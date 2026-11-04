---
name: registro-contratos
description: Conocimiento del registro de contratos vigentes de Periferia — clasificación RN1–RN4, confianza y revisión (RN5), reglas del maestro y alertas. Úsalo al procesar el buzón de contratos.
---

## Registro de contratos vigentes en Periferia

El maestro de contratos vigentes estuvo congelado desde el **30 de mayo de 2026**. Este agente es el punto único de recepción: todo contrato, otrosí o acta que firme el área comercial llega al buzón de contratos, con o sin póliza. No hay área legal interna: el agente registra y alerta, pero no revisa cláusulas.

**Actores.** El comercial envía el contrato firmado al buzón. La analista administrativa es dueña del maestro y confirma los campos dudosos. Gerencia lee el reporte de alertas.

## Clasificación de cada mensaje

| Regla | Clasificación | Cuándo | Qué se hace |
|---|---|---|---|
| RN1 | **Duplicado** | Mismo número de contrato, con el mismo valor y las mismas fechas | No se escribe nada; solo se marca el mensaje como procesado |
| RN2 | **Actualización** | Mismo número (o mismo NIT y objeto casi igual), con algún campo distinto, o un otrosí | Se actualiza la fila y el cambio queda en el historial |
| RN3 | **Nuevo** | No coincide con nada del maestro | Se agrega una fila |
| RN4 | **Rechazado** | El correo no trae contrato ni otrosí, o el texto no permite identificar partes ni objeto | Se informa el motivo |

Un otrosí solo cambia los campos que menciona; lo demás se conserva del maestro. Si el otrosí amplía el plazo y el contrato exige pólizas, estas deben ampliarse: el estado de la póliza pasa a **pendiente**.

## Confianza y revisión (RN5)

Cada campo extraído trae una confianza entre 0 y 1. Los campos con confianza **menor a 0,8** van a revisión: no se registran hasta que la analista los confirme o los corrija. Un campo que no aparece en el documento es `null` con confianza 0: nunca se inventa. Los campos de alta confianza no se pueden cambiar al registrar, porque salen literalmente del documento.

Casos típicos de baja confianza: contrato marco o por demanda (sin valor total; se registra 0), plazo contado desde una firma sin día exacto, o dos fuentes que se contradicen.

## Reglas del maestro

- **id_contrato:** el número del documento; si no tiene, `AUTO-<año>-<secuencia>`.
- **nit_cliente:** sin puntos ni dígito de verificación.
- **País por identificador:** NIT → CO, RUC de 13 dígitos → EC, RUC de 11 dígitos → PE, RTN → HN, además del domicilio.
- **Monedas válidas:** COP, USD, PEN, PAB, HNL.
- **Estado de póliza:** un registro nuevo con póliza nace `pendiente`; sin póliza, `no_aplica`.
- **Archivo:** `Contratos/<año de inicio>/<cliente>/<id_contrato>.<extensión>` en SharePoint.
- El remitente se resuelve contra el catálogo de comerciales. Si no está, se informa, pero no bloquea el registro.

## Alertas

El reporte (`out/alertas.md`) tiene tres secciones: contratos que vencen en 60 días o menos, pólizas exigidas que no están vigentes, y contratos registrados desde el corte del 30 de mayo de 2026. También lista los contratos ya vencidos sin renovación registrada.
