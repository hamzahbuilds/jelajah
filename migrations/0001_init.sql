-- Jelajah D1 schema v1
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  is_infant INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,     -- base64 PBKDF2-SHA256
  salt TEXT NOT NULL,              -- base64
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','ms')),
  participant_id INTEGER REFERENCES participants(id),
  disabled INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  destination TEXT,
  start_date TEXT,                 -- YYYY-MM-DD
  end_date TEXT,
  base_currency TEXT NOT NULL DEFAULT 'MYR',
  emoji TEXT DEFAULT '🧳',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trip_members (
  trip_id INTEGER NOT NULL REFERENCES trips(id),
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  PRIMARY KEY (trip_id, participant_id)
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id),
  filename TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  vendor TEXT,                     -- Trip.com / Airbnb / ...
  doc_type TEXT,                   -- receipt / itinerary / confirmation / other
  booking_no TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
  parsed_json TEXT,                -- raw parser output for audit/re-review
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id),
  document_id INTEGER REFERENCES documents(id),
  category TEXT NOT NULL CHECK (category IN ('accommodation','flight','transport','entrance','pass','food','shopping','other')),
  description TEXT NOT NULL,
  vendor TEXT,
  location TEXT,
  expense_date TEXT,               -- date of the thing (e.g. flight date / check-in)
  end_date TEXT,                   -- e.g. checkout
  payment_date TEXT,               -- date money moved (drives FX rate)
  amount_original REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'MYR',
  fx_rate REAL NOT NULL DEFAULT 1, -- original -> MYR
  amount_myr REAL NOT NULL,
  payer_participant_id INTEGER REFERENCES participants(id),
  meta_json TEXT,                  -- extra parsed details (times, flight no, address...)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expense_shares (
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  amount_myr REAL NOT NULL,
  PRIMARY KEY (expense_id, participant_id)
);

CREATE TABLE IF NOT EXISTS due_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL,
  amount_myr REAL,
  note TEXT,
  settled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id),
  from_participant_id INTEGER NOT NULL REFERENCES participants(id),
  to_participant_id INTEGER NOT NULL REFERENCES participants(id),
  amount_myr REAL NOT NULL,
  pay_date TEXT NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fx_rates (
  rate_date TEXT NOT NULL,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  rate REAL NOT NULL,
  PRIMARY KEY (rate_date, base, quote)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_documents_trip ON documents(trip_id);
CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses(trip_id);
CREATE INDEX IF NOT EXISTS idx_payments_trip ON payments(trip_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_checklist ON checklist_items(trip_id, user_id);
