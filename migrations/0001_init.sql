-- Jelajah D1 schema — regenerated from server/lib/schema.ts SCHEMA (v0.25).
-- Runtime UPGRADES in schema.ts self-heal older DBs; this file is the fresh-install CLI path.
-- Regenerate rather than hand-edit: keep in sync with server/lib/schema.ts.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_infant INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_by INTEGER REFERENCES users(id)
  );

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
    lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','ms')),
    theme TEXT NOT NULL DEFAULT '' CHECK (theme IN ('','dark','system')),
    participant_id INTEGER REFERENCES participants(id),
    referred_by INTEGER REFERENCES users(id),
    referral_invite_id INTEGER REFERENCES invites(id),
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
    start_date TEXT,
    end_date TEXT,
    base_currency TEXT NOT NULL DEFAULT 'MYR',
    emoji TEXT DEFAULT '🧳',
    color TEXT DEFAULT '',
    hidden_features TEXT NOT NULL DEFAULT '[]',
    member_can_edit_plan INTEGER NOT NULL DEFAULT 0,
    watch_currencies TEXT NOT NULL DEFAULT '[]',  -- ISO codes shown in the forex widget
    cover_key TEXT,
    cover_credit TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

CREATE TABLE IF NOT EXISTS trip_members (
    trip_id INTEGER NOT NULL REFERENCES trips(id),
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('leader','editor','viewer')),
    PRIMARY KEY (trip_id, participant_id)
  );

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id),
    filename TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    vendor TEXT,
    doc_type TEXT,
    booking_no TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
    parsed_json TEXT,
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
    expense_date TEXT,
    end_date TEXT,
    payment_date TEXT,
    amount_original REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'MYR',
    fx_rate REAL NOT NULL DEFAULT 1,
    amount_myr REAL NOT NULL,
    payer_participant_id INTEGER REFERENCES participants(id),
    meta_json TEXT,
    lat REAL,
    lng REAL,
    payment_status TEXT NOT NULL DEFAULT 'paid',
    split_json TEXT,
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
    participant_id INTEGER REFERENCES participants(id),  -- NULL = whole payment
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
    expense_id INTEGER REFERENCES expenses(id),  -- NULL = lump sum (oldest-first)
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

CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id),
    title TEXT NOT NULL,
    day TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    notes TEXT,
    location_name TEXT,
    lat REAL,
    lng REAL,
    est_cost_myr REAL,
    expense_id INTEGER REFERENCES expenses(id),
    done INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    stations_json TEXT,
    station_idx INTEGER,
    category TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

CREATE TABLE IF NOT EXISTS activity_participants (
    activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    PRIMARY KEY (activity_id, participant_id)
  );

CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id),
    name TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    PRIMARY KEY (group_id, participant_id)
  );

CREATE TABLE IF NOT EXISTS day_settings (
    trip_id INTEGER NOT NULL REFERENCES trips(id),
    day TEXT NOT NULL,            -- YYYY-MM-DD or '*' for the trip default
    start_name TEXT, start_lat REAL, start_lng REAL,
    end_name TEXT, end_lat REAL, end_lng REAL,
    title TEXT,                   -- what this day is about, shown on the D1..Dx chip
    PRIMARY KEY (trip_id, day)
  );

CREATE TABLE IF NOT EXISTS leg_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id),
    day TEXT NOT NULL,
    leg_key TEXT NOT NULL,        -- "<fromRef>-><toRef>" refs: start|end|act:<id>|auto:<expenseId>
    mode TEXT,
    fare_jpy REAL,
    note TEXT,
    UNIQUE (trip_id, day, leg_key)
  );

CREATE TABLE IF NOT EXISTS personal_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    spend_date TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    description TEXT NOT NULL,
    amount_original REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'JPY',
    fx_rate REAL NOT NULL DEFAULT 1,
    amount_myr REAL NOT NULL,
    behalf_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

CREATE TABLE IF NOT EXISTS day_budgets (
    trip_id INTEGER NOT NULL REFERENCES trips(id),
    day TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'JPY',
    transport REAL, accommodation REAL, food REAL, attractions REAL, misc REAL, total REAL,
    myr_estimate REAL,
    PRIMARY KEY (trip_id, day)
  );

CREATE TABLE IF NOT EXISTS import_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id),
    name TEXT NOT NULL,
    mapping_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

CREATE TABLE IF NOT EXISTS personal_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    personal_expense_id INTEGER NOT NULL REFERENCES personal_expenses(id),
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    amount_myr REAL NOT NULL,
    settled INTEGER NOT NULL DEFAULT 0,
    settled_at TEXT
  );

CREATE INDEX IF NOT EXISTS idx_personal_shares ON personal_shares(personal_expense_id);

CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id),
    stay_label TEXT NOT NULL,
    check_in TEXT, check_out TEXT,
    name TEXT NOT NULL,
    capacity INTEGER,
    sort INTEGER NOT NULL DEFAULT 0
  );

CREATE TABLE IF NOT EXISTS room_occupants (
    room_id INTEGER NOT NULL REFERENCES rooms(id),
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    PRIMARY KEY (room_id, participant_id)
  );

CREATE INDEX IF NOT EXISTS idx_rooms_trip ON rooms(trip_id, stay_label);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0
  );

CREATE TABLE IF NOT EXISTS day_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id),
    day TEXT NOT NULL,
    content TEXT NOT NULL,
    is_check INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,            -- 'inv_' + 128-bit random hex
    kind TEXT NOT NULL CHECK (kind IN ('platform','trip','referral')),
    trip_id INTEGER REFERENCES trips(id), -- NULL unless kind='trip'
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('editor','viewer')),
    created_by INTEGER NOT NULL REFERENCES users(id),
    expires_at TEXT,                      -- NULL = never (referral codes)
    max_uses INTEGER NOT NULL DEFAULT 10,
    used_count INTEGER NOT NULL DEFAULT 0,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

CREATE TABLE IF NOT EXISTS usage_daily (
    day TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    feature TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, user_id, feature)
  );

CREATE INDEX IF NOT EXISTS idx_day_notes ON day_notes(trip_id, day);

CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);

CREATE INDEX IF NOT EXISTS idx_personal_user ON personal_expenses(trip_id, user_id);

CREATE INDEX IF NOT EXISTS idx_activities_trip ON activities(trip_id, day);

CREATE INDEX IF NOT EXISTS idx_documents_trip ON documents(trip_id);

CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses(trip_id);

CREATE INDEX IF NOT EXISTS idx_payments_trip ON payments(trip_id);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_checklist ON checklist_items(trip_id, user_id);
