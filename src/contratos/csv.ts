/** Lectura y escritura de CSV (RFC 4180): comillas para valores con coma, comillas o saltos de línea. */

export function parsearCsv(texto: string): Record<string, string>[] {
  const filas = leerFilas(texto.replace(/^﻿/, ""));
  const [encabezados, ...datos] = filas;
  if (!encabezados) return [];
  return datos
    .filter((f) => f.some((c) => c.trim() !== ""))
    .map((f) => Object.fromEntries(encabezados.map((h, i) => [h.trim(), f[i] ?? ""])));
}

function leerFilas(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"' && texto[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (c === '"') enComillas = false;
      else celda += c;
    } else if (c === '"') enComillas = true;
    else if (c === ",") {
      fila.push(celda);
      celda = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else celda += c;
  }
  if (celda !== "" || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas;
}

function celda(valor: string): string {
  return /[",\n\r]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

export function escribirCsv(columnas: readonly string[], filas: Record<string, string>[]): string {
  return `${[columnas.join(","), ...filas.map((f) => columnas.map((c) => celda(f[c] ?? "")).join(","))].join("\n")}\n`;
}
