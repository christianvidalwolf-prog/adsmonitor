// ── Dominio ──────────────────────────────────────────────────────────────
export type Marketplace = "ES" | "DE" | "FR" | "IT" | "UK";
export type Source = "vendor" | "seller";
export type Currency = "EUR" | "GBP";
export type ReportType =
  | "campaigns"
  | "keywords"
  | "search_terms"
  | "products"
  | "portfolios"
  | "placements"
  | "top_search";

export const MARKETPLACES: Marketplace[] = ["ES", "DE", "FR", "IT", "UK"];
export const MARKETPLACE_CURRENCY: Record<Marketplace, Currency> = {
  ES: "EUR",
  DE: "EUR",
  FR: "EUR",
  IT: "EUR",
  UK: "GBP",
};

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  campaigns: "Campaigns",
  keywords: "Keywords",
  search_terms: "Search Terms",
  products: "Advertised Products",
  portfolios: "Portfolios",
  placements: "Placements",
  top_search: "Top of Search",
};

// ── Campos canónicos ─────────────────────────────────────────────────────
export type CanonicalField =
  | "date"
  | "campaignId"
  | "adGroupId"
  | "keywordId"
  | "productTargetingId"
  | "portfolioName"
  | "campaignName"
  | "campaignType"
  | "adGroupName"
  | "keywordText"
  | "matchType"
  | "searchTerm"
  | "asin"
  | "sku"
  | "productTitle"
  | "status"
  | "bid"
  | "placement"
  | "placementPercentage"
  | "topSearchImpressionShare"
  | "topSearchBidAdjustment"
  | "currency"
  | "impressions"
  | "clicks"
  | "spend"
  | "sales"
  | "orders"
  | "units";

export const METRIC_FIELDS = [
  "impressions",
  "clicks",
  "spend",
  "sales",
  "orders",
  "units",
] as const;

// ── Métricas base (siempre sumas, nunca ratios almacenados) ──────────────
export interface BaseMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  units: number;
}

export interface DerivedMetrics {
  ctr: number | null;
  cpc: number | null;
  cvr: number | null;
  acos: number | null;
  roas: number | null;
}

// ── Importaciones ────────────────────────────────────────────────────────
export interface ImportMeta {
  id: number;
  filename: string;
  reportType: ReportType;
  marketplace: Marketplace;
  source: Source;
  currency: Currency;
  dateFrom: string | null; // ISO yyyy-mm-dd
  dateTo: string | null;
  rowCount: number;
  hasDateColumn: boolean;
  missingFields: CanonicalField[];
  uploadedAt: string;
}

export interface ImportPreview {
  uploadId: string;
  filename: string;
  /** Identifica la hoja/subconjunto dentro del fichero (bulksheets multi-hoja) */
  candidateKey: string;
  sheetLabel: string;
  detectedReportType: ReportType | null;
  mappedColumns: { header: string; field: CanonicalField }[];
  unmappedColumns: string[];
  missingRequired: CanonicalField[];
  missingOptionalMetrics: CanonicalField[];
  detectedCurrency: Currency | null;
  detectedDateFrom: string | null;
  detectedDateTo: string | null;
  hasDateColumn: boolean;
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  warnings: string[];
}

export interface CommitRequest {
  uploadId: string;
  candidateKey?: string; // qué hoja/subconjunto importar; por defecto el primero
  marketplace: Marketplace;
  source: Source;
  dateFrom: string;
  dateTo: string;
  force?: boolean; // saltar validación de solape, decisión explícita
}

// ── Filas agregadas para tablas ──────────────────────────────────────────
export interface CampaignRow extends BaseMetrics, DerivedMetrics {
  marketplace: Marketplace;
  currency: Currency;
  portfolioName: string | null;
  campaignName: string;
  campaignType: string | null;
  status: string | null;
  classification: CampaignClass;
}

export interface KeywordRow extends BaseMetrics, DerivedMetrics {
  marketplace: Marketplace;
  currency: Currency;
  campaignName: string;
  adGroupName: string | null;
  keywordText: string;
  matchType: string | null;
  flags: KeywordFlag[];
}

export interface SearchTermRow extends BaseMetrics, DerivedMetrics {
  marketplace: Marketplace;
  currency: Currency;
  campaignName: string;
  adGroupName: string | null;
  searchTerm: string;
  matchedKeyword: string | null;
  matchType: string | null;
}

// ── Actions ─────────────────────────────────────────────────────────────
export type ActionEntityType = "campaign" | "keyword" | "search_term";

export type ActionType =
  | "pause_keyword"
  | "decrease_bid"
  | "increase_bid"
  | "add_negative"
  | "move_to_exact"
  | "graduate_keyword"
  | "increase_placement_mod"
  | "change_budget"
  | "change_campaign_status";

export type ActionSource = "manual" | "recommendation";

export type ActionStatus =
  | "implemented"
  | "monitoring"
  | "evaluating"
  | "concluded"
  | "rolled_back";

export type ActionResult = "positive" | "negative" | "neutral" | "inconclusive";
export type ActionConfidence = "high" | "medium" | "low";

export interface ActionMetrics extends BaseMetrics, DerivedMetrics {}

export interface ActionEvaluation {
  baselineFrom: string;
  baselineTo: string;
  evaluationFrom: string;
  evaluationTo: string;
  baseline: ActionMetrics;
  evaluation: ActionMetrics;
  delta: BaseMetrics;
  deltaPct: Partial<Record<keyof BaseMetrics | keyof DerivedMetrics, number | null>>;
  result: ActionResult;
  confidence: ActionConfidence;
  reason: string;
  warnings: string[];
}

export interface ActionRow {
  id: number;
  source: ActionSource;
  entityType: ActionEntityType;
  marketplace: Marketplace;
  campaignName: string | null;
  adGroupName: string | null;
  keywordText: string | null;
  matchType: string | null;
  searchTerm: string | null;
  actionType: ActionType;
  owner: string;
  hypothesis: string;
  notes: string;
  implementedAt: string;
  baselineWindowDays: number;
  evaluationWindowDays: number;
  status: ActionStatus;
  createdAt: string;
  updatedAt: string;
  evaluation: ActionEvaluation;
}

export interface ActionInput {
  source?: ActionSource;
  entityType: ActionEntityType;
  marketplace: Marketplace;
  campaignName?: string | null;
  adGroupName?: string | null;
  keywordText?: string | null;
  matchType?: string | null;
  searchTerm?: string | null;
  actionType: ActionType;
  owner: string;
  hypothesis?: string;
  notes?: string;
  implementedAt: string;
  baselineWindowDays?: number;
  evaluationWindowDays?: number;
  status?: ActionStatus;
}

export interface ActionRecommendation extends ActionInput {
  id: string;
  triggerRuleId: string;
  protocolAction: string;
  confidenceLevel: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
  actionDetails?: Record<string, unknown>;
  metrics: ActionMetrics;
}

export type RecommendationRuleStatus = "active" | "degraded" | "blocked";

export interface RecommendationRuleCoverage {
  ruleId: string;
  label: string;
  status: RecommendationRuleStatus;
  availableSignals: string[];
  missingSignals: string[];
  recommendationCount: number;
  reason: string;
}

export interface RecommendationDataCoverage {
  marketplaces: Marketplace[];
  imports: {
    reportType: ReportType;
    marketplace: Marketplace;
    latestDateTo: string | null;
    rowCount: number;
  }[];
  rules: RecommendationRuleCoverage[];
  summary: {
    active: number;
    degraded: number;
    blocked: number;
    recommendations: number;
  };
}

// ── Clasificación ────────────────────────────────────────────────────────
export type CampaignClass =
  | "winner"
  | "scale"
  | "monitor"
  | "reduce"
  | "pause_candidate";

export type KeywordFlag =
  | "top_sales"
  | "spend_no_sales"
  | "high_acos"
  | "scale_candidate"
  | "good_ctr_bad_cvr"
  | "low_visibility";

export const CAMPAIGN_CLASS_LABELS: Record<CampaignClass, string> = {
  winner: "Winner",
  scale: "Scale",
  monitor: "Monitor",
  reduce: "Reduce",
  pause_candidate: "Pause candidate",
};

// ── Settings ─────────────────────────────────────────────────────────────
export interface Settings {
  targetAcosGlobal: number; // 0.30 = 30%
  targetAcosByMarketplace: Partial<Record<Marketplace, number>>;
  minSpendPause: number; // gasto mínimo antes de sugerir pausa
  minOrdersWinner: number; // pedidos mínimos para clasificar winner
  minClicksData: number; // clics mínimos para considerar datos suficientes
}

export const DEFAULT_SETTINGS: Settings = {
  targetAcosGlobal: 0.3,
  targetAcosByMarketplace: {},
  minSpendPause: 15,
  minOrdersWinner: 3,
  minClicksData: 20,
};

// ── Dashboard ────────────────────────────────────────────────────────────
export interface CurrencyTotals extends BaseMetrics, DerivedMetrics {
  currency: Currency;
}

export interface DashboardData {
  totalsByCurrency: CurrencyTotals[];
  byMarketplace: (BaseMetrics &
    DerivedMetrics & { marketplace: Marketplace; currency: Currency })[];
  byPortfolio: (BaseMetrics &
    DerivedMetrics & {
      portfolioName: string;
      marketplace: Marketplace;
      currency: Currency;
    })[];
  topCampaigns: (BaseMetrics &
    DerivedMetrics & {
      campaignName: string;
      marketplace: Marketplace;
      currency: Currency;
    })[];
  timeseries: (BaseMetrics & { date: string; currency: Currency })[];
  hasDatedData: boolean;
  warnings: string[];
}
