# Amazon Ads Monitor — CRAZE (Fase 2: versión mínima funcional)

App interna para importar reportes de Amazon Ads (Vendor y Seller Central, ES/DE/FR/IT/UK)
y convertirlos en dashboards de decisión.

## Arranque

```bash
npm install          # instala los 3 workspaces (shared, server, client)
npm run dev          # API en :3001 + Vite en :5173
```

Requiere Node 22+ (usa `node:sqlite`, sin compilación nativa).
La base de datos se crea sola en `server/data/app.db`.

## Deploy

El frontend llama a `/api` en local. Si se despliega separado del backend
por ejemplo Vercel + Render, define en el frontend:

```bash
VITE_API_BASE_URL=https://tu-api-en-render.onrender.com
```

Sin esa variable, un hosting estático puede devolver el HTML del frontend en
`/api/imports`; la app lo mostrará como error en vez de quedarse en blanco.

## Qué incluye esta fase

- **Imports**: xlsx/csv, headers en ES/EN/DE/FR/IT, detección automática del tipo
  de reporte, preview con mapeo de columnas antes de confirmar, validación de
  solapes de periodo (rechaza con opción de forzar), histórico borrable.
- **Dashboard**: KPIs en dos ledgers separados EUR/GBP (nunca se suman divisas),
  desglose por país/portfolio/campaña, evolución diaria si el reporte trae fecha.
- **Campaigns**: clasificación automática Winner/Scale/Monitor/Reduce/Pause.
- **Keywords**: flags (gasto sin ventas, ACOS alto, escalar, CTR ok · CVR mala,
  poca visibilidad) y vistas rápidas.
- **Search Terms**: vistas con ventas / gasto sin ventas.
- **Settings**: target ACOS global y por país, umbrales de clasificación.

## Fase 3 (pendiente)
Cruce Keywords vs Search Terms, Advertised Products, Action Plan priorizado,
exportaciones Excel/CSV, target ACOS por portfolio, TACOS con fichero externo.

## Decisiones de diseño que no hay que romper

1. **Solo se almacenan sumas, nunca ratios.** ACOS/ROAS/CTR/CPC/CVR se recalculan
   siempre desde agregados (`shared/src/metrics.ts`). Promediar ratios fila a fila
   da números falsos.
2. **Denominador 0 → null, nunca 0.** Un ACOS "0%" en una keyword con gasto y sin
   ventas la ordenaría como la mejor de la tabla.
3. **Periodos no solapados por (tipo de reporte, marketplace).** La API rechaza
   solapes (409) salvo `force: true` explícito.
4. **EUR y GBP nunca se agregan.** UK se muestra como ledger aparte.
5. **CSV se lee como texto crudo** (`raw: true`): si no, SheetJS convierte
   "100,52" en 10052 (coma decimal europea tratada como miles) y multiplica
   spend/ventas ×100 en silencio.
6. La lógica de negocio vive en `shared/` como funciones puras: al conectar la
   Amazon Ads API en el futuro solo cambia el origen de los datos.
