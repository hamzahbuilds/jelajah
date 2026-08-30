// Schema as code — executed by /api/setup on first run so deployment needs no CLI.
// Keep in sync with migrations/0001_init.sql (the CLI path uses that file).
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_infant INTEGER NOT NULL DEFAULT 0,
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
    lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','ms')),
    participant_id INTEGER REFERENCES participants(id),
    disabled INTEGER NOT NULL DEFAULT 0,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    destination TEXT,
    start_date TEXT,
    end_date TEXT,
    base_currency TEXT NOT NULL DEFAULT 'MYR',
    emoji TEXT DEFAULT '🧳',
    hidden_features TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS trip_members (
    trip_id INTEGER NOT NULL REFERENCES trips(id),
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    PRIMARY KEY (trip_id, participant_id)
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
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
  )`,
  `CREATE TABLE IF NOT EXISTS expenses (
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS expense_shares (
    expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    amount_myr REAL NOT NULL,
    PRIMARY KEY (expense_id, participant_id)
  )`,
  `CREATE TABLE IF NOT EXISTS due_dates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    due_date TEXT NOT NULL,
    amount_myr REAL,
    note TEXT,
    settled INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id),
    from_participant_id INTEGER NOT NULL REFERENCES participants(id),
    to_participant_id INTEGER NOT NULL REFERENCES participants(id),
    amount_myr REAL NOT NULL,
    pay_date TEXT NOT NULL,
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS fx_rates (
    rate_date TEXT NOT NULL,
    base TEXT NOT NULL,
    quote TEXT NOT NULL,
    rate REAL NOT NULL,
    PRIMARY KEY (rate_date, base, quote)
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id INTEGER,
    at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS activities (
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS activity_participants (
    activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    PRIMARY KEY (activity_id, participant_id)
  )`,
  `CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id),
    name TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    PRIMARY KEY (group_id, participant_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_activities_trip ON activities(trip_id, day)`,
  `CREATE INDEX IF NOT EXISTS idx_documents_trip ON documents(trip_id)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses(trip_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_trip ON payments(trip_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_checklist ON checklist_items(trip_id, user_id)`,
];

// Idempotent upgrade statements for databases created by earlier versions.
// Run one by one with failures ignored (e.g. ALTER on a column that already exists).
export const UPGRADES: string[] = [
  `ALTER TABLE trips ADD COLUMN hidden_features TEXT NOT NULL DEFAULT '[]'`,
  ...SCHEMA.filter(s => /activities|activity_participants|groups|group_members|idx_activities_trip/.test(s)),
];

// Optional first-run seed: the Japan Nov/Dec 2026 trip with its 16 travellers,
// exactly as named on the Trip.com / Airbnb documents.
export const JAPAN_TRIP = {
  name: 'Jelajah Jepun 2026',
  destination: 'Tokyo & Osaka, Japan',
  start_date: '2026-11-29',
  end_date: '2026-12-07',
  emoji: '🇯🇵',
  participants: [
    ['Mohd Ismail Ismail Bin Hassim', 0],
    ['Mashuraizzah Binti Mustapha', 0],
    ['Hairuni Binti Hassim', 0],
    ['Hamizan Bin Hamdani', 0],
    ['Kairi Ashraf Bin Kamarolzeman', 0],
    ['Kamarolzeman Bin Mohamad Mustapha', 0],
    ['Muhammad Nur Iskandar Bin Ismail', 0],
    ['Nurul Ain Binti Hamizan', 0],
    ['Jalita Binti Junaidi', 0],
    ['Hamzah Bin Hamizan', 0],
    ['Haziqah Binti Hassan', 0],
    ['Ranizah Binti Rahbi', 0],
    ['Jadirah Azra Binti Kamarolzeman', 0],
    ['Mohammad Indera Bin Zamri', 0],
    ['Mohammad Namazi Bin Salleh', 0],
    ['Hareth Azran Bin Hamzah', 1],
  ] as Array<[string, number]>,
};
