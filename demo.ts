/**
 * Verificación sin modelo de lenguaje (sección 6.6 del PRD): procesa los 6 mensajes del
 * buzón en orden llamando directamente a las herramientas. Lo que requiere revisión queda
 * sin registrar en la primera pasada; luego se muestra una segunda llamada con
 * `confirmado: true` para msg-006 y se genera el reporte de alertas. Compara cada mensaje
 * con el resultado esperado y sale con código 1 si algo no coincide.
 *
 *   bun install && bun run demo.ts
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./src/config";
import { leerResultado } from "./src/core/herramientas";
import { leerMaestro, rutas } from "./src/contratos/fuentes";
import type { Validacion } from "./src/contratos/tipos";
import { alertas, leer_buzon, registrar, validar } from "./src/tools/contratos";

const ctx = { directory: config.directorio, sessionId: "demo" };
/** Fecha de referencia del ejemplo de la sección 11 del PRD. */
const HOY = "2026-09-03";

interface Esperado {
  clasificacion: Validacion["clasificacion"];
  revision: string[];
  /** Acción de la primera pasada (sin confirmar). */
  accion: "alta" | "actualizacion" | "sin_cambios" | "rechazado" | "pendiente";
}

/** Resultados esperados según la tabla 7.4 del PRD. */
const ESPERADO: Record<string, Esperado> = {
  "msg-001": { clasificacion: "nuevo", revision: [], accion: "alta" },
  "msg-002": { clasificacion: "nuevo", revision: [], accion: "alta" },
  "msg-003": { clasificacion: "actualizacion", revision: [], accion: "actualizacion" },
  "msg-004": { clasificacion: "duplicado", revision: [], accion: "sin_cambios" },
  "msg-005": { clasificacion: "rechazado", revision: [], accion: "rechazado" },
  "msg-006": { clasificacion: "nuevo", revision: ["valor", "fecha_fin"], accion: "pendiente" },
};

type Datos = Record<string, unknown>;
let fallos = 0;

function verificar(condicion: boolean, mensaje: string) {
  if (!condicion) {
    fallos++;
    console.log(`   ✘ ${mensaje}`);
  }
}

async function ejecutar(promesa: Promise<string>) {
  const r = leerResultado(await promesa);
  return { ...r, datos: (r.ok ? r.data : {}) as Datos };
}

async function procesar(id: string) {
  const esperado = ESPERADO[id];
  const v = await ejecutar(validar.execute({ mensaje_id: id }, ctx));
  if (!v.ok) {
    fallos++;
    return console.log(`\n■ ${id}  ✘ ${v.error}`);
  }
  const val = v.datos as unknown as Validacion;
  console.log(`\n■ ${id} → ${val.clasificacion.toUpperCase()}`);
  console.log(`   ${val.motivo}`);
  if (val.requiere_revision.length) console.log(`   🔎 En revisión: ${val.requiere_revision.join(", ")}`);
  for (const d of val.diferencias ?? []) console.log(`   ↻ ${d.campo}: ${d.antes || "(vacío)"} → ${d.despues}`);
  for (const a of val.advertencias) console.log(`   ⚠️  ${a}`);

  const r = await ejecutar(registrar.execute({ mensaje_id: id }, ctx));
  const accion = r.ok ? String(r.datos.accion) : r.confirmacion ? "pendiente" : "error";
  if (r.ok) console.log(`   ✅ Acción: ${accion}${r.datos.ruta_archivo ? ` · ${r.datos.ruta_archivo}` : ""}`);
  else if (r.confirmacion) console.log(`   ⏸  No se registró: ${r.error}`);
  else console.log(`   ✘ ${r.error}`);

  if (!esperado) return verificar(false, `mensaje sin resultado esperado: ${id}`);
  verificar(val.clasificacion === esperado.clasificacion, `clasificación: esperado ${esperado.clasificacion}`);
  verificar(JSON.stringify(val.requiere_revision) === JSON.stringify(esperado.revision), `revisión: esperado ${esperado.revision.join(", ") || "ninguna"}`);
  verificar(accion === esperado.accion, `acción: esperado ${esperado.accion}, obtenido ${accion}`);
}

async function confirmarMsg006() {
  console.log('\n■ Segunda llamada: msg-006 con confirmado = true ("confirmo el valor 0 y la fecha fin 2027-08-31")');
  const contrato = { valor: 0, fecha_fin: "2027-08-31" };
  const r = await ejecutar(registrar.execute({ mensaje_id: "msg-006", contrato, confirmado: true }, ctx));
  console.log(r.ok ? `   ✅ ${r.datos.accion} · ${r.datos.id_contrato} · ${r.datos.ruta_archivo}` : `   ✘ ${r.error}`);
  verificar(r.ok && r.datos.accion === "alta", "msg-006 debe registrarse tras confirmar");
}

async function verificarMaestro() {
  const maestro = await leerMaestro(config.directorio);
  const ids = maestro.map((f) => f.id_contrato);
  const minera = maestro.find((f) => f.id_contrato === "CT-2026-011");
  const marco = maestro.find((f) => f.id_contrato === "CM-2026-03");
  const historial = (await Bun.file(rutas(config.directorio).historial).text()).trim().split("\n");
  console.log(`\n■ Maestro: ${maestro.length} contratos (8 del corte + 3 nuevos), ${historial.length} líneas de historial`);
  console.log(`   CT-2026-011 tras el otrosí: valor ${minera?.valor} ${minera?.moneda}, fin ${minera?.fecha_fin}, póliza ${minera?.estado_poliza}`);
  verificar(maestro.length === 11, "el maestro debe tener 11 filas");
  verificar(new Set(ids).size === ids.length, "no debe haber filas duplicadas");
  verificar(minera?.fecha_fin === "2027-11-01" && minera.valor === "520000", "el otrosí debe actualizar CT-2026-011");
  verificar(marco?.valor === "0" && marco.fecha_fin === "2027-08-31", "msg-006 con los valores confirmados");
}

async function reporte() {
  const r = await ejecutar(alertas.execute({ hoy: HOY }, ctx));
  const n = (k: string) => (r.datos[k] as unknown[] | undefined)?.length ?? 0;
  console.log(`\n■ Alertas al ${HOY} → ${r.datos.ruta}`);
  console.log(`   vencen en ≤ 60 días: ${n("vencen")} · ya vencidos: ${n("vencidos")} · pólizas pendientes: ${n("polizas_pendientes")} · registrados desde el corte: ${n("registrados_desde_corte")}`);
  verificar(r.ok && n("vencen") === 2 && n("registrados_desde_corte") === 3, "alertas: 2 por vencer y 3 registrados desde el corte");
}

// Determinismo: cada ejecución parte de `out/` vacío.
await rm(join(config.directorio, "out"), { recursive: true, force: true });
console.log("Demo reto 02 · Registro de contratos vigentes (sin modelo de lenguaje)");

const buzon = await ejecutar(leer_buzon.execute({}, ctx));
const mensajes = (buzon.datos.mensajes as { id: string }[] | undefined) ?? [];
console.log(`Buzón: ${mensajes.length} mensajes pendientes`);
for (const { id } of mensajes) await procesar(id);
await confirmarMsg006();
await verificarMaestro();
await reporte();

console.log("\nArchivos: out/sharepoint/{maestro-contratos.csv, historial.jsonl, Contratos/…} · out/procesados.json · out/alertas.md · out/log.jsonl");
console.log(fallos === 0 ? `\n✔ ${mensajes.length} mensajes con el resultado esperado` : `\n✘ ${fallos} verificaciones fallaron`);
process.exit(fallos === 0 ? 0 : 1);
