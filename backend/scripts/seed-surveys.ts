/**
 * Seed fully-completed surveys through the real HTTP API.
 *
 * Drives the same endpoints the mobile app uses, so the resulting records are
 * indistinguishable from ones an enumerator produced by hand: every survey field
 * populated, all nine media files uploaded to S3, and complete() called so the
 * stakeholder is CLOSED and the survey passes server-side validation.
 *
 *   npx tsx scripts/seed-surveys.ts                     # 11 surveys, default API
 *   npx tsx scripts/seed-surveys.ts --count 3           # fewer
 *   npx tsx scripts/seed-surveys.ts --dry-run           # plan only, no writes
 *   npx tsx scripts/seed-surveys.ts --api http://localhost:3000/api
 *   npx tsx scripts/seed-surveys.ts --id test --pass 'enum@123'
 *
 * ── Why the API and not direct Prisma writes ──────────────────────────────────
 * Writing rows straight to Postgres would be far quicker but would prove nothing:
 * it would skip Zod validation, the S3 upload path, the magic-byte file check, the
 * completeSurvey() validators and the realtime broadcast. Going through HTTP means
 * a survey that lands here is genuinely valid, and a schema or validation
 * regression makes this script fail loudly instead of silently producing data the
 * real app could never create.
 *
 * ── Which endpoint creates the survey ────────────────────────────────────────
 * POST /api/sync/upload, not POST /api/surveys. createSurveySchema is .strict()
 * and does NOT list aadharNumber or udyamAadharRegNo, so posting a complete survey
 * there fails with a 400. syncSurveyItemSchema uses .passthrough() and
 * sync.service.ts maps both fields, which is why the mobile app's own save path
 * goes through sync. See the note printed at the end of a run.
 */
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';

// ────────────────────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────────────────────

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const API_BASE   = (arg('api', 'https://mahathithi-production.up.railway.app/api') as string).replace(/\/+$/, '');
const LOGIN_ID   = arg('id', 'test') as string;
const PASSWORD   = arg('pass', 'enum@123') as string;
const TARGET     = parseInt(arg('count', '11') as string, 10);
const DRY_RUN    = has('dry-run');
const DOCS_DIR   = path.resolve(__dirname, '../../docs');

// ────────────────────────────────────────────────────────────────────────────
// Source files
// ────────────────────────────────────────────────────────────────────────────

/**
 * Locate the sample assets by extension rather than exact filename, so renaming
 * a file in docs/ (or dropping in a different photo) does not break the script.
 */
function findAsset(extensions: string[], label: string): string {
  if (!fs.existsSync(DOCS_DIR)) throw new Error(`docs folder not found at ${DOCS_DIR}`);
  const hit = fs.readdirSync(DOCS_DIR).find((f) =>
    extensions.some((e) => f.toLowerCase().endsWith(e))
  );
  if (!hit) throw new Error(`No ${label} (${extensions.join('/')}) found in ${DOCS_DIR}`);
  return path.join(DOCS_DIR, hit);
}

const PHOTO_PATH = findAsset(['.jpg', '.jpeg', '.png'], 'photo');
const VIDEO_PATH = findAsset(['.mp4', '.mov', '.3gp'], 'video');
const DOC_PATH   = findAsset(['.pdf', '.docx', '.doc'], 'document');

// Read once and reuse for all 99 uploads rather than re-reading per request.
const PHOTO_BUF = fs.readFileSync(PHOTO_PATH);
const VIDEO_BUF = fs.readFileSync(VIDEO_PATH);
const DOC_BUF   = fs.readFileSync(DOC_PATH);

const PHOTO_MIME = PHOTO_PATH.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
const VIDEO_MIME = VIDEO_PATH.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
const DOC_MIME   = DOC_PATH.toLowerCase().endsWith('.pdf')
  ? 'application/pdf'
  : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Every media slot the form collects.
 *
 * PHOTO: the four the form marks required plus ADDITIONAL, which is optional but
 * included so nothing the UI offers is left empty.
 * DOCUMENT: the three required uploads from Step 7.
 * VIDEO: the walkthrough, required by completeSurvey().
 */
const MEDIA_SLOTS: { type: 'PHOTO' | 'VIDEO' | 'DOCUMENT'; category?: string; name: string }[] = [
  { type: 'PHOTO',    category: 'BUILDING_FRONT',         name: 'building_front' },
  { type: 'PHOTO',    category: 'SIGNBOARD',              name: 'signboard' },
  { type: 'PHOTO',    category: 'INTERIOR',               name: 'interior' },
  { type: 'PHOTO',    category: 'STAKEHOLDER',            name: 'stakeholder' },
  { type: 'PHOTO',    category: 'ADDITIONAL',             name: 'additional' },
  { type: 'VIDEO',    category: undefined,                name: 'walkthrough' },
  { type: 'DOCUMENT', category: 'GST_DOC',                name: 'gst_certificate' },
  { type: 'DOCUMENT', category: 'PAN_CARD_DOC',           name: 'pan_card' },
  { type: 'DOCUMENT', category: 'ESTABLISHMENT_CERT_DOC', name: 'establishment_cert' },
];

// ────────────────────────────────────────────────────────────────────────────
// Rate limiting
// ────────────────────────────────────────────────────────────────────────────
// The server enforces two limits that this script would otherwise blow straight
// through: uploadLimiter allows 30 uploads per 60s, and generalLimiter allows
// RATE_LIMIT_MAX_REQUESTS (100 by default) per 60s. Eleven surveys need 99
// uploads plus ~33 other calls, so pacing is mandatory rather than polite.
//
// A sliding-window gate is used instead of a fixed sleep so the script runs as
// fast as the limits genuinely allow, and 429s are still retried in case another
// client is consuming part of the same budget.

class SlidingWindow {
  private hits: number[] = [];
  constructor(private max: number, private windowMs: number, private label: string) {}

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.hits = this.hits.filter((t) => now - t < this.windowMs);
      if (this.hits.length < this.max) {
        this.hits.push(now);
        return;
      }
      const waitMs = this.windowMs - (now - this.hits[0]) + 250;
      process.stdout.write(`\n   [${this.label} limit reached — pausing ${Math.ceil(waitMs / 1000)}s] `);
      await sleep(waitMs);
    }
  }
}

// Deliberately under the server's ceilings to leave headroom for the admin panel
// or a phone syncing at the same time.
const uploadGate  = new SlidingWindow(26, 60_000, 'upload');
const generalGate = new SlidingWindow(80, 60_000, 'request');

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let accessToken = '';

interface ReqOptions {
  method?: string;
  body?: any;
  form?: FormData;
  isUpload?: boolean;
  retries?: number;
}

async function api(pathname: string, opts: ReqOptions = {}): Promise<any> {
  const { method = 'GET', body, form, isUpload = false, retries = 4 } = opts;

  for (let attempt = 1; ; attempt++) {
    await (isUpload ? uploadGate : generalGate).take();

    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (body) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await fetch(`${API_BASE}${pathname}`, {
        method,
        headers,
        body: form ? (form as any) : body ? JSON.stringify(body) : undefined,
      });
    } catch (err: any) {
      // Transport failure (DNS, socket reset). Worth retrying — the server may
      // simply be cold-starting on Railway.
      if (attempt <= retries) {
        await sleep(1500 * attempt);
        continue;
      }
      throw new Error(`${method} ${pathname} — network error: ${err.message}`);
    }

    if (res.status === 429) {
      // Respect Retry-After when present, otherwise back off progressively.
      const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 15_000 * attempt;
      if (attempt <= retries) {
        process.stdout.write(`\n   [429 from server — waiting ${Math.ceil(waitMs / 1000)}s] `);
        await sleep(waitMs);
        continue;
      }
    }

    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON error page */ }

    if (!res.ok) {
      const detail = json?.error?.details
        ? (Array.isArray(json.error.details) ? json.error.details.join('; ') : json.error.details)
        : json?.error?.message || text.slice(0, 200);
      // 5xx is worth one more try; 4xx is a considered rejection.
      if (res.status >= 500 && attempt <= retries) {
        await sleep(2000 * attempt);
        continue;
      }
      throw new Error(`${method} ${pathname} → ${res.status}: ${detail}`);
    }

    return json;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Survey content — 11 fully-populated profiles
// ────────────────────────────────────────────────────────────────────────────
// Every field the 8-step form collects is filled. Categories are drawn from
// BUSINESS_CATEGORIES and sub-categories from the SUB_CATEGORIES map in
// SurveyFormScreen.tsx, so the values match exactly what the dropdowns offer.
// The list deliberately mixes Accommodations (which unlocks Step 5 and makes
// rooms + facilities + policies mandatory) with other categories, so both
// branches of the conditional form are exercised.

const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Open all week except a chosen rest day, with explicit hours on two days. */
function workingHours(restDay: string, from = '09:00', to = '21:00') {
  return WEEK.map((day) => {
    if (day === restDay) return { day, type: 'closed' as const, from: '', to: '' };
    if (day === 'Saturday' || day === 'Sunday') return { day, type: 'hours' as const, from, to };
    return { day, type: 'open_all_day' as const, from: '', to: '' };
  });
}

interface Profile {
  businessName: string;
  ownerName: string;
  category: string;
  subCategories: string[];
  city: string;
  pinCode: string;
  address: string;
  mobile: string;
  email: string;
  aadhar: string;          // 12 digits, as the form validates
  pan: string;             // ABCDE1234F
  udyam: string;
  description: string;     // completeSurvey requires >= 50 characters
  about: string;
  restDay: string;
  facilities?: string[];   // Accommodations only
  policies?: string;       // Accommodations only
  rooms?: { name: string; type: string; capacity: string; price: string }[];
}

const PROFILES: Profile[] = [
  {
    businessName: 'Sagar Kinara Beach Resort', ownerName: 'Ramesh Anant Sawant',
    category: 'Accommodations', subCategories: ['Resort', 'Hotels'],
    city: 'Malvan', pinCode: '416606', address: 'Survey No 44, Tarkarli Beach Road, Malvan',
    mobile: '9822014455', email: 'stay@sagarkinara.example.in',
    aadhar: '412578903641', pan: 'AAJPS4471K', udyam: 'UDYAM-MH-26-0011245',
    description: 'Beachfront resort at Tarkarli offering sea-facing rooms, Malvani cuisine and guided water sports for families and groups visiting the Sindhudurg coast.',
    about: 'Family-run since 1998, the resort has hosted over 40,000 guests and received the district tourism board commendation in 2022 for sustainable coastal hospitality.',
    restDay: 'Tuesday',
    facilities: ['WiFi', 'Pool', 'Parking', 'Restaurant', 'Air Conditioning', 'Room Service'],
    policies: 'Check-in 12:00, check-out 10:00. Free cancellation up to 72 hours before arrival, 50% refund within 72 hours. Valid photo ID mandatory for all adults. No loud music after 22:30. Payment by UPI, card or cash.',
    rooms: [
      { name: 'Sea View Deluxe', type: 'Double', capacity: '3', price: '4500' },
      { name: 'Garden Cottage',  type: 'Suite',  capacity: '4', price: '6200' },
      { name: 'Backpacker Dorm', type: 'Dormitory', capacity: '8', price: '900' },
    ],
  },
  {
    businessName: 'Konkan Heritage Homestay', ownerName: 'Sunita Vasant Parab',
    category: 'Accommodations', subCategories: ['Home stay', 'Agro Tourism/ Farm Stay'],
    city: 'Kudal', pinCode: '416520', address: 'House No 12, Pinguli Village, Kudal Taluka',
    mobile: '9764233871', email: 'contact@konkanheritage.example.in',
    aadhar: '731554820967', pan: 'BXQPP9932L', udyam: 'UDYAM-MH-26-0011901',
    description: 'Traditional Konkani homestay set in a working cashew and mango orchard, offering home-cooked meals, bullock cart rides and folk art demonstrations.',
    about: 'Restored 90-year-old ancestral wada converted to a homestay in 2015, employing eleven villagers and supporting the local Chitrakathi puppetry troupe.',
    restDay: 'Monday',
    facilities: ['WiFi', 'Parking', 'Pet Friendly', 'Laundry', 'Restaurant'],
    policies: 'Check-in 11:00, check-out 09:00. Cancellation free up to 7 days prior. Vegetarian and seafood meals included. Guests requested to conserve well water. Cash and UPI accepted.',
    rooms: [
      { name: 'Orchard Room',  type: 'Double', capacity: '2', price: '2200' },
      { name: 'Family Wada',   type: 'Suite',  capacity: '6', price: '3800' },
    ],
  },
  {
    businessName: 'Malvani Ruchi Family Restaurant', ownerName: 'Prakash Dattaram Tandel',
    category: 'Cuisine', subCategories: ['Restaurant', 'Authentic Food/Cusines'],
    city: 'Vengurla', pinCode: '416516', address: 'Shop 3, Market Road, Vengurla',
    mobile: '9403118820', email: 'malvaniruchi@example.in',
    aadhar: '556128340972', pan: 'CJKPT2210M', udyam: 'UDYAM-MH-26-0012388',
    description: 'Authentic Malvani seafood restaurant serving surmai thali, sol kadhi and kombdi vade prepared to traditional family recipes using the day catch.',
    about: 'Opened in 1987 and now run by the third generation, seating sixty diners and sourcing fish directly from the Vengurla landing jetty each morning.',
    restDay: 'Wednesday',
  },
  {
    businessName: 'Tarkarli Scuba Adventures', ownerName: 'Nitin Shashikant Malvankar',
    category: 'Aqua Tourism', subCategories: ['Scuba Diving', 'Jet Ski', 'Cruises'],
    city: 'Malvan', pinCode: '416606', address: 'Beach Shack 7, Devbag Sangam, Tarkarli',
    mobile: '9975440213', email: 'dive@tarkarliadventures.example.in',
    aadhar: '648920137745', pan: 'DKLPM6654N', udyam: 'UDYAM-MH-26-0012994',
    description: 'PADI-affiliated dive centre offering guided reef dives, snorkelling trips and jet ski rides in the sheltered waters around Sindhudurg fort.',
    about: 'Established 2011 with six certified instructors, over 9,000 logged guest dives and an unblemished safety record verified by the state tourism department.',
    restDay: 'Thursday',
  },
  {
    businessName: 'Amboli Ghat Nature Walks', ownerName: 'Deepak Anil Gawde',
    category: 'Experiences and Activities', subCategories: ['Adventure Activities', 'Caves', 'Cultural'],
    city: 'Amboli', pinCode: '416510', address: 'Near Hiranyakeshi Temple, Amboli',
    mobile: '9689207734', email: 'walks@ambolinature.example.in',
    aadhar: '890217346512', pan: 'EFMPG1187P', udyam: 'UDYAM-MH-26-0013507',
    description: 'Guided monsoon trekking and biodiversity walks through the Amboli Western Ghats, covering endemic amphibians, waterfalls and shola forest patches.',
    about: 'Founded by a group of local naturalists in 2013; contributes sighting records to the Western Ghats amphibian survey and trains village youth as nature guides.',
    restDay: 'Monday',
  },
  {
    businessName: 'Sindhudurg Fort Heritage Tours', ownerName: 'Mahesh Baban Kadam',
    category: 'Guided Tours', subCategories: ['Historical/Landmark Tours', 'Cave Tours', 'Educational Tours'],
    city: 'Malvan', pinCode: '416606', address: 'Jetty Office, Malvan Port Road',
    mobile: '9420336618', email: 'tours@sindhudurgheritage.example.in',
    aadhar: '204593817760', pan: 'FGHPK3398Q', udyam: 'UDYAM-MH-26-0014120',
    description: 'Licensed heritage walking tours of Sindhudurg fort covering its Maratha naval history, hidden water cisterns and the Shivaji handprint shrine.',
    about: 'Operating since 2009 with eight ASI-recognised guides conducting tours in Marathi, Hindi and English for school groups and international visitors.',
    restDay: 'Tuesday',
  },
  {
    businessName: 'Konkan Darshan Travel Services', ownerName: 'Sanjay Ravindra Naik',
    category: 'Tour Operator, Travel Agent and Destination Management Company',
    subCategories: ['Holiday Tours', 'Day Tours', 'Guided Tours'],
    city: 'Sawantwadi', pinCode: '416510', address: '2nd Floor, Rajwada Complex, Sawantwadi',
    mobile: '9822756401', email: 'bookings@konkandarshan.example.in',
    aadhar: '318740265193', pan: 'GHJPN5541R', udyam: 'UDYAM-MH-26-0014733',
    description: 'Inbound tour operator building multi-day Konkan itineraries covering beaches, forts, waterfalls and Ganjifa art workshops with vehicle and stay bundled.',
    about: 'MTDC-approved operator since 2006, handling roughly 3,500 travellers a year with a fleet of nine vehicles and tie-ups across twenty-two coastal properties.',
    restDay: 'Sunday',
  },
  {
    businessName: 'Sawantwadi Ganjifa Art Centre', ownerName: 'Anjali Vikram Chitari',
    category: 'Events and Festivals', subCategories: ['Art', 'Folk Art & Culture', 'Cultural'],
    city: 'Sawantwadi', pinCode: '416510', address: 'Chitari Galli, Near Moti Talav, Sawantwadi',
    mobile: '9764019928', email: 'art@sawantwadiganjifa.example.in',
    aadhar: '472069381524', pan: 'HJKPC7729S', udyam: 'UDYAM-MH-26-0015346',
    description: 'Living heritage centre demonstrating and teaching Sawantwadi Ganjifa hand-painted playing cards and traditional lacquered wooden toy making.',
    about: 'One of the last four families practising Ganjifa painting; recipient of a state handicraft award and running apprenticeships for fourteen students.',
    restDay: 'Monday',
  },
  {
    businessName: 'Bhogwe Sunset Cruises', ownerName: 'Vishal Prabhakar Kubal',
    category: 'Aqua Tourism', subCategories: ['Cruises', 'Houseboats', 'Ferries'],
    city: 'Bhogwe', pinCode: '416812', address: 'Bhogwe Beach Jetty, Parule Post',
    mobile: '9975882203', email: 'sail@bhogwecruises.example.in',
    aadhar: '635281470398', pan: 'JKLPK4462T', udyam: 'UDYAM-MH-26-0015959',
    description: 'Evening backwater and estuary cruises from Bhogwe covering the Karli river mouth, dolphin spotting points and mangrove channels with onboard refreshments.',
    about: 'Six licensed boats operating since 2014 with trained lifeguards aboard; partnered with the forest department on mangrove awareness programmes.',
    restDay: 'Thursday',
  },
  {
    businessName: 'Kunkeshwar Spiritual Retreat', ownerName: 'Ganesh Madhav Redkar',
    category: 'Experiences and Activities Slots', subCategories: ['Spiritual', 'Cultural', 'Museums'],
    city: 'Devgad', pinCode: '416613', address: 'Near Kunkeshwar Temple, Devgad Taluka',
    mobile: '9403667712', email: 'retreat@kunkeshwar.example.in',
    aadhar: '729184035617', pan: 'KLMPR8873U', udyam: 'UDYAM-MH-26-0016572',
    description: 'Structured morning and evening slots for temple heritage walks, seaside meditation sessions and Konkani devotional music at Kunkeshwar.',
    about: 'Run by a temple trust since 2017, offering free sessions to local schools and maintaining the shoreline cleanliness drive around the eleventh-century temple.',
    restDay: 'Wednesday',
  },
  {
    businessName: 'Devgad Alphonso Farm Stay', ownerName: 'Shubhangi Ashok Joshi',
    category: 'Accommodations', subCategories: ['Agro Tourism/ Farm Stay', 'Tourism Villas', 'Log Huts'],
    city: 'Devgad', pinCode: '416613', address: 'Mithbav Road, Devgad Alphonso Belt',
    mobile: '9822440917', email: 'stay@devgadalphonso.example.in',
    aadhar: '583920174468', pan: 'LMNPJ1194V', udyam: 'UDYAM-MH-26-0017185',
    description: 'Working Alphonso mango orchard offering harvest-season farm stays, grafting demonstrations, pulp processing tours and orchard-to-table Konkani meals.',
    about: 'GI-tagged Devgad Alphonso grower across eighteen acres, exporting since 2004 and hosting agri-tourism guests each February to May harvest window.',
    restDay: 'Tuesday',
    facilities: ['WiFi', 'Parking', 'Restaurant', 'Pet Friendly', 'Laundry', 'Conference Room'],
    policies: 'Check-in 13:00, check-out 11:00. Minimum two-night stay in harvest season. Cancellation free up to 10 days prior, 25% retained thereafter. Orchard footwear provided; guests asked not to pluck fruit unaccompanied.',
    rooms: [
      { name: 'Orchard Log Hut', type: 'Double', capacity: '2', price: '3100' },
      { name: 'Farmhouse Villa', type: 'Suite',  capacity: '5', price: '5400' },
    ],
  },
];

/**
 * Build the exact payload shape sync.service.processUpload() reads.
 * GPS is nudged per record so the surveys do not all share one coordinate.
 */
function buildSurveyPayload(profile: Profile, stakeholder: any, index: number) {
  const isAccommodation = profile.category === 'Accommodations';
  const baseLat = 16.0500 + index * 0.0121;   // Sindhudurg district band
  const baseLng = 73.4700 + index * 0.0094;

  return {
    stakeholderId: stakeholder.id,
    localId: `seed_${Date.now()}_${index}`,

    // Step 1 — Category & Type
    businessCategory: profile.category,
    subCategories: profile.subCategories.slice(0, 3), // schema caps at 3

    // Step 2 — Basic Information
    businessName: profile.businessName,
    ownerName: profile.ownerName,
    district: stakeholder.district,             // must match the stakeholder's own district
    city: profile.city,
    pinCode: profile.pinCode,
    businessAddress: profile.address,
    mobileNumber: profile.mobile,
    email: profile.email,
    aadharNumber: profile.aadhar,
    panNumber: profile.pan,
    udyamAadharRegNo: profile.udyam,

    // GPS + nearest facilities (captured automatically by the form)
    latitude: Number(baseLat.toFixed(6)),
    longitude: Number(baseLng.toFixed(6)),
    gpsAccuracy: 8.5,
    nearestPoliceStation: `${profile.city} Police Station`,
    nearestHealthcareCenter: `${profile.city} Rural Hospital`,

    // Step 4 — Details
    description: profile.description,
    workingHours: workingHours(profile.restDay),
    ...(isAccommodation
      ? { accommodationFacilities: profile.facilities, accommodationPolicies: profile.policies }
      : {}),

    // Step 5 — Rooms (Accommodations only; completeSurvey requires >= 1)
    ...(isAccommodation ? { rooms: profile.rooms } : {}),

    // Step 7 — Business Documents
    aboutBusiness: profile.about,

    // Step 8 — Terms (all three required by completeSurvey)
    agreedToTerms: true,
    declaredInfoCorrect: true,
    acknowledgedDotLiability: true,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Steps
// ────────────────────────────────────────────────────────────────────────────

async function login(): Promise<any> {
  const res = await api('/auth/login', { method: 'POST', body: { loginId: LOGIN_ID, password: PASSWORD } });
  const { tokens, enumerator } = res.data;
  accessToken = tokens.accessToken;
  return enumerator;
}

/** Pull assigned stakeholders, newest cursor first, until we have enough candidates. */
async function fetchCandidates(needed: number): Promise<any[]> {
  const out: any[] = [];
  let cursor = 0;

  while (out.length < needed * 4) {
    const res = await api(`/stakeholders/assigned/paged?after=${cursor}&page_size=200`);
    const rows: any[] = res.data?.stakeholders ?? [];
    const next = res.data?.nextCursor ?? null;

    for (const s of rows) {
      // Only untouched records: OPEN, unlocked, and with no survey yet. The
      // paged endpoint reports PARTIAL_COMPLETED when a survey already exists.
      if (s.status === 'OPEN' && !s.lockedById) out.push(s);
    }
    if (next === null) break;
    cursor = next;
  }
  return out;
}

async function uploadMedia(serverSurveyId: string, payload: any, slot: typeof MEDIA_SLOTS[number]) {
  const form = new FormData();
  form.append('surveyId', serverSurveyId);
  form.append('type', slot.type);
  if (slot.category) form.append('photoCategory', slot.category);
  form.append('latitude', String(payload.latitude));
  form.append('longitude', String(payload.longitude));
  form.append('gpsAccuracy', String(payload.gpsAccuracy));
  form.append('localId', `seed_${slot.name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  if (slot.type === 'VIDEO') form.append('duration', '42');

  const [buf, mime, ext] =
    slot.type === 'PHOTO'    ? [PHOTO_BUF, PHOTO_MIME, PHOTO_MIME === 'image/png' ? 'png' : 'jpg'] :
    slot.type === 'VIDEO'    ? [VIDEO_BUF, VIDEO_MIME, VIDEO_MIME === 'video/quicktime' ? 'mov' : 'mp4'] :
                               [DOC_BUF,   DOC_MIME,   DOC_MIME === 'application/pdf' ? 'pdf' : 'docx'];

  form.append('file', new Blob([buf as Buffer], { type: mime as string }), `${slot.name}.${ext}`);

  await api('/media/upload', { method: 'POST', form, isUpload: true });
}

async function main() {
  console.log('='.repeat(74));
  console.log('  Seed completed surveys via the live API');
  console.log('='.repeat(74));
  console.log(`  API        : ${API_BASE}`);
  console.log(`  Login as   : ${LOGIN_ID}`);
  console.log(`  Target     : ${TARGET} survey(s)`);
  console.log(`  Photo      : ${path.basename(PHOTO_PATH)} (${(PHOTO_BUF.length / 1024 / 1024).toFixed(2)} MB, ${PHOTO_MIME})`);
  console.log(`  Video      : ${path.basename(VIDEO_PATH)} (${(VIDEO_BUF.length / 1024 / 1024).toFixed(2)} MB, ${VIDEO_MIME})`);
  console.log(`  Document   : ${path.basename(DOC_PATH)} (${(DOC_BUF.length / 1024 / 1024).toFixed(2)} MB, ${DOC_MIME})`);
  console.log(`  Files/survey: ${MEDIA_SLOTS.length}  → ${TARGET * MEDIA_SLOTS.length} uploads total`);
  console.log(`  Mode       : ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log('='.repeat(74));

  if (TARGET > PROFILES.length) {
    console.log(`\nOnly ${PROFILES.length} distinct profiles are defined; ${TARGET} requested.`);
    console.log('Profiles will be reused with a numeric suffix on the business name.');
  }

  console.log('\n[1/3] Authenticating…');
  const me = await login();
  console.log(`      Signed in as ${me.name} (${me.loginId}), admin=${me.isAdmin}`);
  console.log(`      Districts: ${(me.districts || []).map((d: any) => d.name).join(', ') || '(none)'}`);
  if (!me.districts?.length) {
    throw new Error('This account has no assigned districts, so it can see no stakeholders. Assign one in the admin panel first.');
  }

  console.log('\n[2/3] Finding eligible stakeholders (OPEN, unlocked, no survey yet)…');
  const candidates = await fetchCandidates(TARGET);
  console.log(`      ${candidates.length} candidate(s) available`);
  if (candidates.length < TARGET) {
    console.log(`      NOTE: only ${candidates.length} eligible — will seed that many.`);
  }

  const work = candidates.slice(0, Math.min(TARGET, candidates.length));
  if (work.length === 0) {
    console.log('\nNothing to do: no eligible stakeholders. Every one is already CLOSED or locked.');
    console.log('Reset some with:  UPDATE stakeholders SET status=\'OPEN\', locked_by_id=NULL, locked_at=NULL WHERE status=\'CLOSED\';');
    return;
  }

  if (DRY_RUN) {
    console.log('\n[3/3] DRY RUN — the following would be created:\n');
    work.forEach((s, i) => {
      const p = PROFILES[i % PROFILES.length];
      console.log(`  ${String(i + 1).padStart(2)}. ${p.businessName}`);
      console.log(`      category : ${p.category}`);
      console.log(`      sub      : ${p.subCategories.slice(0, 3).join(', ')}`);
      console.log(`      onto     : ${s.companyNameStandardized || s.companyNameOriginal} (${s.district})`);
      console.log(`      rooms    : ${p.rooms ? p.rooms.length : 0}   facilities: ${p.facilities?.length ?? 0}`);
      console.log(`      media    : ${MEDIA_SLOTS.length} files`);
    });
    console.log('\nRe-run without --dry-run to apply.');
    return;
  }

  console.log('\n[3/3] Creating surveys…\n');
  const started = Date.now();
  const done: string[] = [];
  const failed: { name: string; reason: string }[] = [];

  for (let i = 0; i < work.length; i++) {
    const stakeholder = work[i];
    const base = PROFILES[i % PROFILES.length];
    // Keep names unique if profiles wrap around.
    const profile: Profile = i < PROFILES.length
      ? base
      : { ...base, businessName: `${base.businessName} ${Math.floor(i / PROFILES.length) + 1}` };

    const label = `${String(i + 1).padStart(2)}/${work.length}  ${profile.businessName}`;
    process.stdout.write(`${label}\n`);

    try {
      const payload = buildSurveyPayload(profile, stakeholder, i);

      // a. Create the survey via the sync endpoint (passthrough schema).
      process.stdout.write('      survey  … ');
      const syncRes = await api('/sync/upload', {
        method: 'POST',
        body: { surveys: [payload], phoneValidations: [], mediaMetadata: [] },
      });
      const r = syncRes.data?.surveys;
      if (!r || r.success < 1) {
        throw new Error(`sync rejected it: ${(r?.errors || []).join('; ') || 'unknown reason'}`);
      }
      process.stdout.write('ok\n');

      // b. Resolve the server-side survey id that media must attach to.
      const svRes = await api(`/surveys/stakeholder/${stakeholder.id}`);
      const serverSurveyId = svRes.data?.id;
      if (!serverSurveyId) throw new Error('could not resolve the server survey id');

      // c. Upload every media slot.
      process.stdout.write(`      media   … `);
      for (const slot of MEDIA_SLOTS) {
        await uploadMedia(serverSurveyId, payload, slot);
        process.stdout.write('.');
      }
      process.stdout.write(` ${MEDIA_SLOTS.length} file(s)\n`);

      // d. Complete — this runs every server-side validator.
      process.stdout.write('      complete… ');
      await api(`/surveys/${serverSurveyId}/complete`, { method: 'POST' });
      process.stdout.write('CLOSED\n');

      done.push(profile.businessName);
    } catch (err: any) {
      process.stdout.write(`FAILED\n      ↳ ${err.message}\n`);
      failed.push({ name: profile.businessName, reason: err.message });
    }
    console.log('');
  }

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log('='.repeat(74));
  console.log(`  Completed ${done.length}/${work.length} in ${mins} min`);
  if (failed.length) {
    console.log(`  Failed ${failed.length}:`);
    failed.forEach((f) => console.log(`    - ${f.name}: ${f.reason}`));
  }
  console.log('='.repeat(74));
  console.log('\nVerify in the admin panel: Stakeholders (status CLOSED, gallery has');
  console.log('5 photos + 1 video + 3 documents) and Export SQL (rows marked New).');
}

main().catch((err) => {
  console.error(`\nAborted: ${err.message}\n`);
  process.exit(1);
});
