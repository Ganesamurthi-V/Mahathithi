import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

let db: SQLite.SQLiteDatabase;

export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;

  db = await SQLite.openDatabase({
    name: 'mahaatithi.db',
    location: 'default',
  });

  await runMigrations(db);
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

  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS surveys (
      id TEXT PRIMARY KEY,
      stakeholder_id TEXT NOT NULL,
      enumerator_id TEXT NOT NULL,
      contact_person TEXT,
      designation TEXT,
      mobile_number TEXT,
      email TEXT,
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

  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      survey_id TEXT NOT NULL,
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
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

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
  await database.executeSql(`CREATE INDEX IF NOT EXISTS idx_facilities_type ON facilities(type);`);
}

export async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (!db) return initDatabase();
  return db;
}

// ============================================================================
// STAKEHOLDER DAO
// ============================================================================

export const stakeholderDao = {
  async upsertMany(stakeholders: any[]): Promise<void> {
    const database = await getDB();
    for (const s of stakeholders) {
      await database.executeSql(
        `INSERT OR REPLACE INTO stakeholders (id, primary_key_id, uin, data_source, cin_number,
          gst_number, tin_number, company_name_standardized, company_name_original,
          full_address_raw, address_line_1, address_line_2, city, taluka, village, district, state, pin_code,
          nic_code, nic_description, category, priority_weight, company_class, company_status,
          company_category, authorized_capital, paidup_capital, listing_status, registration_date,
          fuzzy_similarity_score, cross_source_match, human_review_required, dedup_match_status,
          source_lineage_notes, status, locked_by_id, locked_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [s.id, s.primaryKeyId, s.uin, s.dataSource, s.cinNumber,
         s.gstNumber, s.tinNumber, s.companyNameStandardized, s.companyNameOriginal,
         s.fullAddressRaw, s.addressLine1, s.addressLine2, s.city, s.taluka, s.village, s.district, s.state, s.pinCode,
         s.nicCode, s.nicDescription, s.category, s.priorityWeight, s.companyClass, s.companyStatus,
         s.companyCategory, s.authorizedCapital, s.paidupCapital, s.listingStatus, s.registrationDate,
         s.fuzzySimilarityScore, s.crossSourceMatch, s.humanReviewRequired, s.dedupMatchStatus,
         s.sourceLineageNotes, s.status, s.lockedById, s.lockedAt, s.updatedAt]
      );
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

    const [results] = await database.executeSql(
      `SELECT * FROM stakeholders ${whereClause} ORDER BY priority_weight DESC, company_name_standardized ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const rows = [];
    for (let i = 0; i < results.rows.length; i++) {
      rows.push(results.rows.item(i));
    }
    return rows;
  },

  async getById(id: string): Promise<any> {
    const database = await getDB();
    const [results] = await database.executeSql('SELECT * FROM stakeholders WHERE id = ?', [id]);
    return results.rows.length > 0 ? results.rows.item(0) : null;
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

// ============================================================================
// SURVEY DAO
// ============================================================================

export const surveyDao = {
  async save(survey: any): Promise<void> {
    const database = await getDB();
    const id = survey.id || `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await database.executeSql(
      `INSERT OR REPLACE INTO surveys (id, stakeholder_id, enumerator_id, contact_person,
        designation, mobile_number, email, website, business_category, notes, gst_number,
        organization_type, remarks, latitude, longitude, gps_accuracy, nearest_police_station, 
        nearest_healthcare_center, is_draft, is_completed, is_synced, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      [id, survey.stakeholderId, survey.enumeratorId, survey.contactPerson,
       survey.designation, survey.mobileNumber, survey.email, survey.website,
       survey.businessCategory, survey.notes, survey.gstNumber,
       survey.organizationType, survey.remarks, survey.latitude, survey.longitude,
       survey.gpsAccuracy, survey.nearestPoliceStation, survey.nearestHealthcareCenter,
       survey.isDraft ? 1 : 0, survey.isCompleted ? 1 : 0,
       survey.isSynced ? 1 : 0]
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

  async markSynced(id: string): Promise<void> {
    const database = await getDB();
    await database.executeSql('UPDATE surveys SET is_synced = 1 WHERE id = ?', [id]);
  },
};

// ============================================================================
// MEDIA DAO
// ============================================================================

export const mediaDao = {
  async save(media: any): Promise<void> {
    const database = await getDB();
    const id = media.id || `local_media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await database.executeSql(
      `INSERT OR REPLACE INTO media (id, survey_id, type, photo_category, file_path, file_name, file_size, mime_type, latitude, longitude, gps_accuracy, captured_at, duration, thumbnail_path, is_synced)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, media.surveyId, media.type, media.photoCategory, media.filePath, media.fileName, media.fileSize, media.mimeType, media.latitude, media.longitude, media.gpsAccuracy, media.capturedAt, media.duration, media.thumbnailPath, media.isSynced ? 1 : 0]
    );
  },

  async getUnsynced(): Promise<any[]> {
    const db = await getDB();
    const [results] = await db.executeSql(`SELECT * FROM media WHERE is_synced = 0`);
    return results.rows.raw();
  },
  async markSynced(id: string): Promise<void> {
    const db = await getDB();
    await db.executeSql(`UPDATE media SET is_synced = 1 WHERE id = ?`, [id]);
  }
};

// ============================================================================
// FACILITY DAO
// ============================================================================
export const facilityDao = {
  async upsertMany(facilities: any[]): Promise<void> {
    const db = await getDB();
    await db.transaction(async (tx) => {
      for (const f of facilities) {
        await tx.executeSql(
          `INSERT OR REPLACE INTO facilities (id, name, type, district, state, latitude, longitude)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [f.id, f.name, f.type, f.district, f.state, f.latitude, f.longitude]
        );
      }
    });
  },
  async getNearest(lat: number, lng: number, type: string): Promise<any> {
    const db = await getDB();
    // Simplified Pythagorean distance for local offline querying (sufficient for small scale)
    const [results] = await db.executeSql(
      `SELECT *, 
        ((latitude - ?) * (latitude - ?) + (longitude - ?) * (longitude - ?)) as distanceSq
       FROM facilities 
       WHERE type = ?
       ORDER BY distanceSq ASC 
       LIMIT 10`,
      [lat, lat, lng, lng, type]
    );
    return results.rows.raw();
  }
};

// ============================================================================
// SYNC QUEUE DAO
// ============================================================================

export const syncQueueDao = {
  async add(entityType: string, entityId: string, action: string, payload: any): Promise<void> {
    const database = await getDB();
    await database.executeSql(
      'INSERT INTO sync_queue (entity_type, entity_id, action, payload) VALUES (?,?,?,?)',
      [entityType, entityId, action, JSON.stringify(payload)]
    );
  },

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

  async markFailed(id: number, error: string): Promise<void> {
    const database = await getDB();
    await database.executeSql(
      "UPDATE sync_queue SET status = 'FAILED', retry_count = retry_count + 1, error_message = ? WHERE id = ?",
      [error, id]
    );
  },

  async getPendingCount(): Promise<number> {
    const database = await getDB();
    const [results] = await database.executeSql("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING'");
    return results.rows.item(0).count;
  },

  async getFailedCount(): Promise<number> {
    const database = await getDB();
    const [results] = await database.executeSql("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'FAILED'");
    return results.rows.item(0).count;
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
