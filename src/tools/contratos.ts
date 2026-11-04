import { z } from "zod";
import { type Contexto, fallo, leerResultado, ok } from "../core/herramientas";
import { generarAlertas } from "../contratos/alertas";
import { aplicarCorrecciones, validar as clasificar } from "../contratos/clasificacion";
import { ErrorExtraccion, extraer as extraerTexto } from "../contratos/extraccion";
import {
  adjuntoContrato,
  cargarComerciales,
  ErrorFuente,
  leerCorreo,
  leerMaestro,
  leerProcesados,
  listarMensajes,
  MensajeIdSchema,
} from "../contratos/fuentes";
import { registrarLog } from "../contratos/log";
import { registrar as escribirRegistro } from "../contratos/registro";
import { esFechaValida } from "../contratos/texto";

/**
 * Herramientas del reto 02. El modelo las ve como `contratos_<export>`.
 * Todas devuelven `{ ok, data }` o `{ ok: false, error }` serializado, nunca lanzan
 * y dejan su línea en `out/log.jsonl` (RN7).
 */

/** Ejecuta, convierte errores esperados en `{ ok: false }` legibles y registra en la bitácora. */
async function ejecutar(ctx: Contexto, herramienta: string, mensajeId: string | null, cuerpo: () => Promise<string>): Promise<string> {
  let resultado: string;
  try {
    resultado = await cuerpo();
  } catch (err) {
    const esperado = err instanceof ErrorFuente || err instanceof ErrorExtraccion;
    resultado = fallo(esperado ? (err as Error).message : `Error inesperado: ${err instanceof Error ? err.message : String(err)}`);
  }
  const r = leerResultado(resultado);
  const resumen = r.confirmacion ? `requiere revisión: ${r.confirmacion.motivo}` : r.ok ? JSON.stringify(r.data).slice(0, 160) : r.error;
  await registrarLog(ctx.directory, { herramienta: `contratos_${herramienta}`, mensaje_id: mensajeId, ok: r.ok, resumen });
  return resultado;
}

/** Correo, adjunto, extracción, correcciones de la analista y clasificación de un mensaje. */
async function analizar(ctx: Contexto, mensajeId: string, contrato?: Record<string, unknown>) {
  const correo = await leerCorreo(ctx.directory, mensajeId);
  const adjunto = await adjuntoContrato(ctx.directory, correo);
  const extraido = adjunto ? extraerTexto(mensajeId, adjunto.texto) : null;
  const correcciones = extraido ? aplicarCorrecciones(extraido, contrato) : null;
  const [maestro, comerciales] = await Promise.all([leerMaestro(ctx.directory), cargarComerciales(ctx.directory)]);
  const validacion = clasificar({ correo, adjunto, extraido, valores: correcciones?.valores ?? null, maestro, comerciales });
  return { correo, adjunto, extraido, correcciones, validacion };
}

const argContrato = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    "Opcional. Valores del contrato confirmados por la analista, p. ej. { valor: 0, fecha_fin: '2027-08-31' }. Solo se pueden cambiar los campos de baja confianza.",
  );

export const leer_buzon = {
  description: "Lista los mensajes del buzón que aún no se han procesado, indicando si traen contrato.",
  args: {},
  async execute(_args: Record<string, never>, ctx: Contexto): Promise<string> {
    return ejecutar(ctx, "leer_buzon", null, async () => {
      const procesados = await leerProcesados(ctx.directory);
      const pendientes = (await listarMensajes(ctx.directory)).filter((id) => !procesados[id]);
      const mensajes = await Promise.all(
        pendientes.map(async (id) => {
          const correo = await leerCorreo(ctx.directory, id);
          const tiene_contrato = (await adjuntoContrato(ctx.directory, correo)) !== null;
          return {
            id,
            de: correo.de,
            asunto: correo.asunto,
            fecha: correo.fecha,
            adjuntos: correo.adjuntos,
            tiene_contrato,
            ...(tiene_contrato ? {} : { clasificacion: "rechazado", motivo: "No trae contrato ni otrosí adjunto." }),
          };
        }),
      );
      return ok({ mensajes, ya_procesados: Object.keys(procesados).length });
    });
  },
};

export const extraer = {
  description: "Extrae los datos estructurados del contrato u otrosí de un mensaje, con un nivel de confianza por campo.",
  args: { mensaje_id: MensajeIdSchema },
  async execute(args: { mensaje_id: string }, ctx: Contexto): Promise<string> {
    return ejecutar(ctx, "extraer", args.mensaje_id, async () => {
      const correo = await leerCorreo(ctx.directory, args.mensaje_id);
      const adjunto = await adjuntoContrato(ctx.directory, correo);
      if (!adjunto) return fallo(`El mensaje ${args.mensaje_id} no trae contrato ni otrosí (adjuntos: ${correo.adjuntos.join(", ") || "ninguno"}).`);
      return ok({ ...extraerTexto(args.mensaje_id, adjunto.texto), documento: adjunto.nombre });
    });
  },
};

export const validar = {
  description: "Clasifica el contrato de un mensaje como nuevo, actualización, duplicado o rechazado y lista los campos que requieren revisión.",
  args: { mensaje_id: MensajeIdSchema, contrato: argContrato },
  async execute(args: { mensaje_id: string; contrato?: Record<string, unknown> }, ctx: Contexto): Promise<string> {
    return ejecutar(ctx, "validar", args.mensaje_id, async () => {
      const { correcciones, validacion } = await analizar(ctx, args.mensaje_id, args.contrato);
      if (correcciones?.errores.length) return fallo(`Valores no aceptados: ${correcciones.errores.join("; ")}`);
      const data = { ...validacion, corregidos: correcciones?.corregidos ?? [] };
      if (validacion.requiere_revision.length > 0 && validacion.clasificacion !== "rechazado") {
        return JSON.stringify({
          ok: true,
          data,
          confirmacion: { motivo: `Revisar antes de registrar: ${validacion.requiere_revision.join(", ")}` },
        });
      }
      return ok(data);
    });
  },
};

export const registrar = {
  description: "Registra o actualiza el contrato en el maestro y lo archiva en SharePoint; si hay campos en revisión, exige confirmado = true.",
  args: {
    mensaje_id: MensajeIdSchema,
    contrato: argContrato,
    confirmado: z.boolean().optional().describe("true solo si la analista confirmó explícitamente los campos en revisión"),
  },
  async execute(args: { mensaje_id: string; contrato?: Record<string, unknown>; confirmado?: boolean }, ctx: Contexto): Promise<string> {
    return ejecutar(ctx, "registrar", args.mensaje_id, async () => {
      const previo = (await leerProcesados(ctx.directory))[args.mensaje_id];
      if (previo) return ok({ ...previo, ya_procesado: true });

      const a = await analizar(ctx, args.mensaje_id, args.contrato);
      if (a.correcciones?.errores.length) return fallo(`Valores no aceptados: ${a.correcciones.errores.join("; ")}`);
      const pendientes = a.validacion.requiere_revision;
      if (pendientes.length > 0 && a.validacion.clasificacion !== "rechazado" && !args.confirmado) {
        return JSON.stringify({
          ok: false,
          error: `requiere revisión: ${pendientes.join(", ")}`,
          confirmacion: { motivo: `Confirmar o corregir: ${pendientes.join(", ")}`, detalles: detalleRevision(a, pendientes) },
        });
      }
      const resultado = await escribirRegistro(ctx.directory, {
        mensajeId: args.mensaje_id,
        adjunto: a.adjunto,
        extraido: a.extraido,
        valores: a.correcciones?.valores ?? null,
        validacion: a.validacion,
      });
      return ok({ ...resultado, clasificacion: a.validacion.clasificacion, motivo: a.validacion.motivo, advertencias: a.validacion.advertencias });
    });
  },
};

export const alertas = {
  description: "Genera out/alertas.md con contratos por vencer en 60 días, pólizas pendientes y contratos registrados desde el corte.",
  args: { hoy: z.string().describe("Fecha de referencia en formato YYYY-MM-DD") },
  async execute(args: { hoy: string }, ctx: Contexto): Promise<string> {
    return ejecutar(ctx, "alertas", null, async () => {
      if (!esFechaValida(args.hoy)) return fallo(`Fecha inválida "${args.hoy}": usa el formato YYYY-MM-DD.`);
      const r = await generarAlertas(ctx.directory, args.hoy);
      const resumen = (filas: { id_contrato: string; cliente: string; fecha_fin: string; estado_poliza: string }[]) =>
        filas.map((f) => ({ id_contrato: f.id_contrato, cliente: f.cliente, fecha_fin: f.fecha_fin, estado_poliza: f.estado_poliza }));
      return ok({
        ruta: r.ruta,
        vencen: resumen(r.vencen),
        vencidos: resumen(r.vencidos),
        polizas_pendientes: resumen(r.polizas_pendientes),
        registrados_desde_corte: r.registrados_desde_corte.map((f) => ({ id_contrato: f.id_contrato, cliente: f.cliente, fecha_registro: f.fecha_registro })),
      });
    });
  },
};

/** Para cada campo en revisión: valor propuesto, confianza y de dónde salió. */
function detalleRevision(a: Awaited<ReturnType<typeof analizar>>, pendientes: string[]) {
  return pendientes.map((p) => {
    const nombre = p.replace(/^conflicto:/, "");
    const campo = a.extraido?.campos[nombre as keyof NonNullable<typeof a.extraido>["campos"]];
    const diferencia = a.validacion.diferencias?.find((d) => d.campo === nombre);
    return { campo: p, propuesto: campo?.valor ?? diferencia?.despues ?? null, confianza: campo?.confianza ?? null, evidencia: campo?.evidencia ?? null, maestro: diferencia?.antes };
  });
}
