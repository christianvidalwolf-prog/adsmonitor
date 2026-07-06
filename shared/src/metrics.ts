import type {
  BaseMetrics,
  CampaignClass,
  DerivedMetrics,
  KeywordFlag,
  Marketplace,
  Settings,
} from "./types";

// ── Fórmulas KPI — única fuente de verdad ────────────────────────────────
// Regla: denominador 0 → null (nunca 0). Un ACOS de 0% con gasto y sin
// ventas ordenaría esa fila como la mejor de la tabla: dato inventado.
export function derive(m: BaseMetrics): DerivedMetrics {
  return {
    ctr: m.impressions > 0 ? m.clicks / m.impressions : null,
    cpc: m.clicks > 0 ? m.spend / m.clicks : null,
    cvr: m.clicks > 0 ? m.orders / m.clicks : null,
    acos: m.sales > 0 ? m.spend / m.sales : null,
    roas: m.spend > 0 ? m.sales / m.spend : null,
  };
}

export function emptyMetrics(): BaseMetrics {
  return { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, units: 0 };
}

export function addMetrics(a: BaseMetrics, b: Partial<BaseMetrics>): void {
  a.impressions += b.impressions ?? 0;
  a.clicks += b.clicks ?? 0;
  a.spend += b.spend ?? 0;
  a.sales += b.sales ?? 0;
  a.orders += b.orders ?? 0;
  a.units += b.units ?? 0;
}

// ── Parsing numérico ─────────────────────────────────────────────────────
// Soporta formato europeo (1.234,56), anglosajón (1,234.56), símbolos de
// moneda y porcentajes. Devuelve null si no es interpretable: nunca 0.
export function parseNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (!s) return null;
  const isPct = s.includes("%");
  s = s.replace(/[<>]/g, "");
  s = s.replace(/[€£$%\s\u00a0]/g, "");
  if (!s || s === "-" || s === "--") return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()\-+]/g, "");

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // el separador que aparece más a la derecha es el decimal
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    const decimals = s.length - lastComma - 1;
    // "1,234" con grupos de 3 → separador de miles; "12,5" → decimal
    if (decimals === 3 && s.length > 4 && !s.slice(0, lastComma).includes(","))
      s = s.replace(/,/g, "");
    else s = s.replace(/,/g, ".");
  } else if (lastDot > -1) {
    const decimals = s.length - lastDot - 1;
    if (decimals === 3 && (s.match(/\./g) || []).length > 1)
      s = s.replace(/\./g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const value = negative ? -n : n;
  return isPct ? value / 100 : value;
}

// ── Parsing de fechas → ISO yyyy-mm-dd ───────────────────────────────────
export function parseDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) return toISO(raw);
  if (typeof raw === "number") {
    // serial de Excel (días desde 1899-12-30)
    if (raw > 20000 && raw < 80000) {
      const d = new Date(Math.round((raw - 25569) * 86400 * 1000));
      return toISO(d);
    }
    return null;
  }
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // ISO
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/); // dd/mm/yyyy europeo
  if (m) {
    const [, d, mo, y] = m;
    const day = Number(d);
    const month = Number(mo);
    if (month > 12 && day <= 12)
      return `${y}-${pad(day)}-${pad(month)}`; // era mm/dd/yyyy
    return `${y}-${pad(month)}-${pad(day)}`;
  }
  const mon: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    ene: 1, abr: 4, ago: 8, dic: 12,
  };
  m = s.toLowerCase().match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})/); // "12 Jun 2026"
  if (m && mon[m[2]]) return `${m[3]}-${pad(mon[m[2]])}-${pad(Number(m[1]))}`;
  m = s.toLowerCase().match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/); // "Jun 12, 2026"
  if (m && mon[m[1]]) return `${m[3]}-${pad(mon[m[1]])}-${pad(Number(m[2]))}`;
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toISO = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

// ── Normalización de texto para matching keyword ↔ search term ──────────
export function normalizeTerm(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// ── Reglas de clasificación (funciones puras, testeables) ────────────────
export function targetAcosFor(
  settings: Settings,
  marketplace: Marketplace
): number {
  return (
    settings.targetAcosByMarketplace[marketplace] ?? settings.targetAcosGlobal
  );
}

export function classifyCampaign(
  m: BaseMetrics,
  marketplace: Marketplace,
  settings: Settings
): CampaignClass {
  const target = targetAcosFor(settings, marketplace);
  const acos = m.sales > 0 ? m.spend / m.sales : null;

  if (m.spend >= settings.minSpendPause && m.sales === 0)
    return "pause_candidate";
  if (acos !== null && acos > target * 1.5 && m.spend >= settings.minSpendPause)
    return "reduce";
  if (m.clicks < settings.minClicksData) return "monitor";
  if (acos !== null && acos <= target && m.orders >= settings.minOrdersWinner)
    return "winner";
  if (acos !== null && acos <= target && m.orders > 0) return "scale";
  if (acos !== null && acos > target) return "reduce";
  return "monitor";
}

export function flagKeyword(
  m: BaseMetrics,
  marketplace: Marketplace,
  settings: Settings
): KeywordFlag[] {
  const target = targetAcosFor(settings, marketplace);
  const d = derive(m);
  const flags: KeywordFlag[] = [];
  if (m.spend >= settings.minSpendPause && m.sales === 0)
    flags.push("spend_no_sales");
  if (d.acos !== null && d.acos > target) flags.push("high_acos");
  if (d.acos !== null && d.acos <= target && m.orders > 0)
    flags.push("scale_candidate");
  if (
    d.ctr !== null &&
    d.ctr >= 0.004 &&
    m.clicks >= settings.minClicksData &&
    m.orders === 0
  )
    flags.push("good_ctr_bad_cvr");
  if (m.impressions > 0 && m.impressions < 100) flags.push("low_visibility");
  return flags;
}
