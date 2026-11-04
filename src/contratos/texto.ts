/** Utilidades de texto para leer contratos en español de forma determinista. */

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MES = `(${MESES.join("|")}|setiembre)`;

/** Minúsculas, sin tildes, espacios simples. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function mesANumero(mes: string): number {
  const m = normalizar(mes) === "setiembre" ? "septiembre" : normalizar(mes);
  return MESES.indexOf(m) + 1;
}

function iso(anio: number, mes: number, dia: number): string | null {
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Fechas escritas como en los contratos: "el treinta y uno (31) de julio de 2027".
 * Se usa el número entre paréntesis, que es el dato inequívoco.
 */
export function fechasEnTexto(texto: string): string[] {
  const re = new RegExp(`\\((\\d{1,2})\\)\\s+(?:d[ií]as\\s+del\\s+mes\\s+)?de\\s+${MES}\\s+de\\s+(\\d{4})`, "gi");
  return [...texto.matchAll(re)].flatMap((m) => {
    const fecha = iso(Number(m[3]), mesANumero(m[2] ?? ""), Number(m[1]));
    return fecha ? [fecha] : [];
  });
}

/** "en el mes de agosto de 2026" → { anio: 2026, mes: 8 } (fecha sin día). */
export function mesEnTexto(texto: string): { anio: number; mes: number } | null {
  const m = texto.match(new RegExp(`mes\\s+de\\s+${MES}\\s+de\\s+(\\d{4})`, "i"));
  return m ? { anio: Number(m[2]), mes: mesANumero(m[1] ?? "") } : null;
}

export function primerDiaDelMes(anio: number, mes: number): string {
  return iso(anio, mes, 1) ?? "";
}

/** Suma meses a una fecha y resta un día: 2026-08-15 + 12 meses → 2027-08-14 (convención de los contratos). */
export function finDePlazo(inicio: string, meses: number): string {
  const d = new Date(`${inicio}T00:00:00Z`);
  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + meses);
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function esFechaValida(fecha: string): boolean {
  const m = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return Boolean(m && iso(Number(m[1]), Number(m[2]), Number(m[3])));
}

/**
 * Monto escrito en cualquiera de los dos formatos que aparecen en los contratos:
 * colombiano "265.000.000" o estadounidense "120,000.00". El último separador
 * seguido de exactamente dos dígitos es el decimal; los demás son de miles.
 */
export function aMonto(texto: string): number | null {
  const limpio = texto.replace(/[^\d.,]/g, "");
  if (!/\d/.test(limpio)) return null;
  const decimal = limpio.match(/[.,](\d{2})$/);
  const entero = (decimal ? limpio.slice(0, -3) : limpio).replace(/[.,]/g, "");
  const n = Number(decimal ? `${entero}.${decimal[1]}` : entero);
  return Number.isFinite(n) ? n : null;
}

/** "doce (12) meses" → 12. */
export function mesesDePlazo(texto: string): number | null {
  const m = texto.match(/\((\d{1,3})\)\s+mes(es)?/i);
  return m ? Number(m[1]) : null;
}

/** Nombre de carpeta: "Industrias Delta S.A.S." → "industrias-delta". */
export function slug(nombre: string): string {
  return normalizar(nombre)
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(s a s|sas|s a c|sac|s de r l|s a|sa|ltda|limitada)\b/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

const VACIAS = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "en", "para", "por", "con", "a", "al", "un", "una", "sus", "su"]);

/** Similitud de Dice entre los conjuntos de palabras significativas (0 a 1). Para RN2. */
export function similitud(a: string, b: string): number {
  const palabras = (t: string) => new Set(normalizar(t).replace(/[^a-z0-9 ]/g, " ").split(" ").filter((p) => p && !VACIAS.has(p)));
  const pa = palabras(a);
  const pb = palabras(b);
  if (pa.size === 0 || pb.size === 0) return 0;
  const comunes = [...pa].filter((p) => pb.has(p)).length;
  return (2 * comunes) / (pa.size + pb.size);
}
