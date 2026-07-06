import { useEffect, useMemo, useState } from "react";
import type { CampaignClass, CampaignRow, Settings } from "@shared";
import { DEFAULT_SETTINGS, CAMPAIGN_CLASS_LABELS } from "@shared";
import { api } from "../api";
import { useMarketplaces } from "../App";
import {
  ClassBadge,
  CLASS_STRIPE,
  DataTable,
  Notice,
  type Column,
} from "../components/ui";
import { acosColor, fmtInt, fmtMoney, fmtPct, fmtRatio } from "../lib/format";

const CLASSES = Object.keys(CAMPAIGN_CLASS_LABELS) as CampaignClass[];

export default function Campaigns() {
  const { marketplaces } = useMarketplaces();
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<CampaignClass | "">("");
  const [portfolio, setPortfolio] = useState("");

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);
  useEffect(() => {
    setError(null);
    api
      .campaigns(marketplaces)
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch((e) => {
        setRows([]);
        setError(e.message);
      });
  }, [marketplaces]);

  const portfolios = useMemo(
    () =>
      [...new Set(rows.map((r) => r.portfolioName).filter(Boolean))] as string[],
    [rows]
  );
  const visible = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!classFilter || r.classification === classFilter) &&
          (!portfolio || r.portfolioName === portfolio)
      ),
    [rows, classFilter, portfolio]
  );

  const target = settings.targetAcosGlobal;
  const cols: Column<CampaignRow>[] = [
    {
      key: "class",
      label: "Clase",
      sortValue: (r) => r.classification,
      render: (r) => <ClassBadge value={r.classification} />,
    },
    {
      key: "name",
      label: "Campaña",
      sortValue: (r) => r.campaignName,
      render: (r) => (
        <span className="inline-block max-w-80 truncate align-bottom" title={r.campaignName}>
          {r.campaignName}
        </span>
      ),
    },
    { key: "mkt", label: "País", sortValue: (r) => r.marketplace, render: (r) => r.marketplace },
    { key: "pf", label: "Portfolio", sortValue: (r) => r.portfolioName, render: (r) => r.portfolioName ?? "–" },
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
    { key: "impr", label: "Impr.", num: true, sortValue: (r) => r.impressions, render: (r) => fmtInt(r.impressions) },
    { key: "clicks", label: "Clicks", num: true, sortValue: (r) => r.clicks, render: (r) => fmtInt(r.clicks) },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold">Campaigns</h1>
        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value as CampaignClass | "")}
        >
          <option value="">Todas las clases</option>
          {CLASSES.map((c) => (
            <option key={c} value={c}>
              {CAMPAIGN_CLASS_LABELS[c]}
            </option>
          ))}
        </select>
        {portfolios.length > 0 && (
          <select value={portfolio} onChange={(e) => setPortfolio(e.target.value)}>
            <option value="">Todos los portfolios</option>
            {portfolios.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <DataTable
        columns={cols}
        rows={visible}
        rowKey={(r) => `${r.marketplace}|${r.campaignName}`}
        searchable={(r) => `${r.campaignName} ${r.portfolioName ?? ""}`}
        stripe={(r) => CLASS_STRIPE[r.classification]}
      />
    </div>
  );
}
