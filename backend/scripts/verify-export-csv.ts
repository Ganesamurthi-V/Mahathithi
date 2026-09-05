/**
 * Verify the survey CSV export against inputs designed to break naive CSV writers.
 *
 * Runs the real generateExportCSV from admin.routes.ts (not a copy) and parses the
 * result back with csv-parse, which is already a dependency. Round-tripping is the
 * only check that actually proves the escaping is right: if a quote or newline is
 * mishandled, the parsed column count drifts and the assertion fires.
 *
 * Touches no database and marks nothing as exported.
 *
 *   npx tsx scripts/verify-export-csv.ts
 */
import { parse } from 'csv-parse/sync';
import { generateExportCSV } from '../src/modules/admin/admin.routes';

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// Values chosen to break things: a comma, an embedded double quote, a real
// newline, a leading '=' (Excel formula), a leading '+' (phone), unicode, nulls,
// and JSON columns in both populated and empty forms.
const surveys: any[] = [
  {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    createdAt: new Date('2026-01-15T10:30:00.000Z'),
    completedAt: new Date('2026-01-15T11:00:00.000Z'),
    businessName: 'Café Sunrise, Panaji',                    // comma + unicode
    ownerName: 'A "Tony" Fernandes',                          // embedded quotes
    businessCategory: 'Accommodations',
    subCategories: ['Hotel', 'Resort'],
    mobileNumber: '+919876543210',                            // leading +
    email: 'tony@example.com',
    district: 'Sindhudurg',
    taluka: 'Malvan',
    city: 'Malvan',
    village: 'Tarkarli',
    pinCode: '416606',
    gstNumber: '27ABCDE1234F1Z5',
    businessAddress: 'Line one\nLine two, near jetty',        // real newline
    latitude: 16.0594,
    longitude: 73.4629,
    gpsAccuracy: 4.5,
    digipin: '3F2-K9M-4820',
    nearestPoliceStation: 'Malvan PS',
    nearestHealthcareCenter: 'Rural Hospital, Malvan',
    aadharNumber: '123456789012',                             // must be FULL
    udyamAadharRegNo: 'UDYAM-MH-26-0001234',
    panNumber: 'ABCDE1234F',
    description: '=SUM(A1:A9) injected',                      // formula attempt
    accommodationFacilities: ['WiFi', 'Pool', 'Home Décor'],
    accommodationPolicies: 'Check-in 12:00; no refunds',
    workingHours: [
      { day: 'Monday', type: 'open_all_day' },
      { day: 'Tuesday', type: 'closed' },
      { day: 'Wednesday', type: 'hours', from: '09:00', to: '18:00' },
      // Real shape from the mobile form: Custom Hours chosen, times left blank as
      // "" rather than null. Used to render as a bare "-".
      { day: 'Thursday', type: 'hours', from: '', to: '' },
    ],
    rooms: [
      { name: 'Deluxe', type: 'Double', capacity: 2, price: 2500 },
      { name: 'Dorm', type: 'Dormitory', capacity: 8, price: 600 },
    ],
    aboutBusiness: 'Family run since 1998',
    agreedToTerms: true,
    declaredInfoCorrect: true,
    acknowledgedDotLiability: false,
    isSynced: true,
    syncedAt: new Date('2026-01-15T11:05:00.000Z'),
  },
  {
    // Sparse row: almost everything null, JSON columns absent entirely.
    id: 'bbbbbbbb-1111-2222-3333-444444444444',
    createdAt: new Date('2026-02-01T08:00:00.000Z'),
    completedAt: null,
    businessName: null,
    ownerName: undefined,
    businessCategory: 'Cuisine',
    subCategories: [],
    mobileNumber: null,
    email: null,
    district: null,
    city: null,
    pinCode: null,
    businessAddress: null,
    latitude: null,
    longitude: null,
    gpsAccuracy: null,
    digipin: null,
    nearestPoliceStation: null,
    nearestHealthcareCenter: null,
    aadharNumber: null,
    udyamAadharRegNo: null,
    panNumber: null,
    description: null,
    accommodationFacilities: null,
    accommodationPolicies: null,
    workingHours: null,
    rooms: null,
    aboutBusiness: null,
    agreedToTerms: false,
    declaredInfoCorrect: false,
    acknowledgedDotLiability: false,
    isSynced: false,
    syncedAt: null,
  },
];

const csv = generateExportCSV(surveys, new Map());

console.log('=== raw output (first 400 chars) ===');
console.log(JSON.stringify(csv.slice(0, 400)));
console.log('');
console.log('=== assertions ===');

check('starts with UTF-8 BOM', csv.charCodeAt(0) === 0xfeff,
  `first charCode was ${csv.charCodeAt(0)}`);

check('uses CRLF line endings', csv.includes('\r\n'));

// Strip the BOM before parsing; csv-parse would otherwise fold it into the first
// header name.
const parsed: string[][] = parse(csv.replace(/^\uFEFF/, ''), {
  skipEmptyLines: true,
});

const header = parsed[0]!;
check('parses back into 3 records (header + 2 rows)', parsed.length === 3,
  `got ${parsed.length}`);

check('every row has the same column count as the header',
  parsed.every(r => r.length === header.length),
  `header=${header.length}, rows=[${parsed.map(r => r.length).join(', ')}]`);

const row1 = parsed[1]!;
const row2 = parsed[2]!;
const col = (name: string) => {
  const i = header.indexOf(name);
  if (i === -1) throw new Error(`column ${name} missing from header`);
  return i;
};

// Escaping fidelity — the whole point of round-tripping.
check('comma inside a value survives',
  row1[col('business_name')] === 'Café Sunrise, Panaji',
  JSON.stringify(row1[col('business_name')]));

check('embedded double quotes survive',
  row1[col('owner_name')] === 'A "Tony" Fernandes',
  JSON.stringify(row1[col('owner_name')]));

check('embedded newline survives inside one field',
  row1[col('business_address')] === 'Line one\nLine two, near jetty',
  JSON.stringify(row1[col('business_address')]));

check('unicode preserved',
  row1[col('accommodation_facilities')].includes('Home Décor'),
  JSON.stringify(row1[col('accommodation_facilities')]));

// Formula-injection guard.
check("leading '=' is neutralised with a quote prefix",
  row1[col('description')] === "'=SUM(A1:A9) injected",
  JSON.stringify(row1[col('description')]));

check("leading '+' on a phone number is neutralised",
  row1[col('mobile_number')] === "'+919876543210",
  JSON.stringify(row1[col('mobile_number')]));

// Aadhaar: full and unmasked, as explicitly requested.
check('aadhar_number column exists', header.includes('aadhar_number'));
check('aadhar_number is the full 12 digits, unmasked',
  row1[col('aadhar_number')] === '123456789012',
  JSON.stringify(row1[col('aadhar_number')]));
check('aadhar_number contains no masking characters',
  !/[X*]/i.test(row1[col('aadhar_number')]));

// JSON flattening.
check('sub_categories joined',
  row1[col('sub_categories')] === 'Hotel | Resort',
  JSON.stringify(row1[col('sub_categories')]));

check('working_hours flattened readably',
  row1[col('working_hours')] ===
    'Monday: Open all day; Tuesday: Closed; Wednesday: 09:00-18:00; Thursday: Hours not specified',
  JSON.stringify(row1[col('working_hours')]));

check('blank custom hours do not render as a bare "-"',
  !/:\s*-\s*(;|$)/.test(row1[col('working_hours')]),
  JSON.stringify(row1[col('working_hours')]));

check('taluka is exported',
  row1[col('taluka')] === 'Malvan',
  JSON.stringify(row1[col('taluka')]));

// village and gst_number were removed on request. The fixture above still SETS
// both, so these assertions prove the columns are deliberately excluded rather
// than merely absent from the test data — which is what would silently regress if
// someone re-added them to the column list.
check('village column is not present', !header.includes('village'));
check('gst_number column is not present', !header.includes('gst_number'));
check('the removed values appear nowhere in the output',
  !csv.includes('Tarkarli') && !csv.includes('27ABCDE1234F1Z5'));

// gst_document_url is a different thing — the uploaded GST certificate file link,
// not the GST number — and stays.
check('gst_document_url (the certificate link) is retained',
  header.includes('gst_document_url'));

check('rooms flattened readably',
  row1[col('rooms')] === 'Deluxe (Double, cap 2, price 2500); Dorm (Dormitory, cap 8, price 600)',
  JSON.stringify(row1[col('rooms')]));

check('rooms_count matches array length',
  row1[col('rooms_count')] === '2',
  JSON.stringify(row1[col('rooms_count')]));

// Booleans and nulls.
check('true renders as TRUE',
  row1[col('agreed_to_terms')] === 'TRUE',
  JSON.stringify(row1[col('agreed_to_terms')]));

check('false renders as FALSE',
  row1[col('acknowledged_dot_liability')] === 'FALSE',
  JSON.stringify(row1[col('acknowledged_dot_liability')]));

check('null renders as an empty cell, not the text "null"',
  row2[col('business_name')] === '',
  JSON.stringify(row2[col('business_name')]));

check('undefined renders as an empty cell',
  row2[col('owner_name')] === '',
  JSON.stringify(row2[col('owner_name')]));

check('null JSON columns render empty',
  row2[col('working_hours')] === '' && row2[col('rooms')] === '',
  `wh=${JSON.stringify(row2[col('working_hours')])} rooms=${JSON.stringify(row2[col('rooms')])}`);

check('rooms_count is 0 when rooms is null',
  row2[col('rooms_count')] === '0',
  JSON.stringify(row2[col('rooms_count')]));

check('media URL columns present even with no media',
  ['display_image_url', 'gst_document_url', 'pan_card_document_url', 'establishment_cert_url']
    .every(c => header.includes(c)));

// The CSV must be a plain table and nothing else. The SQL export is a separate
// artefact; none of its syntax belongs in a file destined for a spreadsheet.
// Opening the SQL file in Excel is what produced a sheet full of #NAME? errors,
// because Excel evaluates its leading "--" comment lines as formulas.
const SQL_MARKERS = [
  'BEGIN;', 'COMMIT;', 'INSERT INTO', 'WITH new_listing', 'gen_random_uuid',
  'RETURNING', '::uuid', '-- ===', 'SELECT 1;',
];
const leaked = SQL_MARKERS.filter(m => csv.includes(m));
check('CSV contains no SQL syntax at all', leaked.length === 0,
  `found: ${leaked.join(', ')}`);

check('no row begins with a SQL comment marker',
  !parsed.some(r => (r[0] ?? '').startsWith('--')));

check('header row is the very first line, no preamble',
  header[0] === 'survey_id', JSON.stringify(header[0]));

console.log('');
console.log(`=== ${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`} ===`);
console.log(`columns: ${header.length}`);
process.exit(failures === 0 ? 0 : 1);
