import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { OpcionesBitacora } from "./core/bitacora";
import { registrar } from "./core/herramientas";
import * as contratos from "./tools/contratos";

/**
 * Único punto donde se conecta el dominio del reto: cada export de `src/tools/contratos.ts`
 * se registra como `contratos_<export>`. El prompt y el conocimiento son archivos.
 */
export const herramientas = registrar("contratos", contratos);

/** Las herramientas ya escriben su línea en out/log.jsonl con el formato de RN7; el núcleo solo agrega, con el mismo formato, las llamadas que no llegaron a ejecutarse (CA4). */
export const opcionesBitacora: OpcionesBitacora = { soloNoEjecutadas: true, formato: "rn7" };

/** Cómo se presenta el agente en el chat: título, descripción y sugerencias para empezar. */
export const presentacion = {
  reto: "Reto 02",
  titulo: "Registro de Contratos Vigentes",
  descripcion:
    "Punto único de recepción del buzón de contratos: extrae los datos de cada contrato con su nivel de confianza, detecta duplicados y otrosíes, lo registra en el maestro y alerta sobre vencimientos y pólizas. Lo dudoso lo confirmas tú.",
  sugerencias: [
    {
      titulo: "Procesar el buzón",
      texto:
        "Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.",
    },
    { titulo: "Ver el buzón", texto: "¿Qué mensajes hay pendientes en el buzón y cuáles traen contrato?" },
    { titulo: "Extraer un contrato", texto: "Extrae los datos del contrato del mensaje msg-001 y muéstrame la confianza de cada campo." },
    { titulo: "Reporte de alertas", texto: "Genera el reporte de alertas con fecha 2026-09-03 y resúmelo." },
  ],
};


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
