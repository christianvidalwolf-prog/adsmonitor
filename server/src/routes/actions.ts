import { Router } from "express";
import { db, getSettings } from "../db";
import {
  addMetrics,
  derive,
  emptyMetrics,
  MARKETPLACES,
  normalizeTerm,
  type ActionConfidence,
  type ActionEntityType,
  type ActionEvaluation,
  type ActionInput,
  type ActionMetrics,
  type ActionRecommendation,
  type RecommendationDataCoverage,
  type RecommendationRuleCoverage,
  type ActionResult,
  type ActionRow,
  type ActionSource,
  type ActionStatus,
  type ActionType,
  type BaseMetrics,
  type Marketplace,
} from "../../../shared/src";

export const actionsRouter = Router();

const ENTITY_TYPES: ActionEntityType[] = ["campaign", "keyword", "search_term"];
const ACTION_TYPES: ActionType[] = [
  "pause_keyword",
  "decrease_bid",
  "increase_bid",
  "add_negative",
  "move_to_exact",
  "graduate_keyword",
  "increase_placement_mod",
  "change_budget",
  "change_campaign_status",
];
const SOURCES: ActionSource[] = ["manual", "recommendation"];
const STATUSES: ActionStatus[] = [
  "implemented",
  "monitoring",
  "evaluating",
  "concluded",
  "rolled_back",
];

interface ActionDbRow {
  id: number;
  source: ActionSource;
  entity_type: ActionEntityType;
  marketplace: Marketplace;
  campaign_name: string | null;
  ad_group_name: string | null;
  keyword_text: string | null;
  keyword_norm: string | null;
  match_type: string | null;
  search_term: string | null;
  search_term_norm: string | null;
  action_type: ActionType;
  owner: string;
  hypothesis: string;
  notes: string;
  implemented_at: string;
  baseline_window_days: number;
  evaluation_window_days: number;
  status: ActionStatus;
  created_at: string;
  updated_at: string;
}

interface FactMetricRow extends BaseMetrics {
  currency: string;
}

interface RecommendationFactRow extends FactMetricRow {
  marketplace: Marketplace;
  campaign_id: string | null;
  campaign_name: string | null;
  campaign_type: string | null;
  ad_group_name: string | null;
  keyword_text: string | null;
  keyword_norm: string | null;
  match_type: string | null;
  search_term: string | null;
  search_term_norm: string | null;
  placement: string | null;
  placement_percentage: number | null;
  top_search_impression_share: number | null;
  top_search_bid_adjustment: number | null;
}

const PROTOCOL_SOFT_TARGET_ACOS = 0.12;
const PROTOCOL_HIGH_ACOS = 0.3;
const PROTOCOL_WASTE_CLICKS = 10;
const PROTOCOL_GRADUATE_ORDERS = 2;

const PROTOCOL_RULE_LABELS: Record<string, string> = {
  "R-001": "Waste por clicks sin ventas",
  "R-002": "Waste por spend sin ventas",
  "R-003": "Marcas competidoras con CVR bajo",
  "R-004": "ACoS alto en keyword",
  "R-005": "Escalar puja con ToS Share bajo",
  "R-006": "Optimizar placement",
  "R-007": "Graduar search term a exacta",
};

function parseMarketplaces(q: unknown): string[] | undefined {
  if (typeof q !== "string" || !q) return undefined;
  return q.split(",").filter(Boolean);
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

function asMetrics(m: BaseMetrics): ActionMetrics {
  return { ...m, ...derive(m) };
}

function pct(next: number | null, prev: number | null): number | null {
  if (next === null || prev === null || prev === 0) return null;
  return (next - prev) / Math.abs(prev);
}

function buildDelta(
  baseline: ActionMetrics,
  evaluation: ActionMetrics
): ActionEvaluation["deltaPct"] {
  return {
    impressions: pct(evaluation.impressions, baseline.impressions),
    clicks: pct(evaluation.clicks, baseline.clicks),
    spend: pct(evaluation.spend, baseline.spend),
    sales: pct(evaluation.sales, baseline.sales),
    orders: pct(evaluation.orders, baseline.orders),
    units: pct(evaluation.units, baseline.units),
    ctr: pct(evaluation.ctr, baseline.ctr),
    cpc: pct(evaluation.cpc, baseline.cpc),
    cvr: pct(evaluation.cvr, baseline.cvr),
    acos: pct(evaluation.acos, baseline.acos),
    roas: pct(evaluation.roas, baseline.roas),
  };
}

function reportTypeFor(entityType: ActionEntityType): string {
  if (entityType === "campaign") return "campaigns";
  if (entityType === "keyword") return "keywords";
  return "search_terms";
}

function entityFilters(row: ActionDbRow): { sql: string; params: unknown[] } {
  const filters = ["report_type = ?", "marketplace = ?"];
  const params: unknown[] = [reportTypeFor(row.entity_type), row.marketplace];

  if (row.campaign_name) {
    filters.push("campaign_name = ?");
    params.push(row.campaign_name);
  }
  if (row.ad_group_name) {
    filters.push("ad_group_name = ?");
    params.push(row.ad_group_name);
  }
  if (row.entity_type === "keyword") {
    filters.push("keyword_norm = ?");
    params.push(row.keyword_norm ?? normalizeTerm(row.keyword_text ?? ""));
    if (row.match_type) {
      filters.push("match_type = ?");
      params.push(row.match_type);
    }
  }
  if (row.entity_type === "search_term") {
    filters.push("search_term_norm = ?");
    params.push(row.search_term_norm ?? normalizeTerm(row.search_term ?? ""));
  }

  return { sql: filters.join(" AND "), params };
}

function sumFacts(row: ActionDbRow, dateFrom: string, dateTo: string): BaseMetrics {
  const { sql, params } = entityFilters(row);
  const factRows = db
    .prepare(
      `SELECT currency, impressions, clicks, spend, sales, orders, units
       FROM facts
       WHERE ${sql} AND date IS NOT NULL AND date >= ? AND date <= ?`
    )
    .all(...(params as any[]), dateFrom, dateTo) as unknown as FactMetricRow[];
  const metrics = emptyMetrics();
  for (const fact of factRows) addMetrics(metrics, fact);
  return metrics;
}

function latestFactDate(row: ActionDbRow): string | null {
  const { sql, params } = entityFilters(row);
  const out = db
    .prepare(`SELECT MAX(date) AS max_date FROM facts WHERE ${sql} AND date IS NOT NULL`)
    .get(...(params as any[])) as { max_date: string | null } | undefined;
  return out?.max_date ?? null;
}

function confidenceFor(baseline: ActionMetrics, evaluation: ActionMetrics): ActionConfidence {
  const clicks = Math.min(baseline.clicks, evaluation.clicks);
  const orders = Math.min(baseline.orders, evaluation.orders);
  if (orders >= 20 || clicks >= 200) return "high";
  if (orders >= 5 || clicks >= 50) return "medium";
  return "low";
}

function classifyResult(
  baseline: ActionMetrics,
  evaluation: ActionMetrics,
  latestDate: string | null,
  evaluationTo: string
): Pick<ActionEvaluation, "result" | "reason" | "warnings" | "confidence"> {
  const settings = getSettings();
  const warnings: string[] = [];
  const totalActivity = baseline.clicks + evaluation.clicks + baseline.spend + evaluation.spend;
  if (totalActivity === 0) {
    return {
      result: "inconclusive",
      confidence: "low",
      reason: "No hay datos con fecha para la entidad y ventanas seleccionadas.",
      warnings,
    };
  }
  if (!latestDate || latestDate < evaluationTo) {
    warnings.push("La ventana post no está completamente cubierta por datos importados.");
  }
  if (
    Math.min(baseline.clicks, evaluation.clicks) < settings.minClicksData &&
    Math.min(baseline.orders, evaluation.orders) < 2
  ) {
    return {
      result: "inconclusive",
      confidence: "low",
      reason: "Volumen insuficiente para comparar con fiabilidad.",
      warnings,
    };
  }

  const confidence = confidenceFor(baseline, evaluation);
  const salesUp = evaluation.sales > baseline.sales;
  const salesDown = evaluation.sales < baseline.sales;
  const acosDown =
    baseline.acos !== null &&
    (evaluation.acos !== null ? evaluation.acos < baseline.acos : evaluation.spend === 0);
  const acosUp =
    baseline.acos !== null &&
    (evaluation.acos !== null ? evaluation.acos > baseline.acos : evaluation.spend > 0);

  if (salesUp && acosDown) {
    return {
      result: "positive",
      confidence,
      reason: "Sales suben y ACOS baja frente al baseline.",
      warnings,
    };
  }
  if ((salesDown && acosUp) || (evaluation.spend > baseline.spend && !salesUp && acosUp)) {
    return {
      result: "negative",
      confidence,
      reason: "ACOS empeora y sales no acompañan el cambio.",
      warnings,
    };
  }
  return {
    result: "neutral",
    confidence,
    reason: "La señal es mixta o demasiado pequeña para declararla positiva o negativa.",
    warnings,
  };
}

function evaluateAction(row: ActionDbRow): ActionEvaluation {
  const baselineTo = addDays(row.implemented_at, -1);
  const baselineFrom = addDays(row.implemented_at, -row.baseline_window_days);
  const evaluationFrom = addDays(row.implemented_at, 1);
  const evaluationTo = addDays(row.implemented_at, row.evaluation_window_days);
  const baseline = asMetrics(sumFacts(row, baselineFrom, baselineTo));
  const evaluation = asMetrics(sumFacts(row, evaluationFrom, evaluationTo));
  const latestDate = latestFactDate(row);
  const result = classifyResult(baseline, evaluation, latestDate, evaluationTo);
  const delta: BaseMetrics = {
    impressions: evaluation.impressions - baseline.impressions,
    clicks: evaluation.clicks - baseline.clicks,
    spend: evaluation.spend - baseline.spend,
    sales: evaluation.sales - baseline.sales,
    orders: evaluation.orders - baseline.orders,
    units: evaluation.units - baseline.units,
  };
  return {
    baselineFrom,
    baselineTo,
    evaluationFrom,
    evaluationTo,
    baseline,
    evaluation,
    delta,
    deltaPct: buildDelta(baseline, evaluation),
    ...result,
  };
}

function toAction(row: ActionDbRow): ActionRow {
  return {
    id: row.id,
    source: row.source,
    entityType: row.entity_type,
    marketplace: row.marketplace,
    campaignName: row.campaign_name,
    adGroupName: row.ad_group_name,
    keywordText: row.keyword_text,
    matchType: row.match_type,
    searchTerm: row.search_term,
    actionType: row.action_type,
    owner: row.owner,
    hypothesis: row.hypothesis,
    notes: row.notes,
    implementedAt: row.implemented_at,
    baselineWindowDays: row.baseline_window_days,
    evaluationWindowDays: row.evaluation_window_days,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    evaluation: evaluateAction(row),
  };
}

function groupRecommendationRows<T extends object>(
  rows: RecommendationFactRow[],
  keyFn: (r: RecommendationFactRow) => string | null,
  make: (r: RecommendationFactRow) => T
): (T & BaseMetrics)[] {
  const map = new Map<string, T & BaseMetrics>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    let entry = map.get(key);
    if (!entry) {
      entry = { ...make(row), ...emptyMetrics() };
      map.set(key, entry);
    }
    addMetrics(entry, row);
  }
  return [...map.values()];
}

function existingRecommendationKeys(): Set<string> {
  const rows = db
    .prepare(
      `SELECT action_type, entity_type, marketplace, campaign_name, ad_group_name,
              keyword_norm, match_type, search_term_norm
       FROM actions`
    )
    .all() as any[];
  return new Set(
    rows.map((r) =>
      [
        r.action_type,
        r.entity_type,
        r.marketplace,
        r.campaign_name ?? "",
        r.ad_group_name ?? "",
        r.keyword_norm ?? "",
        r.match_type ?? "",
        r.search_term_norm ?? "",
      ].join("|")
    )
  );
}

function recommendationKey(r: ActionRecommendation): string {
  return [
    r.actionType,
    r.entityType,
    r.marketplace,
    r.campaignName ?? "",
    r.adGroupName ?? "",
    r.keywordText ? normalizeTerm(r.keywordText) : "",
    r.matchType ?? "",
    r.searchTerm ? normalizeTerm(r.searchTerm) : "",
  ].join("|");
}

function recommendationDate(marketplace: Marketplace, reportType: string): string {
  const row = db
    .prepare(
      `SELECT date_to FROM imports
       WHERE marketplace = ? AND report_type = ?
       ORDER BY date_to DESC, id DESC LIMIT 1`
    )
    .get(marketplace, reportType) as { date_to: string | null } | undefined;
  return row?.date_to ?? new Date().toISOString().slice(0, 10);
}

function campaignNameById(marketplaces?: string[]): Map<string, string> {
  let sql = `SELECT marketplace, campaign_id, campaign_name
             FROM facts
             WHERE report_type = 'campaigns'
               AND campaign_id IS NOT NULL
               AND campaign_name IS NOT NULL`;
  const params: unknown[] = [];
  if (marketplaces && marketplaces.length > 0) {
    sql += ` AND marketplace IN (${marketplaces.map(() => "?").join(",")})`;
    params.push(...marketplaces);
  }
  const rows = db.prepare(sql).all(...(params as any[])) as {
    marketplace: Marketplace;
    campaign_id: string;
    campaign_name: string;
  }[];
  return new Map(rows.map((r) => [`${r.marketplace}|${r.campaign_id}`, r.campaign_name]));
}

function isSponsoredProductsType(t: string | null): boolean {
  if (!t) return true;
  const v = t.trim().toLowerCase();
  return v === "sp" || v.includes("sponsored products");
}

function placementKind(placement: string | null): "top" | "product" | "rest" | null {
  const v = (placement ?? "").toLowerCase();
  if (v.includes("top")) return "top";
  if (v.includes("product")) return "product";
  if (v.includes("rest")) return "rest";
  return null;
}

function buildRecommendations(marketplaces?: string[]): ActionRecommendation[] {
  const settings = getSettings();
  let mktSql = "";
  const mktParams: unknown[] = [];
  if (marketplaces && marketplaces.length > 0) {
    mktSql = ` AND marketplace IN (${marketplaces.map(() => "?").join(",")})`;
    mktParams.push(...marketplaces);
  }

  const out: ActionRecommendation[] = [];
  const keywordFacts = db
    .prepare(`SELECT * FROM facts WHERE report_type = 'keywords'${mktSql}`)
    .all(...(mktParams as any[])) as unknown as RecommendationFactRow[];
  const keywords = groupRecommendationRows(
    keywordFacts,
    (r) =>
      r.keyword_norm
        ? `${r.marketplace}|${r.campaign_name}|${r.ad_group_name}|${r.keyword_norm}|${r.match_type ?? ""}`
        : null,
    (r) => ({
      marketplace: r.marketplace,
      campaignName: r.campaign_name,
      adGroupName: r.ad_group_name,
      keywordText: r.keyword_text,
      matchType: r.match_type,
    })
  );
  for (const k of keywords) {
    const metrics = asMetrics(k);
    const implementedAt = recommendationDate(k.marketplace, "keywords");
    if (metrics.acos !== null && metrics.acos > PROTOCOL_HIGH_ACOS) {
      out.push({
        id: `R-004|${k.marketplace}|${k.campaignName}|${k.keywordText}|${k.matchType}`,
        triggerRuleId: "R-004",
        protocolAction: "REDUCE_BID",
        confidenceLevel: "HIGH",
        source: "recommendation",
        entityType: "keyword",
        marketplace: k.marketplace,
        campaignName: k.campaignName,
        adGroupName: k.adGroupName,
        keywordText: k.keywordText,
        matchType: k.matchType,
        actionType: "decrease_bid",
        owner: "",
        hypothesis: "Mitigar costes hacia ACoS objetivo reduciendo la puja un 15%-25%.",
        notes: "Protocolo Ads 2026.1: R-004. Reducir puja 15%-25% y monitorizar 7 días.",
        implementedAt,
        baselineWindowDays: 7,
        evaluationWindowDays: 7,
        status: "implemented",
        reason: `R-004: ACoS ${(metrics.acos * 100).toFixed(1)}% > 30%. Reducir bid 15%-25% sobre CPC/bid actual.`,
        actionDetails: {
          recommended_bid_change_pct_min: -25,
          recommended_bid_change_pct_max: -15,
          soft_reference_acos: PROTOCOL_SOFT_TARGET_ACOS,
          current_acos: metrics.acos,
        },
        metrics,
      });
    }
  }

  const topSearchFacts = db
    .prepare(`SELECT * FROM facts WHERE report_type = 'top_search'${mktSql}`)
    .all(...(mktParams as any[])) as unknown as RecommendationFactRow[];
  const topSearchRows = groupRecommendationRows(
    topSearchFacts,
    (r) => (r.campaign_name ? `${r.marketplace}|${r.campaign_name}` : null),
    (r) => ({
      marketplace: r.marketplace,
      campaignName: r.campaign_name,
      campaignType: r.campaign_type,
      topSearchImpressionShare: r.top_search_impression_share,
      topSearchBidAdjustment: r.top_search_bid_adjustment,
    })
  );
  for (const row of topSearchRows) {
    const metrics = asMetrics(row);
    const share = row.topSearchImpressionShare;
    const implementedAt = recommendationDate(row.marketplace, "top_search");
    if (
      isSponsoredProductsType(row.campaignType) &&
      share !== null &&
      share < 0.6 &&
      metrics.acos !== null &&
      metrics.acos <= PROTOCOL_SOFT_TARGET_ACOS &&
      metrics.sales > 0
    ) {
      out.push({
        id: `R-005|${row.marketplace}|${row.campaignName}`,
        triggerRuleId: "R-005",
        protocolAction: "INCREASE_BID",
        confidenceLevel: metrics.clicks >= 50 || metrics.orders >= 3 ? "HIGH" : "MEDIUM",
        source: "recommendation",
        entityType: "campaign",
        marketplace: row.marketplace,
        campaignName: row.campaignName,
        actionType: "increase_bid",
        owner: "",
        hypothesis: "Capturar más cuota Top of Search en campaña eficiente sin superar el ACOS objetivo suave.",
        notes: "Protocolo Ads 2026.1: R-005. Requiere aplicar el aumento sobre keywords/targets ganadores o revisar el modificador Top of Search antes de ejecutar en Amazon.",
        implementedAt,
        baselineWindowDays: 7,
        evaluationWindowDays: 7,
        status: "implemented",
        reason: `R-005: ACOS ${(metrics.acos * 100).toFixed(1)}% <= 12% y Top of Search IS ${(share * 100).toFixed(1)}% < 60%. Escalar visibilidad.`,
        actionDetails: {
          top_search_impression_share: share,
          current_top_search_bid_adjustment: row.topSearchBidAdjustment,
          recommended_bid_change_pct_min: 10,
          recommended_bid_change_pct_max: 20,
          soft_reference_acos: PROTOCOL_SOFT_TARGET_ACOS,
          current_acos: metrics.acos,
        },
        metrics,
      });
    }
  }

  const campaignNames = campaignNameById(marketplaces);
  const placementFacts = db
    .prepare(`SELECT * FROM facts WHERE report_type = 'placements'${mktSql}`)
    .all(...(mktParams as any[])) as unknown as RecommendationFactRow[];
  const placementGroups = new Map<
    string,
    {
      marketplace: Marketplace;
      campaignId: string;
      campaignName: string | null;
      placements: Partial<Record<"top" | "product" | "rest", BaseMetrics & {
        placementPercentage: number | null;
      }>>;
    }
  >();
  for (const row of placementFacts) {
    if (!row.campaign_id) continue;
    const kind = placementKind(row.placement);
    if (!kind) continue;
    const key = `${row.marketplace}|${row.campaign_id}`;
    let group = placementGroups.get(key);
    if (!group) {
      group = {
        marketplace: row.marketplace,
        campaignId: row.campaign_id,
        campaignName:
          row.campaign_name ?? campaignNames.get(`${row.marketplace}|${row.campaign_id}`) ?? null,
        placements: {},
      };
      placementGroups.set(key, group);
    }
    let slot = group.placements[kind];
    if (!slot) {
      slot = { ...emptyMetrics(), placementPercentage: row.placement_percentage };
      group.placements[kind] = slot;
    }
    addMetrics(slot, row);
    if (slot.placementPercentage === null && row.placement_percentage !== null) {
      slot.placementPercentage = row.placement_percentage;
    }
  }
  for (const group of placementGroups.values()) {
    const top = group.placements.top;
    const product = group.placements.product;
    if (!top || !product) continue;
    const topMetrics = asMetrics(top);
    const productMetrics = asMetrics(product);
    if (
      topMetrics.roas !== null &&
      productMetrics.roas !== null &&
      topMetrics.roas > 0 &&
      productMetrics.roas > 0 &&
      topMetrics.spend > 0 &&
      productMetrics.spend > 0 &&
      topMetrics.roas >= productMetrics.roas * 1.5
    ) {
      const combined = { ...emptyMetrics() };
      addMetrics(combined, top);
      addMetrics(combined, product);
      if (group.placements.rest) addMetrics(combined, group.placements.rest);
      const metrics = asMetrics(combined);
      const implementedAt = recommendationDate(group.marketplace, "placements");
      out.push({
        id: `R-006|${group.marketplace}|${group.campaignId}`,
        triggerRuleId: "R-006",
        protocolAction: "INCREASE_PLACEMENT_MOD",
        confidenceLevel: topMetrics.orders >= 5 || topMetrics.clicks >= 50 ? "HIGH" : "MEDIUM",
        source: "recommendation",
        entityType: "campaign",
        marketplace: group.marketplace,
        campaignName: group.campaignName,
        actionType: "increase_placement_mod",
        owner: "",
        hypothesis: "Aumentar el modificador Top of Search donde el ROAS supera claramente Product Pages.",
        notes: "Protocolo Ads 2026.1: R-006. Subir Top of Search +20%-40% y revisar reducción de bid base -10% antes de ejecutar.",
        implementedAt,
        baselineWindowDays: 7,
        evaluationWindowDays: 7,
        status: "implemented",
        reason: `R-006: ToS ROAS ${topMetrics.roas.toFixed(2)} >= 1.5x Product Pages ROAS ${productMetrics.roas.toFixed(2)}.`,
        actionDetails: {
          campaign_id: group.campaignId,
          current_top_search_placement_mod: top.placementPercentage,
          top_search_roas: topMetrics.roas,
          product_pages_roas: productMetrics.roas,
          recommended_top_search_mod_change_pct_min: 20,
          recommended_top_search_mod_change_pct_max: 40,
          recommended_base_bid_change_pct: -10,
        },
        metrics,
      });
    }
  }

  const searchTermFacts = db
    .prepare(`SELECT * FROM facts WHERE report_type = 'search_terms'${mktSql}`)
    .all(...(mktParams as any[])) as unknown as RecommendationFactRow[];
  const searchTerms = groupRecommendationRows(
    searchTermFacts,
    (r) =>
      r.search_term_norm
        ? `${r.marketplace}|${r.campaign_name}|${r.ad_group_name}|${r.search_term_norm}`
        : null,
    (r) => ({
      marketplace: r.marketplace,
      campaignName: r.campaign_name,
      adGroupName: r.ad_group_name,
      searchTerm: r.search_term,
      keywordText: r.keyword_text,
      matchType: r.match_type,
    })
  );
  for (const s of searchTerms) {
    const metrics = asMetrics(s);
    const implementedAt = recommendationDate(s.marketplace, "search_terms");
    if (s.clicks >= PROTOCOL_WASTE_CLICKS && s.sales === 0) {
      out.push({
        id: `R-001|${s.marketplace}|${s.campaignName}|${s.adGroupName}|${s.searchTerm}`,
        triggerRuleId: "R-001",
        protocolAction: "NEGATE_EXACT",
        confidenceLevel: "HIGH",
        source: "recommendation",
        entityType: "search_term",
        marketplace: s.marketplace,
        campaignName: s.campaignName,
        adGroupName: s.adGroupName,
        keywordText: s.keywordText,
        matchType: s.matchType,
        searchTerm: s.searchTerm,
        actionType: "add_negative",
        owner: "",
        hypothesis: "Reducir wasted spend añadiendo el search term como negativo exacto en el origen.",
        notes: "Protocolo Ads 2026.1: R-001. Ventana semanal 7-14 días.",
        implementedAt,
        baselineWindowDays: 7,
        evaluationWindowDays: 7,
        status: "implemented",
        reason: `R-001: ${s.clicks.toFixed(0)} clicks y 0 ventas. Negativizar exact en ad group/campaña origen.`,
        actionDetails: {
          negative_match_type: "Exact",
          apply_in_origin: true,
        },
        metrics,
      });
    } else if (s.spend >= settings.minSpendPause && s.sales === 0) {
      out.push({
        id: `R-002|${s.marketplace}|${s.campaignName}|${s.adGroupName}|${s.searchTerm}`,
        triggerRuleId: "R-002",
        protocolAction: "NEGATE_EXACT",
        confidenceLevel: "HIGH",
        source: "recommendation",
        entityType: "search_term",
        marketplace: s.marketplace,
        campaignName: s.campaignName,
        adGroupName: s.adGroupName,
        keywordText: s.keywordText,
        matchType: s.matchType,
        searchTerm: s.searchTerm,
        actionType: "add_negative",
        owner: "",
        hypothesis: "Cortar gasto sin ventas cuando spend supera el CPA provisional configurado.",
        notes: "Protocolo Ads 2026.1: R-002. La app usa Settings > gasto mínimo antes de sugerir pausa como CPA provisional mientras no haya margen real por SKU.",
        implementedAt,
        baselineWindowDays: 7,
        evaluationWindowDays: 7,
        status: "implemented",
        reason: `R-002: spend ${s.spend.toFixed(2)} >= CPA provisional ${settings.minSpendPause} y 0 ventas.`,
        actionDetails: {
          negative_match_type: "Exact",
          apply_in_origin: true,
          provisional_cpa: settings.minSpendPause,
        },
        metrics,
      });
    } else if (s.orders >= PROTOCOL_GRADUATE_ORDERS && s.matchType?.toLowerCase() !== "exact") {
      out.push({
        id: `R-007|${s.marketplace}|${s.campaignName}|${s.adGroupName}|${s.searchTerm}`,
        triggerRuleId: "R-007",
        protocolAction: "GRADUATE_KEYWORD",
        confidenceLevel: "HIGH",
        source: "recommendation",
        entityType: "search_term",
        marketplace: s.marketplace,
        campaignName: s.campaignName,
        adGroupName: s.adGroupName,
        keywordText: s.keywordText,
        matchType: s.matchType,
        searchTerm: s.searchTerm,
        actionType: "graduate_keyword",
        owner: "",
        hypothesis: "Graduar el search term a CORE exact y negativizar exact en GROWTH para aislar tráfico.",
        notes: "Protocolo Ads 2026.1: R-007. Requiere validar destino CORE y duplicados antes de ejecutar fuera de la app.",
        implementedAt,
        baselineWindowDays: 7,
        evaluationWindowDays: 7,
        status: "implemented",
        reason: `R-007: search term con ${s.orders.toFixed(0)} orders. Crear exact en CORE y añadir negativo exact en origen.`,
        actionDetails: {
          create_exact_in_core: true,
          add_as_negative_exact_in_origin: true,
          destination_required: "CORE exact campaign/ad group",
          recommended_initial_bid: metrics.cpc,
        },
        metrics,
      });
    }
  }

  const existing = existingRecommendationKeys();
  return out
    .filter((r) => !existing.has(recommendationKey(r)))
    .sort((a, b) => b.metrics.spend - a.metrics.spend);
}

function filteredFactsCount(reportType: string, marketplaces?: string[]): number {
  let sql = "SELECT COUNT(*) AS n FROM facts WHERE report_type = ?";
  const params: unknown[] = [reportType];
  if (marketplaces && marketplaces.length > 0) {
    sql += ` AND marketplace IN (${marketplaces.map(() => "?").join(",")})`;
    params.push(...marketplaces);
  }
  const row = db.prepare(sql).get(...(params as any[])) as { n: number };
  return row.n;
}

function filteredFactsCountWhere(
  reportType: string,
  condition: string,
  marketplaces?: string[]
): number {
  let sql = `SELECT COUNT(*) AS n FROM facts WHERE report_type = ? AND ${condition}`;
  const params: unknown[] = [reportType];
  if (marketplaces && marketplaces.length > 0) {
    sql += ` AND marketplace IN (${marketplaces.map(() => "?").join(",")})`;
    params.push(...marketplaces);
  }
  const row = db.prepare(sql).get(...(params as any[])) as { n: number };
  return row.n;
}

function importedMarketplaces(marketplaces?: string[]): Marketplace[] {
  if (marketplaces && marketplaces.length > 0) return marketplaces as Marketplace[];
  const rows = db
    .prepare("SELECT DISTINCT marketplace FROM imports ORDER BY marketplace")
    .all() as { marketplace: Marketplace }[];
  return rows.map((r) => r.marketplace);
}

function importsCoverage(marketplaces?: string[]): RecommendationDataCoverage["imports"] {
  let sql = `SELECT report_type, marketplace, MAX(date_to) AS latest_date_to, SUM(row_count) AS row_count
             FROM imports`;
  const params: unknown[] = [];
  if (marketplaces && marketplaces.length > 0) {
    sql += ` WHERE marketplace IN (${marketplaces.map(() => "?").join(",")})`;
    params.push(...marketplaces);
  }
  sql += " GROUP BY report_type, marketplace ORDER BY marketplace, report_type";
  const rows = db.prepare(sql).all(...(params as any[])) as any[];
  return rows.map((r) => ({
    reportType: r.report_type,
    marketplace: r.marketplace,
    latestDateTo: r.latest_date_to,
    rowCount: Number(r.row_count ?? 0),
  }));
}

function buildRuleCoverage(
  recommendations: ActionRecommendation[],
  marketplaces?: string[]
): RecommendationRuleCoverage[] {
  const recCounts = new Map<string, number>();
  for (const rec of recommendations) {
    recCounts.set(rec.triggerRuleId, (recCounts.get(rec.triggerRuleId) ?? 0) + 1);
  }

  const searchTermRows = filteredFactsCount("search_terms", marketplaces);
  const keywordRows = filteredFactsCount("keywords", marketplaces);
  const keywordRowsWithBid = filteredFactsCountWhere(
    "keywords",
    "bid IS NOT NULL",
    marketplaces
  );
  const campaignRows = filteredFactsCount("campaigns", marketplaces);
  const topSearchRows = filteredFactsCount("top_search", marketplaces);
  const topSearchRowsWithShare = filteredFactsCountWhere(
    "top_search",
    "top_search_impression_share IS NOT NULL",
    marketplaces
  );
  const placementRows = filteredFactsCount("placements", marketplaces);
  const placementRowsWithRoasInputs = filteredFactsCountWhere(
    "placements",
    "placement IS NOT NULL AND spend > 0 AND sales > 0",
    marketplaces
  );
  const hasCoreGrowthNaming =
    filteredFactsCountWhere(
      "campaigns",
      "LOWER(COALESCE(campaign_name, '')) LIKE '%core%'",
      marketplaces
    ) > 0 &&
    filteredFactsCountWhere(
      "campaigns",
      "LOWER(COALESCE(campaign_name, '')) LIKE '%growth%'",
      marketplaces
    ) > 0;

  const rule = (
    ruleId: string,
    status: RecommendationRuleCoverage["status"],
    availableSignals: string[],
    missingSignals: string[],
    reason: string
  ): RecommendationRuleCoverage => ({
    ruleId,
    label: PROTOCOL_RULE_LABELS[ruleId],
    status,
    availableSignals,
    missingSignals,
    recommendationCount: recCounts.get(ruleId) ?? 0,
    reason,
  });

  const hasSearchTerms = searchTermRows > 0;
  const hasKeywords = keywordRows > 0;
  const hasTopSearch = topSearchRows > 0;
  const hasPlacements = placementRows > 0;

  return [
    rule(
      "R-001",
      hasSearchTerms ? "active" : "blocked",
      hasSearchTerms ? ["Search terms", "Clicks", "Sales"] : [],
      hasSearchTerms ? [] : ["Search Term Report"],
      hasSearchTerms
        ? "Evaluable con search terms importados."
        : "No hay search terms importados para detectar clicks sin ventas."
    ),
    rule(
      "R-002",
      hasSearchTerms ? "active" : "blocked",
      hasSearchTerms ? ["Search terms", "Spend", "Sales", "CPA provisional"] : [],
      hasSearchTerms ? [] : ["Search Term Report"],
      hasSearchTerms
        ? "Evaluable usando el gasto mínimo configurado como CPA provisional."
        : "No hay search terms importados para detectar spend sin ventas."
    ),
    rule(
      "R-003",
      hasSearchTerms ? "blocked" : "blocked",
      hasSearchTerms ? ["Search terms", "CVR"] : [],
      hasSearchTerms
        ? ["Lista de marcas competidoras"]
        : ["Search Term Report", "Lista de marcas competidoras"],
      hasSearchTerms
        ? "Falta una lista editable de marcas competidoras; la app no infiere marcas por texto libre."
        : "Faltan search terms y lista de marcas competidoras."
    ),
    rule(
      "R-004",
      hasKeywords ? (keywordRowsWithBid > 0 ? "active" : "degraded") : "blocked",
      hasKeywords
        ? ["Keywords", "ACoS", ...(keywordRowsWithBid > 0 ? ["Bid actual"] : [])]
        : [],
      hasKeywords
        ? keywordRowsWithBid > 0
          ? []
          : ["Bid actual"]
        : ["Bulk/keyword report"],
      hasKeywords
        ? keywordRowsWithBid > 0
          ? "Evaluable con ACoS y bid actual importado."
          : "Puede detectar ACoS alto, pero no calcular una puja exacta sin bid actual."
        : "No hay keywords importadas para evaluar ACoS alto."
    ),
    rule(
      "R-005",
      hasTopSearch ? (topSearchRowsWithShare > 0 ? "active" : "degraded") : "blocked",
      [
        ...(hasTopSearch ? ["Top Search report"] : []),
        ...(topSearchRowsWithShare > 0 ? ["Top of Search Impression Share"] : []),
        ...(hasTopSearch ? ["ACoS", "Sales"] : []),
      ],
      hasTopSearch
        ? topSearchRowsWithShare > 0
          ? []
          : ["Top of Search Impression Share"]
        : ["Top Search report"],
      hasTopSearch
        ? topSearchRowsWithShare > 0
          ? "Evaluable con Top of Search IS, ACOS y ventas por campaña."
          : "Hay Top Search importado, pero falta la columna Top of Search IS."
        : "Falta el CSV Top Search para evaluar share bajo con ACOS eficiente."
    ),
    rule(
      "R-006",
      hasPlacements ? (placementRowsWithRoasInputs > 0 ? "active" : "degraded") : "blocked",
      [
        ...(campaignRows > 0 ? ["Campaigns"] : []),
        ...(hasPlacements ? ["Placement rows"] : []),
        ...(placementRowsWithRoasInputs > 0 ? ["Placement ROAS"] : []),
      ],
      hasPlacements
        ? placementRowsWithRoasInputs > 0
          ? []
          : ["Spend/Sales por placement"]
        : ["Bulk con Bidding adjustment / placements"],
      hasPlacements
        ? placementRowsWithRoasInputs > 0
          ? "Evaluable comparando ROAS de Top of Search contra Product Pages."
          : "Hay placements importados, pero faltan métricas suficientes para calcular ROAS."
        : "Falta importar el candidato Placements del bulk."
    ),
    rule(
      "R-007",
      hasSearchTerms ? (hasCoreGrowthNaming ? "active" : "degraded") : "blocked",
      hasSearchTerms
        ? ["Search terms", "Orders", ...(hasCoreGrowthNaming ? ["Routing CORE/GROWTH"] : [])]
        : [],
      hasSearchTerms
        ? hasCoreGrowthNaming
          ? []
          : ["Routing CORE/GROWTH o mapping de destino"]
        : ["Search Term Report", "Routing CORE/GROWTH o mapping de destino"],
      hasSearchTerms
        ? hasCoreGrowthNaming
          ? "Evaluable con destino detectable por naming CORE/GROWTH."
          : "Puede recomendar graduación, pero el destino exacto queda pendiente de mapping."
        : "No hay search terms importados para detectar términos con pedidos."
    ),
  ];
}

function buildDataCoverage(
  recommendations: ActionRecommendation[],
  marketplaces?: string[]
): RecommendationDataCoverage {
  const rules = buildRuleCoverage(recommendations, marketplaces);
  return {
    marketplaces: importedMarketplaces(marketplaces),
    imports: importsCoverage(marketplaces),
    rules,
    summary: {
      active: rules.filter((r) => r.status === "active").length,
      degraded: rules.filter((r) => r.status === "degraded").length,
      blocked: rules.filter((r) => r.status === "blocked").length,
      recommendations: recommendations.length,
    },
  };
}

function validateInput(body: Partial<ActionInput>, partial = false): string | null {
  if (!partial || body.entityType !== undefined) {
    if (!body.entityType || !ENTITY_TYPES.includes(body.entityType))
      return "Entidad no válida";
  }
  if (!partial || body.marketplace !== undefined) {
    if (!body.marketplace || !MARKETPLACES.includes(body.marketplace))
      return "Marketplace no válido";
  }
  if (!partial || body.actionType !== undefined) {
    if (!body.actionType || !ACTION_TYPES.includes(body.actionType))
      return "Tipo de acción no válido";
  }
  if (body.source !== undefined && !SOURCES.includes(body.source))
    return "Origen no válido";
  if (body.status !== undefined && !STATUSES.includes(body.status))
    return "Estado no válido";
  if (!partial || body.owner !== undefined) {
    if (!body.owner?.trim()) return "Owner es obligatorio";
  }
  if (!partial || body.implementedAt !== undefined) {
    if (!body.implementedAt || !/^\d{4}-\d{2}-\d{2}$/.test(body.implementedAt))
      return "Fecha de implementación inválida";
  }
  const entityType = body.entityType;
  if (!partial && entityType === "campaign" && !body.campaignName?.trim())
    return "Campaña es obligatoria";
  if (!partial && entityType === "keyword" && !body.keywordText?.trim())
    return "Keyword es obligatoria";
  if (!partial && entityType === "search_term" && !body.searchTerm?.trim())
    return "Search term es obligatorio";
  if (body.baselineWindowDays !== undefined && body.baselineWindowDays < 1)
    return "La ventana baseline debe ser al menos 1 día";
  if (body.evaluationWindowDays !== undefined && body.evaluationWindowDays < 1)
    return "La ventana post debe ser al menos 1 día";
  return null;
}

function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

actionsRouter.get("/", (req, res) => {
  const mkts = parseMarketplaces(req.query.marketplaces);
  let sql = "SELECT * FROM actions";
  const params: unknown[] = [];
  if (mkts && mkts.length > 0) {
    sql += ` WHERE marketplace IN (${mkts.map(() => "?").join(",")})`;
    params.push(...mkts);
  }
  sql += " ORDER BY implemented_at DESC, id DESC";
  const rows = db.prepare(sql).all(...(params as any[])) as unknown as ActionDbRow[];
  res.json(rows.map(toAction));
});

actionsRouter.get("/recommendations", (req, res) => {
  const mkts = parseMarketplaces(req.query.marketplaces);
  res.json(buildRecommendations(mkts));
});

actionsRouter.get("/recommendations/coverage", (req, res) => {
  const mkts = parseMarketplaces(req.query.marketplaces);
  const recommendations = buildRecommendations(mkts);
  res.json(buildDataCoverage(recommendations, mkts));
});

actionsRouter.post("/", (req, res) => {
  const body = req.body as ActionInput;
  const error = validateInput(body);
  if (error) return res.status(400).json({ error });

  const keywordText = cleanText(body.keywordText);
  const searchTerm = cleanText(body.searchTerm);
  const info = db
    .prepare(
      `INSERT INTO actions (
        source, entity_type, marketplace, campaign_name, ad_group_name,
        keyword_text, keyword_norm, match_type, search_term, search_term_norm,
        action_type, owner, hypothesis, notes, implemented_at,
        baseline_window_days, evaluation_window_days, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      body.source ?? "manual",
      body.entityType,
      body.marketplace,
      cleanText(body.campaignName),
      cleanText(body.adGroupName),
      keywordText,
      keywordText ? normalizeTerm(keywordText) : null,
      cleanText(body.matchType),
      searchTerm,
      searchTerm ? normalizeTerm(searchTerm) : null,
      body.actionType,
      body.owner.trim(),
      cleanText(body.hypothesis) ?? "",
      cleanText(body.notes) ?? "",
      body.implementedAt,
      body.baselineWindowDays ?? 7,
      body.evaluationWindowDays ?? 7,
      body.status ?? "implemented"
    );
  const row = db
    .prepare("SELECT * FROM actions WHERE id = ?")
    .get(info.lastInsertRowid as number) as unknown as ActionDbRow;
  res.status(201).json(toAction(row));
});

actionsRouter.put("/:id", (req, res) => {
  const current = db
    .prepare("SELECT * FROM actions WHERE id = ?")
    .get(req.params.id) as unknown as ActionDbRow | undefined;
  if (!current) return res.status(404).json({ error: "Acción no encontrada" });

  const body = req.body as Partial<ActionInput>;
  const merged: ActionInput = {
    source: body.source ?? current.source,
    entityType: body.entityType ?? current.entity_type,
    marketplace: body.marketplace ?? current.marketplace,
    campaignName: body.campaignName ?? current.campaign_name,
    adGroupName: body.adGroupName ?? current.ad_group_name,
    keywordText: body.keywordText ?? current.keyword_text,
    matchType: body.matchType ?? current.match_type,
    searchTerm: body.searchTerm ?? current.search_term,
    actionType: body.actionType ?? current.action_type,
    owner: body.owner ?? current.owner,
    hypothesis: body.hypothesis ?? current.hypothesis,
    notes: body.notes ?? current.notes,
    implementedAt: body.implementedAt ?? current.implemented_at,
    baselineWindowDays: body.baselineWindowDays ?? current.baseline_window_days,
    evaluationWindowDays: body.evaluationWindowDays ?? current.evaluation_window_days,
    status: body.status ?? current.status,
  };
  const error = validateInput(merged);
  if (error) return res.status(400).json({ error });

  const keywordText = cleanText(merged.keywordText);
  const searchTerm = cleanText(merged.searchTerm);
  const baselineWindowDays = merged.baselineWindowDays ?? 7;
  const evaluationWindowDays = merged.evaluationWindowDays ?? 7;
  db.prepare(
    `UPDATE actions SET
      source = ?, entity_type = ?, marketplace = ?, campaign_name = ?, ad_group_name = ?,
      keyword_text = ?, keyword_norm = ?, match_type = ?, search_term = ?, search_term_norm = ?,
      action_type = ?, owner = ?, hypothesis = ?, notes = ?, implemented_at = ?,
      baseline_window_days = ?, evaluation_window_days = ?, status = ?,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    merged.source ?? "manual",
    merged.entityType,
    merged.marketplace,
    cleanText(merged.campaignName),
    cleanText(merged.adGroupName),
    keywordText,
    keywordText ? normalizeTerm(keywordText) : null,
    cleanText(merged.matchType),
    searchTerm,
    searchTerm ? normalizeTerm(searchTerm) : null,
    merged.actionType,
    merged.owner.trim(),
    cleanText(merged.hypothesis) ?? "",
    cleanText(merged.notes) ?? "",
    merged.implementedAt,
    baselineWindowDays,
    evaluationWindowDays,
    merged.status ?? "implemented",
    req.params.id
  );
  const next = db
    .prepare("SELECT * FROM actions WHERE id = ?")
    .get(req.params.id) as unknown as ActionDbRow;
  res.json(toAction(next));
});

actionsRouter.post("/:id/evaluate", (req, res) => {
  const row = db
    .prepare("SELECT * FROM actions WHERE id = ?")
    .get(req.params.id) as unknown as ActionDbRow | undefined;
  if (!row) return res.status(404).json({ error: "Acción no encontrada" });
  res.json(evaluateAction(row));
});

actionsRouter.delete("/:id", (req, res) => {
  const info = db.prepare("DELETE FROM actions WHERE id = ?").run(req.params.id);
  if (info.changes === 0)
    return res.status(404).json({ error: "Acción no encontrada" });
  res.json({ deleted: true });
});
