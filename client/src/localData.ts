import {
  DEFAULT_SETTINGS,
  addMetrics,
  classifyCampaign,
  derive,
  emptyMetrics,
  flagKeyword,
  type CampaignRow,
  type CommitResult,
  type DashboardData,
  type ImportedFactRow,
  type ImportMeta,
  type KeywordRow,
  type SearchTermRow,
  type Settings,
} from "@shared";

const IMPORTS_KEY = "adsmonitor.imports.v1";
const FACTS_KEY = "adsmonitor.facts.v1";
const SETTINGS_KEY = "adsmonitor.settings.v1";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function readJson<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function readImports(): ImportMeta[] {
  return readJson<ImportMeta[]>(IMPORTS_KEY, []);
}

function writeImports(rows: ImportMeta[]): void {
  writeJson(IMPORTS_KEY, rows);
}

function readFacts(): ImportedFactRow[] {
  return readJson<ImportedFactRow[]>(FACTS_KEY, []);
}

function writeFacts(rows: ImportedFactRow[]): void {
  writeJson(FACTS_KEY, rows);
}

export function saveCommittedImport(result: CommitResult): void {
  const imports = readImports().filter((row) => row.id !== result.importMeta.id);
  imports.unshift(result.importMeta);
  writeImports(imports);

  const facts = readFacts().filter((row) => row.importId !== result.importMeta.id);
  facts.push(...result.facts);
  writeFacts(facts);
}

export function listStoredImports(): ImportMeta[] {
  return readImports();
}

export function deleteStoredImport(id: number): void {
  writeImports(readImports().filter((row) => row.id !== id));
  writeFacts(readFacts().filter((row) => row.importId !== id));
}

export function getStoredSettings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...readJson<Partial<Settings>>(SETTINGS_KEY, {}),
  };
}

export function saveStoredSettings(settings: Settings): Settings {
  writeJson(SETTINGS_KEY, settings);
  return settings;
}

function selectFacts(
  reportType: ImportedFactRow["reportType"],
  marketplaces?: string[]
): ImportedFactRow[] {
  return readFacts().filter(
    (row) =>
      row.reportType === reportType &&
      (!marketplaces || marketplaces.length === 0 || marketplaces.includes(row.marketplace))
  );
}

function groupBy<T>(
  rows: ImportedFactRow[],
  keyFn: (r: ImportedFactRow) => string | null,
  makeEntry: (r: ImportedFactRow) => T
): Map<string, T & ReturnType<typeof emptyMetrics>> {
  const map = new Map<string, T & ReturnType<typeof emptyMetrics>>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    let entry = map.get(key);
    if (!entry) {
      entry = { ...makeEntry(row), ...emptyMetrics() };
      map.set(key, entry);
    }
    addMetrics(entry, row);
  }
  return map;
}

export function buildDashboard(marketplaces: string[]): DashboardData {
  const facts = selectFacts("campaigns", marketplaces);
  const warnings: string[] = [];
  if (facts.length === 0) {
    warnings.push(
      "No hay datos de Campaigns importados para la selección. El dashboard se calcula solo sobre campañas."
    );
  }

  const totalsByCurrency = [
    ...groupBy(facts, (r) => r.currency, (r) => ({ currency: r.currency })).values(),
  ].map((row) => ({ ...row, ...derive(row) }));

  const byMarketplace = [
    ...groupBy(
      facts,
      (r) => r.marketplace,
      (r) => ({ marketplace: r.marketplace, currency: r.currency })
    ).values(),
  ].map((row) => ({ ...row, ...derive(row) }));

  const byPortfolio = [
    ...groupBy(
      facts,
      (r) => (r.portfolioName ? `${r.marketplace}|${r.portfolioName}` : null),
      (r) => ({
        portfolioName: r.portfolioName as string,
        marketplace: r.marketplace,
        currency: r.currency,
      })
    ).values(),
  ]
    .map((row) => ({ ...row, ...derive(row) }))
    .sort((a, b) => b.spend - a.spend);

  const topCampaigns = [
    ...groupBy(
      facts,
      (r) => (r.campaignName ? `${r.marketplace}|${r.campaignName}` : null),
      (r) => ({
        campaignName: r.campaignName as string,
        marketplace: r.marketplace,
        currency: r.currency,
      })
    ).values(),
  ]
    .map((row) => ({ ...row, ...derive(row) }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 15);

  const dated = facts.filter((row) => row.date);
  const timeseries = [
    ...groupBy(
      dated,
      (r) => `${r.date}|${r.currency}`,
      (r) => ({ date: r.date as string, currency: r.currency })
    ).values(),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const hasDatedData = timeseries.length > 0;
  if (!hasDatedData && facts.length > 0) {
    warnings.push(
      "Los reportes importados no incluyen columna de fecha: la evolucion temporal no puede mostrarse."
    );
  }

  return {
    totalsByCurrency,
    byMarketplace,
    byPortfolio,
    topCampaigns,
    timeseries,
    hasDatedData,
    warnings,
  };
}

export function buildCampaignRows(marketplaces: string[]): CampaignRow[] {
  const settings = getStoredSettings();
  const facts = selectFacts("campaigns", marketplaces);
  const grouped = groupBy(
    facts,
    (r) => (r.campaignName ? `${r.marketplace}|${r.campaignName}` : null),
    (r) => ({
      marketplace: r.marketplace,
      currency: r.currency,
      portfolioName: r.portfolioName,
      campaignName: r.campaignName as string,
      campaignType: r.campaignType,
      status: r.status,
    })
  );
  return [...grouped.values()]
    .map((row) => ({
      ...row,
      ...derive(row),
      classification: classifyCampaign(row, row.marketplace, settings),
    }))
    .sort((a, b) => b.spend - a.spend);
}

export function buildKeywordRows(marketplaces: string[]): KeywordRow[] {
  const settings = getStoredSettings();
  const facts = selectFacts("keywords", marketplaces);
  const grouped = groupBy(
    facts,
    (r) =>
      r.keywordText
        ? `${r.marketplace}|${r.campaignName}|${r.adGroupName}|${r.keywordText}|${r.matchType}`
        : null,
    (r) => ({
      marketplace: r.marketplace,
      currency: r.currency,
      campaignName: r.campaignName ?? "",
      adGroupName: r.adGroupName,
      keywordText: r.keywordText as string,
      matchType: r.matchType,
    })
  );
  return [...grouped.values()]
    .map((row) => ({
      ...row,
      ...derive(row),
      flags: flagKeyword(row, row.marketplace, settings),
    }))
    .sort((a, b) => b.spend - a.spend);
}

export function buildSearchTermRows(marketplaces: string[]): SearchTermRow[] {
  const facts = selectFacts("search_terms", marketplaces);
  const grouped = groupBy(
    facts,
    (r) =>
      r.searchTerm
        ? `${r.marketplace}|${r.campaignName}|${r.adGroupName}|${r.searchTerm}`
        : null,
    (r) => ({
      marketplace: r.marketplace,
      currency: r.currency,
      campaignName: r.campaignName ?? "",
      adGroupName: r.adGroupName,
      searchTerm: r.searchTerm as string,
      matchedKeyword: r.keywordText,
      matchType: r.matchType,
    })
  );
  return [...grouped.values()]
    .map((row) => ({ ...row, ...derive(row) }))
    .sort((a, b) => b.spend - a.spend);
}
