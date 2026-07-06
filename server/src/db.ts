import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, type Settings } from "../../shared/src";

const DATA_DIR = path.resolve(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "app.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  report_type TEXT NOT NULL,
  marketplace TEXT NOT NULL,
  source TEXT NOT NULL,
  currency TEXT NOT NULL,
  date_from TEXT,
  date_to TEXT,
  row_count INTEGER NOT NULL,
  has_date_column INTEGER NOT NULL DEFAULT 0,
  missing_fields TEXT NOT NULL DEFAULT '[]',
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL,
  marketplace TEXT NOT NULL,
  source TEXT NOT NULL,
  currency TEXT NOT NULL,
  date TEXT,
  campaign_id TEXT,
  ad_group_id TEXT,
  keyword_id TEXT,
  product_targeting_id TEXT,
  portfolio_name TEXT,
  campaign_name TEXT,
  campaign_type TEXT,
  ad_group_name TEXT,
  keyword_text TEXT,
  keyword_norm TEXT,
  match_type TEXT,
  search_term TEXT,
  search_term_norm TEXT,
  asin TEXT,
  sku TEXT,
  product_title TEXT,
  status TEXT,
  bid REAL,
  placement TEXT,
  placement_percentage REAL,
  top_search_impression_share REAL,
  top_search_bid_adjustment REAL,
  impressions REAL NOT NULL DEFAULT 0,
  clicks REAL NOT NULL DEFAULT 0,
  spend REAL NOT NULL DEFAULT 0,
  sales REAL NOT NULL DEFAULT 0,
  orders REAL NOT NULL DEFAULT 0,
  units REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_facts_type_mkt ON facts(report_type, marketplace);
CREATE INDEX IF NOT EXISTS idx_facts_import ON facts(import_id);
CREATE INDEX IF NOT EXISTS idx_facts_campaign ON facts(campaign_name);
CREATE INDEX IF NOT EXISTS idx_facts_kw_norm ON facts(keyword_norm);
CREATE INDEX IF NOT EXISTS idx_facts_st_norm ON facts(search_term_norm);

CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'manual',
  entity_type TEXT NOT NULL,
  marketplace TEXT NOT NULL,
  campaign_name TEXT,
  ad_group_name TEXT,
  keyword_text TEXT,
  keyword_norm TEXT,
  match_type TEXT,
  search_term TEXT,
  search_term_norm TEXT,
  action_type TEXT NOT NULL,
  owner TEXT NOT NULL,
  hypothesis TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  implemented_at TEXT NOT NULL,
  baseline_window_days INTEGER NOT NULL DEFAULT 7,
  evaluation_window_days INTEGER NOT NULL DEFAULT 7,
  status TEXT NOT NULL DEFAULT 'implemented',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_actions_mkt_date ON actions(marketplace, implemented_at);
CREATE INDEX IF NOT EXISTS idx_actions_entity ON actions(entity_type, marketplace, campaign_name);
CREATE INDEX IF NOT EXISTS idx_actions_kw_norm ON actions(keyword_norm);
CREATE INDEX IF NOT EXISTS idx_actions_st_norm ON actions(search_term_norm);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

function ensureFactsColumn(name: string, definition: string): void {
  const cols = db.prepare("PRAGMA table_info(facts)").all() as { name: string }[];
  if (!cols.some((c) => c.name === name)) {
    db.exec(`ALTER TABLE facts ADD COLUMN ${name} ${definition}`);
  }
}

ensureFactsColumn("campaign_id", "TEXT");
ensureFactsColumn("ad_group_id", "TEXT");
ensureFactsColumn("keyword_id", "TEXT");
ensureFactsColumn("product_targeting_id", "TEXT");
ensureFactsColumn("placement", "TEXT");
ensureFactsColumn("placement_percentage", "REAL");
ensureFactsColumn("top_search_impression_share", "REAL");
ensureFactsColumn("top_search_bid_adjustment", "REAL");

db.exec("CREATE INDEX IF NOT EXISTS idx_facts_campaign_id ON facts(campaign_id)");

/** Transacción manual (node:sqlite no trae helper como better-sqlite3) */
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// ── Settings ─────────────────────────────────────────────────────────────
export function getSettings(): Settings {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'app'")
    .get() as { value: string } | undefined;
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify(s));
}
