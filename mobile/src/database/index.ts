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
      mobile_number TEXT,
      email TEXT,
      business_category TEXT,
      latitude REAL,
      longitude REAL,
      gps_accuracy REAL,
      nearest_police_station TEXT,
      nearest_healthcare_center TEXT,
      is_draft INTEGER DEFAULT 1,
      is_completed INTEGER DEFAULT 0,
      is_synced INTEGER DEFAULT 0,
      sub_categories TEXT,
      business_name TEXT,
      owner_name TEXT,
      district TEXT,
      city TEXT,
      pin_code TEXT,
      business_address TEXT,
      aadhar_number TEXT,
      udyam_aadhar_reg_no TEXT,
      pan_number TEXT,
      description TEXT,
      accommodation_facilities TEXT,
      accommodation_policies TEXT,
      working_hours TEXT,
      rooms TEXT,
      about_business TEXT,
      agreed_to_terms INTEGER DEFAULT 0,
      declared_info_correct INTEGER DEFAULT 0,
      acknowledged_dot_liability INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      next_retry_at TEXT,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (stakeholder_id) REFERENCES stakeholders(id)
    );
  `);

  // ─── Legacy migrations for devices with old surveys table schema ─────────
  // These ADD COLUMN statements ensure devices that already have the old table
  // get the new columns. They silently fail if the column already exists.
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN sub_categories TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN business_name TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN owner_name TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN district TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN city TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN pin_code TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN business_address TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN aadhar_number TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN udyam_aadhar_reg_no TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN pan_number TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN description TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN accommodation_facilities TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN accommodation_policies TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN working_hours TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN rooms TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN about_business TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN agreed_to_terms INTEGER DEFAULT 0;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN declared_info_correct INTEGER DEFAULT 0;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN acknowledged_dot_liability INTEGER DEFAULT 0;'); } catch(e){}

  // ─── SYNC RELIABILITY FIX: per-row retry tracking for surveys ──────────────
  // Previously surveys/media had NO retry_count or next_retry_at, unlike
  // sync_queue. A permanently-failing row (bad enum, deleted file, server
  // conflict) was retried every 3 s forever with no backoff, never dead-lettered
  // and never visible in the Sync Center. These columns give survey/media rows
  // the same backoff + dead-letter semantics sync_queue already had.
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN retry_count INTEGER DEFAULT 0;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN next_retry_at TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE surveys ADD COLUMN last_error TEXT;'); } catch(e){}

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
      retry_count INTEGER DEFAULT 0,
      next_retry_at TEXT,
      last_error TEXT,
      FOREIGN KEY (survey_id) REFERENCES surveys(id)
    );
  `);

  // ─── SYNC RELIABILITY FIX: per-row retry tracking for media ────────────────
  try { await database.executeSql('ALTER TABLE media ADD COLUMN retry_count INTEGER DEFAULT 0;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE media ADD COLUMN next_retry_at TEXT;'); } catch(e){}
  try { await database.executeSql('ALTER TABLE media ADD COLUMN last_error TEXT;'); } catch(e){}

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
  // DATA-INTEGRITY FIX: Postgres enforces @@unique([stakeholderId, enumeratorId])
  // on surveys, but SQLite had no equivalent. If the form was ever opened without
  // the local survey row in route params, onSubmit generated a fresh
  // `local_<ts>_<rand>` id and created a SECOND row for the same stakeholder.
  // removeLockedStakeholders() deletes by stakeholder_id, so completing one row
  // destroyed the other row and all of its media.
  //
  // Repair existing installs, then add a unique index as a backstop.
  // ORDER MATTERS: media must be re-pointed to the surviving survey row BEFORE
  // the duplicate rows are deleted, otherwise those photos/videos are orphaned
  // (survey_id referencing a row that no longer exists → they can never upload).
  try {
    await database.executeSql(`
      UPDATE media SET survey_id = (
        SELECT s2.id FROM surveys s2
        WHERE s2.stakeholder_id = (SELECT s1.stakeholder_id FROM surveys s1 WHERE s1.id = media.survey_id)
          AND s2.enumerator_id  = (SELECT s1.enumerator_id  FROM surveys s1 WHERE s1.id = media.survey_id)
        ORDER BY s2.rowid DESC LIMIT 1
      )
      WHERE survey_id IN (
        SELECT id FROM surveys WHERE rowid NOT IN (
          SELECT MAX(rowid) FROM surveys GROUP BY stakeholder_id, enumerator_id
        )
      );
    `);
    await database.executeSql(`
      DELETE FROM surveys WHERE rowid NOT IN (
        SELECT MAX(rowid) FROM surveys GROUP BY stakeholder_id, enumerator_id
      );
    `);
  } catch (e) { /* best-effort repair; never block app boot */ }
  try {
    await database.executeSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_surveys_stakeholder_enumerator
       ON surveys(stakeholder_id, enumerator_id);`
    );
  } catch (e) { /* if dupes somehow remain, don't block app boot */ }
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_queue(status);`);
  // PERF: hot sync/scan paths that were doing full table scans.
  // - media(is_synced): countUnsyncedForSurvey() and the pending-completion join
  // - media(survey_id): getBySurveyLocal()/deleteUnsyncedForSurvey() run every sync
  // - surveys(is_synced): the pending-completion LEFT JOIN
  // - stakeholders(district, city): the cascade getUniqueCities()/getUniquePins() dropdowns
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_media_is_synced ON media(is_synced);`);
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_media_survey ON media(survey_id);`);
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_surveys_is_synced ON surveys(is_synced);`);
  // PERF: the retryable queries filter on (is_synced, retry_count, next_retry_at).
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_surveys_retry ON surveys(is_synced, retry_count, next_retry_at);`);
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_media_retry ON media(is_synced, retry_count, next_retry_at);`);
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
// SHARED RETRY / BACKOFF POLICY
// ============================================================================
// Applies uniformly to sync_queue rows, survey rows and media rows so all three
// behave the same way in the UI and in the sync pipeline.
//
// Previously MAX_AUTO_RETRIES was 999, which meant nothing was ever
// dead-lettered: getDeadLetterCount() was always 0, the "stuck items" card in
// Sync Center was unreachable dead UI, and a permanently-broken item retried
// effectively forever. 8 attempts spread over the backoff schedule below spans
// roughly 9 hours of real time, which is far past any transient network issue —
// anything still failing after that needs a human to look at it.
export const MAX_AUTO_RETRIES = 8;

// Backoff in minutes indexed by retry_count. Index 0 is unused (a row with
// retry_count 0 has never failed). The final value repeats for higher counts.
export const BACKOFF_MINUTES = [0, 1, 2, 5, 15, 30, 60, 120, 240];

export function backoffMinutesFor(retryCount: number): number {
  const idx = Math.min(Math.max(retryCount, 0), BACKOFF_MINUTES.length - 1);
  return BACKOFF_MINUTES[idx];
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

  // DATA-LOSS FIX: this used to unconditionally delete every survey and media
  // row for the given stakeholders. It is called from two places:
  //   1. after a survey completes successfully (safe — everything is uploaded)
  //   2. with `lockedStakeholderIds` from GET /sync/changes (NOT safe)
  //
  // The server's changes filter is `status === 'CLOSED' || lockedById !== me`,
  // and CLOSED includes stakeholders *you* closed. So the sequence:
  //   text uploads → complete() succeeds → one photo still pending →
  //   next sync calls getChanges → that stakeholder comes back as "locked" →
  //   the pending photo row was deleted
  // silently destroyed field media with no error and no trace.
  //
  // Now: a stakeholder is only purged once it has NOTHING left to upload.
  // Any stakeholder still holding an unsynced survey or unsynced media row is
  // skipped entirely and retried on a later sync, after the uploads land.
  async removeLockedStakeholders(lockedIds: string[]): Promise<void> {
    if (lockedIds.length === 0) return;
    const database = await getDB();
    const placeholders = lockedIds.map(() => '?').join(',');

    // Find which of these stakeholders still have pending uploads.
    const [pendingRes] = await database.executeSql(
      `SELECT DISTINCT s.stakeholder_id AS sid
       FROM surveys s
       WHERE s.stakeholder_id IN (${placeholders})
         AND (
           s.is_synced = 0
           OR EXISTS (SELECT 1 FROM media m WHERE m.survey_id = s.id AND m.is_synced = 0)
         )`,
      lockedIds
    );
    const blocked = new Set<string>();
    for (let i = 0; i < pendingRes.rows.length; i++) {
      blocked.add(pendingRes.rows.item(i).sid);
    }

    const safeToPurge = lockedIds.filter(id => !blocked.has(id));
    if (blocked.size > 0) {
      console.log(
        `[Sync] Keeping ${blocked.size} stakeholder(s) locally - still have unsynced survey/media data: ${[...blocked].join(', ')}`
      );
    }
    if (safeToPurge.length === 0) return;

    const purgePlaceholders = safeToPurge.map(() => '?').join(',');

    // Delete associated media first (all fully synced at this point)
    await database.executeSql(`
      DELETE FROM media WHERE survey_id IN (
        SELECT id FROM surveys WHERE stakeholder_id IN (${purgePlaceholders})
      )
    `, safeToPurge);

    // Delete associated surveys
    await database.executeSql(`DELETE FROM surveys WHERE stakeholder_id IN (${purgePlaceholders})`, safeToPurge);

    // Finally delete stakeholders
    await database.executeSql(`DELETE FROM stakeholders WHERE id IN (${purgePlaceholders})`, safeToPurge);
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

/**
 * Count survey + media rows that have not yet reached the server.
 * Used to decide whether a logout is safe to perform destructively.
 */
export async function getUnsyncedWorkCount(): Promise<number> {
  const database = await getDB();
  const [res] = await database.executeSql(
    `SELECT
       (SELECT COUNT(*) FROM surveys WHERE is_synced = 0) +
       (SELECT COUNT(*) FROM media   WHERE is_synced = 0) AS c`
  );
  return res.rows.item(0).c ?? 0;
}

/**
 * DATA-LOSS FIX: clearAllData used to unconditionally delete surveys and media.
 * It runs from the `logout` thunk, which is also driven by the `force_logout`
 * event the axios interceptor emits on a confirmed 401/403 during token refresh.
 * That meant an ordinary expired refresh token (device idle for a while), a
 * revoked session, or a backend JWT-secret rotation destroyed every survey,
 * photo and video the enumerator had collected but not yet uploaded — a full
 * day of field work, gone, with no warning and no way back.
 *
 * A logout is a *session* boundary, not a signal that pending work is garbage.
 * So by default we now PRESERVE unsynced surveys/media (and the sync_queue rows
 * needed to push them) while still clearing the bulk cached dataset and session
 * state. The rows are re-uploaded on the next successful login.
 *
 * `force = true` performs the original total wipe. Reserve it for a deliberate,
 * user-confirmed "sign out and discard local data" action.
 */
export async function clearAllData(force: boolean = false): Promise<void> {
  if (!db) return;

  if (force) {
    console.log('🚨 [Security] Total database wipe (forced) — discarding unsynced work...');
    await db.executeSql('DELETE FROM media');
    await db.executeSql('DELETE FROM surveys');
    await db.executeSql('DELETE FROM sync_queue');
    await db.executeSql('DELETE FROM stakeholders');
    await db.executeSql('DELETE FROM app_state');
    await db.executeSql('DELETE FROM facilities');
    console.log('✅ [Security] All local data purged from the device.');
    return;
  }

  const pending = await getUnsyncedWorkCount();

  // Always safe to drop: the bulk read-only cache and session/app state.
  // NOTE: initial_sync_done lives in app_state, so clearing it means the next
  // login re-downloads stakeholders + facilities. That is intentional — the
  // next user of this device may be assigned different districts.
  await db.executeSql('DELETE FROM facilities');
  await db.executeSql('DELETE FROM app_state');

  if (pending > 0) {
    // Preserve the survey/media rows still awaiting upload, and the stakeholders
    // they reference (the sync pipeline reads stakeholder_id off those rows, and
    // the Sync Center surfaces them to the user).
    console.log(`[Security] Preserving ${pending} unsynced item(s) across logout.`);

    await db.executeSql(`DELETE FROM media WHERE is_synced = 1`);
    await db.executeSql(`
      DELETE FROM surveys
      WHERE is_synced = 1
        AND id NOT IN (SELECT DISTINCT survey_id FROM media WHERE is_synced = 0)
    `);
    await db.executeSql(`
      DELETE FROM stakeholders
      WHERE id NOT IN (SELECT DISTINCT stakeholder_id FROM surveys WHERE stakeholder_id IS NOT NULL)
    `);
    // sync_queue is left intact — it holds the pending stakeholder edits/uploads.
    console.log('✅ [Security] Cached data cleared; unsynced field work retained.');
    return;
  }

  // Nothing pending — safe to clear everything.
  await db.executeSql('DELETE FROM media');
  await db.executeSql('DELETE FROM surveys');
  await db.executeSql('DELETE FROM sync_queue');
  await db.executeSql('DELETE FROM stakeholders');
  console.log('✅ [Security] All local data purged from the device (nothing was pending).');
}

// ============================================================================
// SURVEY DAO
// ============================================================================

export const surveyDao = {
  /**
   * Resolve the canonical local row id for a (stakeholder, enumerator) pair.
   * Returns null when no local row exists yet.
   *
   * DATA-INTEGRITY FIX: save() must reuse the existing row's id rather than
   * inserting under a freshly generated one. Relying on the unique index to
   * collapse the conflict would be wrong: INSERT OR REPLACE resolves a unique
   * violation by DELETING the old row and inserting the new one, so the survey
   * would come back with a different id and every media row still pointing at
   * the old id would be orphaned — those photos could never upload.
   */
  async findLocalId(stakeholderId: string, enumeratorId: string): Promise<string | null> {
    const database = await getDB();
    const [res] = await database.executeSql(
      `SELECT id FROM surveys WHERE stakeholder_id = ? AND enumerator_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [stakeholderId, enumeratorId]
    );
    return res.rows.length > 0 ? res.rows.item(0).id : null;
  },

  async save(survey: any): Promise<string> {
    const database = await getDB();
    // Reuse the existing local row for this stakeholder+enumerator if there is
    // one, so repeated saves update in place and keep media attached.
    const existingId =
      survey.stakeholderId && survey.enumeratorId
        ? await this.findLocalId(survey.stakeholderId, survey.enumeratorId)
        : null;
    const id =
      survey.id ||
      existingId ||
      `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await database.executeSql(
      `INSERT OR REPLACE INTO surveys (id, stakeholder_id, enumerator_id,
        mobile_number, email, business_category,
        latitude, longitude, gps_accuracy, nearest_police_station,
        nearest_healthcare_center, is_draft, is_completed, is_synced,
        sub_categories, business_name, owner_name, district, city, pin_code,
        business_address, aadhar_number, udyam_aadhar_reg_no, pan_number,
        description, accommodation_facilities, accommodation_policies, working_hours,
        rooms, about_business,
        agreed_to_terms, declared_info_correct, acknowledged_dot_liability, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      [id, survey.stakeholderId, survey.enumeratorId,
       survey.mobileNumber, survey.email, survey.businessCategory,
       survey.latitude, survey.longitude, survey.gpsAccuracy,
       survey.nearestPoliceStation, survey.nearestHealthcareCenter,
       survey.isDraft ? 1 : 0, survey.isCompleted ? 1 : 0, survey.isSynced ? 1 : 0,
       // Step 1
       survey.subCategories ? JSON.stringify(survey.subCategories) : null,
       // Step 2
       survey.businessName || null, survey.ownerName || null, survey.district || null,
       survey.city || null, survey.pinCode || null,
       survey.businessAddress || null,
       survey.aadharNumber || null, survey.udyamAadharRegNo || null, survey.panNumber || null,
       // Step 4
       survey.description || null,
       survey.accommodationFacilities ? JSON.stringify(survey.accommodationFacilities) : null,
       survey.accommodationPolicies || null,
       survey.workingHours ? JSON.stringify(survey.workingHours) : null,
       // Step 5
       survey.rooms ? JSON.stringify(survey.rooms) : null,
       // Step 7
       survey.aboutBusiness || null,
       // Step 8
       survey.agreedToTerms ? 1 : 0,
       survey.declaredInfoCorrect ? 1 : 0,
       survey.acknowledgedDotLiability ? 1 : 0]
    );
    // Return the id actually written so the caller attaches media to the right row.
    return id;
  },

  async getByStakeholder(stakeholderId: string): Promise<any> {
    const database = await getDB();
    const [results] = await database.executeSql(
      'SELECT * FROM surveys WHERE stakeholder_id = ? ORDER BY updated_at DESC LIMIT 1',
      [stakeholderId]
    );
    return results.rows.length > 0 ? results.rows.item(0) : null;
  },

  /**
   * SYNC RELIABILITY FIX: surveys eligible for an upload attempt right now.
   * Excludes rows whose backoff window has not elapsed and rows that exhausted
   * MAX_AUTO_RETRIES (dead-lettered — they need explicit user action).
   *
   * The pipeline previously used getUnsynced() with no notion of retry state,
   * so a permanently-failing survey was re-attempted every 3 seconds forever.
   */
  async getRetryable(): Promise<any[]> {
    const database = await getDB();
    const [results] = await database.executeSql(
      `SELECT * FROM surveys
       WHERE is_synced = 0
         AND retry_count < ?
         AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))`,
      [MAX_AUTO_RETRIES]
    );
    const rows = [];
    for (let i = 0; i < results.rows.length; i++) rows.push(results.rows.item(i));
    return rows;
  },

  /** Record a failed attempt and schedule the next one with exponential backoff. */
  async markFailed(id: string, error: string): Promise<void> {
    const database = await getDB();
    const [res] = await database.executeSql('SELECT retry_count FROM surveys WHERE id = ?', [id]);
    const current = res.rows.length > 0 ? (res.rows.item(0).retry_count ?? 0) : 0;
    const next = current + 1;
    const mins = backoffMinutesFor(next);
    await database.executeSql(
      `UPDATE surveys
       SET retry_count = ?, last_error = ?, next_retry_at = datetime('now', '+' || ? || ' minutes')
       WHERE id = ?`,
      [next, (error || '').substring(0, 500), mins, id]
    );
  },

  /** Clear retry state after a successful upload so the row starts clean if reused. */
  async clearRetryState(id: string): Promise<void> {
    const database = await getDB();
    await database.executeSql(
      `UPDATE surveys SET retry_count = 0, next_retry_at = NULL, last_error = NULL WHERE id = ?`,
      [id]
    );
  },

  /**
   * Dead-letter immediately without burning through the retry budget.
   * Used when the server returns a considered rejection (4xx) that no amount of
   * retrying will change — a validation failure, a district/ownership denial, or
   * a stakeholder already completed by another enumerator.
   */
  async markUnrecoverable(id: string, reason: string): Promise<void> {
    const database = await getDB();
    await database.executeSql(
      `UPDATE surveys SET retry_count = ?, last_error = ?, next_retry_at = NULL WHERE id = ?`,
      [MAX_AUTO_RETRIES, (reason || '').substring(0, 500), id]
    );
  },

  // The four counters below key off `is_completed = 0` rather than `is_synced = 0`
  // so they cover BOTH incomplete phases a survey can get stuck in:
  //   • text payload not yet uploaded      (is_synced = 0)
  //   • uploaded but complete() failing    (is_synced = 1, is_completed = 0)

  /** Surveys still auto-retrying (under the cap). */
  async getFailedCount(): Promise<number> {
    const database = await getDB();
    const [res] = await database.executeSql(
      `SELECT COUNT(*) as count FROM surveys
       WHERE is_completed = 0 AND retry_count > 0 AND retry_count < ?`,
      [MAX_AUTO_RETRIES]
    );
    return res.rows.item(0).count ?? 0;
  },

  /** Surveys that exhausted automatic retries and need user action. */
  async getDeadLetterCount(): Promise<number> {
    const database = await getDB();
    const [res] = await database.executeSql(
      `SELECT COUNT(*) as count FROM surveys WHERE is_completed = 0 AND retry_count >= ?`,
      [MAX_AUTO_RETRIES]
    );
    return res.rows.item(0).count ?? 0;
  },

  /** Bypass the backoff window for all auto-retrying surveys (manual "retry now"). */
  async retryAllFailedNow(): Promise<number> {
    const database = await getDB();
    const [res] = await database.executeSql(
      `UPDATE surveys SET next_retry_at = datetime('now') WHERE is_completed = 0 AND retry_count < ?`,
      [MAX_AUTO_RETRIES]
    );
    return res?.rowsAffected ?? 0;
  },

  /** Re-arm dead-lettered surveys with a fresh retry budget. */
  async resetDeadLetters(): Promise<number> {
    const database = await getDB();
    const [res] = await database.executeSql(
      `UPDATE surveys SET retry_count = 0, next_retry_at = NULL WHERE is_completed = 0 AND retry_count >= ?`,
      [MAX_AUTO_RETRIES]
    );
    return res?.rowsAffected ?? 0;
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
    //
    // SYNC RELIABILITY FIX: this path also needs retry bounds. If complete()
    // fails permanently — e.g. the server returns 409 because another enumerator
    // locked the stakeholder, or validation rejects the survey — the row sits at
    // is_synced=1 / is_completed=0 forever and was re-attempted on every single
    // sync pass with no backoff and no dead-lettering. Same runaway loop as the
    // media case, just via a different route.
    const [results] = await database.executeSql(
      `SELECT s.*
       FROM surveys s
       LEFT JOIN media m ON m.survey_id = s.id AND m.is_synced = 0
       WHERE s.is_synced = 1
         AND s.is_completed = 0
         AND m.id IS NULL
         AND s.retry_count < ?
         AND (s.next_retry_at IS NULL OR s.next_retry_at <= datetime('now'))`,
      [MAX_AUTO_RETRIES]
    );
    const rows = [];
    for (let i = 0; i < results.rows.length; i++) rows.push(results.rows.item(i));
    return rows;
  },


};

export const mediaDao = {
  /**
   * DUPLICATE-UPLOAD FIX: the id used to be `local_media_<timestamp>_<random>`
   * whenever the caller did not supply one. SurveyFormScreen's saveMediaToDb()
   * never supplies one, so every re-save of the same form inserted a fresh row
   * for the same photo — the file was then uploaded to S3 twice (or more) and
   * appeared duplicated in the admin panel.
   *
   * A survey holds at most one photo per category and one walkthrough video, so
   * (survey_id, type, photo_category) is a natural key. Deriving the id from it
   * makes INSERT OR REPLACE overwrite the previous row in place, which is what
   * "the user retook this photo" should mean.
   *
   * An explicit `media.id` still wins, so callers that manage their own ids
   * (and rows already on disk) are unaffected.
   */
  async save(media: any): Promise<string> {
    const database = await getDB();
    const naturalKey = media.surveyId
      ? `m_${media.surveyId}_${media.type}_${media.photoCategory || 'main'}`
      : null;
    const id =
      media.id ||
      naturalKey ||
      `local_media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Use INSERT ... ON CONFLICT to preserve retry state when re-saving.
    // INSERT OR REPLACE does DELETE-then-INSERT internally, so subqueries
    // referencing the old row would always return NULL — wiping retry state.
    // ON CONFLICT ... DO UPDATE avoids the DELETE entirely: it updates the
    // existing row in place, which keeps retry_count/next_retry_at/last_error
    // intact when the user retakes a photo.
    await database.executeSql(
      `INSERT INTO media (id, survey_id, stakeholder_id, type, photo_category, file_path, file_name, file_size, mime_type, latitude, longitude, gps_accuracy, captured_at, duration, thumbnail_path, is_synced, retry_count, next_retry_at, last_error)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,NULL,NULL)
      ON CONFLICT(id) DO UPDATE SET
        survey_id = excluded.survey_id,
        stakeholder_id = excluded.stakeholder_id,
        type = excluded.type,
        photo_category = excluded.photo_category,
        file_path = excluded.file_path,
        file_name = excluded.file_name,
        file_size = excluded.file_size,
        mime_type = excluded.mime_type,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        gps_accuracy = excluded.gps_accuracy,
        captured_at = excluded.captured_at,
        duration = excluded.duration,
        thumbnail_path = excluded.thumbnail_path,
        is_synced = excluded.is_synced`,
      [id, media.surveyId, media.stakeholderId || null, media.type, media.photoCategory,
       media.filePath, media.fileName, media.fileSize, media.mimeType,
       media.latitude, media.longitude, media.gpsAccuracy, media.capturedAt,
       media.duration, media.thumbnailPath, media.isSynced ? 1 : 0]
    );
    return id;
  },

  /**
   * SYNC RELIABILITY FIX: media eligible for an upload attempt right now.
   * This is what stops the runaway loop the GST_DOC enum error produced: an
   * unknown photo_category made the server return 500 on every attempt, and
   * with no retry state the pipeline re-uploaded that same file every 3 seconds
   * indefinitely.
   */
  async getRetryable(): Promise<any[]> {
    const db = await getDB();
    const [results] = await db.executeSql(
      `SELECT * FROM media
       WHERE is_synced = 0
         AND retry_count < ?
         AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))`,
      [MAX_AUTO_RETRIES]
    );
    const rows = [];
    for (let i = 0; i < results.rows.length; i++) rows.push(results.rows.item(i));
    return rows;
  },

  async markFailed(id: string, error: string): Promise<void> {
    const db = await getDB();
    const [res] = await db.executeSql('SELECT retry_count FROM media WHERE id = ?', [id]);
    const current = res.rows.length > 0 ? (res.rows.item(0).retry_count ?? 0) : 0;
    const next = current + 1;
    const mins = backoffMinutesFor(next);
    await db.executeSql(
      `UPDATE media
       SET retry_count = ?, last_error = ?, next_retry_at = datetime('now', '+' || ? || ' minutes')
       WHERE id = ?`,
      [next, (error || '').substring(0, 500), mins, id]
    );
  },

  async getFailedCount(): Promise<number> {
    const db = await getDB();
    const [res] = await db.executeSql(
      `SELECT COUNT(*) as count FROM media WHERE is_synced = 0 AND retry_count > 0 AND retry_count < ?`,
      [MAX_AUTO_RETRIES]
    );
    return res.rows.item(0).count ?? 0;
  },

  async getDeadLetterCount(): Promise<number> {
    const db = await getDB();
    const [res] = await db.executeSql(
      `SELECT COUNT(*) as count FROM media WHERE is_synced = 0 AND retry_count >= ?`,
      [MAX_AUTO_RETRIES]
    );
    return res.rows.item(0).count ?? 0;
  },

  async retryAllFailedNow(): Promise<number> {
    const db = await getDB();
    const [res] = await db.executeSql(
      `UPDATE media SET next_retry_at = datetime('now') WHERE is_synced = 0 AND retry_count < ?`,
      [MAX_AUTO_RETRIES]
    );
    return res?.rowsAffected ?? 0;
  },

  async resetDeadLetters(): Promise<number> {
    const db = await getDB();
    const [res] = await db.executeSql(
      `UPDATE media SET retry_count = 0, next_retry_at = NULL WHERE is_synced = 0 AND retry_count >= ?`,
      [MAX_AUTO_RETRIES]
    );
    return res?.rowsAffected ?? 0;
  },

  /**
   * Rows that are permanently unuploadable because their local file is gone
   * (camera cache evicted by Android, user cleared storage). Detected by the
   * pipeline and dead-lettered immediately rather than retried 8 times.
   */
  async markUnrecoverable(id: string, reason: string): Promise<void> {
    const db = await getDB();
    await db.executeSql(
      `UPDATE media SET retry_count = ?, last_error = ?, next_retry_at = NULL WHERE id = ?`,
      [MAX_AUTO_RETRIES, (reason || '').substring(0, 500), id]
    );
  },

  /**
   * Drop not-yet-uploaded media rows for a survey.
   *
   * Called right before the form writes its current photo/video set. Any
   * unsynced row that is not part of that set is stale — either a retake the
   * user replaced, or a row created under the old random-id scheme before media
   * ids became derived from (survey, type, category). Without this, upgrading
   * mid-survey would leave the old random-id row behind and the same photo would
   * upload twice.
   *
   * Rows already marked synced are left alone: they are on the server and their
   * S3 objects must not be re-uploaded.
   */
  async deleteUnsyncedForSurvey(surveyId: string): Promise<number> {
    const db = await getDB();
    const [res] = await db.executeSql(
      'DELETE FROM media WHERE survey_id = ? AND is_synced = 0',
      [surveyId]
    );
    return res?.rowsAffected ?? 0;
  },

  /**
   * Unsynced media for one survey, regardless of retry/backoff state.
   *
   * The pipeline checks this before calling complete(): a file sitting inside a
   * backoff window is absent from getRetryable(), so without this check the
   * survey would look "fully uploaded" and get completed while a photo was still
   * outstanding. The server locks the survey on completion, which would strand
   * that file permanently.
   */
  async countUnsyncedForSurvey(surveyId: string): Promise<number> {
    const db = await getDB();
    const [res] = await db.executeSql(
      'SELECT COUNT(*) as count FROM media WHERE survey_id = ? AND is_synced = 0',
      [surveyId]
    );
    return res.rows.item(0).count ?? 0;
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

// Retry policy now lives in one place (MAX_AUTO_RETRIES / BACKOFF_MINUTES near
// the top of this file) and is shared by sync_queue, surveys and media so all
// three dead-letter consistently and the Sync Center counts mean the same thing
// for every entity type.

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
    const backoffMinutes = backoffMinutesFor(newRetryCount);

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

  /**
   * Dead-letter a queue item immediately, skipping the remaining retry budget.
   * Used for 4xx rejections that retrying cannot fix.
   */
  async markDead(id: number, error: string): Promise<void> {
    const database = await getDB();
    await database.executeSql(
      `UPDATE sync_queue
       SET status = 'FAILED', retry_count = ?, error_message = ?, next_retry_at = NULL
       WHERE id = ?`,
      [MAX_AUTO_RETRIES, (error || '').substring(0, 500), id]
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

  // Counts distinct surveys that still have work to push. Dead-lettered rows are
  // excluded so "Pending Uploads" and "Stuck" don't double-count the same item —
  // an item that exhausted its retries is reported as stuck, not pending.
  async getLogicalPendingCount(): Promise<number> {
    const database = await getDB();
    const [syncQueueResult] = await database.executeSql(
      "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING' AND entity_type != 'survey'"
    );
    const pendingSyncQueue = syncQueueResult.rows.item(0).count ?? 0;

    const [surveyResult] = await database.executeSql(`
      SELECT COUNT(DISTINCT id) as count FROM (
        SELECT id FROM surveys WHERE is_synced = 0 AND retry_count < ?
        UNION
        SELECT survey_id as id FROM media WHERE is_synced = 0 AND retry_count < ?
      )
    `, [MAX_AUTO_RETRIES, MAX_AUTO_RETRIES]);
    const pendingSurveys = surveyResult.rows.item(0).count ?? 0;

    return pendingSyncQueue + pendingSurveys;
  },

  // SYNC FIX: "failed" now specifically means "still retrying automatically" —
  // distinct from dead-lettered, so the count the user sees isn't alarming for
  // something that's already self-healing in the background.
  //
  // VISIBILITY FIX: these used to read sync_queue ONLY. Surveys and media track
  // their own state, so a photo failing forever was reported as "Pending" and
  // never as failed or stuck — the user had no signal that anything was wrong
  // and no button to act on it. Both counts now aggregate all three sources.
  async getFailedCount(): Promise<number> {
    const database = await getDB();
    const [results] = await database.executeSql(
      "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'FAILED' AND retry_count < ?",
      [MAX_AUTO_RETRIES]
    );
    const queueFailed = results.rows.item(0).count ?? 0;
    const [surveyFailed, mediaFailed] = await Promise.all([
      surveyDao.getFailedCount(),
      mediaDao.getFailedCount(),
    ]);
    return queueFailed + surveyFailed + mediaFailed;
  },

  // SYNC FIX: items that exhausted MAX_AUTO_RETRIES and need manual attention.
  async getDeadLetterCount(): Promise<number> {
    const database = await getDB();
    const [results] = await database.executeSql(
      "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'FAILED' AND retry_count >= ?",
      [MAX_AUTO_RETRIES]
    );
    const queueDead = results.rows.item(0).count ?? 0;
    const [surveyDead, mediaDead] = await Promise.all([
      surveyDao.getDeadLetterCount(),
      mediaDao.getDeadLetterCount(),
    ]);
    return queueDead + surveyDead + mediaDead;
  },

  /**
   * Bypass the backoff window across sync_queue, surveys and media.
   * Backs the Sync Center's "retry now" link.
   */
  async retryEverythingNow(): Promise<number> {
    const [q, s, m] = await Promise.all([
      this.retryAllFailedNow(),
      surveyDao.retryAllFailedNow(),
      mediaDao.retryAllFailedNow(),
    ]);
    return q + s + m;
  },

  /**
   * Re-arm dead-lettered items across sync_queue, surveys and media.
   * Backs the Sync Center's "Retry Stuck Items" button.
   */
  async resetAllDeadLetters(): Promise<number> {
    const [q, s, m] = await Promise.all([
      this.resetDeadLetters(),
      surveyDao.resetDeadLetters(),
      mediaDao.resetDeadLetters(),
    ]);
    return q + s + m;
  },

  /**
   * Human-readable detail for the items that are stuck, so the Sync Center can
   * tell the user *what* is failing and *why* instead of just a number.
   */
  async getStuckItemDetails(): Promise<Array<{ kind: string; id: string; error: string }>> {
    const database = await getDB();
    const out: Array<{ kind: string; id: string; error: string }> = [];

    const [sRes] = await database.executeSql(
      `SELECT id, business_name, last_error FROM surveys WHERE is_synced = 0 AND retry_count >= ?`,
      [MAX_AUTO_RETRIES]
    );
    for (let i = 0; i < sRes.rows.length; i++) {
      const r = sRes.rows.item(i);
      out.push({ kind: 'Survey', id: r.business_name || r.id, error: r.last_error || 'Unknown error' });
    }

    const [mRes] = await database.executeSql(
      `SELECT id, type, photo_category, last_error FROM media WHERE is_synced = 0 AND retry_count >= ?`,
      [MAX_AUTO_RETRIES]
    );
    for (let i = 0; i < mRes.rows.length; i++) {
      const r = mRes.rows.item(i);
      out.push({
        kind: r.type === 'VIDEO' ? 'Video' : `Photo (${r.photo_category || 'uncategorised'})`,
        id: r.id,
        error: r.last_error || 'Unknown error',
      });
    }

    const [qRes] = await database.executeSql(
      `SELECT id, entity_type, error_message FROM sync_queue WHERE status = 'FAILED' AND retry_count >= ?`,
      [MAX_AUTO_RETRIES]
    );
    for (let i = 0; i < qRes.rows.length; i++) {
      const r = qRes.rows.item(i);
      out.push({ kind: r.entity_type, id: String(r.id), error: r.error_message || 'Unknown error' });
    }

    return out;
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