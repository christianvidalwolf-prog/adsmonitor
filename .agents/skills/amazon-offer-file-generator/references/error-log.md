# Amazon Upload Error Log

This log lists errors encountered during upload attempts to Amazon, their diagnostics, and how they were solved. This file serves as the learning base for the Skill.

---

## [2026-07-02] - Error de Cumplimiento de Canal (fulfillment_channel_code)
- **Marketplace afectado**: ES (España)
- **Tipo de fichero**: Price and Quantity (listings-item template `.xlsm`)
- **Descripción del error**: El procesamiento falló debido a que el código de canal de cumplimiento estaba vacío.
- **Mensaje de error de Amazon**: `ERROR : El campo “fulfillment_channel_code” del atributo “Cumplimiento de código de canal” no tiene valores suficientes. El mínimo de valores necesarios es “1”.`
- **Causa raíz**: El archivo descargado original tenía vacía la columna `fulfillment_channel_code`. Al procesar un fichero de actualización parcial, Amazon exige que se indique el tipo de logística (FBA o FBM) para cada SKU.
- **Solución aplicada**: Se rellenó la columna `fulfillment_channel_code` (Columna B / Col 1) con el valor técnico `'DEFAULT'` para todos los productos FBM.
- **Regla nueva para la Skill**: Todo producto autogestionado (FBM) debe tener `'DEFAULT'` en la columna de canal de cumplimiento.
- **Cómo prevenir**: Validar que la columna no esté vacía si el SKU tiene cantidades y tiempos de entrega configurados.

---

## [2026-07-02] - Error de Calendario de Precios de Oferta (schedule.start_at / schedule.end_at)
- **Marketplace afectado**: ES (España)
- **Tipo de fichero**: Price and Quantity (listings-item template `.xlsm`)
- **Descripción del error**: Las fechas de inicio y fin de la oferta se rellenaron en las columnas incorrectas.
- **Mensaje de error de Amazon**: `ERROR : Según los datos de “[offers#?.prices#?.price_type]”, el campo “schedule.start_at” / “schedule.end_at” del atributo “Fecha de comienzo/finalización de la venta.” no tiene suficientes valores. El mínimo de valores necesarios es “1”.`
- **Causa raíz**: Se configuraron las fechas de oferta general (`start_at.value` y `end_at.value`), pero al indicar un precio promocional (`discounted_price`), Amazon requiere obligatoriamente definir el rango de fechas en las columnas de calendario específicas de la oferta (`discounted_price...start_at` y `discounted_price...end_at`).
- **Solución aplicada**: Se rellenaron las columnas `discounted_price#1.schedule#1.start_at` (Columna L / Col 11) y `discounted_price#1.schedule#1.end_at` (Columna K / Col 10) con las fechas de la oferta.
- **Regla nueva para la Skill**: Si hay un precio de oferta (`discounted_price`), las columnas del calendario de oferta de precio rebajado deben estar rellenadas con las fechas de la promoción.
- **Cómo prevenir**: Ejecutar comprobaciones automatizadas de coherencia de columnas antes de la exportación final.
