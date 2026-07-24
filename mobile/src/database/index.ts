import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

let db: SQLite.SQLiteDatabase;

export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;

  db = await SQLite.openDatabase({
    name: 'mahaatithi.db',
    location: 'default',
  });

  // PERF: SQLite pragmas tuned for a large (295K-row) read-heavy dataset.
  // - WAL: concurrent reads while a write (sync) is in progress, far fewer fsyncs
  // - synchronous NORMAL: safe with WAL, avoids fsync on every transaction
  // - cache_size negative = KB; -8000 = ~8MB page cache keeps hot index pages in RAM
  // - temp_store MEMORY: sorts/temp b-trees (ORDER BY) built in RAM not on disk
  // - mmap_size: memory-map up to 128MB of the DB file for zero-copy reads
  try {
    await db.executeSql('PRAGMA journal_mode = WAL;');
    await db.executeSql('PRAGMA synchronous = NORMAL;');
    await db.executeSql('PRAGMA cache_size = -8000;');
    await db.executeSql('PRAGMA temp_store = MEMORY;');
    await db.executeSql('PRAGMA mmap_size = 134217728;');
  } catch (e) { /* pragmas are best-effort */ }

  await runMigrations(db);

  // PERF: refresh the query planner's statistics so it picks the right index
  // for the ORDER BY priority_weight + filter combos on 295K rows. Run only
  // once after the new perf indexes are created (not every launch) — ANALYZE
  // over 295K rows on every cold start would itself add startup latency.
  try {
    const [res] = await db.executeSql(
      "SELECT value FROM app_state WHERE key = 'analyze_done_v2'"
    );
    if (res.rows.length === 0) {
      await db.executeSql('ANALYZE;');
      await db.executeSql(
        "INSERT OR REPLACE INTO app_state (key, value) VALUES ('analyze_done_v2', 'true')"
      );
    }
  } catch (e) { /* best-effort */ }

  return db;
}

async function runMigrations(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS stakeholders (
      id TEXT PRIMARY KEY,
      primary_key_id INTEGER UNIQUE,
      uin TEXT,
      data_source TEXT,
      cin_number TEXT,
      gst_number TEXT,
      tin_number TEXT,
      company_name_standardized TEXT,
      company_name_original TEXT,
      full_address_raw TEXT,
      address_line_1 TEXT,
      address_line_2 TEXT,
      city TEXT,
      taluka TEXT,
      village TEXT,
      district TEXT,
      state TEXT,
      pin_code TEXT,
      nic_code TEXT,
      nic_description TEXT,
      category TEXT,
      priority_weight REAL,
      company_class TEXT,
      company_status TEXT,
      company_category TEXT,
      authorized_capital REAL,
      paidup_capital REAL,
      listing_status TEXT,
      registration_date TEXT,
      fuzzy_similarity_score REAL,
      cross_source_match TEXT,
      human_review_required TEXT,
      dedup_match_status TEXT,
      source_lineage_notes TEXT,
      status TEXT DEFAULT 'OPEN',
      locked_by_id TEXT,
      locked_at TEXT,
      updated_at TEXT
    );
  `);

  // Migrate existing tables
  try {
    await database.executeSql('ALTER TABLE stakeholders ADD COLUMN taluka TEXT;');
  } catch (e) { /* ignore if column already exists */ }

  try {
    await database.executeSql('ALTER TABLE stakeholders ADD COLUMN village TEXT;');
  } catch (e) { /* ignore if column already exists */ }

  // BUG 3 FIX: add stakeholder_id to media table for media-only sync runs
  try {
    await database.executeSql('ALTER TABLE media ADD COLUMN stakeholder_id TEXT;');
  } catch (e) { /* ignore if column already exists */ }

  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS surveys (
      id TEXT PRIMARY KEY,
      stakeholder_id TEXT NOT NULL,
      enumerator_id TEXT NOT NULL,
      contact_person TEXT,
      designation TEXT,
      mobile_number TEXT,
      email TEXT,
      contact_person_2 TEXT,
      mobile_number_2 TEXT,
      email_2 TEXT,
      website TEXT,
      business_category TEXT,
      notes TEXT,
      gst_number TEXT,
      organization_type TEXT,
      remarks TEXT,
      latitude REAL,
      longitude REAL,
      gps_accuracy REAL,
      nearest_police_station TEXT,
      nearest_healthcare_center TEXT,
      is_draft INTEGER DEFAULT 1,
      is_completed INTEGER DEFAULT 0,
      is_synced INTEGER DEFAULT 0,
      server_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (stakeholder_id) REFERENCES stakeholders(id)
    );
  `);

  // Migrate existing surveys table for secondary contact fields
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN contact_person_2 TEXT;'); } catch (e) { /* ignore if column already exists */ }
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN mobile_number_2 TEXT;'); } catch (e) { /* ignore if column already exists */ }
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN email_2 TEXT;'); } catch (e) { /* ignore if column already exists */ }

  // ─── New Plan: Step 1 — Category & Type ────────────────────────────────────
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN sub_categories TEXT;'); } catch(e){}

  // ─── New Plan: Step 2 — Basic Information ──────────────────────────────────
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN business_name TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN owner_name TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN district TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN city TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN taluka TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN village TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN pin_code TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN business_address TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN working_address TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN male_employees INTEGER;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN female_employees INTEGER;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN landline TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN alternate_mobile TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN alternate_email TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN aadhar_number TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN udyam_aadhar_reg_no TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN fssai_number TEXT;'); } catch(e){}

  // ─── New Plan: Step 4 — Details ────────────────────────────────────────────
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN description TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN accommodation_facilities TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN accommodation_policies TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN working_hours TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN faq TEXT;'); } catch(e){}

  // ─── New Plan: Step 5 — Rooms & Pricing ────────────────────────────────────
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN rooms TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN coupon_codes TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN sale_off REAL;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN additional_service_fees TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN booking_note TEXT;'); } catch(e){}

  // ─── New Plan: Step 6 — Your Socials ───────────────────────────────────────
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN social_links TEXT;'); } catch(e){}

  // ─── New Plan: Step 7 — Business Documents ─────────────────────────────────
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN about_business TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN registered_travel_for_life INTEGER DEFAULT 0;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN registered_green_leaf INTEGER DEFAULT 0;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN received_tourism_award INTEGER DEFAULT 0;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN custom_documents TEXT;'); } catch(e){}

  // ─── New Plan: Step 8 — Terms & Conditions ─────────────────────────────────
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN agreed_to_terms INTEGER DEFAULT 0;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN declared_info_correct INTEGER DEFAULT 0;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN acknowledged_dot_liability INTEGER DEFAULT 0;'); } catch(e){}

  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      survey_id TEXT NOT NULL,
      stakeholder_id TEXT,
      type TEXT NOT NULL,
      photo_category TEXT,
      file_path TEXT NOT NULL,
      file_name TEXT,
      file_size INTEGER,
      mime_type TEXT,
      latitude REAL,
      longitude REAL,
      gps_accuracy REAL,
      captured_at TEXT,
      duration INTEGER,
      thumbnail_path TEXT,
      is_synced INTEGER DEFAULT 0,
      server_id TEXT,
      FOREIGN KEY (survey_id) REFERENCES surveys(id)
    );
  `);

  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS phone_validations (
      id TEXT PRIMARY KEY,
      stakeholder_id TEXT NOT NULL,
      enumerator_id TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING_VERIFICATION',
      method TEXT DEFAULT 'phone_call',
      verified_at TEXT,
      remarks TEXT,
      is_synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT,
      status TEXT DEFAULT 'PENDING',
      retry_count INTEGER DEFAULT 0,
      error_message TEXT,
      next_retry_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // SYNC FIX: add next_retry_at for backoff scheduling on existing installs
  try {
    await database.executeSql('ALTER TABLE sync_queue ADD COLUMN next_retry_at TEXT;');
  } catch (e) { /* ignore if column already exists */ }

  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS facilities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      district TEXT,
      state TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL
    );
  `);

  // Create indexes for offline search
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_sh_name ON stakeholders(company_name_standardized COLLATE NOCASE);`);
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_sh_district ON stakeholders(district COLLATE NOCASE);`);
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_sh_pin ON stakeholders(pin_code);`);
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_sh_category ON stakeholders(category COLLATE NOCASE);`);
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_sh_status ON stakeholders(status);`);
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_survey_stakeholder ON surveys(stakeholder_id);`);
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_queue(status);`);
  // PERF: hot sync/scan paths that were doing full table scans.
  // - media(is_synced)/media(survey_id): getUnsynced() & getBySurveyLocal() run every sync
  // - surveys(is_synced): getUnsynced()/getUnsyncedCount() & the pending-completion join
  // - stakeholders(district, city): the cascade getUniqueCities()/getUniquePins() dropdowns
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_media_is_synced ON media(is_synced);`);
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_media_survey ON media(survey_id);`);
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_surveys_is_synced ON surveys(is_synced);`);
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_sh_district_city ON stakeholders(district COLLATE NOCASE, city COLLATE NOCASE);`);
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_facilities_type ON facilities(type);`);
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_facilities_name ON facilities(name COLLATE NOCASE);`);
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_facilities_district ON facilities(district COLLATE NOCASE);`);

  // PERF (critical): the default list + every search ORDERs BY
  // priority_weight DESC, company_name_standardized ASC. With no matching
  // index SQLite scanned all 295K rows and did a filesort on every open —
  // the dominant cause of the 4-5s load. This composite index lets SQLite
  // walk rows in already-sorted order and stop after LIMIT (20), turning a
  // full scan+sort into an index range read.
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_sh_sort ON stakeholders(priority_weight DESC, company_name_standardized ASC);`);
  // PERF: the most common filtered browse is by district, still sorted by
  // priority. This composite serves "district = ? ORDER BY priority_weight".
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_sh_district_sort ON stakeholders(district COLLATE NOCASE, priority_weight DESC);`);
  // PERF: cascade dropdown getUniquePins(city) filters by city alone; the
  // existing composite leads with district so a city-only predicate scanned.
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_sh_city_only ON stakeholders(city COLLATE NOCASE);`);
}

export async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (!db) return initDatabase();
  return db;
}

// ============================================================================
// HELPER: Convert snake_case SQLite rows to camelCase for UI
// ============================================================================
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function mapRowToCamel(row: any): any {
  const mapped: any = {};
  for (const key of Object.keys(row)) {
    mapped[snakeToCamel(key)] = row[key];
  }
  return mapped;
}

// ============================================================================
// STAKEHOLDER DAO
// ============================================================================

export const stakeholderDao = {
  async upsertMany(stakeholders: any[], onProgress?: (inserted: number, total: number, percent: number) => void): Promise<void> {
    const database = await getDB();
    const total = stakeholders.length;
    if (total === 0) return;

    // PERF: insert in multi-row batches instead of one executeSql per row.
    // The old loop issued `total` separate INSERT statements — each an implicit
    // transaction with its own disk flush — so an initial sync of thousands of
    // stakeholders took minutes. A single multi-row INSERT OR REPLACE commits its
    // whole batch atomically in one flush.
    // Mirrors facilityDao.upsertMany (executeSql per batch, no db.transaction —
    // the wrapper's transaction() promise handling is buggy in this lib).
    // BATCH SIZE: this table has 38 bound params per row and react-native-sqlite-
    // storage's bundled SQLite caps statement variables at 999, so 25 rows
    // (25 × 38 = 950) is the largest safe batch.
    const COLUMNS = 38;
    const batchSize = 25;
    const rowPlaceholder = `(${Array(COLUMNS).fill('?').join(',')})`;
    let inserted = 0;

    for (let i = 0; i < total; i += batchSize) {
      const batch = stakeholders.slice(i, i + batchSize);
      const params: any[] = [];
      for (const s of batch) {
        params.push(
          s.id, s.primaryKeyId, s.uin, s.dataSource, s.cinNumber, s.gstNumber, s.tinNumber,
          s.companyNameStandardized, s.companyNameOriginal, s.fullAddressRaw, s.addressLine1,
          s.addressLine2, s.city, s.taluka, s.village, s.district, s.state, s.pinCode, s.nicCode,
          s.nicDescription, s.category, s.priorityWeight, s.companyClass, s.companyStatus,
          s.companyCategory, s.authorizedCapital, s.paidupCapital, s.listingStatus,
          s.registrationDate, s.fuzzySimilarityScore, s.crossSourceMatch, s.humanReviewRequired,
          s.dedupMatchStatus, s.sourceLineageNotes, s.status, s.lockedById, s.lockedAt, s.updatedAt
        );
      }

      await database.executeSql(
        `INSERT OR REPLACE INTO stakeholders (id, primary_key_id, uin, data_source, cin_number,
          gst_number, tin_number, company_name_standardized, company_name_original,
          full_address_raw, address_line_1, address_line_2, city, taluka, village, district, state, pin_code,
          nic_code, nic_description, category, priority_weight, company_class, company_status,
          company_category, authorized_capital, paidup_capital, listing_status, registration_date,
          fuzzy_similarity_score, cross_source_match, human_review_required, dedup_match_status,
          source_lineage_notes, status, locked_by_id, locked_at, updated_at)
        VALUES ${batch.map(() => rowPlaceholder).join(',')}`,
        params
      );

      inserted += batch.length;
      const percent = Math.round((inserted / total) * 100);
      console.log(`⏳ [SQLite Stakeholders] Inserted ${inserted} / ${total} (${percent}%)`);
      if (onProgress) onProgress(inserted, total, percent);
    }
  },

  async search(filters: Record<string, string>, page: number = 1, limit: number = 20): Promise<any[]> {
    const database = await getDB();
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.name) {
      conditions.push(`(company_name_standardized LIKE ? OR company_name_original LIKE ?)`);
      params.push(`%${filters.name}%`, `%${filters.name}%`);
    }
    if (filters.district) {
      conditions.push(`district = ? COLLATE NOCASE`);
      params.push(filters.district);
    }
    if (filters.pinCode) {
      conditions.push(`pin_code LIKE ?`);
      params.push(`${filters.pinCode}%`);
    }
    if (filters.taluka) {
      conditions.push(`taluka = ? COLLATE NOCASE`);
      params.push(filters.taluka);
    }
    if (filters.city) {
      conditions.push(`(city LIKE ? COLLATE NOCASE OR village LIKE ? COLLATE NOCASE)`);
      params.push(`%${filters.city}%`, `%${filters.city}%`);
    }
    if (filters.category) {
      conditions.push(`category LIKE ? COLLATE NOCASE`);
      params.push(`%${filters.category}%`);
    }
    if (filters.nicCode) {
      conditions.push(`nic_code = ?`);
      params.push(filters.nicCode);
    }
    if (filters.gst) {
      conditions.push(`gst_number LIKE ? COLLATE NOCASE`);
      params.push(`%${filters.gst}%`);
    }
    if (filters.state) {
      conditions.push(`state = ? COLLATE NOCASE`);
      params.push(filters.state);
    }
    if (filters.status) {
      conditions.push(`status = ?`);
      params.push(filters.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    // PERF: list rows only need the fields the cards render — the old `SELECT *`
    // pulled all 38 columns (long address/lineage text) per row just to throw most
    // away. Tapping a row re-fetches the full record via getById (SELECT *), so the
    // detail screen is unaffected. priority_weight stays for the ORDER BY.
    const [results] = await database.executeSql(
      `SELECT id, primary_key_id, company_name_standardized, company_name_original,
              district, city, pin_code, category, nic_description, status,
              locked_by_id, priority_weight
       FROM stakeholders ${whereClause}
       ORDER BY priority_weight DESC, company_name_standardized ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const rows = [];
    for (let i = 0; i < results.rows.length; i++) {
      rows.push(mapRowToCamel(results.rows.item(i)));
    }
    return rows;
  },

  async searchCount(filters: Record<string, string>): Promise<number> {
    const database = await getDB();
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.name) {
      conditions.push(`(company_name_standardized LIKE ? OR company_name_original LIKE ?)`);
      params.push(`%${filters.name}%`, `%${filters.name}%`);
    }
    if (filters.district) {
      conditions.push(`district = ? COLLATE NOCASE`);
      params.push(filters.district);
    }
    if (filters.pinCode) {
      conditions.push(`pin_code LIKE ?`);
      params.push(`${filters.pinCode}%`);
    }
    if (filters.taluka) {
      conditions.push(`taluka = ? COLLATE NOCASE`);
      params.push(filters.taluka);
    }
    if (filters.city) {
      conditions.push(`(city LIKE ? COLLATE NOCASE OR village LIKE ? COLLATE NOCASE)`);
      params.push(`%${filters.city}%`, `%${filters.city}%`);
    }
    if (filters.category) {
      conditions.push(`category LIKE ? COLLATE NOCASE`);
      params.push(`%${filters.category}%`);
    }
    if (filters.nicCode) {
      conditions.push(`nic_code = ?`);
      params.push(filters.nicCode);
    }
    if (filters.gst) {
      conditions.push(`gst_number LIKE ? COLLATE NOCASE`);
      params.push(`%${filters.gst}%`);
    }
    if (filters.state) {
      conditions.push(`state = ? COLLATE NOCASE`);
      params.push(filters.state);
    }
    if (filters.status) {
      conditions.push(`status = ?`);
      params.push(filters.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [results] = await database.executeSql(
      `SELECT COUNT(*) as count FROM stakeholders ${whereClause}`,
      params
    );

    return results.rows.item(0).count ?? 0;
  },

  async getById(id: string): Promise<any> {
    const database = await getDB();
    const [results] = await database.executeSql('SELECT * FROM stakeholders WHERE id = ?', [id]);
    return results.rows.length > 0 ? mapRowToCamel(results.rows.item(0)) : null;
  },

  async update(id: string, updates: Record<string, any>): Promise<void> {
    const database = await getDB();
    const keys = Object.keys(updates);
    if (keys.length === 0) return;

    // Convert JS keys to database column names (camelCase to snake_case)
    const toSnakeCase = (str: string) => str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    
    const setClause = keys.map(k => `${toSnakeCase(k)} = ?`).join(', ');
    const values = keys.map(k => updates[k]);

    await database.executeSql(
      `UPDATE stakeholders SET ${setClause}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    );
  },

  async removeLockedStakeholders(lockedIds: string[]): Promise<void> {
    if (lockedIds.length === 0) return;
    const database = await getDB();
    const placeholders = lockedIds.map(() => '?').join(',');
    
    // Delete associated media first
    await database.executeSql(`
      DELETE FROM media WHERE survey_id IN (
        SELECT id FROM surveys WHERE stakeholder_id IN (${placeholders})
      )
    `, lockedIds);

    // Delete associated surveys
    await database.executeSql(`DELETE FROM surveys WHERE stakeholder_id IN (${placeholders})`, lockedIds);

    // Finally delete stakeholders
    await database.executeSql(`DELETE FROM stakeholders WHERE id IN (${placeholders})`, lockedIds);
  },

  async getCount(): Promise<number> {
    const database = await getDB();
    const [results] = await database.executeSql('SELECT COUNT(*) as count FROM stakeholders');
    return results.rows.item(0).count;
  },

  async getUniqueDistricts(): Promise<string[]> {
    const database = await getDB();
    const [results] = await database.executeSql('SELECT DISTINCT district FROM stakeholders WHERE district IS NOT NULL AND district != \'\' ORDER BY district ASC');
    const rows = [];
    for (let i = 0; i < results.rows.length; i++) {
      rows.push(results.rows.item(i).district);
    }
    return rows;
  },

  async getUniqueCities(district: string): Promise<string[]> {
    const database = await getDB();
    const [results] = await database.executeSql('SELECT DISTINCT city FROM stakeholders WHERE district = ? COLLATE NOCASE AND city IS NOT NULL AND city != \'\' ORDER BY city ASC', [district]);
    const rows = [];
    for (let i = 0; i < results.rows.length; i++) {
      rows.push(results.rows.item(i).city);
    }
    return rows;
  },

  async getUniquePins(city: string): Promise<string[]> {
    const database = await getDB();
    const [results] = await database.executeSql('SELECT DISTINCT pin_code FROM stakeholders WHERE city = ? COLLATE NOCASE AND pin_code IS NOT NULL AND pin_code != \'\' ORDER BY pin_code ASC', [city]);
    const rows = [];
    for (let i = 0; i < results.rows.length; i++) {
      rows.push(results.rows.item(i).pin_code);
    }
    return rows;
  },
};

export async function clearAllData(): Promise<void> {
  if (!db) return;
  console.log('🚨 [Security] Commencing total database wipe...');
  await db.executeSql('DELETE FROM stakeholders');
  console.log('🗑️ [Security] Deleted all stakeholders.');
  await db.executeSql('DELETE FROM surveys');
  console.log('🗑️ [Security] Deleted all surveys.');
  await db.executeSql('DELETE FROM sync_queue');
  await db.executeSql('DELETE FROM app_state');
  await db.executeSql('DELETE FROM media');
  await db.executeSql('DELETE FROM facilities');
  console.log('✅ [Security] All local data has been successfully purged from the device.');
}

// ============================================================================
// SURVEY DAO
// ============================================================================

export const surveyDao = {
  async save(survey: any): Promise<void> {
    const database = await getDB();
    const id = survey.id || `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await database.executeSql(
      `INSERT OR REPLACE INTO surveys (id, stakeholder_id, enumerator_id, contact_person,
        designation, mobile_number, email, contact_person_2, mobile_number_2, email_2, website, business_category, notes, gst_number,
        organization_type, remarks, latitude, longitude, gps_accuracy, nearest_police_station, 
        nearest_healthcare_center, is_draft, is_completed, is_synced,
        sub_categories, business_name, owner_name, district, city, taluka, village, pin_code,
        business_address, working_address, male_employees, female_employees, landline,
        alternate_mobile, alternate_email, aadhar_number, udyam_aadhar_reg_no, fssai_number,
        description, accommodation_facilities, accommodation_policies, working_hours, faq,
        rooms, coupon_codes, sale_off, additional_service_fees, booking_note,
        social_links, about_business, registered_travel_for_life, registered_green_leaf,
        received_tourism_award, custom_documents, agreed_to_terms, declared_info_correct,
        acknowledged_dot_liability, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      [id, survey.stakeholderId, survey.enumeratorId, survey.contactPerson,
       survey.designation, survey.mobileNumber, survey.email, survey.contactPerson2, survey.mobileNumber2, survey.email2, survey.website,
       survey.businessCategory, survey.notes, survey.gstNumber,
       survey.organizationType, survey.remarks, survey.latitude, survey.longitude,
       survey.gpsAccuracy, survey.nearestPoliceStation, survey.nearestHealthcareCenter,
       survey.isDraft ? 1 : 0, survey.isCompleted ? 1 : 0, survey.isSynced ? 1 : 0,
       // Step 1
       survey.subCategories ? JSON.stringify(survey.subCategories) : null,
       // Step 2
       survey.businessName || null, survey.ownerName || null, survey.district || null,
       survey.city || null, survey.taluka || null, survey.village || null, survey.pinCode || null,
       survey.businessAddress || null, survey.workingAddress || null,
       survey.maleEmployees ?? null, survey.femaleEmployees ?? null,
       survey.landline || null, survey.alternateMobile || null, survey.alternateEmail || null,
       survey.aadharNumber || null, survey.udyamAadharRegNo || null, survey.fssaiNumber || null,
       // Step 4
       survey.description || null,
       survey.accommodationFacilities ? JSON.stringify(survey.accommodationFacilities) : null,
       survey.accommodationPolicies || null,
       survey.workingHours ? JSON.stringify(survey.workingHours) : null,
       survey.faq ? JSON.stringify(survey.faq) : null,
       // Step 5
       survey.rooms ? JSON.stringify(survey.rooms) : null,
       survey.couponCodes ? JSON.stringify(survey.couponCodes) : null,
       survey.saleOff ?? null,
       survey.additionalServiceFees ? JSON.stringify(survey.additionalServiceFees) : null,
       survey.bookingNote || null,
       // Step 6
       survey.socialLinks ? JSON.stringify(survey.socialLinks) : null,
       // Step 7
       survey.aboutBusiness || null,
       survey.registeredTravelForLife ? 1 : 0,
       survey.registeredGreenLeaf ? 1 : 0,
       survey.receivedTourismAward ? 1 : 0,
       survey.customDocuments ? JSON.stringify(survey.customDocuments) : null,
       // Step 8
       survey.agreedToTerms ? 1 : 0,
       survey.declaredInfoCorrect ? 1 : 0,
       survey.acknowledgedDotLiability ? 1 : 0]
    );
  },

  async getByStakeholder(stakeholderId: string): Promise<any> {
    const database = await getDB();
    const [results] = await database.executeSql(
      'SELECT * FROM surveys WHERE stakeholder_id = ? ORDER BY updated_at DESC LIMIT 1',
      [stakeholderId]
    );
    return results.rows.length > 0 ? results.rows.item(0) : null;
  },

  async getUnsynced(): Promise<any[]> {
    const database = await getDB();
    const [results] = await database.executeSql('SELECT * FROM surveys WHERE is_synced = 0');
    const rows = [];
    for (let i = 0; i < results.rows.length; i++) {
      rows.push(results.rows.item(i));
    }
    return rows;
  },

  // COUNT FIX: surveys pending upload live in the surveys table (is_synced=0),
  // not in sync_queue. The Sync Center's getPendingCount() only counted
  // sync_queue rows (stakeholder updates), so offline surveys were invisible to
  // the counter — it always showed 0 even with 10 surveys waiting to upload.
  async getUnsyncedCount(): Promise<number> {
    const database = await getDB();
    const [results] = await database.executeSql(
      "SELECT COUNT(*) as count FROM surveys WHERE is_synced = 0"
    );
    return results.rows.item(0).count ?? 0;
  },

  async markSynced(id: string): Promise<void> {
    const database = await getDB();
    await database.executeSql('UPDATE surveys SET is_synced = 1 WHERE id = ?', [id]);
  },

  // Scenario E FIX: mark survey as locally completed after server complete() succeeds
  async markCompleted(id: string): Promise<void> {
    const database = await getDB();
    await database.executeSql('UPDATE surveys SET is_completed = 1 WHERE id = ?', [id]);
  },

  // Scenario E FIX: find surveys fully synced but whose complete() never got through
  async getPendingCompletion(): Promise<any[]> {
    const database = await getDB();
    // SCENARIO E BUG FIX: the original query only checked is_synced=1 AND
    // is_completed=0 on the survey row. This fires prematurely when a media
    // upload failed mid-sync: the survey text is uploaded (is_synced=1) but
    // some media rows are still is_synced=0. The old query returned those
    // surveys as "ready to complete", so Scenario E called complete() on the
    // server — locking the survey — while media was still pending. The next
    // sync then tried to upload media to a server-locked survey, which the
    // server rejected, permanently stranding those files.
    //
    // Fix: only treat a survey as stranded-complete when it has NO unsynced
    // media rows. LEFT JOIN + WHERE m.id IS NULL ensures Scenario E only fires
    // when every file has already reached the server — the only safe time to
    // call complete().
    const [results] = await database.executeSql(
      `SELECT s.*
       FROM surveys s
       LEFT JOIN media m ON m.survey_id = s.id AND m.is_synced = 0
       WHERE s.is_synced = 1
         AND s.is_completed = 0
         AND m.id IS NULL`
    );
    const rows = [];
    for (let i = 0; i < results.rows.length; i++) rows.push(results.rows.item(i));
    return rows;
  },
};

export const mediaDao = {
  async save(media: any): Promise<void> {
    const database = await getDB();
    const id = media.id || `local_media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await database.executeSql(
      `INSERT OR REPLACE INTO media (id, survey_id, stakeholder_id, type, photo_category, file_path, file_name, file_size, mime_type, latitude, longitude, gps_accuracy, captured_at, duration, thumbnail_path, is_synced)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, media.surveyId, media.stakeholderId || null, media.type, media.photoCategory, media.filePath, media.fileName, media.fileSize, media.mimeType, media.latitude, media.longitude, media.gpsAccuracy, media.capturedAt, media.duration, media.thumbnailPath, media.isSynced ? 1 : 0]
    );
  },

  async getUnsynced(): Promise<any[]> {
    const db = await getDB();
    const [results] = await db.executeSql(`SELECT * FROM media WHERE is_synced = 0`);
    const rows = [];
    for (let i = 0; i < results.rows.length; i++) {
      rows.push(results.rows.item(i));
    }
    return rows;
  },

  // COUNT FIX: unsynced media files also live outside sync_queue.
  // Each photo/video is a separate pending upload the user is waiting on.
  async getUnsyncedCount(): Promise<number> {
    const db = await getDB();
    const [results] = await db.executeSql(
      "SELECT COUNT(*) as count FROM media WHERE is_synced = 0"
    );
    return results.rows.item(0).count ?? 0;
  },

  async markSynced(id: string): Promise<void> {
    const db = await getDB();
    await db.executeSql(`UPDATE media SET is_synced = 1 WHERE id = ?`, [id]);
  },

  // BUG 4 FIX: fetch all media rows for a local survey id (for marking synced after online upload)
  async getBySurveyLocal(surveyId: string): Promise<any[]> {
    const db = await getDB();
    const [results] = await db.executeSql(`SELECT * FROM media WHERE survey_id = ?`, [surveyId]);
    const rows = [];
    for (let i = 0; i < results.rows.length; i++) {
      rows.push(results.rows.item(i));
    }
    return rows;
  },
};

// ============================================================================
// FACILITY DAO
// ============================================================================
export const facilityDao = {
  async upsertMany(facilities: any[], onProgress?: (inserted: number, total: number, percent: number) => void): Promise<void> {
    const db = await getDB();
    const batchSize = 100;
    const queries: any[] = [];
    
    for (let i = 0; i < facilities.length; i += batchSize) {
      const batch = facilities.slice(i, i + batchSize);
      let query = 'INSERT OR REPLACE INTO facilities (id, name, type, district, state, latitude, longitude) VALUES ';
      const params: any[] = [];
      
      batch.forEach((f, idx) => {
        query += '(?, ?, ?, ?, ?, ?, ?)';
        if (idx < batch.length - 1) query += ', ';
        params.push(f.id, f.name, f.type, f.district, f.state, f.latitude, f.longitude);
      });
      
      queries.push([query, params]);
    }
    
    // Execute all queries sequentially using db.executeSql directly to avoid transaction promise bugs
    if (queries.length > 0) {
      try {
        let inserted = 0;
        for (let i = 0; i < queries.length; i++) {
          await db.executeSql(queries[i][0], queries[i][1]);
          // Calculate how many items were in this batch (7 parameters per facility)
          inserted += (queries[i][1].length / 7);
          const percent = Math.round((inserted / facilities.length) * 100);
          console.log(`⏳ [SQLite Facilities] Inserted ${inserted} / ${facilities.length} (${percent}%)`);
          if (onProgress) onProgress(inserted, facilities.length, percent);
        }
      } catch (error) {
        console.error('Batch insert failed:', error);
        throw error;
      }
    }
  },
  async getNearest(lat: number, lng: number, type: string): Promise<any> {
    const db = await getDB();
    // Relax the type matching in case backend uses "Police Station" vs "POLICE_STATION"
    const searchType = type.replace('_STATION', '').replace('_CENTER', '').trim();
    const [results] = await db.executeSql(
      `SELECT *, 
        ((latitude - ?) * (latitude - ?) + (longitude - ?) * (longitude - ?)) as distanceSq
       FROM facilities 
       WHERE type LIKE ? COLLATE NOCASE
       ORDER BY distanceSq ASC 
       LIMIT 10`,
      [lat, lat, lng, lng, `%${searchType}%`]
    );
    const rows = [];
    for (let i = 0; i < results.rows.length; i++) {
      rows.push(results.rows.item(i));
    }
    return rows;
  },
  async search(query: string, type: string, limit: number = 20): Promise<any[]> {
    const db = await getDB();
    const [results] = await db.executeSql(
      `SELECT * FROM facilities 
       WHERE type = ? AND (name LIKE ? COLLATE NOCASE OR district LIKE ? COLLATE NOCASE) 
       ORDER BY name ASC 
       LIMIT ?`,
      [type, `%${query}%`, `%${query}%`, limit]
    );
    const rows = [];
    for (let i = 0; i < results.rows.length; i++) {
      rows.push(results.rows.item(i));
    }
    return rows;
  }
};

// ============================================================================
// SYNC QUEUE DAO
// ============================================================================

// SYNC FIX: cap automatic retries so a permanently-broken payload (e.g. server
// rejects with 400 every time) doesn't hammer the API forever. After this many
// failures the item becomes "DEAD" and needs a manual retry from Sync Center.
// Retry cap removed — sync will keep retrying indefinitely until success
const MAX_AUTO_RETRIES = 999;

// SYNC FIX: exponential backoff schedule (minutes) indexed by retry_count.
// Prevents every reconnect/manual-sync from immediately re-hitting an item
// that just failed seconds ago.
const BACKOFF_MINUTES = [0, 1, 5, 15, 60, 240];

export const syncQueueDao = {
  async add(entityType: string, entityId: string, action: string, payload: any): Promise<void> {
    const database = await getDB();
    await database.executeSql(
      'INSERT INTO sync_queue (entity_type, entity_id, action, payload) VALUES (?,?,?,?)',
      [entityType, entityId, action, JSON.stringify(payload)]
    );
  },

  // SYNC FIX: replaces the old getPending(). Returns PENDING items immediately,
  // and FAILED items only once their backoff window has elapsed AND they're
  // still under the retry cap. This is what makes "Failed uploads are retried
  // automatically" (as SyncStatusScreen claims) actually true.
  async getRetryable(): Promise<any[]> {
    const database = await getDB();
    const [results] = await database.executeSql(
      `SELECT * FROM sync_queue
       WHERE status = 'PENDING'
          OR (status = 'FAILED' AND retry_count < ? AND (next_retry_at IS NULL OR next_retry_at <= datetime('now')))
       ORDER BY created_at ASC`,
      [MAX_AUTO_RETRIES]
    );
    const rows = [];
    for (let i = 0; i < results.rows.length; i++) {
      rows.push(results.rows.item(i));
    }
    return rows;
  },

  // Kept for any external caller still expecting the old name/behavior.
  async getPending(): Promise<any[]> {
    const database = await getDB();
    const [results] = await database.executeSql(
      "SELECT * FROM sync_queue WHERE status = 'PENDING' ORDER BY created_at ASC"
    );
    const rows = [];
    for (let i = 0; i < results.rows.length; i++) {
      rows.push(results.rows.item(i));
    }
    return rows;
  },

  async markCompleted(id: number): Promise<void> {
    const database = await getDB();
    await database.executeSql("UPDATE sync_queue SET status = 'COMPLETED' WHERE id = ?", [id]);
  },

  // SYNC FIX: schedules the next allowed retry time using exponential backoff
  // based on the new retry_count, so getRetryable() won't pick this item up
  // again until the window has passed. Status stays 'FAILED' so the UI can
  // surface it, but it's still eligible for automatic retry until the cap.
  async markFailed(id: number, error: string): Promise<void> {
    const database = await getDB();
    const [results] = await database.executeSql('SELECT retry_count FROM sync_queue WHERE id = ?', [id]);
    const currentRetryCount = results.rows.length > 0 ? results.rows.item(0).retry_count : 0;
    const newRetryCount = currentRetryCount + 1;
    const backoffIndex = Math.min(newRetryCount, BACKOFF_MINUTES.length - 1);
    const backoffMinutes = BACKOFF_MINUTES[backoffIndex];

    await database.executeSql(
      `UPDATE sync_queue
       SET status = 'FAILED',
           retry_count = ?,
           error_message = ?,
           next_retry_at = datetime('now', '+' || ? || ' minutes')
       WHERE id = ?`,
      [newRetryCount, error, backoffMinutes, id]
    );
  },

  // SYNC FIX: manual override for Sync Center's "Retry Failed Now" button —
  // resets backoff so the next sync run picks these up immediately regardless
  // of the scheduled window. Does NOT reset items that already hit MAX_AUTO_RETRIES;
  // those need retryDeadLetters() since they likely need investigation, not a blind retry.
  async retryAllFailedNow(): Promise<number> {
    const database = await getDB();
    const [result] = await database.executeSql(
      `UPDATE sync_queue SET next_retry_at = datetime('now') WHERE status = 'FAILED' AND retry_count < ?`,
      [MAX_AUTO_RETRIES]
    );
    return result?.rowsAffected ?? 0;
  },

  // SYNC FIX: explicit re-arm for items that exhausted automatic retries.
  // Resets retry_count to 0 so they get a fresh backoff cycle. Surfaced as a
  // distinct, deliberate action in the UI (separate from the normal retry button)
  // since a dead-lettered item likely needs the user to check connectivity/data first.
  async resetDeadLetters(): Promise<number> {
    const database = await getDB();
    const [result] = await database.executeSql(
      `UPDATE sync_queue SET status = 'PENDING', retry_count = 0, next_retry_at = NULL WHERE status = 'FAILED' AND retry_count >= ?`,
      [MAX_AUTO_RETRIES]
    );
    return result?.rowsAffected ?? 0;
  },

  async getPendingCount(): Promise<number> {
    const database = await getDB();
    const [results] = await database.executeSql(
      "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING'"
    );
    return results.rows.item(0).count;
  },

  async getLogicalPendingCount(): Promise<number> {
    const database = await getDB();
    const [syncQueueResult] = await database.executeSql(
      "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING' AND entity_type != 'survey'"
    );
    const pendingSyncQueue = syncQueueResult.rows.item(0).count;

    const [surveyResult] = await database.executeSql(`
      SELECT COUNT(DISTINCT id) as count FROM (
        SELECT id FROM surveys WHERE is_synced = 0
        UNION
        SELECT survey_id as id FROM media WHERE is_synced = 0
      )
    `);
    const pendingSurveys = surveyResult.rows.item(0).count;

    return pendingSyncQueue + pendingSurveys;
  },

  // SYNC FIX: "failed" now specifically means "still retrying automatically" —
  // distinct from dead-lettered, so the count the user sees isn't alarming for
  // something that's already self-healing in the background.
  async getFailedCount(): Promise<number> {
    const database = await getDB();
    const [results] = await database.executeSql(
      "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'FAILED' AND retry_count < ?",
      [MAX_AUTO_RETRIES]
    );
    return results.rows.item(0).count;
  },

  // SYNC FIX: items that exhausted MAX_AUTO_RETRIES and need manual attention.
  async getDeadLetterCount(): Promise<number> {
    const database = await getDB();
    const [results] = await database.executeSql(
      "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'FAILED' AND retry_count >= ?",
      [MAX_AUTO_RETRIES]
    );
    return results.rows.item(0).count;
  },

  async getDeadLetters(): Promise<any[]> {
    const database = await getDB();
    const [results] = await database.executeSql(
      "SELECT * FROM sync_queue WHERE status = 'FAILED' AND retry_count >= ? ORDER BY created_at ASC",
      [MAX_AUTO_RETRIES]
    );
    const rows = [];
    for (let i = 0; i < results.rows.length; i++) {
      rows.push(results.rows.item(i));
    }
    return rows;
  },
};

// ============================================================================
// APP STATE DAO
// ============================================================================

export const appStateDao = {
  async get(key: string): Promise<string | null> {
    const database = await getDB();
    const [results] = await database.executeSql('SELECT value FROM app_state WHERE key = ?', [key]);
    return results.rows.length > 0 ? results.rows.item(0).value : null;
  },

  async set(key: string, value: string): Promise<void> {
    const database = await getDB();
    await database.executeSql(
      "INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, datetime('now'))",
      [key, value]
    );
  },
};