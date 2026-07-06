import { useEffect, useMemo, useState } from "react";
import type { KeywordFlag, KeywordRow, Settings } from "@shared";
import { DEFAULT_SETTINGS } from "@shared";
import { api } from "../api";
import { useMarketplaces } from "../App";
import { DataTable, FlagBadges, Notice, type Column } from "../components/ui";
import { acosColor, fmtInt, fmtMoney, fmtPct, fmtRatio } from "../lib/format";

const VIEWS: { id: string; label: string; filter: (r: KeywordRow) => boolean; sort?: (a: KeywordRow, b: KeywordRow) => number }[] = [
  { id: "all", label: "Todas", filter: () => true },
  { id: "top_sales", label: "Top ventas", filter: (r) => r.sales > 0, sort: (a, b) => b.sales - a.sales },
  { id: "top_roas", label: "Top ROAS", filter: (r) => r.roas !== null, sort: (a, b) => (b.roas ?? 0) - (a.roas ?? 0) },
  { id: "burn", label: "Gasto sin ventas", filter: (r) => r.flags.includes("spend_no_sales"), sort: (a, b) => b.spend - a.spend },
  { id: "scale", label: "Candidatas a escalar", filter: (r) => r.flags.includes("scale_candidate"), sort: (a, b) => b.sales - a.sales },
  { id: "ctr_no_cvr", label: "CTR ok · CVR mala", filter: (r) => r.flags.includes("good_ctr_bad_cvr") },
  { id: "low_vis", label: "Poca visibilidad", filter: (r) => r.flags.includes("low_visibility") },
];

export default function Keywords() {
  const { marketplaces } = useMarketplaces();
  const [rows, setRows] = useState<KeywordRow[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState("all");
  const [matchType, setMatchType] = useState("");

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);
  useEffect(() => {
    api.keywords(marketplaces).then(setRows).catch((e) => setError(e.message));
  }, [marketplaces]);

  const matchTypes = useMemo(
    () => [...new Set(rows.map((r) => r.matchType).filter(Boolean))] as string[],
    [rows]
  );
  const visible = useMemo(() => {
    const v = VIEWS.find((x) => x.id === view)!;
    let out = rows.filter(
      (r) => v.filter(r) && (!matchType || r.matchType === matchType)
    );
    if (v.sort) out = [...out].sort(v.sort);
    return out;
  }, [rows, view, matchType]);

  const target = settings.targetAcosGlobal;
  const cols: Column<KeywordRow>[] = [
    {
      key: "kw", label: "Keyword", sortValue: (r) => r.keywordText,
      render: (r) => (
        <span className="inline-block max-w-72 truncate align-bottom font-medium" title={r.keywordText}>
          {r.keywordText}
        </span>
      ),
    },
    { key: "match", label: "Match", sortValue: (r) => r.matchType, render: (r) => <span className="text-muted">{r.matchType ?? "–"}</span> },
    { key: "flags", label: "Flags", render: (r) => <FlagBadges flags={r.flags as KeywordFlag[]} /> },
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
    {
      key: "acos", label: "ACOS", num: true, sortValue: (r) => r.acos,
      render: (r) => <span className={acosColor(r.acos, target, r.spend)}>{fmtPct(r.acos)}</span>,
    },
    { key: "roas", label: "ROAS", num: true, sortValue: (r) => r.roas, render: (r) => fmtRatio(r.roas) },
    { key: "ctr", label: "CTR", num: true, sortValue: (r) => r.ctr, render: (r) => fmtPct(r.ctr, 2) },
    { key: "cvr", label: "CVR", num: true, sortValue: (r) => r.cvr, render: (r) => fmtPct(r.cvr) },
    { key: "impr", label: "Impr.", num: true, sortValue: (r) => r.impressions, render: (r) => fmtInt(r.impressions) },
    { key: "clicks", label: "Clicks", num: true, sortValue: (r) => r.clicks, render: (r) => fmtInt(r.clicks) },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-bold">Keywords</h1>
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
        {matchTypes.length > 0 && (
          <select value={matchType} onChange={(e) => setMatchType(e.target.value)}>
            <option value="">Todos los match types</option>
            {matchTypes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <DataTable
        columns={cols}
        rows={visible}
        rowKey={(r) =>
          `${r.marketplace}|${r.campaignName}|${r.adGroupName}|${r.keywordText}|${r.matchType}`
        }
        searchable={(r) => `${r.keywordText} ${r.campaignName}`}
      />
    </div>
  );
}
