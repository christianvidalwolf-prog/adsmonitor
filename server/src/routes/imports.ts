import { Router } from "express";
import multer from "multer";
import crypto from "node:crypto";
import { db, transaction } from "../db";
import {
  buildCandidates,
  parseWorkbook,
  toPreview,
  type ImportCandidate,
} from "../services/parser";
import {
  MARKETPLACES,
  MARKETPLACE_CURRENCY,
  normalizeTerm,
  type CanonicalField,
  type CommitRequest,
  type ImportMeta,
  type Marketplace,
} from "../../../shared/src";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Ficheros analizados pendientes de confirmar (flujo preview → commit)
const pending = new Map<
  string,
  { filename: string; candidates: ImportCandidate[]; createdAt: number }
>();
// caducidad 30 min
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, v] of pending) if (v.createdAt < cutoff) pending.delete(k);
}, 60_000).unref();

export const importsRouter = Router();

function parseMissingFields(raw: unknown): CanonicalField[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CanonicalField[]) : [];
  } catch {
    return [];
  }
}

importsRouter.post("/preview", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Falta el fichero" });
    const sheets = parseWorkbook(req.file.buffer);
    const candidates = buildCandidates(sheets);
    if (candidates.length === 0) {
      return res.status(422).json({
        error:
          "No se reconoce el tipo de reporte en ninguna hoja: no se han encontrado columnas reconocibles de campaña, keyword, search term, ASIN/SKU, placement o Top of Search.",
      });
    }
    const uploadId = crypto.randomUUID();
    pending.set(uploadId, {
      filename: req.file.originalname,
      candidates,
      createdAt: Date.now(),
    });
    res.json(
      candidates.map((c) => toPreview(uploadId, req.file!.originalname, c))
    );
  } catch (e: any) {
    res.status(400).json({ error: e.message ?? "Error al analizar el fichero" });
  }
});

importsRouter.post("/commit", (req, res) => {
  const body = req.body as CommitRequest;
  const item = pending.get(body.uploadId);
  if (!item)
    return res
      .status(410)
      .json({ error: "La previsualización ha caducado. Vuelve a subir el fichero." });
  if (!MARKETPLACES.includes(body.marketplace))
    return res.status(400).json({ error: "Marketplace no válido" });
  if (!body.dateFrom || !body.dateTo)
    return res.status(400).json({
      error:
        "Indica el periodo del reporte (desde/hasta). Es la base del modelo de periodos no solapados.",
    });
  if (body.dateFrom > body.dateTo)
    return res.status(400).json({ error: "El periodo es inválido: desde > hasta" });

  const candidate = body.candidateKey
    ? item.candidates.find((c) => c.key === body.candidateKey)
    : item.candidates[0];
  if (!candidate)
    return res.status(400).json({ error: "Hoja/candidato no válido" });
  const { analysis } = candidate;
  const { filename } = item;
  const currency = MARKETPLACE_CURRENCY[body.marketplace as Marketplace];
  if (analysis.detectedCurrency && analysis.detectedCurrency !== currency) {
    return res.status(422).json({
      error: `El fichero declara divisa ${analysis.detectedCurrency} pero el marketplace ${body.marketplace} usa ${currency}. Revisa la selección de país.`,
    });
  }

  // ── Validación de solape: el único modo de fallo catastrófico ──────────
  const overlap = db
    .prepare(
      `SELECT id, filename, date_from, date_to FROM imports
       WHERE report_type = ? AND marketplace = ?
         AND date_from <= ? AND date_to >= ?`
    )
    .get(analysis.reportType, body.marketplace, body.dateTo, body.dateFrom) as
    | { id: number; filename: string; date_from: string; date_to: string }
    | undefined;
  if (overlap && !body.force) {
    return res.status(409).json({
      error: `El periodo ${body.dateFrom} → ${body.dateTo} se solapa con la importación #${overlap.id} (${overlap.filename}, ${overlap.date_from} → ${overlap.date_to}). Importar duplicaría spend y ventas en todos los KPIs.`,
      overlapImportId: overlap.id,
      canForce: true,
    });
  }

  const insertImport = db.prepare(
    `INSERT INTO imports (filename, report_type, marketplace, source, currency, date_from, date_to, row_count, has_date_column, missing_fields)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertFact = db.prepare(
    `INSERT INTO facts (import_id, report_type, marketplace, source, currency, date,
       campaign_id, ad_group_id, keyword_id, product_targeting_id,
       portfolio_name, campaign_name, campaign_type, ad_group_name,
       keyword_text, keyword_norm, match_type, search_term, search_term_norm,
       asin, sku, product_title, status, bid, placement, placement_percentage,
       top_search_impression_share, top_search_bid_adjustment,
       impressions, clicks, spend, sales, orders, units)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const importId = transaction(() => {
    const info = insertImport.run(
      filename,
      analysis.reportType,
      body.marketplace,
      body.source,
      currency,
      body.dateFrom,
      body.dateTo,
      analysis.normalized.length,
      analysis.hasDateColumn ? 1 : 0,
      JSON.stringify(analysis.missingOptionalMetrics)
    );
    const importId = info.lastInsertRowid as number;
    for (const r of analysis.normalized) {
      insertFact.run(
        importId,
        analysis.reportType,
        body.marketplace,
        body.source,
        currency,
        r.date,
        r.campaignId,
        r.adGroupId,
        r.keywordId,
        r.productTargetingId,
        r.portfolioName,
        r.campaignName,
        r.campaignType,
        r.adGroupName,
        r.keywordText,
        r.keywordText ? normalizeTerm(r.keywordText) : null,
        r.matchType,
        r.searchTerm,
        r.searchTerm ? normalizeTerm(r.searchTerm) : null,
        r.asin,
        r.sku,
        r.productTitle,
        r.status,
        r.bid,
        r.placement,
        r.placementPercentage,
        r.topSearchImpressionShare,
        r.topSearchBidAdjustment,
        r.impressions,
        r.clicks,
        r.spend,
        r.sales,
        r.orders,
        r.units
      );
    }
    return importId;
  });

  // No se borra el pending: un bulksheet contiene varios candidatos y el
  // usuario puede importar el siguiente sin volver a subir el fichero.
  // La caducidad de 30 min lo limpia igualmente.
  res.json({ importId, rowCount: analysis.normalized.length, forced: !!overlap });
});

importsRouter.get("/", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM imports ORDER BY uploaded_at DESC")
    .all() as any[];
  const out: ImportMeta[] = rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    reportType: r.report_type,
    marketplace: r.marketplace,
    source: r.source,
    currency: r.currency,
    dateFrom: r.date_from,
    dateTo: r.date_to,
    rowCount: r.row_count,
    hasDateColumn: !!r.has_date_column,
    missingFields: parseMissingFields(r.missing_fields),
    uploadedAt: r.uploaded_at,
  }));
  res.json(out);
});

importsRouter.delete("/:id", (req, res) => {
  const info = db.prepare("DELETE FROM imports WHERE id = ?").run(req.params.id);
  if (info.changes === 0)
    return res.status(404).json({ error: "Importación no encontrada" });
  res.json({ deleted: true });
});
