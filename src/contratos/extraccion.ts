import { normalizar, aMonto, fechasEnTexto, finDePlazo, mesEnTexto, mesesDePlazo, primerDiaDelMes } from "./texto";
import { type Campo, type ContratoExtraido, MONEDAS, type Moneda, type Pais } from "./tipos";

/**
 * HU-2: extracción determinista (regex y heurísticas) sobre el texto del contrato.
 * Cada campo lleva una confianza según cómo se obtuvo:
 *
 *   0.95  dato literal e inequívoco (número entre paréntesis, NIT rotulado)
 *   0.90  dato literal con una interpretación menor (razón social de la firma)
 *   0.85  dos fuentes que coinciden de forma indirecta, o una regla condicionada
 *   0.80  derivado con una convención documentada (día 1 cuando solo hay mes)
 *   0.60  derivado sobre un dato aproximado
 *   0.50  el documento no lo define (valor por demanda)
 *   0     ausente: el valor es null, nunca inventado
 */

export class ErrorExtraccion extends Error {
  override name = "ErrorExtraccion";
}

const ausente = <T>(motivo: string): Campo<T> => ({ valor: null, confianza: 0, evidencia: motivo });
const campo = <T>(valor: T, confianza: number, evidencia: string): Campo<T> => ({ valor, confianza, evidencia });

/** Texto de una cláusula: desde "SEGUNDA. VALOR." hasta la siguiente cláusula numerada. */
export function clausula(texto: string, nombre: string): string | null {
  const re = new RegExp(`\\b[A-ZÁÉÍÓÚ]+\\.\\s*${nombre}\\.?\\s*([\\s\\S]*?)(?=\\n\\s*[A-ZÁÉÍÓÚ]{4,}\\.\\s|\\n\\s*(Para constancia|Se firma)|$)`, "i");
  return texto.match(re)?.[1]?.trim() ?? null;
}

const RAZON_PERIFERIA = /periferia/i;

/** Razón social del contratante, tomada del bloque de firmas (mejor capitalizada que el encabezado). */
function cliente(texto: string): Campo<string> {
  const lineas = texto.trim().split("\n").reverse();
  for (const linea of lineas) {
    if (!RAZON_PERIFERIA.test(linea)) continue;
    const columnas = linea.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    const otra = columnas.find((c) => !RAZON_PERIFERIA.test(c));
    if (otra) return campo(otra, 0.9, `Bloque de firmas: "${otra}"`);
  }
  const m = texto.match(/Entre\s+(?:los suscritos,\s+)?([^,]+?),\s+(?:identificada|NIT|RUC|RTN)/i);
  if (m?.[1] && !RAZON_PERIFERIA.test(m[1])) return campo(m[1].trim(), 0.75, `Encabezado: "${m[1].trim()}" (sin firma legible)`);
  return ausente("No se identificó la contraparte");
}

const ID_TRIBUTARIO = /\b(NIT|RUC|RTN)\s+(?:No\.\s*)?([\d.\-]+)/gi;

/** Identificador de la contraparte (el primero que no es el NIT de Periferia), sin puntos ni DV. */
function identificador(texto: string): { campo: Campo<string>; tipo: string | null } {
  for (const m of texto.matchAll(ID_TRIBUTARIO)) {
    const crudo = m[2] ?? "";
    if (crudo.replace(/\D/g, "").startsWith("900123456")) continue;
    const tipo = (m[1] ?? "").toUpperCase();
    // Solo el NIT colombiano lleva dígito de verificación separado por guion.
    const valor = tipo === "NIT" ? (crudo.split("-")[0] ?? crudo).replace(/\D/g, "") : crudo.replace(/\D/g, "");
    return { campo: campo(valor, 0.95, `${tipo} ${crudo}`), tipo };
  }
  return { campo: ausente("El documento no trae identificador tributario de la contraparte"), tipo: null };
}

const CIUDADES: Record<string, Pais> = {
  colombia: "CO", bogota: "CO", medellin: "CO", barranquilla: "CO", cali: "CO",
  ecuador: "EC", quito: "EC", guayaquil: "EC",
  peru: "PE", lima: "PE",
  panama: "PA",
  honduras: "HN", tegucigalpa: "HN", "san pedro sula": "HN",
};

/** País por el identificador y por el domicilio de la contraparte; si coinciden, alta confianza. */
function pais(texto: string, tipoId: string | null, id: string | null): Campo<Pais> {
  const porId: Pais | null =
    tipoId === "NIT" ? "CO" : tipoId === "RTN" ? "HN" : tipoId === "RUC" && id?.length === 13 ? "EC" : tipoId === "RUC" && id?.length === 11 ? "PE" : null;
  const domicilio = normalizar(texto.match(/domicilio en ([^,.]+(?:, [^,.]+)?)/i)?.[1] ?? "");
  const lugar = Object.keys(CIUDADES).find((c) => domicilio.includes(c));
  const porDomicilio = lugar ? CIUDADES[lugar] : null;
  if (porId && porDomicilio && porId === porDomicilio) return campo(porId, 0.95, `${tipoId} y domicilio (${lugar}) coinciden`);
  if (porId && !porDomicilio) return campo(porId, 0.85, `Por el tipo de identificador ${tipoId}`);
  if (porDomicilio && !porId) return campo(porDomicilio, 0.85, `Por el domicilio (${lugar})`);
  if (porId && porDomicilio) return campo(porId, 0.5, `Conflicto: ${tipoId} indica ${porId}, el domicilio indica ${porDomicilio}`);
  return ausente("No se pudo inferir el país");
}

const MAX_OBJETO = 200;

function objeto(texto: string): Campo<string> {
  const c = clausula(texto, "OBJETO");
  if (!c) return ausente("No hay cláusula de objeto");
  // "EL CONTRATISTA se obliga a ejecutar la implementación…" → "Ejecutar la implementación…"
  const sinSujeto = c.replace(/\s+/g, " ").trim().replace(/^EL CONTRATISTA\s+(se obliga a\s+|prestar[áa]\s+)?/i, "");
  const limpio = sinSujeto.charAt(0).toUpperCase() + sinSujeto.slice(1);
  if (limpio.length <= MAX_OBJETO) return campo(limpio, 0.9, "Cláusula OBJETO");
  const corte = limpio.slice(0, MAX_OBJETO - 1).lastIndexOf(" ");
  return campo(`${limpio.slice(0, corte)}…`, 0.9, `Cláusula OBJETO recortada a ${MAX_OBJETO} caracteres`);
}

const MONTO = new RegExp(`\\b(${MONEDAS.join("|")}|EUR|MXN|CLP|ARS|GBP)\\s*\\$?\\s*([\\d][\\d.,]*)`, "i");

function valorYMoneda(texto: string): { valor: Campo<number>; moneda: Campo<Moneda>; indeterminado: boolean } {
  const c = clausula(texto, "VALOR") ?? "";
  if (/no tiene un valor determinado|valor indeterminado|por demanda/i.test(c)) {
    const otra = texto.match(MONTO)?.[1]?.toUpperCase();
    const moneda: Campo<Moneda> =
      otra && (MONEDAS as readonly string[]).includes(otra)
        ? campo(otra as Moneda, 0.85, `Sin valor total; los montos del contrato están en ${otra}`)
        : ausente("El contrato no menciona ninguna moneda");
    return { valor: campo(0, 0.5, "Contrato sin valor determinado: se registra 0 (valor por demanda)"), moneda, indeterminado: true };
  }
  const m = c.match(MONTO) ?? texto.match(MONTO);
  if (!m) return { valor: ausente("No se encontró un monto"), moneda: ausente("No se encontró moneda"), indeterminado: false };
  const codigo = (m[1] ?? "").toUpperCase();
  if (!(MONEDAS as readonly string[]).includes(codigo)) {
    throw new ErrorExtraccion(`Moneda desconocida "${codigo}": el maestro solo admite ${MONEDAS.join(", ")}.`);
  }
  const monto = aMonto(m[2] ?? "");
  return {
    valor: monto === null ? ausente("Monto ilegible") : campo(monto, 0.95, `"${m[0].trim()}"`),
    moneda: campo(codigo as Moneda, 0.95, `"${m[0].trim()}"`),
    indeterminado: false,
  };
}

/** Fechas de inicio y fin a partir de la cláusula de plazo (y de la fecha de firma si hace falta). */
function fechas(texto: string, tipo: "contrato" | "otrosi"): { inicio: Campo<string>; fin: Campo<string> } {
  const plazo = tipo === "otrosi" ? texto : (clausula(texto, "PLAZO") ?? "");
  const desdeHasta = plazo.match(/desde([\s\S]*?)hasta([\s\S]*?)(?:\.|$)/i);
  if (desdeHasta) {
    const [inicio] = fechasEnTexto(desdeHasta[1] ?? "");
    const [fin] = fechasEnTexto(desdeHasta[2] ?? "");
    return {
      inicio: inicio ? campo(inicio, 0.95, "Plazo: fecha 'desde' explícita") : ausente("Fecha de inicio ilegible"),
      fin: fin ? campo(fin, 0.95, "Plazo: fecha 'hasta' explícita") : ausente("Fecha de fin ilegible"),
    };
  }
  if (tipo === "otrosi") {
    const [fin] = fechasEnTexto(plazo.match(/se extiende hasta([\s\S]*?)(?:\.|")/i)?.[1] ?? "");
    return { inicio: ausente("El otrosí no modifica la fecha de inicio"), fin: fin ? campo(fin, 0.95, "Otrosí: nueva fecha 'hasta'") : ausente("El otrosí no modifica el plazo") };
  }
  return desdeFirma(texto, plazo);
}

/** Plazo "de N meses contados a partir de la firma": inicio = firma, fin = inicio + N meses − 1 día. */
function desdeFirma(texto: string, plazo: string): { inicio: Campo<string>; fin: Campo<string> } {
  const meses = mesesDePlazo(plazo);
  const firma = texto.slice(texto.search(/(Para constancia|Se firma)/i));
  const [firmaExacta] = fechasEnTexto(firma);
  const soloMes = firmaExacta ? null : mesEnTexto(firma);
  const inicio = firmaExacta
    ? campo(firmaExacta, 0.9, "Inicio = fecha de firma")
    : soloMes
      ? campo(primerDiaDelMes(soloMes.anio, soloMes.mes), 0.8, "La firma solo indica mes y año: se toma el día 1 por convención")
      : ausente<string>("No hay fecha de inicio ni de firma");
  if (!meses || !inicio.valor) return { inicio, fin: ausente("No se pudo calcular la fecha de fin") };
  const confianza = inicio.confianza >= 0.9 ? 0.9 : 0.6;
  const prorroga = /prorrog/i.test(plazo) ? "; prorrogable automáticamente" : "";
  return { inicio, fin: campo(finDePlazo(inicio.valor, meses), confianza, `Calculada: inicio + ${meses} meses − 1 día${prorroga}`) };
}

const TIPOS_POLIZA: [RegExp, string][] = [
  [/cumplimiento/i, "cumplimiento"],
  [/calidad/i, "calidad"],
  [/salarios|prestaciones sociales/i, "salarios_prestaciones"],
  [/responsabilidad civil/i, "responsabilidad_civil"],
  [/anticipo/i, "buen_manejo_anticipo"],
];

function polizas(texto: string): { requiere: Campo<boolean>; tipo: Campo<string> } {
  const garantias = clausula(texto, "GARANT[ÍI]AS");
  if (!garantias || !/p[óo]liza/i.test(garantias)) {
    return { requiere: campo(false, 0.9, "No hay cláusula de garantías con póliza"), tipo: campo("", 0.9, "No aplica") };
  }
  const tipos = TIPOS_POLIZA.filter(([re]) => re.test(garantias)).map(([, t]) => t);
  const condicionada = /para cada orden|cuyo valor supere/i.test(garantias);
  return {
    requiere: condicionada
      ? campo(true, 0.85, "Póliza condicionada a cada orden de servicio que supere un monto")
      : campo(true, 0.95, "Cláusula de garantías exige póliza"),
    tipo: tipos.length > 0 ? campo(tipos.join(";"), 0.9, `Garantías: ${tipos.join(", ")}`) : campo("", 0.5, "Exige póliza pero no se identificó el tipo"),
  };
}

function idContrato(texto: string, tipo: "contrato" | "otrosi"): Campo<string> {
  const re = tipo === "otrosi" ? /AL CONTRATO[^\n]*?No\.\s*([A-Z]{1,4}-\d{4}-\d{1,4})/i : /CONTRATO[^\n]*?No\.\s*([A-Z]{1,4}-\d{4}-\d{1,4})/i;
  const m = texto.match(re);
  return m?.[1] ? campo(m[1], 0.95, `Título: No. ${m[1]}`) : ausente("El documento no trae número de contrato");
}

/** Extrae los campos del contrato u otrosí. Lanza `ErrorExtraccion` ante texto vacío o moneda desconocida. */
export function extraer(mensajeId: string, texto: string): ContratoExtraido {
  if (!texto.trim()) throw new ErrorExtraccion("El documento está vacío: no hay texto que extraer.");
  // Sin \b: en JavaScript la "Í" no cuenta como letra para los límites de palabra.
  const tipo = /^\s*OTROS[ÍI](\s|$)/i.test(texto) ? "otrosi" : "contrato";
  const id = identificador(texto);
  const monto = valorYMoneda(tipo === "otrosi" ? (texto.match(/cl[áa]usula SEGUNDA \(VALOR\)[\s\S]*?"([^"]+)"/i)?.[1] ?? "") : texto);
  const { inicio, fin } = fechas(texto, tipo);
  const poliza = tipo === "otrosi" ? { requiere: ausente<boolean>("El otrosí no modifica garantías"), tipo: ausente<string>("El otrosí no modifica garantías") } : polizas(texto);
  const otrosiSinValor = tipo === "otrosi" && monto.valor.valor === null;

  return {
    mensaje_id: mensajeId,
    tipo_documento: tipo,
    valor_indeterminado: monto.indeterminado,
    amplia_polizas: tipo === "otrosi" && /garant[íi]as[\s\S]*ampliarse/i.test(texto),
    campos: {
      id_contrato: idContrato(texto, tipo),
      cliente: cliente(texto),
      nit_cliente: id.campo,
      pais: pais(texto, id.tipo, id.campo.valor),
      objeto: tipo === "otrosi" ? ausente("El otrosí no modifica el objeto") : objeto(texto),
      valor: otrosiSinValor ? ausente("El otrosí no modifica el valor") : monto.valor,
      moneda: otrosiSinValor ? ausente("El otrosí no modifica la moneda") : monto.moneda,
      fecha_inicio: inicio,
      fecha_fin: fin,
      requiere_poliza: poliza.requiere,
      tipo_poliza: poliza.tipo,
    },
  };
}
