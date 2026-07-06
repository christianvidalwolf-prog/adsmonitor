import { useEffect, useMemo, useState } from "react";
import type { SearchTermRow, Settings } from "@shared";
import { DEFAULT_SETTINGS } from "@shared";
import { api } from "../api";
import { useMarketplaces } from "../App";
import { DataTable, Notice, type Column } from "../components/ui";
import { acosColor, fmtInt, fmtMoney, fmtPct, fmtRatio } from "../lib/format";

const VIEWS = [
  { id: "all", label: "Todos" },
  { id: "converting", label: "Con ventas" },
  { id: "burn", label: "Gasto sin ventas" },
] as const;

export default function SearchTerms() {
  const { marketplaces } = useMarketplaces();
  const [rows, setRows] = useState<SearchTermRow[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<(typeof VIEWS)[number]["id"]>("all");

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);
  useEffect(() => {
    api
      .searchTerms(marketplaces)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [marketplaces]);

  const visible = useMemo(() => {
    if (view === "converting")
      return [...rows.filter((r) => r.sales > 0)].sort((a, b) => b.sales - a.sales);
    if (view === "burn")
      return [
        ...rows.filter((r) => r.sales === 0 && r.spend >= settings.minSpendPause),
      ].sort((a, b) => b.spend - a.spend);
    return rows;
  }, [rows, view, settings.minSpendPause]);

  const target = settings.targetAcosGlobal;
  const cols: Column<SearchTermRow>[] = [
    {
      key: "st", label: "Search term", sortValue: (r) => r.searchTerm,
      render: (r) => (
        <span className="inline-block max-w-72 truncate align-bottom font-medium" title={r.searchTerm}>
          {r.searchTerm}
        </span>
      ),
    },
    {
      key: "kw", label: "Keyword asociada", sortValue: (r) => r.matchedKeyword,
      render: (r) => (
        <span className="inline-block max-w-56 truncate align-bottom text-muted" title={r.matchedKeyword ?? ""}>
          {r.matchedKeyword ?? "–"}
        </span>
      ),
    },
    { key: "match", label: "Match", sortValue: (r) => r.matchType, render: (r) => <span className="text-muted">{r.matchType ?? "–"}</span> },
    {
      key: "camp", label: "Campaña", sortValue: (r) => r.campaignName,
      render: (r) => (
        <span className="inline-block max-w-56 truncate align-bottom text-muted" title={r.campaignName}>
          {r.campaignName}
        </span>
      ),
    },
    { key: "mkt", label: "País", sortValue: (r) => r.marketplace, render: (r) => r.marketplace },
    { key: "spend", label: "Spend", num: true, sortValue: (r) => r.spend, render: (r) => fmtMoney(r.spend, r.currency) },
    { key: "sales", label: "Sales", num: true, sortValue: (r) => r.sales, render: (r) => fmtMoney(r.sales, r.currency) },
    { key: "orders", label: "Orders", num: true, sortValue: (r) => r.orders, render: (r) => fmtInt(r.orders) },
    { key: "units", label: "Units", num: true, sortValue: (r) => r.units, render: (r) => fmtInt(r.units) },
    {
      key: "acos", label: "ACOS", num: true, sortValue: (r) => r.acos,
      render: (r) => <span className={acosColor(r.acos, target, r.spend)}>{fmtPct(r.acos)}</span>,
    },
    { key: "roas", label: "ROAS", num: true, sortValue: (r) => r.roas, render: (r) => fmtRatio(r.roas) },
    { key: "ctr", label: "CTR", num: true, sortValue: (r) => r.ctr, render: (r) => fmtPct(r.ctr, 2) },
    { key: "cpc", label: "CPC", num: true, sortValue: (r) => r.cpc, render: (r) => fmtMoney(r.cpc, r.currency) },
    { key: "cvr", label: "CVR", num: true, sortValue: (r) => r.cvr, render: (r) => fmtPct(r.cvr) },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="mr-2 text-lg font-bold">Search Terms</h1>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${
              view === v.id
                ? "border-accent/60 bg-accent/15 text-accent"
                : "border-line bg-panel text-muted hover:text-ink"
            }`}
          >
            {v.label}
          </button>
        ))}
        <span className="ml-2 text-xs text-faint">
          «Gasto sin ventas» usa el umbral de Settings (
          {settings.minSpendPause} de gasto mínimo)
        </span>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <DataTable
        columns={cols}
        rows={visible}
        rowKey={(r) =>
          `${r.marketplace}|${r.campaignName}|${r.adGroupName}|${r.searchTerm}`
        }
        searchable={(r) =>
          `${r.searchTerm} ${r.matchedKeyword ?? ""} ${r.campaignName}`
        }
      />
    </div>
  );
}
