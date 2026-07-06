import { useEffect, useMemo, useState } from "react";
import {
  MARKETPLACES,
  type ActionEntityType,
  type ActionInput,
  type ActionRecommendation,
  type ActionResult,
  type ActionRow,
  type ActionSource,
  type ActionStatus,
  type ActionType,
  type Marketplace,
} from "@shared";
import { api } from "../api";
import { useMarketplaces } from "../App";
import { DataTable, Notice, type Column } from "../components/ui";
import { fmtInt, fmtMoney, fmtPct, fmtRatio } from "../lib/format";

const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  pause_keyword: "Pausar keyword",
  decrease_bid: "Bajar bid",
  increase_bid: "Subir bid",
  add_negative: "Añadir negativa",
  move_to_exact: "Mover a exacta",
  change_budget: "Cambiar presupuesto",
  change_campaign_status: "Cambiar campaign status",
};

const ENTITY_LABELS: Record<ActionEntityType, string> = {
  campaign: "Campaña",
  keyword: "Keyword",
  search_term: "Search term",
};

const RESULT_LABELS: Record<ActionResult, string> = {
  positive: "Positiva",
  negative: "Negativa",
  neutral: "Neutral",
  inconclusive: "Inconclusa",
};

const RESULT_STYLE: Record<ActionResult, string> = {
  positive: "border-good/30 bg-good/15 text-good",
  negative: "border-bad/30 bg-bad/15 text-bad",
  neutral: "border-line bg-panel-2 text-muted",
  inconclusive: "border-warn/30 bg-warn/15 text-warn",
};

const STATUS_LABELS: Record<ActionStatus, string> = {
  implemented: "Implementada",
  monitoring: "Monitorizando",
  evaluating: "Evaluando",
  concluded: "Concluida",
  rolled_back: "Revertida",
};

const SOURCE_LABELS: Record<ActionSource, string> = {
  manual: "Manual",
  recommendation: "Recomendación",
};

const RECOMMENDATIONS_PAGE_SIZE = 12;

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyForm = (): ActionInput => ({
  source: "manual",
  entityType: "keyword",
  marketplace: "IT",
  campaignName: "",
  adGroupName: "",
  keywordText: "",
  matchType: "",
  searchTerm: "",
  actionType: "decrease_bid",
  owner: "",
  hypothesis: "",
  notes: "",
  implementedAt: todayIso(),
  baselineWindowDays: 7,
  evaluationWindowDays: 7,
  status: "implemented",
});

function ResultBadge({ value }: { value: ActionResult }) {
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-semibold ${RESULT_STYLE[value]}`}
    >
      {RESULT_LABELS[value]}
    </span>
  );
}

function signedPct(n: number | null | undefined) {
  if (n === null || n === undefined) return "–";
  const sign = n > 0 ? "+" : "";
  return `${sign}${fmtPct(n)}`;
}

function entityName(row: ActionRow) {
  if (row.entityType === "campaign") return row.campaignName ?? "–";
  if (row.entityType === "keyword") return row.keywordText ?? "–";
  return row.searchTerm ?? "–";
}

function compactContext(row: ActionRow) {
  const bits = [row.campaignName, row.adGroupName, row.matchType].filter(Boolean);
  return bits.length ? bits.join(" · ") : "–";
}

function recommendationSearchText(rec: ActionRecommendation) {
  return [
    ACTION_TYPE_LABELS[rec.actionType],
    ENTITY_LABELS[rec.entityType],
    rec.marketplace,
    rec.campaignName,
    rec.adGroupName,
    rec.keywordText,
    rec.matchType,
    rec.searchTerm,
    rec.reason,
    rec.hypothesis,
    rec.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function Actions() {
  const { marketplaces } = useMarketplaces();
  const [rows, setRows] = useState<ActionRow[]>([]);
  const [recommendations, setRecommendations] = useState<ActionRecommendation[]>([]);
  const [recommendationsQuery, setRecommendationsQuery] = useState("");
  const [recommendationsPage, setRecommendationsPage] = useState(0);
  const [form, setForm] = useState<ActionInput>(emptyForm);
  const [resultFilter, setResultFilter] = useState<ActionResult | "">("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () =>
    Promise.all([api.actions(marketplaces), api.actionRecommendations(marketplaces)])
      .then(([actions, recs]) => {
        setRows(actions);
        setRecommendations(recs);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, [marketplaces]);

  const visible = useMemo(
    () =>
      rows.filter(
        (r) => !resultFilter || r.evaluation.result === resultFilter
      ),
    [rows, resultFilter]
  );

  const visibleRecommendations = useMemo(() => {
    const q = recommendationsQuery.trim().toLowerCase();
    if (!q) return recommendations;
    return recommendations.filter((rec) =>
      recommendationSearchText(rec).includes(q)
    );
  }, [recommendations, recommendationsQuery]);

  const recommendationsPages = Math.max(
    1,
    Math.ceil(visibleRecommendations.length / RECOMMENDATIONS_PAGE_SIZE)
  );
  const recommendationsCurrentPage = Math.min(
    recommendationsPage,
    recommendationsPages - 1
  );
  const recommendationsStart =
    recommendationsCurrentPage * RECOMMENDATIONS_PAGE_SIZE;
  const recommendationsPageRows = visibleRecommendations.slice(
    recommendationsStart,
    recommendationsStart + RECOMMENDATIONS_PAGE_SIZE
  );
  const recommendationsEnd =
    recommendationsStart + recommendationsPageRows.length;
  const hasRecommendationsPagination =
    visibleRecommendations.length > RECOMMENDATIONS_PAGE_SIZE;

  useEffect(() => {
    setRecommendationsPage(0);
  }, [visibleRecommendations.length, marketplaces, recommendationsQuery]);

  const setField = <K extends keyof ActionInput>(key: K, value: ActionInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: ActionInput = {
        ...form,
        campaignName: form.campaignName || null,
        adGroupName: form.adGroupName || null,
        keywordText: form.keywordText || null,
        matchType: form.matchType || null,
        searchTerm: form.searchTerm || null,
        baselineWindowDays: Number(form.baselineWindowDays ?? 7),
        evaluationWindowDays: Number(form.evaluationWindowDays ?? 7),
      };
      const created = await api.createAction(payload);
      setRows((prev) => [created, ...prev]);
      setForm(emptyForm());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("¿Eliminar esta acción?")) return;
    await api.deleteAction(id);
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const markConcluded = async (row: ActionRow) => {
    const updated = await api.updateAction(row.id, { status: "concluded" });
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  };

  const createFromRecommendation = async (rec: ActionRecommendation) => {
    if (!form.owner.trim()) {
      setError("Indica un owner en el formulario antes de convertir una recomendación.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api.createAction({ ...rec, owner: form.owner.trim() });
      setRows((prev) => [created, ...prev]);
      setRecommendations((prev) => prev.filter((r) => r.id !== rec.id));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const cols: Column<ActionRow>[] = [
    {
      key: "result",
      label: "Resultado",
      sortValue: (r) => r.evaluation.result,
      render: (r) => <ResultBadge value={r.evaluation.result} />,
    },
    {
      key: "date",
      label: "Fecha",
      sortValue: (r) => r.implementedAt,
      render: (r) => <span className="font-mono text-xs">{r.implementedAt}</span>,
    },
    {
      key: "action",
      label: "Acción",
      sortValue: (r) => r.actionType,
      render: (r) => ACTION_TYPE_LABELS[r.actionType],
    },
    {
      key: "entity",
      label: "Entidad",
      sortValue: (r) => entityName(r),
      render: (r) => (
        <div className="max-w-72">
          <div className="truncate font-medium" title={entityName(r)}>
            {entityName(r)}
          </div>
          <div className="truncate text-xs text-faint" title={compactContext(r)}>
            {ENTITY_LABELS[r.entityType]} · {compactContext(r)}
          </div>
        </div>
      ),
    },
    { key: "mkt", label: "País", sortValue: (r) => r.marketplace, render: (r) => r.marketplace },
    { key: "owner", label: "Owner", sortValue: (r) => r.owner, render: (r) => r.owner },
    {
      key: "sales",
      label: "Δ Sales",
      num: true,
      sortValue: (r) => r.evaluation.delta.sales,
      render: (r) => fmtMoney(r.evaluation.delta.sales, r.marketplace === "UK" ? "GBP" : "EUR"),
    },
    {
      key: "clicks",
      label: "Δ Clicks",
      num: true,
      sortValue: (r) => r.evaluation.delta.clicks,
      render: (r) => fmtInt(r.evaluation.delta.clicks),
    },
    {
      key: "acos",
      label: "Δ ACOS",
      num: true,
      sortValue: (r) => r.evaluation.deltaPct.acos ?? null,
      render: (r) => signedPct(r.evaluation.deltaPct.acos),
    },
    {
      key: "post",
      label: "Post",
      num: true,
      sortValue: (r) => r.evaluation.evaluation.sales,
      render: (r) => (
        <span title={`Orders ${fmtInt(r.evaluation.evaluation.orders)} · ROAS ${fmtRatio(r.evaluation.evaluation.roas)}`}>
          {fmtMoney(r.evaluation.evaluation.sales, r.marketplace === "UK" ? "GBP" : "EUR")}
        </span>
      ),
    },
    {
      key: "confidence",
      label: "Conf.",
      sortValue: (r) => r.evaluation.confidence,
      render: (r) => r.evaluation.confidence,
    },
    {
      key: "status",
      label: "Estado",
      sortValue: (r) => r.status,
      render: (r) => STATUS_LABELS[r.status],
    },
    {
      key: "ops",
      label: "",
      render: (r) => (
        <span className="flex justify-end gap-2">
          {r.status !== "concluded" && (
            <button
              onClick={() => markConcluded(r)}
              className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink"
            >
              cerrar
            </button>
          )}
          <button
            onClick={() => remove(r.id)}
            className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-bad"
          >
            borrar
          </button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-bold">Actions</h1>
        {(["", "positive", "negative", "neutral", "inconclusive"] as const).map(
          (r) => (
            <button
              key={r || "all"}
              onClick={() => setResultFilter(r)}
              className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${
                resultFilter === r
                  ? "border-accent/60 bg-accent/15 text-accent"
                  : "border-line bg-panel text-muted hover:text-ink"
              }`}
            >
              {r ? RESULT_LABELS[r] : "Todas"}
            </button>
          )
        )}
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-muted">Recomendaciones</h2>
          <span className="font-mono text-xs text-faint">
            {visibleRecommendations.length} de {recommendations.length} pendientes
          </span>
        </div>
        <label className="grid max-w-xl gap-1 text-xs text-muted">
          Buscar acciones recomendadas
          <input
            value={recommendationsQuery}
            onChange={(e) => setRecommendationsQuery(e.target.value)}
            placeholder="Campaña, ad group, keyword, search term, razón…"
            className="w-full"
          />
        </label>
        <div className="overflow-auto rounded-lg border border-line bg-panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Acción</th>
                <th>Entidad</th>
                <th>Campaña</th>
                <th>Razón</th>
                <th className="num">Spend</th>
                <th className="num">Clicks</th>
                <th className="num">Sales</th>
                <th className="num">ACOS</th>
                <th className="num">Orders</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleRecommendations.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-5 text-center text-muted">
                    {recommendations.length === 0
                      ? "No hay recomendaciones pendientes para los datos importados."
                      : "No hay recomendaciones que coincidan con la búsqueda."}
                  </td>
                </tr>
              )}
              {recommendationsPageRows.map((rec) => (
                <tr key={rec.id}>
                  <td>{ACTION_TYPE_LABELS[rec.actionType]}</td>
                  <td>
                    <div className="max-w-72">
                      <div className="truncate font-medium" title={rec.searchTerm ?? rec.keywordText ?? rec.campaignName ?? ""}>
                        {rec.searchTerm ?? rec.keywordText ?? rec.campaignName}
                      </div>
                      <div className="truncate text-xs text-faint">
                        {ENTITY_LABELS[rec.entityType]} · {rec.marketplace}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span
                      className="inline-block max-w-72 truncate text-muted"
                      title={rec.campaignName ?? ""}
                    >
                      {rec.campaignName ?? "–"}
                    </span>
                  </td>
                  <td>
                    <span className="inline-block max-w-96 truncate" title={rec.reason}>
                      {rec.reason}
                    </span>
                  </td>
                  <td className="num">{fmtMoney(rec.metrics.spend, rec.marketplace === "UK" ? "GBP" : "EUR")}</td>
                  <td className="num">{fmtInt(rec.metrics.clicks)}</td>
                  <td className="num">{fmtMoney(rec.metrics.sales, rec.marketplace === "UK" ? "GBP" : "EUR")}</td>
                  <td className="num">{fmtPct(rec.metrics.acos)}</td>
                  <td className="num">{fmtInt(rec.metrics.orders)}</td>
                  <td>
                    <button
                      onClick={() => createFromRecommendation(rec)}
                      disabled={saving}
                      className="rounded-md border border-accent/60 bg-accent/15 px-2 py-1 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
                    >
                      crear
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasRecommendationsPagination && (
          <div className="flex items-center justify-end gap-2">
            <span className="font-mono text-xs text-faint">
              {recommendationsStart + 1}-{recommendationsEnd} de{" "}
              {visibleRecommendations.length} · página {recommendationsCurrentPage + 1} de{" "}
              {recommendationsPages}
            </span>
            <button
              onClick={() => setRecommendationsPage(0)}
              disabled={recommendationsCurrentPage === 0}
              className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              primera
            </button>
            <button
              onClick={() =>
                setRecommendationsPage((p) => Math.max(0, p - 1))
              }
              disabled={recommendationsCurrentPage === 0}
              className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              anterior
            </button>
            <button
              onClick={() =>
                setRecommendationsPage((p) =>
                  Math.min(recommendationsPages - 1, p + 1)
                )
              }
              disabled={recommendationsCurrentPage >= recommendationsPages - 1}
              className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              siguiente
            </button>
            <button
              onClick={() => setRecommendationsPage(recommendationsPages - 1)}
              disabled={recommendationsCurrentPage >= recommendationsPages - 1}
              className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              última
            </button>
          </div>
        )}
      </section>

      <form
        onSubmit={submit}
        className="grid gap-3 rounded-lg border border-line bg-panel p-4"
      >
        <div className="grid gap-3 lg:grid-cols-6">
          <label className="grid gap-1 text-xs text-muted">
            Origen
            <select
              value={form.source}
              onChange={(e) => setField("source", e.target.value as ActionSource)}
            >
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted">
            País
            <select
              value={form.marketplace}
              onChange={(e) => setField("marketplace", e.target.value as Marketplace)}
            >
              {MARKETPLACES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Entidad
            <select
              value={form.entityType}
              onChange={(e) =>
                setField("entityType", e.target.value as ActionEntityType)
              }
            >
              {Object.entries(ENTITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Acción
            <select
              value={form.actionType}
              onChange={(e) => setField("actionType", e.target.value as ActionType)}
            >
              {Object.entries(ACTION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Fecha
            <input
              type="date"
              value={form.implementedAt}
              onChange={(e) => setField("implementedAt", e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Owner
            <input
              value={form.owner}
              onChange={(e) => setField("owner", e.target.value)}
              placeholder="Responsable"
              required
            />
          </label>
        </div>

        <div className="grid gap-3 lg:grid-cols-4">
          <label className="grid gap-1 text-xs text-muted">
            Campaña
            <input
              value={form.campaignName ?? ""}
              onChange={(e) => setField("campaignName", e.target.value)}
              placeholder="Nombre campaña"
              required={form.entityType === "campaign"}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Ad group
            <input
              value={form.adGroupName ?? ""}
              onChange={(e) => setField("adGroupName", e.target.value)}
              placeholder="Opcional"
            />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Keyword
            <input
              value={form.keywordText ?? ""}
              onChange={(e) => setField("keywordText", e.target.value)}
              placeholder="Keyword exacta"
              required={form.entityType === "keyword"}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Search term
            <input
              value={form.searchTerm ?? ""}
              onChange={(e) => setField("searchTerm", e.target.value)}
              placeholder="Search term exacto"
              required={form.entityType === "search_term"}
            />
          </label>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_120px_120px_120px]">
          <label className="grid gap-1 text-xs text-muted">
            Hipótesis
            <textarea
              value={form.hypothesis ?? ""}
              onChange={(e) => setField("hypothesis", e.target.value)}
              placeholder="Qué esperamos que ocurra"
              rows={2}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Notas
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => setField("notes", e.target.value)}
              placeholder="Contexto, promo, stock, cambios externos"
              rows={2}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Baseline
            <input
              type="number"
              min={1}
              value={form.baselineWindowDays}
              onChange={(e) => setField("baselineWindowDays", Number(e.target.value))}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Post
            <input
              type="number"
              min={1}
              value={form.evaluationWindowDays}
              onChange={(e) =>
                setField("evaluationWindowDays", Number(e.target.value))
              }
            />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Estado
            <select
              value={form.status}
              onChange={(e) => setField("status", e.target.value as ActionStatus)}
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-faint">
            La evaluación compara 7 días antes contra 7 días después por defecto.
          </span>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar action"}
          </button>
        </div>
      </form>

      <DataTable
        columns={cols}
        rows={visible}
        rowKey={(r) => String(r.id)}
        searchable={(r) =>
          [
            entityName(r),
            ACTION_TYPE_LABELS[r.actionType],
            ENTITY_LABELS[r.entityType],
            r.marketplace,
            r.campaignName,
            r.adGroupName,
            r.keywordText,
            r.matchType,
            r.searchTerm,
            r.owner,
            r.hypothesis,
            r.notes,
            r.evaluation.reason,
          ]
            .filter(Boolean)
            .join(" ")
        }
        emptyMessage="Sin actions todavía. Registra una acción para empezar a medirla."
        maxRows={50}
      />

      {visible.length > 0 && (
        <div className="space-y-2">
          {visible.slice(0, 8).map((r) => (
            <Notice key={r.id} kind={r.evaluation.result === "negative" ? "error" : r.evaluation.result === "positive" ? "info" : "warn"}>
              <span className="font-semibold">#{r.id} {entityName(r)}:</span>{" "}
              {r.evaluation.reason} Baseline {r.evaluation.baselineFrom} →{" "}
              {r.evaluation.baselineTo}; post {r.evaluation.evaluationFrom} →{" "}
              {r.evaluation.evaluationTo}.
              {r.evaluation.warnings.length > 0
                ? ` ${r.evaluation.warnings.join(" ")}`
                : ""}
            </Notice>
          ))}
        </div>
      )}
    </div>
  );
}
