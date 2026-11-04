import { esFechaValida, similitud } from "./texto";
import {
  CAMPOS,
  type Comercial,
  type ContratoExtraido,
  type Correo,
  type FilaMaestro,
  MONEDAS,
  type NombreCampo,
  PAISES,
  UMBRAL_CONFIANZA,
  type Validacion,
  type ValoresContrato,
} from "./tipos";

/** RN2: similitud mínima de objeto para considerar que es el mismo contrato (mismo cliente). */
export const UMBRAL_SIMILITUD = 0.9;

const CAMPOS_FECHA: NombreCampo[] = ["fecha_inicio", "fecha_fin"];

export interface Correcciones {
  valores: ValoresContrato;
  corregidos: NombreCampo[];
  errores: string[];
}

function valorDe(entrada: unknown): unknown {
  return typeof entrada === "object" && entrada !== null && "valor" in entrada ? (entrada as { valor: unknown }).valor : entrada;
}

function validarValor(campo: NombreCampo, valor: unknown): string | null {
  if (valor === null) return null;
  if (CAMPOS_FECHA.includes(campo)) return typeof valor === "string" && esFechaValida(valor) ? null : `${campo}: fecha inválida "${String(valor)}" (formato YYYY-MM-DD)`;
  if (campo === "valor") return typeof valor === "number" && valor >= 0 ? null : `valor: debe ser un número sin separadores`;
  if (campo === "moneda") return (MONEDAS as readonly unknown[]).includes(valor) ? null : `moneda desconocida "${String(valor)}" (válidas: ${MONEDAS.join(", ")})`;
  if (campo === "pais") return (PAISES as readonly unknown[]).includes(valor) ? null : `país desconocido "${String(valor)}"`;
  if (campo === "requiere_poliza") return typeof valor === "boolean" ? null : "requiere_poliza: debe ser true o false";
  return typeof valor === "string" ? null : `${campo}: debe ser texto`;
}

/**
 * Aplica los valores que envía el modelo (normalmente confirmados por la analista).
 * Solo se pueden cambiar los campos de baja confianza; los de alta confianza deben
 * coincidir con la extracción. Así el modelo puede proponer, pero no alterar lo leído.
 */
export function aplicarCorrecciones(extraido: ContratoExtraido, contrato?: Record<string, unknown>): Correcciones {
  const valores = Object.fromEntries(CAMPOS.map((c) => [c, extraido.campos[c].valor])) as ValoresContrato;
  const corregidos: NombreCampo[] = [];
  const errores: string[] = [];
  for (const campo of CAMPOS) {
    if (!contrato || !(campo in contrato)) continue;
    const nuevo = valorDe(contrato[campo]);
    if (JSON.stringify(nuevo) === JSON.stringify(valores[campo])) continue;
    const error = validarValor(campo, nuevo);
    if (error) {
      errores.push(error);
      continue;
    }
    if (extraido.campos[campo].confianza >= UMBRAL_CONFIANZA) {
      errores.push(`${campo}: se extrajo con confianza ${extraido.campos[campo].confianza} y no se puede modificar (leído: ${JSON.stringify(valores[campo])})`);
      continue;
    }
    Object.assign(valores, { [campo]: nuevo });
    corregidos.push(campo);
  }
  return { valores, corregidos, errores };
}

/** El texto de una fila del maestro para un campo (booleanos y números como en el CSV). */
export function aCelda(valor: ValoresContrato[NombreCampo]): string {
  return valor === null ? "" : String(valor);
}

/** RN1–RN3: busca el contrato en el maestro por id o por NIT + objeto similar. */
function buscarExistente(v: ValoresContrato, maestro: FilaMaestro[]): { fila: FilaMaestro; criterio: string } | null {
  const porId = v.id_contrato ? maestro.find((f) => f.id_contrato === v.id_contrato) : undefined;
  if (porId) return { fila: porId, criterio: `mismo id_contrato ${porId.id_contrato}` };
  if (!v.nit_cliente || !v.objeto) return null;
  for (const fila of maestro.filter((f) => f.nit_cliente === v.nit_cliente)) {
    const s = similitud(fila.objeto, v.objeto);
    if (s >= UMBRAL_SIMILITUD) return { fila, criterio: `mismo NIT y objeto similar (${s.toFixed(2)}) a ${fila.id_contrato}` };
  }
  return null;
}

function resolverComercial(correo: Correo, comerciales: Comercial[]) {
  return comerciales.find((c) => c.email.toLowerCase() === correo.de.toLowerCase())?.nombre ?? null;
}

/** Campos de baja confianza entre los que se van a escribir (RN5). */
function bajaConfianza(extraido: ContratoExtraido, campos: readonly NombreCampo[]): string[] {
  return campos.filter((c) => extraido.campos[c].confianza < UMBRAL_CONFIANZA);
}

interface EntradaValidacion {
  correo: Correo;
  adjunto: { nombre: string } | null;
  extraido: ContratoExtraido | null;
  valores: ValoresContrato | null;
  maestro: FilaMaestro[];
  comerciales: Comercial[];
}

/** HU-3: clasifica en nuevo, actualización, duplicado o rechazado (RN1–RN5). */
export function validar(e: EntradaValidacion): Validacion {
  const comercial = resolverComercial(e.correo, e.comerciales);
  const advertencias = comercial
    ? []
    : [`El remitente ${e.correo.de} no está en comerciales.json: se registra sin comercial asignado y conviene informarlo.`];
  const base = { comercial, advertencias, requiere_revision: [] as string[] };

  if (!e.adjunto || !e.extraido || !e.valores) {
    const adjuntos = e.correo.adjuntos.join(", ") || "ninguno";
    return { ...base, clasificacion: "rechazado", motivo: `RN4: el correo no trae un contrato ni un otrosí (adjuntos: ${adjuntos}).` };
  }
  const v = e.valores;
  if (!v.cliente && !v.objeto && e.extraido.tipo_documento === "contrato") {
    return { ...base, clasificacion: "rechazado", motivo: "RN4: el texto no permite identificar las partes ni el objeto." };
  }

  const existente = buscarExistente(v, e.maestro);
  if (e.extraido.tipo_documento === "otrosi") return validarOtrosi(e.extraido, v, existente, base);
  if (!existente) {
    return { ...base, clasificacion: "nuevo", motivo: "RN3: no hay un contrato con el mismo id ni con el mismo NIT y objeto similar.", requiere_revision: bajaConfianza(e.extraido, CAMPOS) };
  }

  const { fila, criterio } = existente;
  const mismos = fila.valor === aCelda(v.valor) && fila.fecha_inicio === v.fecha_inicio && fila.fecha_fin === v.fecha_fin;
  if (mismos) {
    return { ...base, clasificacion: "duplicado", motivo: `RN1: ${criterio}, con el mismo valor y las mismas fechas. No se escribe nada.`, id_contrato_existente: fila.id_contrato };
  }
  const diferencias = compararConMaestro(fila, v);
  return {
    ...base,
    clasificacion: "actualizacion",
    motivo: `RN2: ${criterio}, con campos distintos al maestro.`,
    id_contrato_existente: fila.id_contrato,
    diferencias,
    // Un contrato reenviado que difiere del maestro (sin ser otrosí) es un conflicto: lo revisa la analista.
    requiere_revision: [...new Set([...bajaConfianza(e.extraido, diferencias.map((d) => d.campo as NombreCampo)), ...diferencias.map((d) => `conflicto:${d.campo}`)])],
  };
}

function validarOtrosi(
  extraido: ContratoExtraido,
  v: ValoresContrato,
  existente: { fila: FilaMaestro; criterio: string } | null,
  base: Pick<Validacion, "comercial" | "advertencias" | "requiere_revision">,
): Validacion {
  if (!existente) {
    return { ...base, clasificacion: "rechazado", motivo: `RN4: el otrosí modifica el contrato ${v.id_contrato ?? "(sin número)"}, que no está en el maestro. Hay que registrar primero el contrato original.` };
  }
  const { fila, criterio } = existente;
  // Del otrosí solo se aplican los campos que trae; el resto se conserva del maestro.
  const presentes = CAMPOS.filter((c) => extraido.campos[c].valor !== null && !["id_contrato", "cliente", "nit_cliente", "pais"].includes(c));
  const diferencias = compararConMaestro(fila, v, presentes);
  if (extraido.amplia_polizas && fila.requiere_poliza === "true" && fila.estado_poliza !== "pendiente") {
    diferencias.push({ campo: "estado_poliza", antes: fila.estado_poliza, despues: "pendiente" });
  }
  const identidad = fila.nit_cliente && v.nit_cliente && fila.nit_cliente !== v.nit_cliente ? ["conflicto:nit_cliente"] : [];
  return {
    ...base,
    clasificacion: "actualizacion",
    motivo: `RN2: otrosí del contrato existente (${criterio}).`,
    id_contrato_existente: fila.id_contrato,
    diferencias,
    requiere_revision: [...bajaConfianza(extraido, presentes), ...identidad],
    advertencias: extraido.amplia_polizas
      ? [...base.advertencias, "El otrosí exige ampliar la vigencia de las pólizas: el estado de la póliza pasa a 'pendiente'."]
      : base.advertencias,
  };
}

function compararConMaestro(fila: FilaMaestro, v: ValoresContrato, campos: readonly NombreCampo[] = ["valor", "moneda", "fecha_inicio", "fecha_fin", "objeto"]) {
  return campos
    .filter((c) => v[c] !== null && fila[c] !== aCelda(v[c]))
    .map((c) => ({ campo: c as string, antes: fila[c], despues: aCelda(v[c]) }));
}
