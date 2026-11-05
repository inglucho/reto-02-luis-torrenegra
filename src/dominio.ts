import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { OpcionesBitacora } from "./core/bitacora";
import { registrar } from "./core/herramientas";
export { presentacion } from "./presentacion";
import * as contratos from "./tools/contratos";

/**
 * Único punto donde se conecta el dominio del reto: cada export de `src/tools/contratos.ts`
 * se registra como `contratos_<export>`. El prompt y el conocimiento son archivos.
 */
export const herramientas = registrar("contratos", contratos);

/** Las herramientas ya escriben su línea en out/log.jsonl con el formato de RN7; el núcleo solo agrega, con el mismo formato, las llamadas que no llegaron a ejecutarse (CA4). */
export const opcionesBitacora: OpcionesBitacora = { soloNoEjecutadas: true, formato: "rn7" };



/**
 * System prompt = comportamiento (`agent/prompt.md`) + conocimiento del proceso
 * (`src/knowledge/*.md`). Se mantienen en archivos separados, como pide el PRD.
 */
export async function cargarSistema(directorio: string): Promise<string> {
  const prompt = await Bun.file(join(directorio, "agent", "prompt.md")).text();
  const carpeta = join(directorio, "src", "knowledge");
  const archivos = (await readdir(carpeta)).filter((f) => f.endsWith(".md")).sort();
  const conocimiento = await Promise.all(archivos.map((f) => Bun.file(join(carpeta, f)).text()));
  return [prompt.trim(), "# Conocimiento del proceso", ...conocimiento.map((c) => c.trim())].join("\n\n");
}
