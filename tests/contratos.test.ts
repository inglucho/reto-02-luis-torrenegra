import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { leerResultado } from "../src/core/herramientas";
import { aplicarCorrecciones } from "../src/contratos/clasificacion";
import { parsearCsv, escribirCsv } from "../src/contratos/csv";
import { ErrorExtraccion, extraer } from "../src/contratos/extraccion";
import { aMonto, fechasEnTexto, finDePlazo, similitud, slug } from "../src/contratos/texto";
import { alertas, extraer as extraerTool, leer_buzon, registrar, validar } from "../src/tools/contratos";

const RAIZ = join(import.meta.dir, "..");
const TEMPORAL = join(RAIZ, ".tmp-tests");
const BUZON = join(RAIZ, "fixtures/reto-02/buzon");

/** Cada test de herramientas trabaja sobre una copia de los fixtures, con su propio `out/`. */
let dir: string;
const ctx = () => ({ directory: dir, sessionId: "test" });
beforeEach(async () => {
  await mkdir(TEMPORAL, { recursive: true });
  dir = await mkdtemp(join(TEMPORAL, "caso-"));
  await cp(join(RAIZ, "fixtures"), join(dir, "fixtures"), { recursive: true });
  await Bun.$`chmod -R u+w ${dir}`;
});
afterAll(async () => {
  await rm(TEMPORAL, { recursive: true, force: true });
});

const texto = (id: string, archivo = "contrato.txt") => Bun.file(join(BUZON, id, archivo)).text();
const correr = async (p: Promise<string>) => leerResultado(await p);

describe("utilidades de texto", () => {
  test("montos en formato colombiano y estadounidense", () => {
    expect(aMonto("$265.000.000")).toBe(265000000);
    expect(aMonto("120,000.00")).toBe(120000);
    expect(aMonto("1.234,50")).toBe(1234.5);
  });

  test("fechas en palabras con el número entre paréntesis", () => {
    expect(fechasEnTexto("desde el primero (1) de agosto de 2026 hasta el treinta y uno (31) de julio de 2027")).toEqual(["2026-08-01", "2027-07-31"]);
    expect(fechasEnTexto("a los treinta (30) días del mes de julio de 2026")).toEqual(["2026-07-30"]);
    expect(fechasEnTexto("el treinta y uno (31) de febrero de 2026")).toEqual([]);
  });

  test("plazo en meses con la convención de los contratos (inicio + N meses − 1 día)", () => {
    expect(finDePlazo("2026-08-15", 12)).toBe("2027-08-14");
    expect(finDePlazo("2026-05-15", 6)).toBe("2026-11-14");
  });

  test("slug de carpeta sin sufijos societarios, como el maestro", () => {
    expect(slug("Industrias Delta S.A.S.")).toBe("industrias-delta");
    expect(slug("Agroexport Sula S. de R.L.")).toBe("agroexport-sula");
  });

  test("similitud de objeto (RN2)", () => {
    expect(similitud("Mesa de servicio TI nivel 1 y 2", "mesa de servicio ti nivel 1 y 2")).toBe(1);
    expect(similitud("Soporte y mantenimiento plataforma SAP", "Implementación de la plataforma CRM")).toBeLessThan(0.9);
  });

  test("CSV con comas y comillas sobrevive ida y vuelta", () => {
    const filas = [{ a: 'objeto, con "comillas"', b: "2" }];
    expect(parsearCsv(escribirCsv(["a", "b"], filas))).toEqual(filas);
  });
});

describe("extracción con confianza", () => {
  test("msg-001: todos los campos por encima de 0.8", async () => {
    const c = extraer("msg-001", await texto("msg-001"));
    expect(Object.values(c.campos).every((f) => f.confianza >= 0.8)).toBe(true);
    expect(c.campos.nit_cliente.valor).toBe("890900111");
    expect(c.campos.requiere_poliza.valor).toBe(true);
  });

  test("msg-003: otrosí con solo los campos que cambian; el resto es null con confianza 0", async () => {
    const c = extraer("msg-003", await texto("msg-003", "otrosi.txt"));
    expect(c.tipo_documento).toBe("otrosi");
    expect(c.amplia_polizas).toBe(true);
    expect(c.campos.fecha_fin.valor).toBe("2027-11-01");
    expect(c.campos.valor.valor).toBe(520000);
    expect(c.campos.objeto).toMatchObject({ valor: null, confianza: 0 });
  });

  test("msg-006: valor por demanda y fin derivado quedan bajo el umbral", async () => {
    const c = extraer("msg-006", await texto("msg-006"));
    expect(c.valor_indeterminado).toBe(true);
    expect(c.campos.valor.confianza).toBeLessThan(0.8);
    expect(c.campos.fecha_fin.confianza).toBeLessThan(0.8);
  });

  test("texto vacío y moneda desconocida se rechazan (HU-6)", () => {
    expect(() => extraer("x", "   ")).toThrow(ErrorExtraccion);
    expect(() => extraer("x", "CONTRATO No. CT-2026-099\nSEGUNDA. VALOR. El valor es de EUR 10.000.\n")).toThrow("Moneda desconocida");
  });

  test("las correcciones solo cambian campos de baja confianza y se validan", async () => {
    const c = extraer("msg-006", await texto("msg-006"));
    expect(aplicarCorrecciones(c, { valor: 0, fecha_fin: "2027-08-31" })).toMatchObject({ corregidos: ["fecha_fin"], errores: [] });
    expect(aplicarCorrecciones(c, { nit_cliente: "999" }).errores[0]).toContain("no se puede modificar");
    expect(aplicarCorrecciones(c, { fecha_fin: "31/08/2027" }).errores[0]).toContain("fecha inválida");
  });
});

describe("herramientas", () => {
  test.each([
    ["msg-001", "nuevo", []],
    ["msg-002", "nuevo", []],
    ["msg-003", "actualizacion", []],
    ["msg-004", "duplicado", []],
    ["msg-005", "rechazado", []],
    ["msg-006", "nuevo", ["valor", "fecha_fin"]],
  ])("%s se clasifica como %s con revisión %p", async (id, clasificacion, revision) => {
    const r = await correr(validar.execute({ mensaje_id: id }, ctx()));
    expect(r.ok && r.data).toMatchObject({ clasificacion, requiere_revision: revision });
  });

  test("leer_buzon marca los mensajes sin contrato como rechazados y omite los procesados", async () => {
    const r = await correr(leer_buzon.execute({}, ctx()));
    const mensajes = (r.ok ? (r.data as { mensajes: { id: string; tiene_contrato: boolean; clasificacion?: string }[] }).mensajes : []);
    expect(mensajes.find((m) => m.id === "msg-005")).toMatchObject({ tiene_contrato: false, clasificacion: "rechazado" });
    await registrar.execute({ mensaje_id: "msg-001" }, ctx());
    const otra = await correr(leer_buzon.execute({}, ctx()));
    expect(otra.ok && (otra.data as { mensajes: { id: string }[] }).mensajes.map((m) => m.id)).not.toContain("msg-001");
  });

  test("registrar sin confirmar rechaza lo dudoso; confirmado registra y el fixture no se toca (RN5, RN6)", async () => {
    const original = await Bun.file(join(dir, "fixtures/reto-02/maestro-contratos.csv")).text();
    const pendiente = await correr(registrar.execute({ mensaje_id: "msg-006" }, ctx()));
    expect(!pendiente.ok && pendiente.error).toBe("requiere revisión: valor, fecha_fin");

    const ok = await correr(registrar.execute({ mensaje_id: "msg-006", contrato: { fecha_fin: "2027-08-31" }, confirmado: true }, ctx()));
    expect(ok.ok && ok.data).toMatchObject({ accion: "alta", id_contrato: "CM-2026-03" });
    expect(await Bun.file(join(dir, "fixtures/reto-02/maestro-contratos.csv")).text()).toBe(original);
  });

  test("un mensaje ya procesado no se registra dos veces", async () => {
    await registrar.execute({ mensaje_id: "msg-001" }, ctx());
    const otra = await correr(registrar.execute({ mensaje_id: "msg-001" }, ctx()));
    expect(otra.ok && otra.data).toMatchObject({ ya_procesado: true, id_contrato: "CT-2026-015" });
    const maestro = await Bun.file(join(dir, "out/sharepoint/maestro-contratos.csv")).text();
    expect(maestro.match(/CT-2026-015/g)).toHaveLength(2); // id y nombre del archivo, en una sola fila
  });

  test("errores legibles: mensaje inexistente, id inseguro y fecha inválida (HU-6)", async () => {
    expect((await correr(validar.execute({ mensaje_id: "msg-999" }, ctx()))).ok).toBe(false);
    expect((await correr(alertas.execute({ hoy: "03/09/2026" }, ctx()))).ok).toBe(false);
    await writeFile(join(dir, "fixtures/reto-02/buzon/msg-001/contrato.txt"), "");
    const vacio = await correr(extraerTool.execute({ mensaje_id: "msg-001" }, ctx()));
    expect(!vacio.ok && vacio.error).toContain("vacío");
  });

  test("toda ejecución deja su línea en out/log.jsonl (RN7)", async () => {
    await validar.execute({ mensaje_id: "msg-002" }, ctx());
    const linea = JSON.parse((await Bun.file(join(dir, "out/log.jsonl")).text()).trim());
    expect(Object.keys(linea)).toEqual(["ts", "herramienta", "mensaje_id", "ok", "resumen"]);
    expect(linea).toMatchObject({ herramienta: "contratos_validar", mensaje_id: "msg-002", ok: true });
  });
});
