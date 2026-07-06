import * as XLSX from "xlsx";
import {
  mapHeaders,
  normalizeHeader,
  detectReportType,
  REQUIRED_FIELDS,
  OPTIONAL_METRIC_FIELDS,
  parseNumber,
  parseDate,
  normalizeTerm,
  METRIC_FIELDS,
  type CanonicalField,
  type Currency,
  type ImportPreview,
  type ReportType,
} from "../../../shared/src";

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

export function parseWorkbook(buffer: Buffer): ParsedSheet[] {
  // xlsx/xls son binarios (zip "PK" o CFB "\xd0\xcf"); el resto se trata como
  // texto CSV. SheetJS asume codepage 1252 para buffers de texto, lo que
  // destroza acentos UTF-8 ("campaña" → "campaÃ±a") y rompe el mapeo de
  // columnas, así que decodificamos nosotros con fallback.
  const isBinary =
    (buffer[0] === 0x50 && buffer[1] === 0x4b) ||
    (buffer[0] === 0xd0 && buffer[1] === 0xcf);
  let wb: XLSX.WorkBook;
  if (isBinary) {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } else {
    let text = buffer.toString("utf8");
    if (text.includes("\uFFFD")) text = buffer.toString("latin1"); // no era UTF-8
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
    // raw:true mantiene las celdas CSV como texto. Sin esto, SheetJS convierte
    // "100,52" (decimal europeo) en 10052 tratando la coma como separador de
    // miles: spend y ventas quedarían multiplicados ×100 en silencio.
    wb = XLSX.read(text, { type: "string", raw: true });
  }
  const sheets: ParsedSheet[] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets[name],
      { defval: null, raw: true }
    );
    if (rows.length === 0) continue;
    sheets.push({ name, headers: Object.keys(rows[0]), rows });
  }
  if (sheets.length === 0)
    throw new Error("El fichero no contiene filas de datos");
  return sheets;
}

export interface NormalizedRow {
  date: string | null;
  campaignId: string | null;
  adGroupId: string | null;
  keywordId: string | null;
  productTargetingId: string | null;
  portfolioName: string | null;
  campaignName: string | null;
  campaignType: string | null;
  adGroupName: string | null;
  keywordText: string | null;
  matchType: string | null;
  searchTerm: string | null;
  asin: string | null;
  sku: string | null;
  productTitle: string | null;
  status: string | null;
  bid: number | null;
  placement: string | null;
  placementPercentage: number | null;
  topSearchImpressionShare: number | null;
  topSearchBidAdjustment: number | null;
  currency: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  units: number;
}

const TEXT_FIELDS: CanonicalField[] = [
  "campaignId",
  "adGroupId",
  "keywordId",
  "productTargetingId",
  "portfolioName",
  "campaignName",
  "campaignType",
  "adGroupName",
  "keywordText",
  "matchType",
  "searchTerm",
  "asin",
  "sku",
  "productTitle",
  "status",
  "placement",
  "currency",
];

export interface AnalysisResult {
  reportType: ReportType | null;
  mapping: Map<string, CanonicalField>;
  unmapped: string[];
  missingRequired: CanonicalField[];
  missingOptionalMetrics: CanonicalField[];
  normalized: NormalizedRow[];
  detectedCurrency: Currency | null;
  detectedDateFrom: string | null;
  detectedDateTo: string | null;
  hasDateColumn: boolean;
  warnings: string[];
}

export interface AnalyzeOptions {
  /** Fuerza el tipo (subconjuntos de bulksheet: la autodetección fallaría
   *  porque la hoja mezcla columnas de varios tipos) */
  forcedType?: ReportType;
  /** Descarta el mapeo de fecha: en bulksheets "Start date"/"End date" son
   *  fechas de creación de campaña, no el periodo del reporte */
  ignoreDate?: boolean;
}

export function analyze(
  headers: string[],
  dataRows: Record<string, unknown>[],
  opts: AnalyzeOptions = {}
): AnalysisResult {
  const { mapping, unmapped } = mapHeaders(headers, dataRows);
  if (opts.ignoreDate) {
    for (const [header, field] of mapping) {
      if (field === "date") {
        mapping.delete(header);
        unmapped.push(header);
      }
    }
  }
  const fields = new Set(mapping.values());
  const reportType = opts.forcedType ?? detectReportType(fields);
  const warnings: string[] = [];

  const missingRequired = reportType
    ? REQUIRED_FIELDS[reportType].filter((f) => !fields.has(f))
    : [];
  const missingOptionalMetrics = OPTIONAL_METRIC_FIELDS.filter(
    (f) => !fields.has(f)
  );
  if (missingOptionalMetrics.length > 0) {
    warnings.push(
      `Faltan columnas de métrica: ${missingOptionalMetrics.join(", ")}. Los KPIs que dependen de ellas no se calcularán (no se inventan datos).`
    );
  }

  // header → campo invertido para acceso rápido
  const fieldToHeader = new Map<CanonicalField, string>();
  mapping.forEach((field, header) => fieldToHeader.set(field, header));

  const normalized: NormalizedRow[] = [];
  const currencies = new Set<string>();
  let minDate: string | null = null;
  let maxDate: string | null = null;
  let badNumberCells = 0;

  for (const raw of dataRows) {
    const row: NormalizedRow = {
      date: null,
      campaignId: null, adGroupId: null, keywordId: null, productTargetingId: null,
      portfolioName: null, campaignName: null, campaignType: null,
      adGroupName: null, keywordText: null, matchType: null, searchTerm: null,
      asin: null, sku: null, productTitle: null, status: null, bid: null,
      placement: null, placementPercentage: null,
      topSearchImpressionShare: null, topSearchBidAdjustment: null,
      currency: null,
      impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, units: 0,
    };
    for (const f of TEXT_FIELDS) {
      const h = fieldToHeader.get(f);
      if (h !== undefined && raw[h] !== null && raw[h] !== undefined) {
        const v = String(raw[h]).trim();
        (row as any)[f] = v === "" ? null : v;
      }
    }
    for (const f of METRIC_FIELDS) {
      const h = fieldToHeader.get(f);
      if (h !== undefined) {
        const n = parseNumber(raw[h]);
        if (n === null && raw[h] !== null && raw[h] !== "") badNumberCells++;
        (row as any)[f] = n ?? 0;
      }
    }
    const bidH = fieldToHeader.get("bid");
    if (bidH !== undefined) row.bid = parseNumber(raw[bidH]);
    const placementPercentageH = fieldToHeader.get("placementPercentage");
    if (placementPercentageH !== undefined)
      row.placementPercentage = parseNumber(raw[placementPercentageH]);
    const topSearchShareH = fieldToHeader.get("topSearchImpressionShare");
    if (topSearchShareH !== undefined)
      row.topSearchImpressionShare = parseNumber(raw[topSearchShareH]);
    const topSearchBidAdjustmentH = fieldToHeader.get("topSearchBidAdjustment");
    if (topSearchBidAdjustmentH !== undefined)
      row.topSearchBidAdjustment = parseNumber(raw[topSearchBidAdjustmentH]);
    const dateH = fieldToHeader.get("date");
    if (dateH !== undefined) {
      row.date = parseDate(raw[dateH]);
      if (row.date) {
        if (!minDate || row.date < minDate) minDate = row.date;
        if (!maxDate || row.date > maxDate) maxDate = row.date;
      }
    }
    if (row.currency) currencies.add(row.currency.toUpperCase());
    // saltar filas totalmente vacías
    const hasContent =
      row.campaignName || row.keywordText || row.searchTerm || row.asin ||
      row.portfolioName || row.campaignId || row.placement;
    if (hasContent) normalized.push(row);
  }

  if (badNumberCells > 0)
    warnings.push(
      `${badNumberCells} celdas numéricas no interpretables se han tratado como vacías.`
    );
  if (currencies.size > 1)
    warnings.push(
      `El fichero mezcla divisas (${[...currencies].join(", ")}). Revisa que sea un solo marketplace.`
    );

  let detectedCurrency: Currency | null = null;
  const c = [...currencies][0];
  if (currencies.size === 1 && (c === "EUR" || c === "GBP"))
    detectedCurrency = c;

  return {
    reportType,
    mapping,
    unmapped,
    missingRequired,
    missingOptionalMetrics,
    normalized,
    detectedCurrency,
    detectedDateFrom: minDate,
    detectedDateTo: maxDate,
    hasDateColumn: fieldToHeader.has("date"),
    warnings,
  };
}

// ── Candidatos de importación ─────────────────────────────────────────────
// Un fichero puede contener varios conjuntos importables: los bulksheets de
// Amazon traen varias hojas y, dentro de cada hoja, filas de distintas
// entidades cuyas métricas se solapan (una fila Campaign ya es la suma de sus
// Keywords: sumarlo todo duplicaría spend y ventas). Cada candidato es un
// subconjunto coherente que se importa como un reporte independiente.
export interface ImportCandidate {
  key: string;
  sheetLabel: string;
  analysis: AnalysisResult;
  sampleRows: Record<string, unknown>[];
}

const BULK_ENTITY_SUBSETS: [entity: string, type: ReportType, label: string][] = [
  ["campaign", "campaigns", "Campaigns"],
  ["bidding adjustment", "placements", "Placements"],
  ["keyword", "keywords", "Keywords"],
  ["product ad", "products", "Advertised Products"],
];

export function buildCandidates(sheets: ParsedSheet[]): ImportCandidate[] {
  const out: ImportCandidate[] = [];
  const workbookHasBulkEntitySheet = sheets.some((sheet) =>
    sheet.headers.some((h) => normalizeHeader(h) === "entity")
  );
  for (const sheet of sheets) {
    const entityHeader = sheet.headers.find(
      (h) => normalizeHeader(h) === "entity"
    );
    if (entityHeader) {
      // Hoja de bulksheet: un candidato por entidad relevante. Se ignoran
      // "Ad group" y "Product targeting" para KPIs generales; "Bidding
      // adjustment" se importa aparte para evaluar placement ROAS.
      for (const [entity, type, label] of BULK_ENTITY_SUBSETS) {
        const rows = sheet.rows.filter(
          (r) =>
            String(r[entityHeader] ?? "").trim().toLowerCase() === entity
        );
        if (rows.length === 0) continue;
        const analysis = analyze(sheet.headers, rows, {
          forcedType: type,
          ignoreDate: true,
        });
        if (analysis.missingRequired.length > 0) continue;
        out.push({
          key: `${sheet.name}::${type}`,
          sheetLabel: `${sheet.name} · ${label}`,
          analysis,
          sampleRows: rows.slice(0, 5),
        });
      }
    } else {
      if (workbookHasBulkEntitySheet && /search term report/i.test(sheet.name)) {
        continue;
      }
      const analysis = analyze(sheet.headers, sheet.rows, {});
      if (!analysis.reportType || analysis.missingRequired.length > 0) continue;
      out.push({
        key: `${sheet.name}::${analysis.reportType}`,
        sheetLabel: sheet.name,
        analysis,
        sampleRows: sheet.rows.slice(0, 5),
      });
    }
  }
  // Un mismo tipo puede salir de varias hojas (campañas SP + SB + SD): se
  // fusionan en un candidato único. Son conjuntos disjuntos de campañas, no
  // duplicados, y así no chocan con la validación de periodos solapados
  // (un import por tipo y periodo).
  const merged = mergeByReportType(out);
  // Primero los candidatos con métricas completas; a igualdad, más filas
  merged.sort((a, b) => {
    const dm =
      a.analysis.missingOptionalMetrics.length -
      b.analysis.missingOptionalMetrics.length;
    if (dm !== 0) return dm;
    return b.analysis.normalized.length - a.analysis.normalized.length;
  });
  return merged;
}

function mergeByReportType(candidates: ImportCandidate[]): ImportCandidate[] {
  const groups = new Map<ReportType, ImportCandidate[]>();
  for (const c of candidates) {
    const t = c.analysis.reportType!;
    const g = groups.get(t);
    if (g) g.push(c);
    else groups.set(t, [c]);
  }
  const out: ImportCandidate[] = [];
  groups.forEach((group, type) => {
    if (group.length === 1) {
      out.push(group[0]);
      return;
    }
    const analyses = group.map((c) => c.analysis);
    const mapping = new Map<string, CanonicalField>();
    const unmapped = new Set<string>();
    const missingOptional = new Set<CanonicalField>();
    const warnings = new Set<string>();
    const currencies = new Set<Currency>();
    let minDate: string | null = null;
    let maxDate: string | null = null;
    for (const a of analyses) {
      a.mapping.forEach((f, h) => mapping.set(h, f));
      a.unmapped.forEach((h) => unmapped.add(h));
      a.missingOptionalMetrics.forEach((f) => missingOptional.add(f));
      a.warnings.forEach((w) => warnings.add(w));
      if (a.detectedCurrency) currencies.add(a.detectedCurrency);
      if (a.detectedDateFrom && (!minDate || a.detectedDateFrom < minDate))
        minDate = a.detectedDateFrom;
      if (a.detectedDateTo && (!maxDate || a.detectedDateTo > maxDate))
        maxDate = a.detectedDateTo;
    }
    if (currencies.size > 1)
      warnings.add(
        `Las hojas fusionadas declaran divisas distintas (${[...currencies].join(", ")}).`
      );
    out.push({
      key: `merged::${type}`,
      sheetLabel: group.map((c) => c.sheetLabel).join(" + "),
      analysis: {
        reportType: type,
        mapping,
        unmapped: [...unmapped].filter((h) => !mapping.has(h)),
        missingRequired: [],
        missingOptionalMetrics: [...missingOptional],
        normalized: analyses.flatMap((a) => a.normalized),
        detectedCurrency: currencies.size === 1 ? [...currencies][0] : null,
        detectedDateFrom: minDate,
        detectedDateTo: maxDate,
        hasDateColumn: analyses.some((a) => a.hasDateColumn),
        warnings: [...warnings],
      },
      sampleRows: group.flatMap((c) => c.sampleRows).slice(0, 5),
    });
  });
  return out;
}

export function toPreview(
  uploadId: string,
  filename: string,
  c: ImportCandidate
): ImportPreview {
  const a = c.analysis;
  return {
    uploadId,
    filename,
    candidateKey: c.key,
    sheetLabel: c.sheetLabel,
    detectedReportType: a.reportType,
    mappedColumns: [...a.mapping.entries()].map(([header, field]) => ({
      header,
      field,
    })),
    unmappedColumns: a.unmapped,
    missingRequired: a.missingRequired,
    missingOptionalMetrics: a.missingOptionalMetrics,
    detectedCurrency: a.detectedCurrency,
    detectedDateFrom: a.detectedDateFrom,
    detectedDateTo: a.detectedDateTo,
    hasDateColumn: a.hasDateColumn,
    rowCount: a.normalized.length,
    sampleRows: c.sampleRows,
    warnings: a.warnings,
  };
}

export { normalizeTerm };
