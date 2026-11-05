# SOLUCION — Reto 02: Registro de Contratos Vigentes

## 1. Problema en una frase

El registro de contratos vigentes murió el 30 de mayo de 2026 con la salida de la persona que lo alimentaba, y hoy solo llegan a administración los contratos con póliza. Por eso la dirección no sabe qué contratos están vigentes ni cuáles vencen, y nadie vigila que las pólizas exigidas se constituyan. Le duele a la analista administrativa, que es dueña del dato, y a la gerencia, que necesita la visibilidad.

## 2. Arquitectura

```
┌──────────── web/ (chat) ─────────────┐   POST /api/chat    ┌──────────── src/server.ts ────────────┐
│ historial · tarjetas de herramientas │ ──────────────────▶ │ sesiones en memoria · SSE             │
│ turno resaltado si pide revisión     │ ◀── SSE: texto,     │  src/core/agente.ts (ciclo del agente)│
│ botones Confirmo / No, cancela       │   llamada, resultado│   tope de iteraciones y de tokens     │
└──────────────────────────────────────┘   fin_turno         │   guardia de confirmación (CA3)       │
                                                             └───┬───────────────┬───────────────────┘
                                          src/llm/adapter.ts ◀───┘               ▼
                                          gemini.ts · anthropic.ts   src/tools/contratos.ts (contratos_*)
                                                                                 │  log por ejecución → out/log.jsonl
                     src/contratos/  texto · extracción · clasificación · registro · alertas · csv
                                                                                 │
              fixtures/reto-02 (lectura): buzon/, maestro-contratos.csv, comerciales.json
              out/ (escritura): sharepoint/{maestro-contratos.csv, historial.jsonl, Contratos/<año>/<cliente>/},
                                procesados.json, alertas.md, log.jsonl
```

| Capa | Dónde | Qué contiene |
|---|---|---|
| Comportamiento | `agent/prompt.md` | Cómo procesa el buzón, cuándo pregunta y cómo presenta los resultados |
| Conocimiento | `src/knowledge/registro-contratos.md` | Las reglas RN1–RN7, la confianza, las reglas del maestro y las alertas. Se anexa al prompt |
| Ejecución | `src/tools/contratos.ts` → `src/contratos/` | Herramientas tipadas con zod y, debajo, extracción y clasificación como funciones puras |

## 3. Ciclo del agente

El ciclo es propio (`src/core/agente.ts`, unas 250 líneas) y no depende del proveedor. Se agrega el mensaje del usuario a la sesión, cuyo historial solo crece. Luego se llama al modelo vía `AdaptadorLLM.enviar(mensajes, herramientas)`, se validan con zod los argumentos de cada herramienta, se ejecuta y se devuelve el resultado al modelo. Esto se repite hasta que el modelo responde sin herramientas. Cada llamada se emite al chat por SSE.

**Topes (CA1 y costo).** Hay un máximo de 25 rondas por turno: en la última, los resultados van con una nota que le pide al modelo cerrar con lo que tiene. Si aun así pide más herramientas, no se ejecutan y el turno termina con un resumen determinista de lo hecho y lo que falta. Para el costo hay tres topes configurables: tokens por conversación, **tokens por día para todo el servidor** (el link es público y cualquiera podría abrir conversaciones nuevas) y **mensajes por IP** en una ventana de minutos. A eso se suma un timeout al proveedor.

**Revisión humana (CA3 y RN5), en tres capas:**
1. **La herramienta decide.** `contratos_validar` y `contratos_registrar` marcan `confirmacion` cuando hay campos con confianza < 0,8 o conflictos con el maestro. `contratos_registrar` no escribe sin `confirmado: true`.
2. **El backend garantiza, por acción y por caso.** Cada confirmación queda ligada a la herramienta que la pidió y al caso (`caso` o `mensaje_id`). Confirmar msg-006 no autoriza registrar otro mensaje ("confirmo el valor 0 y la fecha fin 2027-08-31" sí cuenta como confirmación). Una validación puede declarar qué acción habilita (por ejemplo, validar habilita crear o registrar). `confirmado: true` solo pasa si el siguiente mensaje del usuario confirma sin negar; si el modelo lo usa por su cuenta, el backend lo bloquea. La detección reconoce "sí" con tilde y frases como "confirmo, no hay más cambios".
3. **Al registrar, el modelo solo puede cambiar campos de baja confianza.** Los demás deben coincidir con lo extraído del documento: el modelo propone y la analista confirma, pero nadie altera lo que el documento dice con claridad.

**Errores (CA5 y HU-6).** Un mensaje malo devuelve `{ ok: false, error }` y el lote sigue. En la prueba real, cuando se agotó la cuota gratuita, el chat mostró *"Se alcanzó el límite de uso gratuito… espera un minuto"* y la sesión siguió viva.

**Bitácora (RN7 y CA4).** Cada herramienta escribe `{ ts, herramienta, mensaje_id, ok, resumen }` en `out/log.jsonl`, así queda registro también cuando se ejecuta desde `demo.ts`. El núcleo agrega, con el mismo formato, las llamadas que no llegan a ejecutarse (herramienta desconocida, argumentos inválidos, confirmación bloqueada o fuera del tope), sin duplicar las demás.

**Adaptador LLM.** La interfaz es `enviar(mensajes, herramientas, opciones)`. El tercer parámetro lleva el system prompt y el callback de streaming: el contrato del PRD no lo nombra, pero cualquier proveedor lo necesita. Cambiar de proveedor no toca el ciclo.

**Interfaz de chat.** La pantalla inicial propone instrucciones de ejemplo. Cada respuesta muestra los pasos del agente: la herramienta, sus argumentos y un resumen en lenguaje natural que escribe la propia herramienta (el JSON completo queda plegado). Las respuestas se renderizan en Markdown escapando todo el HTML, y la confirmación se destaca con botones.

## 4. Elección del modelo

**Proveedor y modelo:** Google Gemini, `gemini-3.5-flash`, con respaldo automático a `gemini-3.5-flash-lite` y luego a `gemini-3.1-flash-lite`.

**Por qué:**
- **Costo cero para la demo.** La capa gratuita de Google AI Studio no exige tarjeta, así que nadie puede generar una factura con la clave.
- **El trabajo del modelo es orquestar y redactar, no extraer.** La extracción es determinista y vive en el código (sección 5), así que un modelo rápido basta.
- **Disponibilidad.** Cada modelo tiene su propia cuota gratuita. Ante un 503 o un 429, el adaptador pasa al siguiente en la misma petición; en la prueba del buzón completo pasó tres veces sin que el usuario lo notara.
- **Independencia del proveedor.** Existe una implementación de Anthropic y se cambia con `LLM_PROVIDER`, sin tocar el ciclo.

**Costo estimado por contrato.** Medí el consumo real con el prompt de la sección 11 del PRD:

| Escenario | Llamadas al modelo | Entrada (+ caché) | Salida |
|---|---|---|---|
| Buzón completo (6 mensajes, validar + registrar + alertas) | 15 | 47.200 (+17.900) | 1.600 |
| Confirmación de msg-006 | 3 | 10.000 (+11.900) | 130 |

Eso da unos **11.000 tokens de entrada y 300 de salida por mensaje**. En la capa gratuita, el costo es **$0**. Con tarifas de pago de Anthropic (USD por millón, entrada / salida):

| Modelo | Tarifa | Por contrato | 100 contratos al mes |
|---|---|---|---|
| Claude Haiku 5.5 | 0,10 / 0,50 | ≈ USD 0,0013 | ≈ USD 0,13 |
| Claude Sonnet 5.5 | 2 / 10 | ≈ USD 0,025 | ≈ USD 2,5 |
| Claude Opus 5.5 | 4 / 20 | ≈ USD 0,05 | ≈ USD 5 |

La caché de prompts abarata la entrada en los turnos siguientes. Para Gemini en capa de pago se aplica la misma fórmula con su tarifa vigente.

## 5. Estrategia de extracción

La extracción es **determinista** (`src/contratos/extraccion.ts`): regex y heurísticas sobre el texto, sin modelo. El modelo no extrae ningún valor que se registre. Así la extracción es reproducible, `demo.ts` la verifica sin clave y un valor nunca depende de cómo "interprete" el modelo ese día.

**Cómo se encuentra cada campo:**

| Campo | Cómo | Confianza |
|---|---|---|
| `id_contrato` | `CONTRATO … No. XX-AAAA-NNN` en el título; en un otrosí, `AL CONTRATO … No.` | 0,95 |
| `cliente` | Bloque de firmas, la columna que no es Periferia (mejor capitalizada que el encabezado en mayúsculas). Si no está, el encabezado `Entre …, identificada` | 0,9 / 0,75 |
| `nit_cliente` | Primer `NIT/RUC/RTN` que no es el de Periferia. Al NIT colombiano se le quitan puntos y dígito de verificación | 0,95 |
| `pais` | Tipo de identificador (NIT → CO, RUC de 13 → EC, RUC de 11 → PE, RTN → HN) cruzado con la ciudad del domicilio | 0,95 si coinciden; 0,85 con uno; 0,5 si se contradicen |
| `objeto` | Cláusula OBJETO, sin "EL CONTRATISTA se obliga a…", hasta 200 caracteres | 0,9 |
| `valor` y `moneda` | En la cláusula VALOR, el código y el número entre paréntesis (`COP $265.000.000`, `USD 120,000.00`). Se aceptan los formatos colombiano y estadounidense: el último separador seguido de dos dígitos es el decimal. Una moneda fuera del maestro es un error | 0,95 |
| Valor indeterminado | "no tiene un valor determinado" → valor 0 y `valor_indeterminado = true` | 0,5 |
| `fecha_inicio` y `fecha_fin` | "desde … hasta …" con el número entre paréntesis: "el treinta y uno (31) de julio de 2027" → 2027-07-31. Se valida que la fecha exista | 0,95 |
| Plazo en meses | "doce (12) meses a partir de la firma" → fin = inicio + 12 meses − 1 día (la convención de los demás contratos) | 0,9 si la firma tiene día; 0,6 si no |
| Firma sin día | "en el mes de agosto de 2026" → día 1 por convención | 0,8 |
| `requiere_poliza` y `tipo_poliza` | Cláusula GARANTÍAS con "póliza" y tipos (cumplimiento, calidad, salarios, responsabilidad civil…). Si la póliza depende de cada orden de servicio, la confianza baja | 0,95 / 0,85; sin cláusula, `false` con 0,9 |

**Escala de confianza:**

| Valor | Significado |
|---|---|
| 0,95 | Literal e inequívoco |
| 0,9 | Literal con una interpretación menor |
| 0,85 | Dos fuentes indirectas o una regla condicionada |
| 0,8 | Convención documentada |
| 0,6 | Derivado de un dato aproximado |
| 0,5 | El documento no lo define |
| 0 | Ausente: `null`, nunca inventado |

El umbral de RN5 es 0,8. Con esta escala, msg-006 deja en revisión exactamente `valor` (0,5) y `fecha_fin` (0,6), como espera el PRD.

**Otrosíes.** Se detectan por el título. Solo traen los campos que modifican; lo demás queda en `null` con confianza 0 y se conserva del maestro, no se pide revisar. Si el otrosí dice que las garantías "deberán ampliarse", el estado de la póliza pasa a `pendiente`, porque el contrato vuelve a necesitar gestión con el corredor.

**Dónde entra el modelo y dónde no.** El modelo decide el orden de las herramientas, explica los resultados y traslada a `contrato` lo que la analista corrige. No extrae, no clasifica y no puede cambiar un campo de alta confianza.

## 6. Regla de gobierno

**Propuesta: "Todo contrato firmado entra por el buzón de contratos en 3 días hábiles. Si no está en el maestro, no se factura."**

1. **Canal único.** El buzón es `contratos@periferia.com`. Lo administra la analista administrativa como dueña del maestro, con un suplente nombrado por la gerencia administrativa para que el proceso no dependa de una sola persona. Nadie más recibe contratos para registro.
2. **Obligación del comercial.** Dentro de los **3 días hábiles** siguientes a la firma, el comercial responsable envía el PDF firmado por ambas partes. Aplica a todo contrato, con o sin póliza, y también a otrosíes, actas de inicio y actas de terminación. El asunto sigue el formato `[CONTRATO|OTROSI|ACTA] <cliente> – <número>`, por ejemplo `[OTROSI] Minera Los Andes – CT-2026-011`. Un correo, un documento.
3. **Acuse automático.** En menos de una hora, el agente responde al comercial con el resultado: registrado (número y ruta en SharePoint), en revisión (qué campo y por qué), duplicado o rechazado (motivo). Si el contrato exige póliza, el acuse incluye el recordatorio de solicitarla al corredor.
4. **Excepciones y escalamiento.**
   - Un contrato sin firma de ambas partes no se registra: se devuelve al comercial.
   - Un contrato sin valor (marco o por demanda) se registra con valor 0 tras la confirmación de la analista, y cada orden de servicio se envía después como anexo.
   - Lo que siga en revisión más de 5 días hábiles se escala a la dirección comercial, porque el dato faltante lo tiene el comercial.
   - Los remitentes que no están en el catálogo, como el practicante de msg-006, se registran igual y se informa a la dirección comercial para que actualice el catálogo.
5. **Cierre del gap de junio a agosto de 2026, en una sola campaña de dos semanas.**
   - Contabilidad extrae los clientes facturados entre el 30 de mayo y hoy.
   - Se cruza contra el maestro.
   - A cada comercial se le envía la lista de clientes facturados sin contrato registrado, y tiene 5 días hábiles para enviarlos al buzón con el asunto `[CONTRATO]`.
   - Lo registrado en la campaña queda con `fuente = migracion`, para distinguirlo.
   - Al cierre, la sección 3 de `out/alertas.md` muestra el gap cubierto.
6. **Indicador mensual.** **% de clientes facturados en el mes que tienen un contrato vigente en el maestro.** La meta es 100 %. Se complementa con el tiempo promedio entre la firma y el registro (meta ≤ 3 días hábiles) y con el número de pólizas exigidas que siguen pendientes. La gerencia lo revisa en el comité mensual. Si baja, alguien está facturando sin contrato registrado, y eso es exactamente lo que este proceso quiere evitar.

**Dueño del maestro.** Esto responde la pregunta abierta del PRD: la gerencia administrativa es la dueña del proceso, la analista es la dueña del dato y la dirección comercial responde por el cumplimiento de sus comerciales.

## 7. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | **Extracción determinista con confianza por heurística** | Extraer con el modelo (salida estructurada) y pedirle una confianza | Una confianza autodeclarada por el modelo no es calibrada ni reproducible. Con reglas, cada confianza tiene una razón explicable ("la firma no trae día"), la demo corre sin clave y el valor registrado nunca depende del modelo |
| 2 | **Al registrar, solo se pueden cambiar campos de baja confianza** | Aceptar el `contrato` que envíe el modelo tal cual | Mitiga el riesgo del PRD de que el modelo redondee un valor o infiera una fecha. Lo leído con claridad no se toca; lo dudoso lo decide la analista |
| 3 | **Un otrosí solo aplica los campos que trae** | Tratarlo como un contrato completo y comparar todo | Si no, los campos ausentes del otrosí parecerían "borrados" o irían a revisión innecesaria. Además se detecta que las pólizas deben ampliarse |
| 4 | **Duplicados y rechazados también pasan por `contratos_registrar`** (sin escribir el maestro) | Que solo los registrables se marquen como procesados | Si no, quedarían para siempre en el buzón pendiente. Así cada mensaje termina con un estado |
| 5 | **Gemini en capa gratuita con dos modelos de respaldo** | Un modelo de pago | Costo cero; el respaldo encadenado compensa la cuota y la saturación de la capa gratuita |
| 6 | **CSV leído y escrito con un parser RFC 4180 propio** (30 líneas) | Una dependencia de CSV | Los objetos tienen comas y comillas. El parser es pequeño, está probado y evita otra dependencia |

### Dependencias

| Dependencia | Para qué | Alternativa descartada |
|---|---|---|
| `zod` | Esquemas de los argumentos de herramientas y de los datos (obligatorio por el PRD) | — |
| `@google/genai` | SDK oficial de Gemini, el proveedor por defecto | Llamar la API REST a mano: más código propio y sin tipos |
| `@anthropic-ai/sdk` | Segundo adaptador, para demostrar que el proveedor se cambia sin tocar el ciclo | — |
| `typescript`, `@types/bun` (solo desarrollo) | Verificación de tipos estricta | — |

Bun aporta el servidor HTTP, el empaquetado del front, el test runner y la lectura de archivos, así que no hicieron falta Express, Vite ni Jest.

## 8. Supuestos

1. El maestro de trabajo es una copia en `out/sharepoint/`, hecha en la primera ejecución. El fixture no se modifica nunca (RN6).
2. `fecha_registro` es la fecha de referencia del negocio (`FECHA_REFERENCIA`; vacía, hoy). La demo usa 2026-09-03, la misma fecha de las alertas, para que el reporte sea coherente.
3. Si la firma solo indica mes y año, el inicio es el día 1 de ese mes (confianza 0,8). En msg-006, la analista corrige `fecha_fin` a 2027-08-31, como en el ejemplo del PRD.
4. El plazo en meses sigue la convención de los demás contratos: fin = inicio + N meses − 1 día.
5. Un contrato marco que exige póliza para las órdenes que superen un monto se registra con `requiere_poliza = true` y estado `pendiente`, para que aparezca en las alertas.
6. Un otrosí cuyo contrato original no está en el maestro se rechaza: primero hay que registrar el original.
7. Un contrato reenviado (no otrosí) con el mismo número pero campos distintos se clasifica como actualización con **conflicto**, y siempre va a revisión.
8. El remitente desconocido se registra con `comercial` vacío y una advertencia, sin bloquear.
9. Los documentos se archivan con su extensión original (`.txt` en los fixtures). Un otrosí se archiva junto al contrato, sin reemplazarlo: `<id>-otrosi-<mensaje>.txt`.
10. El reporte de alertas añade una lista de contratos ya vencidos sin renovación. No la pide el PRD, pero es el riesgo más alto que muestran los datos (CT-2025-018 y CT-2026-002).
11. El contrato extraído se entrega como `campos.<nombre> = { valor, confianza, evidencia }`: la confianza por campo que pide HU-2 necesita esa forma. El esquema plano de la sección 7.2 es el de la fila del maestro, que es lo que se registra.
12. El argumento `contrato` de validar y registrar es opcional y parcial: solo lleva los valores que la analista confirma o corrige, con un esquema zod por campo. Si se omite, se usa lo extraído del documento.

## 9. Cobertura

| Historia | Estado | Notas | Falta para producción |
|---|---|---|---|
| HU-1 Leer el buzón | ✅ Hecho | Pendientes, `tiene_contrato`, rechazados con motivo | Conexión a Exchange o Graph |
| HU-2 Extraer | ✅ Hecho | Confianza y evidencia por campo; ausente = `null` con 0 | OCR para escaneados y lectura de PDF nativo (P1 no hecho) |
| HU-3 Validar y clasificar | ✅ Hecho | RN1–RN5, diferencias, conflictos y remitente desconocido | Deduplicar también contra SharePoint real |
| HU-4 Registrar y archivar | ✅ Hecho | Maestro, carpeta por año y cliente, historial y procesados; idempotente | API de SharePoint y bloqueo de concurrencia del CSV |
| HU-5 Alertas | ✅ Hecho | Tres secciones + vencidos, con fecha `hoy` como argumento | Envío programado por correo |
| HU-6 Errores | ✅ Hecho | Texto vacío, fecha inválida, moneda desconocida, mensaje inexistente e id inseguro | Alertas operativas |
| `contratos_leer_pdf` (P1) | ❌ No hecho | Opcional | — |
| Bonus `modulo/` | ✅ Hecho | Generado de las mismas fuentes y verificado por test | — |

## 10. Uso de IA

Usé **Claude Code** (modelo Claude Opus 5.5) como asistente de desarrollo:

| Tarea | Qué hizo la IA | Qué decidí o revisé yo |
|---|---|---|
| Análisis | Leyó el PRD y los 6 mensajes y detectó las trampas de los datos: NIT compartido con otro contrato, monto en formato estadounidense, otrosí que obliga a ampliar pólizas y firma sin día | Validar la tabla de resultados esperados |
| Reutilización | Partió del núcleo común construido para el reto 03 (ciclo, adaptador LLM, chat) | La estrategia de un núcleo para los tres retos |
| Extracción | Escribió las heurísticas y la escala de confianza; ajustó las confianzas contra los fixtures hasta que msg-006 dejó en revisión exactamente `valor` y `fecha_fin` | Que cada confianza tuviera una justificación, no solo que cuadrara |
| Tests | Escribió los tests | — |
| Documentación | Redactó README, CLAUDE.md y este documento, incluida la regla de gobierno | La regla de gobierno como propuesta propia |

**Lo que descarté de lo propuesto o lo que corregí:**
- **Bug con la "Í":** la primera versión no detectaba "OTROSÍ" porque `\b` en JavaScript no trata la "Í" como letra. Lo encontré probando contra el fixture, no en el código.
- **Sufijo "S. de R.L.":** el nombre de carpeta no lo quitaba por espacios dobles. Lo detectó un test.
- **Estado de confirmación en el núcleo:** la prueba real mostró que, si el modelo pedía confirmación y luego registraba con `confirmado` en el mismo turno, el turno quedaba marcado como pendiente. Ahora se mira el estado final de cada herramienta.
- **Bitácora duplicada:** el núcleo también escribía en `out/log.jsonl` con otro formato. La desactivé en este reto para que el log siga exactamente el esquema de RN7.

## 11. Riesgos de llevar esto a producción

| Riesgo | Mitigación |
|---|---|
| Contratos reales más variados que los fixtures (escaneados, otros formatos de cláusula) | Lo que la heurística no reconoce queda en `null` con confianza 0 y va a revisión, nunca se inventa. Medir el % de campos en revisión y ampliar las reglas, o agregar OCR |
| Falsos duplicados por variaciones del nombre del cliente | Se busca primero por número de contrato y luego por NIT + objeto, nunca por nombre |
| El modelo altera un valor | Solo se pueden cambiar campos de baja confianza, con confirmación; lo demás se compara con el documento |
| Escrituras concurrentes al CSV | En producción, SharePoint List o una base de datos con control de concurrencia; el CSV es una simulación |
| Datos sensibles (valores, NIT) en `out/log.jsonl` | Retención limitada, acceso restringido y resúmenes sin cifras en producción |
| Instrucciones maliciosas dentro del texto de un contrato o correo | El texto se procesa con regex como dato. Las decisiones salen de reglas en código, no de lo que diga el documento |
| La regla de gobierno no se cumple | El indicador mensual y la condición "si no está en el maestro, no se factura" hacen visible el incumplimiento |
| Cuota gratuita del proveedor de IA | Modelos de respaldo, mensajes claros y, en producción, capa de pago con límite de gasto |
