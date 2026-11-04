import { appendFile, mkdir } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { aCelda } from "./clasificacion";
import { escribirCsv } from "./csv";
import { asegurarCopiaMaestro, leerMaestro, leerProcesados, type Procesado, rutas } from "./fuentes";
import { slug } from "./texto";
import { COLUMNAS_MAESTRO, type ContratoExtraido, type FilaMaestro, type Validacion, type ValoresContrato } from "./tipos";

export interface ResultadoRegistro {
  id_contrato: string | null;
  accion: "alta" | "actualizacion" | "sin_cambios" | "rechazado";
  ruta_archivo: string | null;
  /** Fila resultante del maestro, para mostrarla en el chat. */
  fila?: FilaMaestro;
}

interface EntradaRegistro {
  mensajeId: string;
  adjunto: { nombre: string; texto: string } | null;
  extraido: ContratoExtraido | null;
  valores: ValoresContrato | null;
  validacion: Validacion;
}

const hoy = () => new Date().toISOString().slice(0, 10);

/**
 * HU-4: escribe en el SharePoint simulado según la clasificación. Quien llama ya
 * verificó RN5 (revisión o confirmación). Un mensaje se procesa una sola vez.
 */
export async function registrar(dir: string, e: EntradaRegistro): Promise<ResultadoRegistro> {
  await asegurarCopiaMaestro(dir);
  const { clasificacion } = e.validacion;
  let resultado: ResultadoRegistro;
  if (clasificacion === "rechazado") resultado = { id_contrato: null, accion: "rechazado", ruta_archivo: null };
  else if (clasificacion === "duplicado") resultado = await sinCambios(dir, e.validacion);
  else if (clasificacion === "nuevo") resultado = await alta(dir, e);
  else resultado = await actualizacion(dir, e);
  await marcarProcesado(dir, e.mensajeId, resultado);
  return resultado;
}

async function sinCambios(dir: string, v: Validacion): Promise<ResultadoRegistro> {
  const fila = (await leerMaestro(dir)).find((f) => f.id_contrato === v.id_contrato_existente);
  return { id_contrato: v.id_contrato_existente ?? null, accion: "sin_cambios", ruta_archivo: fila?.ruta_sharepoint ?? null };
}

/** Si el documento no trae número: AUTO-<año>-<secuencia> (sección 7.2). */
function idAutomatico(maestro: FilaMaestro[], anio: string): string {
  const usados = maestro.filter((f) => f.id_contrato.startsWith(`AUTO-${anio}-`)).length;
  return `AUTO-${anio}-${String(usados + 1).padStart(3, "0")}`;
}

async function alta(dir: string, e: EntradaRegistro): Promise<ResultadoRegistro> {
  const v = e.valores;
  if (!v || !e.adjunto) throw new Error("No hay contrato que registrar.");
  const maestro = await leerMaestro(dir);
  const anio = (v.fecha_inicio ?? hoy()).slice(0, 4);
  const id = v.id_contrato ?? idAutomatico(maestro, anio);
  const ruta = join("Contratos", anio, slug(v.cliente ?? "sin-cliente"), `${id}${extname(e.adjunto.nombre) || ".txt"}`);
  await archivar(dir, ruta, e.adjunto.texto);

  const fila: FilaMaestro = {
    id_contrato: id,
    cliente: aCelda(v.cliente),
    nit_cliente: aCelda(v.nit_cliente),
    pais: aCelda(v.pais),
    objeto: aCelda(v.objeto),
    valor: aCelda(v.valor),
    moneda: aCelda(v.moneda),
    fecha_inicio: aCelda(v.fecha_inicio),
    fecha_fin: aCelda(v.fecha_fin),
    requiere_poliza: aCelda(v.requiere_poliza),
    tipo_poliza: v.requiere_poliza ? aCelda(v.tipo_poliza) : "",
    estado_poliza: v.requiere_poliza ? "pendiente" : "no_aplica",
    comercial: e.validacion.comercial ?? "",
    ruta_sharepoint: ruta,
    fecha_registro: hoy(),
    fuente: "buzon",
  };
  await guardarMaestro(dir, [...maestro, fila]);
  await historial(dir, { id_contrato: id, accion: "alta", cambios: fila, mensaje_id: e.mensajeId });
  return { id_contrato: id, accion: "alta", ruta_archivo: ruta, fila };
}

async function actualizacion(dir: string, e: EntradaRegistro): Promise<ResultadoRegistro> {
  const id = e.validacion.id_contrato_existente;
  const maestro = await leerMaestro(dir);
  const fila = maestro.find((f) => f.id_contrato === id);
  if (!fila || !id || !e.adjunto) throw new Error(`El contrato ${id} ya no está en el maestro.`);

  // El otrosí se archiva junto al contrato original, sin reemplazarlo.
  const sufijo = e.extraido?.tipo_documento === "otrosi" ? "otrosi" : "version";
  const carpeta = fila.ruta_sharepoint ? dirname(fila.ruta_sharepoint) : join("Contratos", fila.fecha_inicio.slice(0, 4), slug(fila.cliente));
  const ruta = join(carpeta, `${id}-${sufijo}-${e.mensajeId}${extname(e.adjunto.nombre) || ".txt"}`);
  await archivar(dir, ruta, e.adjunto.texto);

  const cambios = e.validacion.diferencias ?? [];
  const actualizada: FilaMaestro = { ...fila };
  for (const c of cambios) Object.assign(actualizada, { [c.campo]: c.despues });
  await guardarMaestro(dir, maestro.map((f) => (f.id_contrato === id ? actualizada : f)));
  await historial(dir, { id_contrato: id, accion: "actualizacion", cambios, mensaje_id: e.mensajeId, documento: ruta });
  return { id_contrato: id, accion: "actualizacion", ruta_archivo: ruta, fila: actualizada };
}

async function archivar(dir: string, ruta: string, contenido: string) {
  const destino = join(rutas(dir).sharepoint, ruta);
  await mkdir(dirname(destino), { recursive: true });
  await Bun.write(destino, contenido);
}

async function guardarMaestro(dir: string, filas: FilaMaestro[]) {
  await Bun.write(rutas(dir).maestro, escribirCsv(COLUMNAS_MAESTRO, filas));
}

async function historial(dir: string, entrada: Record<string, unknown>) {
  const ruta = rutas(dir).historial;
  await mkdir(dirname(ruta), { recursive: true });
  await appendFile(ruta, `${JSON.stringify({ ts: new Date().toISOString(), ...entrada })}\n`);
}

async function marcarProcesado(dir: string, mensajeId: string, r: ResultadoRegistro) {
  const procesados = await leerProcesados(dir);
  const entrada: Procesado = { accion: r.accion, id_contrato: r.id_contrato, ruta_archivo: r.ruta_archivo, ts: new Date().toISOString() };
  await mkdir(dirname(rutas(dir).procesados), { recursive: true });
  await Bun.write(rutas(dir).procesados, `${JSON.stringify({ ...procesados, [mensajeId]: entrada }, null, 2)}\n`);
}
