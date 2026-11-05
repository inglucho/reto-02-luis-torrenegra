/**
 * Genera `modulo/` (bonus 9.4 del PRD) desde las mismas fuentes que usa la aplicación:
 * el prompt (`agent/prompt.md`) y el conocimiento (`src/knowledge/registro-contratos.md`).
 * Las herramientas no se copian: `modulo/tools/contratos.ts` reexporta `src/tools/contratos.ts`.
 *
 *   bun run modulo            # regenera los archivos
 *   bun run modulo --check    # falla si están desactualizados (lo usa el test)
 */
import { join } from "node:path";

const raiz = join(import.meta.dir, "..");

export async function contenidoModulo(): Promise<Record<string, string>> {
  const prompt = (await Bun.file(join(raiz, "agent", "prompt.md")).text()).trim();
  const conocimiento = (await Bun.file(join(raiz, "src", "knowledge", "registro-contratos.md")).text()).trim();
  return {
    "modulo/agent.md": `---
description: Punto único de recepción del buzón de contratos; extrae los datos con confianza por campo, detecta duplicados y actualizaciones, registra en el maestro y genera alertas de vencimiento y pólizas, con revisión humana de lo dudoso.
mode: primary
permission:
  edit: deny
  bash: deny
---

${prompt}
`,
    "modulo/skill/registro-contratos/SKILL.md": `---
name: registro-contratos
description: Conocimiento del registro de contratos vigentes de Periferia — clasificación RN1–RN4, confianza y revisión (RN5), reglas del maestro y alertas. Úsalo al procesar el buzón de contratos.
---

${conocimiento}
`,
    "modulo/tools/contratos.ts": `/**
 * Las mismas herramientas que usa la aplicación (no es una copia): cada export es
 * \`{ description, args, execute(args, ctx) }\` y se registra como \`contratos_<export>\`.
 * Se importan sin el servidor; \`ctx.directory\` debe apuntar a la raíz con \`fixtures/\`.
 */
export * from "../../src/tools/contratos";
`,
  };
}

if (import.meta.main) {
  const verificar = process.argv.includes("--check");
  const desactualizados: string[] = [];
  for (const [ruta, contenido] of Object.entries(await contenidoModulo())) {
    const archivo = Bun.file(join(raiz, ruta));
    const actual = (await archivo.exists()) ? await archivo.text() : null;
    if (actual === contenido) continue;
    if (verificar) desactualizados.push(ruta);
    else await Bun.write(join(raiz, ruta), contenido);
  }
  if (desactualizados.length > 0) {
    console.error(`modulo/ desactualizado: ${desactualizados.join(", ")}. Ejecuta \`bun run modulo\`.`);
    process.exit(1);
  }
  console.log(verificar ? "modulo/ sincronizado" : "modulo/ generado");
}
