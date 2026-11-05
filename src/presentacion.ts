import type { Presentacion } from "./core/presentacion";

/**
 * Lo que el chat le explica a quien lo usa: qué hace el agente, ejemplos con lo que se
 * puede esperar, los datos de prueba y cómo funcionan las confirmaciones. Los resultados
 * esperados son los que verifica `demo.ts`.
 */
export const presentacion: Presentacion = {
  reto: "Reto 02",
  titulo: "Registro de Contratos Vigentes",
  descripcion:
    "Punto único de recepción del buzón de contratos: extrae los datos de cada contrato con su nivel de confianza, detecta duplicados y otrosíes, lo registra en el maestro y alerta sobre vencimientos y pólizas. Lo dudoso lo confirmas tú.",
  placeholder: "Escribe una instrucción, por ejemplo: Procesa el buzón con fecha 2026-09-03",
  queHace: [
    "Lee el buzón de contratos y reconoce qué trae cada correo: un contrato, un otrosí u otro documento.",
    "Extrae los datos del contrato (cliente, NIT, valor, fechas y pólizas) y le da a cada uno un nivel de confianza, con la evidencia del texto. Nunca inventa un dato.",
    "Clasifica cada mensaje: nuevo, actualización (otrosí), duplicado o rechazado.",
    "Registra en el maestro, archiva el documento en SharePoint y guarda el historial de cambios.",
    "Genera el reporte de alertas: contratos por vencer, pólizas pendientes y lo registrado desde el corte del 30 de mayo.",
  ],
  sugerencias: [
    {
      titulo: "Procesar el buzón",
      texto:
        "Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.",
      espera: "Registra lo limpio, deja msg-006 en revisión (valor y fecha fin) con su evidencia y cierra con las alertas. Toma más tiempo.",
    },
    {
      titulo: "Ver el buzón",
      texto: "¿Qué mensajes hay pendientes en el buzón y cuáles traen contrato?",
      espera: "Lista los mensajes pendientes y marca cuáles traen contrato u otrosí; msg-005 es solo una cotización.",
    },
    {
      titulo: "Extraer un contrato",
      texto: "Extrae los datos del contrato del mensaje msg-001 y muéstrame la confianza de cada campo.",
      espera: "Muestra cada campo con su valor, su confianza (de 0 a 1) y la evidencia en el texto del contrato.",
    },
    {
      titulo: "Revisar un otrosí",
      texto: "Valida el mensaje msg-003 y explícame qué cambia en el contrato.",
      espera: "Detecta el otrosí de CT-2026-011: nuevo valor, nueva fecha de fin y la póliza que debe ampliarse.",
    },
    {
      titulo: "Reporte de alertas",
      texto: "Genera el reporte de alertas con fecha 2026-09-03 y resúmelo.",
      espera: "Crea out/alertas.md con los contratos que vencen en 60 días, las pólizas pendientes y lo registrado desde el corte.",
    },
  ],
  casos: [
    { id: "msg-001", descripcion: "Contrato · Industrias Delta · implementación de CRM", resultado: "Nuevo, con póliza pendiente", tono: "ok", instruccion: "Procesa el mensaje msg-001 del buzón." },
    { id: "msg-002", descripcion: "Contrato · Corporación Andina · fábrica de software (USD)", resultado: "Nuevo, sin póliza", tono: "ok", instruccion: "Procesa el mensaje msg-002 del buzón." },
    { id: "msg-003", descripcion: "Otrosí · Minera Los Andes", resultado: "Actualiza valor, fecha fin y póliza", tono: "info", instruccion: "Procesa el mensaje msg-003 del buzón." },
    { id: "msg-004", descripcion: "Reenvío · Clínica San Rafael", resultado: "Duplicado: no se escribe nada", tono: "info", instruccion: "Procesa el mensaje msg-004 del buzón." },
    { id: "msg-005", descripcion: "Cotización · Universidad del Valle del Río", resultado: "Rechazado: no es un contrato", tono: "bloqueo", instruccion: "Procesa el mensaje msg-005 del buzón." },
    { id: "msg-006", descripcion: "Contrato marco · Distribuidora Caribe", resultado: "Pide revisar valor y fecha fin", tono: "confirmar", instruccion: "Procesa el mensaje msg-006 del buzón." },
  ],
  confirmaciones:
    "El agente no registra nada dudoso por su cuenta. Si un campo tiene confianza menor a 0,8 o choca con el maestro, te muestra el valor propuesto, su confianza y de dónde salió, y se detiene. Responde «Confirmo» o corrige el valor, por ejemplo: «confirmo el valor 0 y la fecha fin 2027-08-31». La confirmación solo vale para ese mensaje.",
  resultados: [
    { ruta: "out/sharepoint/maestro-contratos.csv", descripcion: "El maestro actualizado (el original de los fixtures nunca se modifica)." },
    { ruta: "out/sharepoint/Contratos/<año>/<cliente>/", descripcion: "Los documentos archivados como en SharePoint." },
    { ruta: "out/sharepoint/historial.jsonl", descripcion: "Cada alta o cambio, con el antes y el después." },
    { ruta: "out/procesados.json", descripcion: "Los mensajes ya procesados y su resultado." },
    { ruta: "out/alertas.md", descripcion: "El reporte de alertas para gerencia." },
    { ruta: "out/log.jsonl", descripcion: "Cada ejecución de herramienta." },
  ],
};
