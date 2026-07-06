import { Router } from "express";
import { db, getSettings } from "../db";
import {
  addMetrics,
  classifyCampaign,
  derive,
  emptyMetrics,
  flagKeyword,
  type BaseMetrics,
  type CampaignRow,
  type Currency,
  type DashboardData,
  type KeywordRow,
  type Marketplace,
  type SearchTermRow,
} from "../../../shared/src";

export const dataRouter = Router();

interface FactRow {
  report_type: string;
  marketplace: Marketplace;
  currency: Currency;
  date: string | null;
  portfolio_name: string | null;
  campaign_name: string | null;
  campaign_type: string | null;
  ad_group_name: string | null;
  status: string | null;
  keyword_text: string | null;
  match_type: string | null;
  search_term: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  units: number;
}

function queryFacts(reportType: string, marketplaces?: string[]): FactRow[] {
  let sql = "SELECT * FROM facts WHERE report_type = ?";
  const params: unknown[] = [reportType];
  if (marketplaces && marketplaces.length > 0) {
    sql += ` AND marketplace IN (${marketplaces.map(() => "?").join(",")})`;
    params.push(...marketplaces);
  }
  return db.prepare(sql).all(...(params as any[])) as unknown as FactRow[];
}

function parseMarketplaces(q: unknown): string[] | undefined {
  if (typeof q !== "string" || !q) return undefined;
  return q.split(",").filter(Boolean);
}

function groupBy<T>(
  rows: FactRow[],
  keyFn: (r: FactRow) => string | null,
  makeEntry: (r: FactRow) => T
): Map<string, T & BaseMetrics> {
  const map = new Map<string, T & BaseMetrics>();
  for (const r of rows) {
    const key = keyFn(r);
    if (key === null) continue;
    let entry = map.get(key);
    if (!entry) {
      entry = { ...makeEntry(r), ...emptyMetrics() };
      map.set(key, entry);
    }
    addMetrics(entry, r);
  }
  return map;
}

// ── Dashboard ────────────────────────────────────────────────────────────
dataRouter.get("/dashboard", (req, res) => {
  const mkts = parseMarketplaces(req.query.marketplaces);
  // Base del dashboard: reporte de campañas (evita doble conteo al mezclar
  // niveles campaña/keyword/search-term del mismo periodo)
  const facts = queryFacts("campaigns", mkts);
  const warnings: string[] = [];
  if (facts.length === 0)
    warnings.push(
      "No hay datos de Campaigns report importados para la selección. El dashboard se calcula solo sobre reportes de campañas."
    );

  const totalsByCurrency = [
    ...groupBy(facts, (r) => r.currency, (r) => ({ currency: r.currency })).values(),
  ].map((t) => ({ ...t, ...derive(t) }));

  const byMarketplace = [
    ...groupBy(
      facts,
      (r) => r.marketplace,
      (r) => ({ marketplace: r.marketplace, currency: r.currency })
    ).values(),
  ].map((t) => ({ ...t, ...derive(t) }));

  const byPortfolio = [
    ...groupBy(
      facts,
      (r) => (r.portfolio_name ? `${r.marketplace}|${r.portfolio_name}` : null),
      (r) => ({
        portfolioName: r.portfolio_name as string,
        marketplace: r.marketplace,
        currency: r.currency,
      })
    ).values(),
  ]
    .map((t) => ({ ...t, ...derive(t) }))
    .sort((a, b) => b.spend - a.spend);

  const topCampaigns = [
    ...groupBy(
      facts,
      (r) => (r.campaign_name ? `${r.marketplace}|${r.campaign_name}` : null),
      (r) => ({
        campaignName: r.campaign_name as string,
        marketplace: r.marketplace,
        currency: r.currency,
      })
    ).values(),
  ]
    .map((t) => ({ ...t, ...derive(t) }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 15);

  const dated = facts.filter((r) => r.date);
  const timeseries = [
    ...groupBy(
      dated,
      (r) => `${r.date}|${r.currency}`,
      (r) => ({ date: r.date as string, currency: r.currency })
    ).values(),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const hasDatedData = timeseries.length > 0;
  if (!hasDatedData && facts.length > 0)
    warnings.push(
      "Los reportes importados no incluyen columna de fecha: la evolución temporal no puede mostrarse."
    );

  const out: DashboardData = {
    totalsByCurrency,
    byMarketplace,
    byPortfolio,
    topCampaigns,
    timeseries,
    hasDatedData,
    warnings,
  };
  res.json(out);
});

// ── Campañas ─────────────────────────────────────────────────────────────
dataRouter.get("/campaigns", (req, res) => {
  const settings = getSettings();
  const facts = queryFacts("campaigns", parseMarketplaces(req.query.marketplaces));
  const grouped = groupBy(
    facts,
    (r) => (r.campaign_name ? `${r.marketplace}|${r.campaign_name}` : null),
    (r) => ({
      marketplace: r.marketplace,
      currency: r.currency,
      portfolioName: r.portfolio_name,
      campaignName: r.campaign_name as string,
      campaignType: r.campaign_type,
      status: r.status,
    })
  );
  const rows: CampaignRow[] = [...grouped.values()].map((g) => ({
    ...g,
    ...derive(g),
    classification: classifyCampaign(g, g.marketplace, settings),
  }));
  rows.sort((a, b) => b.spend - a.spend);
  res.json(rows);
});

// ── Keywords ─────────────────────────────────────────────────────────────
dataRouter.get("/keywords", (req, res) => {
  const settings = getSettings();
  const facts = queryFacts("keywords", parseMarketplaces(req.query.marketplaces));
  const grouped = groupBy(
    facts,
    (r) =>
      r.keyword_text
        ? `${r.marketplace}|${r.campaign_name}|${r.ad_group_name}|${r.keyword_text}|${r.match_type}`
        : null,
    (r) => ({
      marketplace: r.marketplace,
      currency: r.currency,
      campaignName: r.campaign_name ?? "",
      adGroupName: r.ad_group_name,
      keywordText: r.keyword_text as string,
      matchType: r.match_type,
    })
  );
  const rows: KeywordRow[] = [...grouped.values()].map((g) => ({
    ...g,
    ...derive(g),
    flags: flagKeyword(g, g.marketplace, settings),
  }));
  rows.sort((a, b) => b.spend - a.spend);
  res.json(rows);
});

// ── Search terms ─────────────────────────────────────────────────────────
dataRouter.get("/search-terms", (req, res) => {
  const facts = queryFacts(
    "search_terms",
    parseMarketplaces(req.query.marketplaces)
  );
  const grouped = groupBy(
    facts,
    (r) =>
      r.search_term
        ? `${r.marketplace}|${r.campaign_name}|${r.ad_group_name}|${r.search_term}`
        : null,
    (r) => ({
      marketplace: r.marketplace,
      currency: r.currency,
      campaignName: r.campaign_name ?? "",
      adGroupName: r.ad_group_name,
      searchTerm: r.search_term as string,
      matchedKeyword: r.keyword_text,
      matchType: r.match_type,
    })
  );
  const rows: SearchTermRow[] = [...grouped.values()].map((g) => ({
    ...g,
    ...derive(g),
  }));
  rows.sort((a, b) => b.spend - a.spend);
  res.json(rows);
});
