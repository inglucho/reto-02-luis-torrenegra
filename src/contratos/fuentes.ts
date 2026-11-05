import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { parsearCsv } from "./csv";
import { type Comercial, ComercialSchema, type Correo, CorreoSchema, COLUMNAS_MAESTRO, type FilaMaestro } from "./tipos";

/** Rutas del reto. Los fixtures son de solo lectura; todo lo que se escribe va a `out/`. */
export function rutas(dir: string) {
  const fixtures = join(dir, "fixtures", "reto-02");
  const sharepoint = join(dir, "out", "sharepoint");
  return {
    fixtures,
    buzon: join(fixtures, "buzon"),
    maestroOriginal: join(fixtures, "maestro-contratos.csv"),
    comerciales: join(fixtures, "comerciales.json"),
    sharepoint,
    maestro: join(sharepoint, "maestro-contratos.csv"),
    historial: join(sharepoint, "historial.jsonl"),
    procesados: join(dir, "out", "procesados.json"),
    alertas: join(dir, "out", "alertas.md"),
    log: join(dir, "out", "log.jsonl"),
  };
}

/** Identificador seguro: evita rutas como `../../etc` desde un argumento del modelo. */
export const MensajeIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "El mensaje_id debe ser el nombre de una carpeta del buzón, p. ej. msg-001")
  .describe("Identificador del mensaje: nombre de su carpeta en fixtures/reto-02/buzon/, p. ej. msg-001");

export class ErrorFuente extends Error {
  override name = "ErrorFuente";
}

export async function listarMensajes(dir: string): Promise<string[]> {
  const ids: string[] = [];
  for await (const ruta of new Bun.Glob("*/correo.json").scan(rutas(dir).buzon)) ids.push(ruta.split("/")[0] ?? ruta);
  return ids.sort();
}

export async function leerCorreo(dir: string, id: string): Promise<Correo> {
  const archivo = Bun.file(join(rutas(dir).buzon, id, "correo.json"));
  if (!(await archivo.exists())) throw new ErrorFuente(`No existe el mensaje "${id}" en el buzón.`);
  let crudo: unknown;
  try {
    crudo = JSON.parse(await archivo.text());
  } catch {
    throw new ErrorFuente(`El correo de ${id} no es un JSON válido.`);
  }
  const r = CorreoSchema.safeParse(crudo);
  if (!r.success) throw new ErrorFuente(`El correo de ${id} tiene datos inválidos: ${z.prettifyError(r.error)}`);
  return r.data;
}

export interface Adjunto {
  nombre: string;
  texto: string;
}

const ES_CONTRATO = /^(contrato|otros[ií])/i;

/** Primer adjunto que es un contrato u otrosí, por nombre o por encabezado. `null` si no hay. */
export async function adjuntoContrato(dir: string, correo: Correo): Promise<Adjunto | null> {
  for (const nombre of correo.adjuntos) {
    if (nombre.includes("/") || nombre.includes("..")) continue;
    const archivo = Bun.file(join(rutas(dir).buzon, correo.id, nombre));
    if (!(await archivo.exists())) continue;
    const texto = await archivo.text();
    if (ES_CONTRATO.test(nombre) || /^\s*(CONTRATO|OTROS[ÍI])/i.test(texto)) return { nombre, texto };
  }
  return null;
}

/** RN6: el fixture es de solo lectura; la primera ejecución lo copia a `out/sharepoint/`. */
export async function asegurarCopiaMaestro(dir: string): Promise<void> {
  const r = rutas(dir);
  if (await Bun.file(r.maestro).exists()) return;
  await mkdir(r.sharepoint, { recursive: true });
  await copyFile(r.maestroOriginal, r.maestro);
}

/** Maestro vigente: la copia de trabajo si existe, si no el fixture (sin modificarlo). */
export async function leerMaestro(dir: string): Promise<FilaMaestro[]> {
  const r = rutas(dir);
  const ruta = (await Bun.file(r.maestro).exists()) ? r.maestro : r.maestroOriginal;
  const filas = parsearCsv(await Bun.file(ruta).text());
  return filas.map((f) => Object.fromEntries(COLUMNAS_MAESTRO.map((c) => [c, f[c] ?? ""])) as FilaMaestro);
}

export async function cargarComerciales(dir: string): Promise<Comercial[]> {
  return z.array(ComercialSchema).parse(JSON.parse(await Bun.file(rutas(dir).comerciales).text()));
}

export interface Procesado {
  accion: string;
  id_contrato: string | null;
  ruta_archivo: string | null;
  ts: string;
}

export async function leerProcesados(dir: string): Promise<Record<string, Procesado>> {
  const archivo = Bun.file(rutas(dir).procesados);
  return (await archivo.exists()) ? (JSON.parse(await archivo.text()) as Record<string, Procesado>) : {};
}
