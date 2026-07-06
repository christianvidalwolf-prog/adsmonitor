import { useCallback, useEffect, useState } from "react";
import type {
  ImportMeta,
  ImportPreview,
  Marketplace,
  Source,
} from "@shared";
import { MARKETPLACES, REPORT_TYPE_LABELS } from "@shared";
import { api, ApiError } from "../api";
import { Notice } from "../components/ui";

function reportTypeLabel(type: ImportMeta["reportType"] | ImportPreview["detectedReportType"]) {
  if (!type) return "?";
  return REPORT_TYPE_LABELS[type] ?? type;
}

function missingFields(importMeta: ImportMeta) {
  return Array.isArray(importMeta.missingFields) ? importMeta.missingFields : [];
}

export default function Imports() {
  const [imports, setImports] = useState<ImportMeta[]>([]);
  const [previews, setPreviews] = useState<ImportPreview[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [importedKeys, setImportedKeys] = useState<Set<string>>(new Set());
  const [marketplace, setMarketplace] = useState<Marketplace>("ES");
  const [source, setSource] = useState<Source>("seller");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .listImports()
      .then((rows) => setImports(Array.isArray(rows) ? rows : []))
      .catch((e) =>
        setError(e.message ?? "No se pudo cargar el histórico de importaciones.")
      );
  }, []);
  useEffect(refresh, [refresh]);

  const preview =
    previews.find((p) => p.candidateKey === selectedKey) ?? previews[0] ?? null;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setOk(null);
    setConflict(null);
    setPreviews([]);
    setImportedKeys(new Set());
    setBusy(true);
    try {
      const list = await api.previewImport(file);
      setPreviews(list);
      setSelectedKey(list[0]?.candidateKey ?? null);
      const first = list[0];
      if (first?.detectedDateFrom) setDateFrom(first.detectedDateFrom);
      if (first?.detectedDateTo) setDateTo(first.detectedDateTo);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const selectCandidate = (p: ImportPreview) => {
    setSelectedKey(p.candidateKey);
    setConflict(null);
    // solo rellenar fechas si el candidato las trae y el usuario no ha puesto nada
    if (p.detectedDateFrom && !dateFrom) setDateFrom(p.detectedDateFrom);
    if (p.detectedDateTo && !dateTo) setDateTo(p.detectedDateTo);
  };

  const commit = async (force = false) => {
    if (!preview) return;
    setError(null);
    setConflict(null);
    setBusy(true);
    try {
      const r = await api.commitImport({
        uploadId: preview.uploadId,
        candidateKey: preview.candidateKey,
        marketplace,
        source,
        dateFrom,
        dateTo,
        force,
      });
      const rest = previews.filter(
        (p) =>
          p.candidateKey !== preview.candidateKey &&
          !importedKeys.has(p.candidateKey)
      );
      setOk(
        `Importadas ${r.rowCount} filas (#${r.importId}).` +
          (rest.length > 0
            ? ` El fichero tiene ${rest.length} hoja(s) más sin importar.`
            : "")
      );
      setImportedKeys((s) => new Set(s).add(preview.candidateKey));
      if (rest.length > 0) {
        setSelectedKey(rest[0].candidateKey);
      } else {
        setPreviews([]);
        setDateFrom("");
        setDateTo("");
      }
      refresh();
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409 && e.body?.canForce) {
        setConflict(e.message);
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl space-y-5">
      <h1 className="text-lg font-bold">Imports</h1>

      <label className="block cursor-pointer rounded-xl border-2 border-dashed border-line bg-panel px-6 py-10 text-center transition-colors hover:border-accent/50">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <div className="text-sm text-muted">
          Arrastra o haz clic para subir un reporte de Amazon Ads
        </div>
        <div className="mt-1 text-xs text-faint">
          Excel o CSV · Campaigns, Keywords, Search Terms, Advertised Products ·
          headers en ES/EN/DE/FR/IT
        </div>
      </label>

      {busy && <div className="text-sm text-muted">Procesando…</div>}
      {error && <Notice kind="error">{error}</Notice>}
      {ok && <Notice kind="info">{ok}</Notice>}

      {preview && (
        <section className="space-y-3 rounded-xl border border-line bg-panel p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-bold">
              {preview.filename} ·{" "}
              <span className="text-accent">
                {reportTypeLabel(preview.detectedReportType)}
              </span>{" "}
              · {preview.rowCount} filas
            </h2>
          </div>

          {previews.length > 1 && (
            <div className="space-y-1">
              <div className="text-xs text-muted">
                El fichero contiene varios conjuntos importables. Cada uno se
                importa por separado:
              </div>
              <div className="flex flex-wrap gap-2">
                {previews.map((p) => {
                  const active = p.candidateKey === preview.candidateKey;
                  const done = importedKeys.has(p.candidateKey);
                  return (
                    <button
                      key={p.candidateKey}
                      onClick={() => selectCandidate(p)}
                      className={`rounded-md border px-2.5 py-1.5 text-xs ${
                        active
                          ? "border-accent/60 bg-accent/15 font-semibold text-accent"
                          : "border-line text-muted hover:border-accent/40"
                      }`}
                    >
                      {p.sheetLabel} ·{" "}
                      {reportTypeLabel(p.detectedReportType)}{" "}
                      · {p.rowCount} filas{done ? " ✓" : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {preview.warnings.map((w) => (
            <Notice key={w}>{w}</Notice>
          ))}
          {preview.unmappedColumns.length > 0 && (
            <div className="text-xs text-faint">
              Columnas ignoradas: {preview.unmappedColumns.join(" · ")}
            </div>
          )}
          <div className="text-xs text-muted">
            Columnas reconocidas:{" "}
            {preview.mappedColumns.map((c) => (
              <span key={c.header} className="mr-2 inline-block">
                <span className="text-faint">{c.header}</span> →{" "}
                <span className="font-mono text-good">{c.field}</span>
              </span>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs text-muted">
              Marketplace
              <select
                className="mt-1 w-full"
                value={marketplace}
                onChange={(e) => setMarketplace(e.target.value as Marketplace)}
              >
                {MARKETPLACES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              Source
              <select
                className="mt-1 w-full"
                value={source}
                onChange={(e) => setSource(e.target.value as Source)}
              >
                <option value="seller">Seller Central</option>
                <option value="vendor">Vendor Central</option>
              </select>
            </label>
            <label className="text-xs text-muted">
              Periodo desde
              <input
                type="date"
                className="mt-1 w-full"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label className="text-xs text-muted">
              Periodo hasta
              <input
                type="date"
                className="mt-1 w-full"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
          </div>
          {!preview.hasDateColumn && (
            <Notice kind="info">
              El fichero no incluye columna de fecha: indica manualmente el
              periodo exacto del reporte. Es la base de la validación de solapes.
            </Notice>
          )}

          {conflict ? (
            <div className="space-y-2">
              <Notice kind="error">{conflict}</Notice>
              <div className="flex gap-2">
                <button
                  onClick={() => commit(true)}
                  className="rounded-md border border-bad/50 bg-bad/15 px-3 py-1.5 text-sm font-semibold text-bad"
                >
                  Importar igualmente (duplicará métricas)
                </button>
                <button
                  onClick={() => setConflict(null)}
                  className="rounded-md border border-line px-3 py-1.5 text-sm text-muted"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => commit(false)}
              disabled={
                busy ||
                !dateFrom ||
                !dateTo ||
                importedKeys.has(preview.candidateKey)
              }
              className="rounded-md border border-accent/60 bg-accent/15 px-4 py-2 text-sm font-semibold text-accent disabled:opacity-40"
            >
              {importedKeys.has(preview.candidateKey)
                ? "Ya importado ✓"
                : "Confirmar importación"}
            </button>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
          Histórico de importaciones
        </h2>
        <div className="overflow-auto rounded-lg border border-line bg-panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Fichero</th>
                <th>Tipo</th>
                <th>País</th>
                <th>Source</th>
                <th>Periodo</th>
                <th className="num">Filas</th>
                <th>Subido</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {imports.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-muted">
                    Todavía no hay importaciones.
                  </td>
                </tr>
              )}
              {imports.map((i) => (
                <tr key={i.id}>
                  <td className="font-mono text-faint">{i.id}</td>
                  <td>
                    <span className="inline-block max-w-64 truncate align-bottom" title={i.filename}>
                      {i.filename}
                    </span>
                    {missingFields(i).length > 0 && (
                      <span className="ml-2 text-[10px] text-warn" title={`Sin columnas: ${missingFields(i).join(", ")}`}>
                        ⚠ métricas incompletas
                      </span>
                    )}
                  </td>
                  <td>{reportTypeLabel(i.reportType)}</td>
                  <td className="font-mono">{i.marketplace}</td>
                  <td className="text-muted">{i.source}</td>
                  <td className="font-mono text-xs">
                    {i.dateFrom} → {i.dateTo}
                  </td>
                  <td className="num">{i.rowCount}</td>
                  <td className="text-xs text-faint">{i.uploadedAt}</td>
                  <td>
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `¿Borrar la importación #${i.id} (${i.filename}) y todas sus filas?`
                          )
                        )
                          api.deleteImport(i.id).then(refresh);
                      }}
                      className="text-xs text-bad hover:underline"
                    >
                      borrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
