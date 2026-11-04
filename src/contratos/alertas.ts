import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { leerMaestro, rutas } from "./fuentes";
import { sumarDias } from "./texto";
import { FECHA_CORTE, type FilaMaestro } from "./tipos";

/** HU-5: ventana de alerta de vencimiento. */
export const DIAS_ALERTA = 60;

export interface Alertas {
  ruta: string;
  vencen: FilaMaestro[];
  /** Ya vencidos sin renovación registrada: no los pide el PRD, pero son el riesgo más alto. */
  vencidos: FilaMaestro[];
  polizas_pendientes: FilaMaestro[];
  registrados_desde_corte: FilaMaestro[];
}

const monto = (f: FilaMaestro) => `${f.moneda} ${Number(f.valor).toLocaleString("es-CO")}`;
const fila = (cols: string[]) => `| ${cols.join(" | ")} |`;

function tabla(encabezados: string[], filas: string[][], vacio: string): string {
  if (filas.length === 0) return `_${vacio}_`;
  return [fila(encabezados), fila(encabezados.map(() => "---")), ...filas.map(fila)].join("\n");
}

/** Genera `out/alertas.md`. La fecha `hoy` llega como argumento para que la demo sea determinista. */
export async function generarAlertas(dir: string, hoy: string): Promise<Alertas> {
  const maestro = await leerMaestro(dir);
  const limite = sumarDias(hoy, DIAS_ALERTA);
  const porFin = (a: FilaMaestro, b: FilaMaestro) => a.fecha_fin.localeCompare(b.fecha_fin);

  const vencen = maestro.filter((f) => f.fecha_fin >= hoy && f.fecha_fin <= limite).sort(porFin);
  const vencidos = maestro.filter((f) => f.fecha_fin && f.fecha_fin < hoy).sort(porFin);
  const polizas = maestro.filter((f) => f.requiere_poliza === "true" && f.estado_poliza !== "vigente");
  const desdeCorte = maestro.filter((f) => f.fecha_registro >= FECHA_CORTE).sort((a, b) => a.fecha_registro.localeCompare(b.fecha_registro));

  const md = [
    `# Alertas de contratos — ${hoy}`,
    "",
    `## 1. Contratos que vencen en ${DIAS_ALERTA} días o menos (hasta ${limite})`,
    "",
    tabla(["Contrato", "Cliente", "Vence", "Valor", "Comercial"], vencen.map((f) => [f.id_contrato, f.cliente, f.fecha_fin, monto(f), f.comercial]), "Ninguno."),
    "",
    "**Ya vencidos sin renovación registrada:**",
    "",
    tabla(["Contrato", "Cliente", "Venció", "Comercial"], vencidos.map((f) => [f.id_contrato, f.cliente, f.fecha_fin, f.comercial]), "Ninguno."),
    "",
    "## 2. Pólizas exigidas que no están vigentes",
    "",
    tabla(["Contrato", "Cliente", "Tipo de póliza", "Estado"], polizas.map((f) => [f.id_contrato, f.cliente, f.tipo_poliza.replace(/;/g, ", "), f.estado_poliza]), "Ninguna."),
    "",
    `## 3. Contratos registrados desde el corte del ${FECHA_CORTE} (gap cubierto)`,
    "",
    tabla(["Contrato", "Cliente", "Registrado", "Fuente"], desdeCorte.map((f) => [f.id_contrato, f.cliente, f.fecha_registro, f.fuente]), "Ninguno todavía."),
    "",
  ].join("\n");

  const ruta = rutas(dir).alertas;
  await mkdir(dirname(ruta), { recursive: true });
  await Bun.write(ruta, md);
  return { ruta: "out/alertas.md", vencen, vencidos, polizas_pendientes: polizas, registrados_desde_corte: desdeCorte };
}
