import type { CanonicalField, ReportType } from "./types";

/**
 * Diccionario de columnas por campo canónico.
 * Los reportes de Amazon Ads llegan con headers en el idioma de la consola
 * (EN/ES/DE/FR/IT). El matching se hace sobre headers normalizados:
 * minúsculas, sin acentos, sin paréntesis, espacios colapsados.
 */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // acentos
    .replace(/\(.*?\)/g, " ") // "(#)", "(nº)"…
    .replace(/[^a-z0-9%]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const DICT: Record<CanonicalField, string[]> = {
  date: ["date", "start date", "fecha", "datum", "data"],
  campaignId: ["campaign id", "campaignid", "id campana", "id de campana"],
  adGroupId: ["ad group id", "adgroup id", "adgroupid", "id grupo de anuncios"],
  keywordId: ["keyword id", "keywordid", "id palabra clave"],
  productTargetingId: [
    "product targeting id",
    "targeting id",
    "target id",
    "id segmentacion de producto",
  ],
  portfolioName: [
    "portfolio name",
    "portfolio",
    "nombre de la cartera",
    "cartera",
    "portfolioname",
    "nom du portefeuille",
    "nome del portfolio",
    "portfolios",
  ],
  campaignName: [
    "campaign name",
    "campaign",
    "campaigns",
    "campaign name informational only",
    "nombre de la campana",
    "campana",
    "kampagnenname",
    "kampagne",
    "nom de la campagne",
    "campagne",
    "nome campagna",
    "nome della campagna",
  ],
  campaignType: [
    "campaign type",
    "ad type",
    "type",
    "tipo de campana",
    "tipo de anuncio",
    "kampagnentyp",
    "type de campagne",
    "tipo di campagna",
  ],
  adGroupName: [
    "ad group name",
    "ad group",
    "adgroup",
    "ad group name informational only",
    "nombre del grupo de anuncios",
    "grupo de anuncios",
    "anzeigengruppenname",
    "anzeigengruppe",
    "nom du groupe d annonces",
    "groupe d annonces",
    "nome del gruppo di annunci",
    "gruppo di annunci",
  ],
  keywordText: [
    "keyword",
    "keyword text",
    "targeting",
    "palabra clave",
    "texto de palabra clave",
    "segmentacion",
    "ubereinstimmung", // guardas extra debajo
    "ausrichtung",
    "mot cle",
    "ciblage",
    "parola chiave",
    "targeting espressione",
  ],
  matchType: [
    "match type",
    "tipo de concordancia",
    "concordancia",
    "ubereinstimmungstyp",
    "type de correspondance",
    "tipo di corrispondenza",
  ],
  searchTerm: [
    "customer search term",
    "search term",
    "termino de busqueda del cliente",
    "termino de busqueda",
    "suchbegriff des kunden",
    "kundensuchbegriff",
    "suchbegriff",
    "terme de recherche du client",
    "terme de recherche",
    "termine di ricerca del cliente",
    "termini di ricerca dei clienti",
    "termine di ricerca",
  ],
  asin: [
    "advertised asin",
    "asin",
    "asin anunciado",
    "beworbene asin",
    "asin mis en avant",
    "asin sponsorise",
    "asin pubblicizzato",
  ],
  sku: [
    "advertised sku",
    "sku",
    "sku anunciado",
    "beworbene sku",
    "sku mis en avant",
    "sku pubblicizzato",
  ],
  productTitle: [
    "product title",
    "product name",
    "titulo del producto",
    "nombre del producto",
    "produkttitel",
    "produktname",
    "titre du produit",
    "titolo del prodotto",
  ],
  status: [
    "status",
    "state",
    "campaign status",
    "estado",
    "estado de la campana",
    "statut",
    "etat",
    "stato",
  ],
  bid: ["bid", "keyword bid", "puja", "gebot", "enchere", "offerta"],
  placement: ["placement", "ubicacion", "posicion", "platzierung", "emplacement"],
  placementPercentage: [
    "percentage",
    "placement percentage",
    "porcentaje",
  ],
  topSearchImpressionShare: [
    "top of search impression share",
    "top of search impression share is",
    "top of search is",
    "top search impression share",
    "top search is",
    "top of search share",
  ],
  topSearchBidAdjustment: [
    "top of search bid adjustment",
    "top search bid adjustment",
    "tos bid adjustment",
  ],
  currency: ["currency", "divisa", "moneda", "wahrung", "devise", "valuta"],
  impressions: [
    "impressions",
    "impresiones",
    "impressionen",
    "impressioni",
    "viewable impressions",
  ],
  clicks: ["clicks", "clics", "klicks", "clic"],
  spend: [
    "spend",
    "cost",
    "gasto",
    "inversion",
    "coste",
    "ausgaben",
    "kosten",
    "depenses",
    "cout",
    "spesa",
    "costo",
    "total cost",
    "total cost converted",
  ],
  sales: [
    "sales",
    "ventas",
    "umsatz",
    "umsatze",
    "ventes",
    "vendite",
    "14 day total sales",
    "7 day total sales",
    "total sales",
    "sales converted",
  ],
  orders: [
    "orders",
    "purchases",
    "pedidos",
    "bestellungen",
    "commandes",
    "ordini",
    "14 day total orders",
    "7 day total orders",
    "total orders",
  ],
  units: [
    "units",
    "unidades",
    "einheiten",
    "unites",
    "unita",
    "14 day total units",
    "7 day total units",
    "total units",
  ],
};

/** Regex de respaldo para columnas de métricas con ventana de atribución
 *  ("14 Day Total Sales", "Ventas totales de 14 días", "Gesamtumsatz in 14 Tagen"…) */
const METRIC_PATTERNS: [CanonicalField, RegExp][] = [
  ["sales", /(sales|ventas|umsatz|ventes|vendite)/],
  ["orders", /(orders|pedidos|bestellungen|commandes|ordini)/],
  ["units", /(units|unidades|einheiten|unites|unita)/],
];

export interface MappingResult {
  mapping: Map<string, CanonicalField>; // header original → campo
  unmapped: string[];
}

export function mapHeaders(
  headers: string[],
  rows?: Record<string, unknown>[]
): MappingResult {
  const mapping = new Map<string, CanonicalField>();
  const unmapped: string[] = [];

  // Índice normalizado → campo (primer variant gana; variants más específicos
  // van primero en el diccionario)
  const index = new Map<string, CanonicalField>();
  (Object.keys(DICT) as CanonicalField[]).forEach((field) => {
    for (const v of DICT[field]) {
      if (!index.has(v)) index.set(v, field);
    }
  });

  // 1ª pasada: header → campo candidato. Varios headers pueden competir por
  // el mismo campo: en bulksheets, "Campaign name" y "Campaign name
  // (Informational only)" normalizan ambos a "campaign name", pero según la
  // entidad de la fila solo uno de los dos trae datos.
  const byField = new Map<CanonicalField, string[]>();
  for (const header of headers) {
    const norm = normalizeHeader(header);
    let field = index.get(norm);
    if (!field) {
      // respaldo: métricas con ventana de atribución, evitando falsos
      // positivos tipo "same sku units" (solo si contiene un indicador
      // de total/ventana)
      if (/(14|7)\s?(day|dias|tagen|jours|giorni)|total|totales|gesamt|totali/.test(norm)) {
        if (!/(same|mismo|gleiche|meme|stesso|ntb|new to brand)/.test(norm)) {
          for (const [f, re] of METRIC_PATTERNS) {
            if (re.test(norm)) {
              field = f;
              break;
            }
          }
        }
      }
    }
    if (field) {
      const list = byField.get(field);
      if (list) list.push(header);
      else byField.set(field, [header]);
    } else {
      unmapped.push(header);
    }
  }

  // 2ª pasada: en caso de empate gana el header con más celdas rellenas en
  // las filas dadas; sin filas, el primero (variants específicos primero).
  const sample = rows && rows.length > 0 ? rows.slice(0, 500) : null;
  byField.forEach((candidates, field) => {
    let winner = candidates[0];
    if (candidates.length > 1 && sample) {
      let best = -1;
      for (const h of candidates) {
        let filled = 0;
        for (const r of sample) {
          const v = r[h];
          if (v !== null && v !== undefined && v !== "") filled++;
        }
        if (filled > best) {
          best = filled;
          winner = h;
        }
      }
    }
    mapping.set(winner, field);
    for (const h of candidates) if (h !== winner) unmapped.push(h);
  });

  return { mapping, unmapped };
}

// ── Detección de tipo de reporte por campos presentes ────────────────────
export function detectReportType(
  fields: Set<CanonicalField>
): ReportType | null {
  if (fields.has("topSearchImpressionShare")) return "top_search";
  if (fields.has("placement")) return "placements";
  if (fields.has("searchTerm")) return "search_terms";
  if (fields.has("asin") || fields.has("sku")) return "products";
  if (fields.has("keywordText") || fields.has("matchType")) return "keywords";
  if (fields.has("campaignName")) return "campaigns";
  if (fields.has("portfolioName")) return "portfolios";
  return null;
}

/** Campos sin los cuales una importación no tiene sentido */
export const REQUIRED_FIELDS: Record<ReportType, CanonicalField[]> = {
  campaigns: ["campaignName"],
  keywords: ["campaignName", "keywordText"],
  search_terms: ["campaignName", "searchTerm", "spend"],
  products: ["campaignName"],
  portfolios: ["portfolioName"],
  placements: ["campaignId", "placement"],
  top_search: ["campaignName", "topSearchImpressionShare"],
};

/** Métricas cuya ausencia no bloquea, pero anula KPIs (aviso visible) */
export const OPTIONAL_METRIC_FIELDS: CanonicalField[] = [
  "impressions",
  "clicks",
  "spend",
  "sales",
  "orders",
  "units",
];
