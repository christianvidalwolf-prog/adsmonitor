import { useEffect, useState } from "react";
import type { Marketplace, Settings } from "@shared";
import { DEFAULT_SETTINGS, MARKETPLACES } from "@shared";
import { api } from "../api";
import { Notice } from "../components/ui";

export default function SettingsPage() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then(setS).catch((e) => setError(e.message));
  }, []);

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      const next = await api.saveSettings(s);
      setS(next);
      setSaved(true);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const pct = (v: number) => Math.round(v * 100);

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-lg font-bold">Settings</h1>
      <p className="text-sm text-muted">
        Estos umbrales alimentan la clasificación de campañas y los flags de
        keywords en toda la app. En la fase 3 alimentarán también el Action
        Plan.
      </p>

      <section className="space-y-3 rounded-xl border border-line bg-panel p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
          Target ACOS
        </h2>
        <label className="block text-sm">
          Global (%)
          <input
            type="number"
            min={1}
            max={199}
            className="mt-1 block w-32"
            value={pct(s.targetAcosGlobal)}
            onChange={(e) =>
              setS({ ...s, targetAcosGlobal: Number(e.target.value) / 100 })
            }
          />
        </label>
        <div className="grid grid-cols-5 gap-2">
          {MARKETPLACES.map((m) => (
            <label key={m} className="text-xs text-muted">
              {m} (%)
              <input
                type="number"
                min={0}
                max={199}
                placeholder="global"
                className="mt-1 w-full"
                value={
                  s.targetAcosByMarketplace[m] !== undefined
                    ? pct(s.targetAcosByMarketplace[m] as number)
                    : ""
                }
                onChange={(e) => {
                  const map = { ...s.targetAcosByMarketplace };
                  if (e.target.value === "") delete map[m as Marketplace];
                  else map[m as Marketplace] = Number(e.target.value) / 100;
                  setS({ ...s, targetAcosByMarketplace: map });
                }}
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-faint">
          Vacío = usa el global. (Target por portfolio: fase 3.)
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-panel p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
          Umbrales de clasificación
        </h2>
        <label className="block text-sm">
          Gasto mínimo antes de sugerir pausa (moneda del marketplace)
          <input
            type="number"
            min={0}
            className="mt-1 block w-32"
            value={s.minSpendPause}
            onChange={(e) => setS({ ...s, minSpendPause: Number(e.target.value) })}
          />
        </label>
        <label className="block text-sm">
          Pedidos mínimos para clasificar Winner
          <input
            type="number"
            min={0}
            className="mt-1 block w-32"
            value={s.minOrdersWinner}
            onChange={(e) => setS({ ...s, minOrdersWinner: Number(e.target.value) })}
          />
        </label>
        <label className="block text-sm">
          Clics mínimos para considerar datos suficientes (si no, Monitor)
          <input
            type="number"
            min={0}
            className="mt-1 block w-32"
            value={s.minClicksData}
            onChange={(e) => setS({ ...s, minClicksData: Number(e.target.value) })}
          />
        </label>
      </section>

      {error && <Notice kind="error">{error}</Notice>}
      {saved && <Notice kind="info">Guardado.</Notice>}
      <button
        onClick={save}
        className="rounded-md border border-accent/60 bg-accent/15 px-4 py-2 text-sm font-semibold text-accent"
      >
        Guardar
      </button>
    </div>
  );
}
