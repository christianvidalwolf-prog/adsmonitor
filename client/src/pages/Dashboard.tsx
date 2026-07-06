import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { DashboardData, Settings } from "@shared";
import { DEFAULT_SETTINGS } from "@shared";
import { api } from "../api";
import { useMarketplaces } from "../App";
import { DataTable, KpiCard, Notice, type Column } from "../components/ui";
import { acosColor, fmtInt, fmtMoney, fmtPct, fmtRatio } from "../lib/format";

export default function Dashboard() {
  const { marketplaces } = useMarketplaces();
  const [data, setData] = useState<DashboardData | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);
  useEffect(() => {
    setError(null);
    api
      .dashboard(marketplaces)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [marketplaces]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data) return <div className="text-muted">Cargando…</div>;

  const target = settings.targetAcosGlobal;

  type MktRow = DashboardData["byMarketplace"][number];
  const mktCols: Column<MktRow>[] = [
    { key: "mkt", label: "País", render: (r) => <b>{r.marketplace}</b> },
    { key: "spend", label: "Spend", num: true, sortValue: (r) => r.spend, render: (r) => fmtMoney(r.spend, r.currency) },
    { key: "sales", label: "Sales", num: true, sortValue: (r) => r.sales, render: (r) => fmtMoney(r.sales, r.currency) },
    { key: "orders", label: "Orders", num: true, sortValue: (r) => r.orders, render: (r) => fmtInt(r.orders) },
    { key: "acos", label: "ACOS", num: true, sortValue: (r) => r.acos, render: (r) => <span className={acosColor(r.acos, target, r.spend)}>{fmtPct(r.acos)}</span> },
    { key: "roas", label: "ROAS", num: true, sortValue: (r) => r.roas, render: (r) => fmtRatio(r.roas) },
    { key: "ctr", label: "CTR", num: true, sortValue: (r) => r.ctr, render: (r) => fmtPct(r.ctr, 2) },
    { key: "cpc", label: "CPC", num: true, sortValue: (r) => r.cpc, render: (r) => fmtMoney(r.cpc, r.currency) },
    { key: "cvr", label: "CVR", num: true, sortValue: (r) => r.cvr, render: (r) => fmtPct(r.cvr) },
  ];

  type PfRow = DashboardData["byPortfolio"][number];
  const pfCols: Column<PfRow>[] = [
    { key: "pf", label: "Portfolio", render: (r) => r.portfolioName },
    { key: "mkt", label: "País", render: (r) => r.marketplace },
    ...mktCols.slice(1).map((c) => ({ ...c, render: c.render as any })),
  ] as Column<PfRow>[];

  type CampRow = DashboardData["topCampaigns"][number];
  const campCols: Column<CampRow>[] = [
    { key: "c", label: "Campaña", render: (r) => <span className="max-w-96 truncate inline-block align-bottom" title={r.campaignName}>{r.campaignName}</span> },
    { key: "mkt", label: "País", render: (r) => r.marketplace },
    ...mktCols.slice(1).map((c) => ({ ...c, render: c.render as any })),
  ] as Column<CampRow>[];

  return (
    <div className="space-y-5">
      {data.warnings.map((w) => (
        <Notice key={w}>{w}</Notice>
      ))}

      {/* Ledgers por divisa — EUR y GBP nunca se suman */}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.totalsByCurrency.map((t) => (
          <section
            key={t.currency}
            className="rounded-xl border border-line bg-panel p-4"
          >
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
                Total {t.currency}
              </h2>
              <span className="text-[11px] text-faint">
                {t.currency === "GBP"
                  ? "UK · divisa aparte, sin conversión"
                  : "ES · DE · FR · IT"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <KpiCard label="Spend" value={fmtMoney(t.spend, t.currency)} />
              <KpiCard label="Sales" value={fmtMoney(t.sales, t.currency)} />
              <KpiCard
                label="ACOS"
                value={fmtPct(t.acos)}
                tone={
                  t.acos === null
                    ? t.spend > 0
                      ? "bad"
                      : undefined
                    : t.acos <= target
                      ? "good"
                      : t.acos <= target * 1.5
                        ? "warn"
                        : "bad"
                }
                sub={`objetivo ${fmtPct(target, 0)}`}
              />
              <KpiCard label="ROAS" value={fmtRatio(t.roas)} />
              <KpiCard label="Impressions" value={fmtInt(t.impressions)} />
              <KpiCard label="Clicks" value={fmtInt(t.clicks)} sub={`CTR ${fmtPct(t.ctr, 2)}`} />
              <KpiCard label="Orders" value={fmtInt(t.orders)} sub={`CVR ${fmtPct(t.cvr)}`} />
              <KpiCard label="Units" value={fmtInt(t.units)} sub={`CPC ${fmtMoney(t.cpc, t.currency)}`} />
            </div>
          </section>
        ))}
        {data.totalsByCurrency.length === 0 && (
          <Notice kind="info">
            Sin datos todavía. Importa un Campaigns report en la pestaña Imports.
          </Notice>
        )}
      </div>

      {data.hasDatedData && (
        <section className="rounded-xl border border-line bg-panel p-4">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">
            Evolución diaria (spend vs sales)
          </h2>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={data.timeseries}>
                <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="var(--color-faint)" fontSize={11} />
                <YAxis stroke="var(--color-faint)" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-panel-2)",
                    border: "1px solid var(--color-line)",
                    borderRadius: 8,
                  }}
                />
                <Line type="monotone" dataKey="spend" stroke="var(--color-accent)" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="sales" stroke="var(--color-good)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
          Por país
        </h2>
        <DataTable
          columns={mktCols}
          rows={data.byMarketplace}
          rowKey={(r) => r.marketplace}
        />
      </section>

      {data.byPortfolio.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
            Por portfolio
          </h2>
          <DataTable
            columns={pfCols}
            rows={data.byPortfolio}
            rowKey={(r) => `${r.marketplace}|${r.portfolioName}`}
          />
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
          Top 15 campañas por spend
        </h2>
        <DataTable
          columns={campCols}
          rows={data.topCampaigns}
          rowKey={(r) => `${r.marketplace}|${r.campaignName}`}
        />
      </section>
    </div>
  );
}
