import { createContext, useContext, useState } from "react";
import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import type { Marketplace } from "@shared";
import { MarketplaceFilter } from "./components/ui";
import Dashboard from "./pages/Dashboard";
import Campaigns from "./pages/Campaigns";
import Keywords from "./pages/Keywords";
import SearchTerms from "./pages/SearchTerms";
import Actions from "./pages/Actions";
import Imports from "./pages/Imports";
import SettingsPage from "./pages/Settings";

// ── Filtro de marketplaces global ────────────────────────────────────────
const MktContext = createContext<{
  marketplaces: Marketplace[];
  setMarketplaces: (m: Marketplace[]) => void;
}>({ marketplaces: [], setMarketplaces: () => {} });
export const useMarketplaces = () => useContext(MktContext);

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/campaigns", label: "Campaigns" },
  { to: "/keywords", label: "Keywords" },
  { to: "/search-terms", label: "Search Terms" },
  { to: "/actions", label: "Actions" },
  { to: "/imports", label: "Imports" },
  { to: "/settings", label: "Settings" },
];

const PHASE3 = ["Kw vs Search Term", "Products"];

export default function App() {
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  return (
    <MktContext.Provider value={{ marketplaces, setMarketplaces }}>
      <HashRouter>
        <div className="flex h-screen">
          <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-panel">
            <div className="border-b border-line px-4 py-4">
              <div className="font-sans text-lg font-bold tracking-tight">
                Ads<span className="text-accent">Monitor</span>
              </div>
              <div className="text-[11px] text-faint">
                CRAZE · Amazon Ads EU
              </div>
            </div>
            <nav className="flex-1 space-y-0.5 p-2">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.to === "/"}
                  className={({ isActive }) =>
                    `block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-accent/15 text-accent"
                        : "text-muted hover:bg-panel-2 hover:text-ink"
                    }`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
              <div className="pt-3">
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
                  Fase 3
                </div>
                {PHASE3.map((label) => (
                  <div
                    key={label}
                    className="cursor-not-allowed px-3 py-2 text-sm text-faint"
                    title="Se añade en la fase 3 (recomendaciones y exportaciones)"
                  >
                    {label}
                  </div>
                ))}
              </div>
            </nav>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center justify-between border-b border-line bg-panel/60 px-5 py-2.5 backdrop-blur">
              <span className="text-xs text-muted">
                Filtro de países (aplica a todas las pantallas)
              </span>
              <MarketplaceFilter
                selected={marketplaces}
                onChange={setMarketplaces}
              />
            </header>
            <main className="min-h-0 flex-1 overflow-auto p-5">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/campaigns" element={<Campaigns />} />
                <Route path="/keywords" element={<Keywords />} />
                <Route path="/search-terms" element={<SearchTerms />} />
                <Route path="/actions" element={<Actions />} />
                <Route path="/imports" element={<Imports />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </main>
          </div>
        </div>
      </HashRouter>
    </MktContext.Provider>
  );
}
