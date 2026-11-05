import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { rutas } from "./fuentes";

/**
 * RN7: toda ejecución de una herramienta deja una línea en `out/log.jsonl` con
 * `{ ts, herramienta, mensaje_id, ok, resumen }`. Lo escriben las propias herramientas,
 * así queda registro también cuando se ejecutan sin el agente (demo.ts).
 */
export async function registrarLog(dir: string, entrada: { herramienta: string; mensaje_id: string | null; ok: boolean; resumen: string }) {
  try {
    const ruta = rutas(dir).log;
    await mkdir(dirname(ruta), { recursive: true });
    await appendFile(ruta, `${JSON.stringify({ ts: new Date().toISOString(), ...entrada })}\n`);
  } catch (err) {
    console.error("No se pudo escribir out/log.jsonl:", err);
  }
}
