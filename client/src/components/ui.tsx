import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  MARKETPLACES,
  type CampaignClass,
  type KeywordFlag,
  type Marketplace,
} from "@shared";

// ── Badges ───────────────────────────────────────────────────────────────
const CLASS_STYLES: Record<CampaignClass, string> = {
  winner: "bg-good/15 text-good border-good/30",
  scale: "bg-info/15 text-info border-info/30",
  monitor: "bg-panel-2 text-muted border-line",
  reduce: "bg-warn/15 text-warn border-warn/30",
  pause_candidate: "bg-bad/15 text-bad border-bad/30",
};
const CLASS_LABELS: Record<CampaignClass, string> = {
  winner: "Winner",
  scale: "Scale",
  monitor: "Monitor",
  reduce: "Reduce",
  pause_candidate: "Pause",
};
export const CLASS_STRIPE: Record<CampaignClass, string> = {
  winner: "var(--color-good)",
  scale: "var(--color-info)",
  monitor: "var(--color-line)",
  reduce: "var(--color-warn)",
  pause_candidate: "var(--color-bad)",
};

export function ClassBadge({ value }: { value: CampaignClass }) {
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-semibold ${CLASS_STYLES[value]}`}
    >
      {CLASS_LABELS[value]}
    </span>
  );
}

const FLAG_LABELS: Record<KeywordFlag, [string, string]> = {
  top_sales: ["Top ventas", "bg-good/15 text-good border-good/30"],
  spend_no_sales: ["Gasto sin ventas", "bg-bad/15 text-bad border-bad/30"],
  high_acos: ["ACOS alto", "bg-warn/15 text-warn border-warn/30"],
  scale_candidate: ["Escalar", "bg-good/15 text-good border-good/30"],
  good_ctr_bad_cvr: ["CTR ok · CVR mala", "bg-info/15 text-info border-info/30"],
  low_visibility: ["Poca visibilidad", "bg-panel-2 text-muted border-line"],
};

export function FlagBadges({ flags }: { flags: KeywordFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <span
          key={f}
          className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${FLAG_LABELS[f][1]}`}
        >
          {FLAG_LABELS[f][0]}
        </span>
      ))}
    </span>
  );
}

// ── KPI card ─────────────────────────────────────────────────────────────
export function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "text-good"
      : tone === "warn"
        ? "text-warn"
        : tone === "bad"
          ? "text-bad"
          : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className={`mt-1 font-mono text-xl tabular-nums ${toneCls}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-faint">{sub}</div>}
    </div>
  );
}

// ── Aviso (nunca silencioso) ─────────────────────────────────────────────
export function Notice({
  kind = "warn",
  children,
}: {
  kind?: "warn" | "error" | "info";
  children: ReactNode;
}) {
  const cls =
    kind === "error"
      ? "border-bad/40 bg-bad/10 text-bad"
      : kind === "info"
        ? "border-info/40 bg-info/10 text-info"
        : "border-warn/40 bg-warn/10 text-warn";
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${cls}`}>{children}</div>
  );
}

// ── Filtro de marketplaces ───────────────────────────────────────────────
export function MarketplaceFilter({
  selected,
  onChange,
}: {
  selected: Marketplace[];
  onChange: (m: Marketplace[]) => void;
}) {
  const toggle = (m: Marketplace) =>
    onChange(
      selected.includes(m) ? selected.filter((x) => x !== m) : [...selected, m]
    );
  return (
    <div className="flex items-center gap-1">
      {MARKETPLACES.map((m) => {
        const active = selected.length === 0 || selected.includes(m);
        return (
          <button
            key={m}
            onClick={() => toggle(m)}
            className={`rounded-md border px-2.5 py-1 font-mono text-xs font-semibold transition-colors ${
              selected.includes(m)
                ? "border-accent/60 bg-accent/15 text-accent"
                : active && selected.length === 0
                  ? "border-line bg-panel text-muted hover:text-ink"
                  : "border-line bg-panel text-faint hover:text-ink"
            }`}
            title={selected.includes(m) ? `Quitar ${m}` : `Filtrar por ${m}`}
          >
            {m}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="ml-1 text-xs text-faint hover:text-ink"
        >
          todos
        </button>
      )}
    </div>
  );
}

// ── DataTable genérica: sort + filtro texto ──────────────────────────────
export interface Column<T> {
  key: string;
  label: string;
  num?: boolean;
  sortValue?: (row: T) => number | string | null;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  searchable,
  stripe,
  emptyMessage = "Sin datos. Importa un reporte en la pestaña Imports.",
  maxRows = 500,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  searchable?: (row: T) => string;
  stripe?: (row: T) => string;
  emptyMessage?: string;
  maxRows?: number;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const visible = useMemo(() => {
    let out = rows;
    if (query && searchable) {
      const q = query.toLowerCase();
      out = out.filter((r) => searchable(r).toLowerCase().includes(q));
    }
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col?.sortValue) {
        out = [...out].sort((a, b) => {
          const va = col.sortValue!(a);
          const vb = col.sortValue!(b);
          if (va === null && vb === null) return 0;
          if (va === null) return 1; // nulls al final siempre
          if (vb === null) return -1;
          if (typeof va === "number" && typeof vb === "number")
            return (va - vb) * sortDir;
          return String(va).localeCompare(String(vb)) * sortDir;
        });
      }
    }
    return out;
  }, [rows, query, sortKey, sortDir, columns, searchable]);

  const totalPages = Math.max(1, Math.ceil(visible.length / maxRows));
  const currentPage = Math.min(page, totalPages - 1);
  const pageStart = currentPage * maxRows;
  const pageRows = visible.slice(pageStart, pageStart + maxRows);
  const pageEnd = pageStart + pageRows.length;
  const hasPagination = visible.length > maxRows;

  useEffect(() => {
    setPage(0);
  }, [query, sortKey, sortDir, rows]);

  const onSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(-1);
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {searchable && (
        <div className="flex items-center justify-between gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar…"
            className="w-64"
          />
          <span className="font-mono text-xs text-faint">
            {visible.length} filas
            {hasPagination ? ` · ${pageStart + 1}-${pageEnd}` : ""}
          </span>
        </div>
      )}
      <div className="overflow-auto rounded-lg border border-line bg-panel">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`${c.num ? "num" : ""} ${c.sortValue ? "cursor-pointer hover:text-ink" : ""}`}
                  onClick={c.sortValue ? () => onSort(c.key) : undefined}
                >
                  {c.label}
                  {sortKey === c.key && (
                    <span className="ml-1 text-accent">
                      {sortDir === -1 ? "↓" : "↑"}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="py-8 text-center text-muted">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {pageRows.map((row) => (
              <tr
                key={rowKey(row)}
                style={
                  stripe
                    ? { boxShadow: `inset 3px 0 0 0 ${stripe(row)}` }
                    : undefined
                }
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.num ? "num" : ""}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasPagination && (
        <div className="flex items-center justify-end gap-2">
          <span className="font-mono text-xs text-faint">
            Página {currentPage + 1} de {totalPages}
          </span>
          <button
            onClick={() => setPage(0)}
            disabled={currentPage === 0}
            className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            primera
          </button>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            anterior
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage >= totalPages - 1}
            className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            siguiente
          </button>
          <button
            onClick={() => setPage(totalPages - 1)}
            disabled={currentPage >= totalPages - 1}
            className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            última
          </button>
        </div>
      )}
    </div>
  );
}
