import { z } from "zod";

export const PAISES = ["CO", "EC", "PE", "PA", "HN"] as const;
export const MONEDAS = ["COP", "USD", "PEN", "PAB", "HNL"] as const;
export const ESTADOS_POLIZA = ["vigente", "pendiente", "vencida", "no_aplica"] as const;
export type Pais = (typeof PAISES)[number];
export type Moneda = (typeof MONEDAS)[number];

/** Umbral de RN5: campos por debajo requieren revisión humana antes de registrar. */
export const UMBRAL_CONFIANZA = 0.8;

/** Fecha de corte del maestro congelado (sección 1 del PRD). */
export const FECHA_CORTE = "2026-05-30";

export const CorreoSchema = z.object({
  id: z.string(),
  de: z.string(),
  para: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  cuerpo: z.string(),
  adjuntos: z.array(z.string()),
});
export type Correo = z.infer<typeof CorreoSchema>;

export const ComercialSchema = z.object({ email: z.string(), nombre: z.string(), region: z.string() });
export type Comercial = z.infer<typeof ComercialSchema>;

/** Una fila del maestro (sección 7.2 del PRD). */
export const COLUMNAS_MAESTRO = [
  "id_contrato",
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
  "requiere_poliza",
  "tipo_poliza",
  "estado_poliza",
  "comercial",
  "ruta_sharepoint",
  "fecha_registro",
  "fuente",
] as const;
export type FilaMaestro = Record<(typeof COLUMNAS_MAESTRO)[number], string>;

/** Campos que se extraen del documento. */
export const CAMPOS = [
  "id_contrato",
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
  "requiere_poliza",
  "tipo_poliza",
] as const;
export type NombreCampo = (typeof CAMPOS)[number];

export interface Campo<T> {
  valor: T | null;
  /** Confianza en [0, 1]. Ausente en el texto → `null` con confianza 0, nunca inventado. */
  confianza: number;
  /** Cómo se obtuvo, para que la analista pueda verificarlo. */
  evidencia: string;
}

export interface ContratoExtraido {
  mensaje_id: string;
  tipo_documento: "contrato" | "otrosi";
  /** Contrato por demanda: el valor se registra como 0. */
  valor_indeterminado: boolean;
  campos: {
    id_contrato: Campo<string>;
    cliente: Campo<string>;
    nit_cliente: Campo<string>;
    pais: Campo<Pais>;
    objeto: Campo<string>;
    valor: Campo<number>;
    moneda: Campo<Moneda>;
    fecha_inicio: Campo<string>;
    fecha_fin: Campo<string>;
    requiere_poliza: Campo<boolean>;
    tipo_poliza: Campo<string>;
  };
  /** Para otrosíes: las pólizas deben ampliarse según el nuevo plazo. */
  amplia_polizas: boolean;
}

/** Valores ya decididos de un contrato (extraídos o corregidos por la analista). */
export type ValoresContrato = { [K in NombreCampo]: ContratoExtraido["campos"][K]["valor"] };

export type Clasificacion = "nuevo" | "actualizacion" | "duplicado" | "rechazado";

export interface Validacion {
  clasificacion: Clasificacion;
  motivo: string;
  id_contrato_existente?: string;
  /** Campos con confianza < 0.8 y conflictos con el maestro. */
  requiere_revision: string[];
  /** Para actualizaciones: qué cambia respecto al maestro. */
  diferencias?: { campo: string; antes: string; despues: string }[];
  /** Avisos que no bloquean (p. ej. remitente desconocido). */
  advertencias: string[];
  comercial: string | null;
}
