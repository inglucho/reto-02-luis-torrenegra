# Reto 02 — Registro de Contratos Vigentes (prueba técnica Periferia)

Agente conversacional en TypeScript + Bun. El PRD está en `docs/PRD.md` (copia local, no versionada: es material de la prueba); su sección 6 fija la arquitectura (nombres de archivo, contrato de herramientas, API) y la 7 el esquema del maestro y las reglas RN1–RN7. El PRD manda sobre cualquier suposición.

## Comandos

- `bun run dev`: servidor en http://localhost:3000 (el chat requiere `LLM_API_KEY` en `.env`)
- `bun run demo.ts`: los 6 mensajes sin modelo, con verificación del resultado esperado
- `bun test` · `bun run typecheck` · `bun run modulo` (regenera `modulo/`)

Antes de cada commit: `bun run typecheck && bun test && bun run demo.ts`.

## Dónde va cada cosa

- Comportamiento → `agent/prompt.md`. Conocimiento → `src/knowledge/registro-contratos.md`. Ejecución → `src/tools/contratos.ts`.
- Extracción → `src/contratos/extraccion.ts`: cada heurística asigna una confianza según la escala documentada al inicio del archivo. Clasificación → `clasificacion.ts`. Escritura → `registro.ts`.
- Tras editar el prompt o el conocimiento, ejecutar `bun run modulo`; un test falla si `modulo/` queda desactualizado.
- `fixtures/` es de solo lectura (RN6); el maestro de trabajo vive en `out/sharepoint/`.

## Convenciones

- Herramientas: `{ description, args, execute(args, ctx) }`, devuelven string JSON, **nunca lanzan** y escriben su línea en `out/log.jsonl` (RN7).
- Un campo ausente es `null` con confianza 0, nunca inventado. Al registrar, el modelo solo puede cambiar campos de baja confianza, y con `confirmado: true`.
- Código y mensajes en español, TypeScript sin `any`, funciones cortas.
- Ninguna clave en el repo: solo `LLM_API_KEY` en el entorno.
- Nunca hacer commit en `main`: ramas `feat/…`, `fix/…`, `docs/…` y pull request.
