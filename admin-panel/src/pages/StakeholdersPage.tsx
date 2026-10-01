import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { searchStakeholders, updateStakeholder, createStakeholder, deleteStakeholder, getSurveyByStakeholder, getMediaBySurvey, getDistricts, getErrorMessage, updateSurvey, finalizeSurvey, uploadMedia } from '../api';
import type { District } from '../types';
import { getDigiPin } from '../utils/digipin';
import {
  LoadingButton,
  TableSkeletonWithHeader,
  RefetchOverlay,
  PageLoader,
  SkeletonBlock,
  CopyButton,
} from '../components/Loading';

// PERF: pure helper hoisted to module scope so it isn't re-created each render
// and a memoized row can reference it without breaking memoization.
const getStatusBadge = (status: string) => {
  const map: Record<string, string> = { PENDING: 'badge-pending', IN_PROGRESS: 'badge-active', IN_REVIEW: 'badge-admin', PARTIAL_COMPLETED: 'badge-admin', CLOSED: 'badge-active' };
  return map[status] || 'badge-pending';
};

// PERF: memoized table row — only re-renders when its own stakeholder/handler
// change, so typing in the filter inputs no longer re-renders every row.
const StakeholderRow = memo(function StakeholderRow({ s, onSelect }: { s: any; onSelect: (s: any) => void }) {
  return (
    <tr style={{ cursor: 'pointer' }} onClick={() => onSelect(s)}>
      <td style={{ fontWeight: '600', color: 'var(--text-primary)', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {s.companyNameStandardized || s.companyNameOriginal || '—'}
      </td>
      <td>{s.district || '—'}</td>
      <td style={{ fontSize: '13px' }}>{s.city || s.taluka || '—'}</td>
      <td><code style={{ fontSize: '12px', background: 'var(--bg-input)', padding: '2px 6px', borderRadius: '4px' }}>{s.pinCode || '—'}</code></td>
      <td><code style={{ fontSize: '12px', background: 'var(--bg-input)', padding: '2px 6px', borderRadius: '4px' }}>{s.digipin || '—'}</code></td>
      <td style={{ fontSize: '12px' }}>{s.category || '—'}</td>
      <td><span className={`badge ${getStatusBadge(s.status)}`}>{(s.status || 'PENDING').replace('_', ' ')}</span></td>
      <td>
        <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onSelect(s); }}>
          📸 View Gallery
        </button>
      </td>
    </tr>
  );
});

const TABLE_HEADERS = ['Organization', 'District', 'City / Taluka', 'PIN Code', 'DIGIPIN', 'Category', 'Status', 'Actions'];

// Canonical week order for the survey Working Hours editor. Matches the mobile
// form's day keys so an edited row round-trips to the same shape.
const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ── Survey field format validation ──────────────────────────────────────────
// Standard Indian formats. Every rule is applied ONLY to a non-empty value:
// these fields are optional (an admin can save a partial survey), so a blank
// field is valid — we only warn when something is typed in the wrong shape.
// The Aadhaar rule matches the server's own regex (/^\d{12}$/); the rest are
// enforced client-side for data quality and mirrored in adminEditSurvey.
const SURVEY_FIELD_RULES: Record<string, { test: (v: string) => boolean; message: string }> = {
  // 10-digit Indian mobile starting 6-9, optional +91 / leading 0.
  mobileNumber: {
    test: (v) => /^(?:\+91[-\s]?|0)?[6-9]\d{9}$/.test(v.replace(/\s+/g, '')),
    message: 'Enter a valid 10-digit mobile number (optionally with +91).',
  },
  email: {
    test: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    message: 'Enter a valid email address.',
  },
  // Indian PIN: 6 digits, first digit 1-9.
  pinCode: {
    test: (v) => /^[1-9]\d{5}$/.test(v),
    message: 'PIN code must be 6 digits.',
  },
  aadharNumber: {
    test: (v) => /^\d{12}$/.test(v),
    message: 'Aadhar number must be exactly 12 digits.',
  },
  // PAN: 5 letters, 4 digits, 1 letter (case-insensitive input).
  panNumber: {
    test: (v) => /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/.test(v),
    message: 'PAN must be 10 characters, e.g. ABCDE1234F.',
  },
  // GSTIN: 15 chars — 2 digit state, 10-char PAN, entity digit, 'Z', checksum.
  gstNumber: {
    test: (v) => /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][0-9A-Za-z]Z[0-9A-Za-z]$/.test(v),
    message: 'GST number must be a valid 15-character GSTIN.',
  },
};

/**
 * Validate one survey field. Returns an error string, or '' when the value is
 * empty (optional) or correctly formatted. Used both to render inline warnings
 * as the admin types and to gate the Save button.
 */
function validateSurveyField(field: string, value: any): string {
  const rule = SURVEY_FIELD_RULES[field];
  if (!rule) return '';
  const v = (value ?? '').toString().trim();
  if (v === '') return ''; // optional — blank is fine
  return rule.test(v) ? '' : rule.message;
}

/** Collect all format errors in a survey-edit object, keyed by field. */
function collectSurveyFormatErrors(edit: Record<string, any>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of Object.keys(SURVEY_FIELD_RULES)) {
    const msg = validateSurveyField(field, edit[field]);
    if (msg) errors[field] = msg;
  }
  return errors;
}

export default function StakeholdersPage() {
  const [filters, setFilters] = useState({ name: '', district: '', pinCode: '', digipin: '', category: '', status: '' });
  const [debouncedFilters, setDebouncedFilters] = useState(filters);
  const [page, setPage] = useState(1);
  const [selectedStakeholder, setSelectedStakeholder] = useState<any>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  // Which pagination button was pressed, so only that one shows a spinner.
  const [pendingDirection, setPendingDirection] = useState<'prev' | 'next' | null>(null);

  // Debounce filter changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
      setPage(1); // Reset to page 1 on search
    }, 500);
    return () => clearTimeout(timer);
  }, [filters]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['stakeholders', debouncedFilters, page],
    queryFn: () => {
      const params: any = { page, limit: 20 };
      if (debouncedFilters.name) params.name = debouncedFilters.name;
      if (debouncedFilters.district) params.district = debouncedFilters.district;
      if (debouncedFilters.pinCode) params.pinCode = debouncedFilters.pinCode;
      if (debouncedFilters.digipin) params.digipin = debouncedFilters.digipin;
      if (debouncedFilters.category) params.category = debouncedFilters.category;
      if (debouncedFilters.status) params.status = debouncedFilters.status;
      return searchStakeholders(params);
    },
    staleTime: 10000,
  });

  const stakeholders = data?.data?.data?.stakeholders || data?.data?.data || [];
  const pagination = data?.data?.data?.pagination;
  // The server omits the total on filtered searches — the exact COUNT was 7x the
  // cost of the page itself. `totalKnown` says whether a figure was supplied at
  // all, so the UI can stay silent rather than display a misleading 0.
  const totalKnown = pagination?.totalKnown === true || typeof pagination?.total === 'number';
  const total = totalKnown ? (pagination?.total ?? 0) : null;
  // Total pages comes straight from the server (ceil(total/limit)) when a total
  // is known; null when the count was skipped (an expensive name/org/gst/city
  // filter is active), in which case we fall back to the "Page N" + hasMore UI.
  const totalPages: number | null = typeof pagination?.totalPages === 'number' ? pagination.totalPages : null;
  // Prefer the server's hasMore over `length < limit`: it comes from an over-fetch,
  // so it is authoritative and works when no total exists.
  const hasMore = pagination?.hasMore ?? stakeholders.length >= 20;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setDebouncedFilters(filters);
    setPage(1);
  };

  // PERF: stable handler reference so memoized rows don't re-render on every keystroke.
  const handleSelect = useCallback((s: any) => setSelectedStakeholder(s), []);

  // A refresh of data already on screen, as distinct from the very first load.
  const isRefreshing = isFetching && !isLoading;

  // Clear the pagination spinner target once the request settles.
  useEffect(() => {
    if (!isFetching) setPendingDirection(null);
  }, [isFetching]);

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2>Stakeholders</h2>
          <p>Browse and verify stakeholder submissions with photos and documents</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddForm(true)} style={{ whiteSpace: 'nowrap' }}>
          ➕ Add Stakeholder
        </button>
      </div>

      {showAddForm && <AddStakeholderModal onClose={() => setShowAddForm(false)} />}

      <div className="card" style={{ marginBottom: '24px' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '2', minWidth: '200px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>Organization Name</label>
            <input className="form-input" placeholder="Search by name..." value={filters.name} onChange={(e) => setFilters({ ...filters, name: e.target.value })} />
          </div>
          <div style={{ flex: '1', minWidth: '140px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>District</label>
            <input className="form-input" placeholder="District" value={filters.district} onChange={(e) => setFilters({ ...filters, district: e.target.value })} />
          </div>
          <div style={{ flex: '1', minWidth: '120px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>PIN Code</label>
            <input className="form-input" placeholder="PIN Code" value={filters.pinCode} onChange={(e) => setFilters({ ...filters, pinCode: e.target.value })} />
          </div>
          <div style={{ flex: '1', minWidth: '120px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>DIGIPIN</label>
            <input className="form-input" placeholder="DIGIPIN" value={filters.digipin} onChange={(e) => setFilters({ ...filters, digipin: e.target.value })} />
          </div>
          <div style={{ flex: '1', minWidth: '120px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>Status</label>
            <select className="form-input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">All</option>
              <option value="OPEN">Open (No Survey)</option>
              <option value="PARTIAL_COMPLETED">Has Survey (Draft or Submitted)</option>
              <option value="CLOSED">Closed / Completed</option>
            </select>
          </div>
          {/* Was `isLoading ? '...' : 'Search'`, which only reacted to the very
              first fetch — pressing Search again after results existed gave no
              feedback at all. isFetching covers every subsequent search too. */}
          <LoadingButton
            type="submit"
            variant="primary"
            loading={isFetching}
            loadingText="Searching…"
            style={{ height: '42px' }}
          >
            🔍 Search
          </LoadingButton>
        </form>
      </div>

      <div style={{ marginBottom: '16px', fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '12px' }}>
        {isLoading
          ? <SkeletonBlock width={200} height={13} />
          : <span>
              {total !== null
                ? (total === 0
                    ? 'No results'
                    : `Showing ${((page - 1) * 20 + 1).toLocaleString()}–${((page - 1) * 20 + stakeholders.length).toLocaleString()} of ${total.toLocaleString()} total`)
                : <>Showing {stakeholders.length} results{hasMore && ' (more available)'}</>}
            </span>
        }
      </div>

      {isLoading ? (
        // First load only. A skeleton in the real column layout means the header
        // row and column widths do not shift when results arrive.
        <TableSkeletonWithHeader
          headers={TABLE_HEADERS}
          rows={10}
          widths={['80%', '50%', '45%', '40%', '45%', '55%', '50%', '75%']}
        />
      ) : (
        // Paging or re-searching with results already on screen: dim the existing
        // rows rather than tearing them down, so the operator keeps their place.
        <RefetchOverlay active={isRefreshing} label="Loading results…">
          <table>
            <thead>
              <tr>
                {TABLE_HEADERS.map((h) => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {stakeholders.length === 0 && (
                <tr>
                  <td colSpan={TABLE_HEADERS.length} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    No stakeholders found. Try adjusting your search filters.
                  </td>
                </tr>
              )}
              {stakeholders.map((s: any) => (
                <StakeholderRow key={s.id} s={s} onSelect={handleSelect} />
              ))}
            </tbody>
          </table>
        </RefetchOverlay>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '24px' }}>
        {/* Pagination now blocks while a page is in flight, so a double-click
            cannot skip a page, and shows which direction is loading. */}
        <LoadingButton
          variant="secondary"
          size="sm"
          disabled={page <= 1 || isFetching}
          loading={isFetching && pendingDirection === 'prev'}
          loadingText="Loading…"
          onClick={() => { setPendingDirection('prev'); setPage(page - 1); }}
        >
          ← Previous
        </LoadingButton>
        <span style={{ display: 'flex', alignItems: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
          {totalPages !== null ? `Page ${page} of ${totalPages.toLocaleString()}` : `Page ${page}`}
        </span>
        <LoadingButton
          variant="secondary"
          size="sm"
          disabled={(totalPages !== null ? page >= totalPages : !hasMore) || isFetching}
          loading={isFetching && pendingDirection === 'next'}
          loadingText="Loading…"
          onClick={() => { setPendingDirection('next'); setPage(page + 1); }}
        >
          Next →
        </LoadingButton>
      </div>

      {selectedStakeholder && (
        <VerificationGalleryModal
          stakeholder={selectedStakeholder}
          onClose={() => setSelectedStakeholder(null)}
        />
      )}
    </>
  );
}

function VerificationGalleryModal({ stakeholder, onClose }: any) {
  const queryClient = useQueryClient();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<any>({
    companyNameStandardized: stakeholder.companyNameStandardized || '',
    addressLine1: stakeholder.addressLine1 || '',
    addressLine2: stakeholder.addressLine2 || '',
    city: stakeholder.city || '',
    taluka: stakeholder.taluka || '',
    village: stakeholder.village || '',
    district: stakeholder.district || '',
    state: stakeholder.state || '',
    pinCode: stakeholder.pinCode || '',
    category: stakeholder.category || '',
    latitude: stakeholder.latitude || '',
    longitude: stakeholder.longitude || '',
    digipin: stakeholder.digipin || '',
  });

  const { data: surveyData, isLoading: isSurveyLoading } = useQuery({
    queryKey: ['survey', stakeholder.id],
    queryFn: () => getSurveyByStakeholder(stakeholder.id).catch(() => ({ data: { data: null } })),
  });
  
  const survey = surveyData?.data?.data;

  const { data: mediaData, isLoading: isMediaLoading } = useQuery({
    queryKey: ['media', survey?.id],
    queryFn: () => getMediaBySurvey(survey.id).catch(() => ({ data: { data: [] } })),
    enabled: !!survey?.id,
  });

  const media = mediaData?.data?.data || [];

  // A survey is still a draft (PARTIAL_COMPLETED) until finalized. isCompleted is
  // the authoritative flag; fall back to the stakeholder status for older rows.
  const isSurveyDraft = !!survey && survey.isCompleted !== true;

  // Survey-field edit state for admin verification. Seeded from the loaded survey
  // whenever it changes; only sent fields the admin touched are persisted.
  const [surveyEditMode, setSurveyEditMode] = useState(false);
  const [surveyEdit, setSurveyEdit] = useState<any>({});
  useEffect(() => {
    if (survey) {
      setSurveyEdit({
        businessName: survey.businessName || '',
        ownerName: survey.ownerName || '',
        mobileNumber: survey.mobileNumber || '',
        email: survey.email || '',
        district: survey.district || '',
        city: survey.city || '',
        pinCode: survey.pinCode || '',
        businessAddress: survey.businessAddress || '',
        aadharNumber: survey.aadharNumber || '',
        panNumber: survey.panNumber || '',
        udyamAadharRegNo: survey.udyamAadharRegNo || '',
        gstNumber: survey.gstNumber || '',
        description: survey.description || '',
        // Working hours: normalize to all 7 days so the editor always shows a full
        // week even if the enumerator only filled some. Preserve any saved row.
        workingHours: WEEK_DAYS.map(day => {
          const saved = Array.isArray(survey.workingHours)
            ? survey.workingHours.find((w: any) => w.day === day)
            : null;
          return saved
            ? { day, type: saved.type || 'open_all_day', from: saved.from || '', to: saved.to || '' }
            : { day, type: 'open_all_day', from: '', to: '' };
        }),
        // Terms & Conditions flags.
        agreedToTerms: !!survey.agreedToTerms,
        declaredInfoCorrect: !!survey.declaredInfoCorrect,
        acknowledgedDotLiability: !!survey.acknowledgedDotLiability,
      });
    }
  }, [survey]);

  // Live format errors for the survey editor, recomputed as the admin types.
  // Keyed by field name; empty object means everything is valid.
  const surveyErrors = useMemo(() => collectSurveyFormatErrors(surveyEdit), [surveyEdit]);
  const hasSurveyErrors = Object.keys(surveyErrors).length > 0;

  const surveyEditMut = useMutation({
    mutationFn: (data: any) => updateSurvey(survey.id, data),
    onSuccess: () => {
      setSurveyEditMode(false);
      queryClient.invalidateQueries({ queryKey: ['survey', stakeholder.id] });
      queryClient.invalidateQueries({ queryKey: ['stakeholders'] });
    },
    onError: (err: any) => {
      alert(getErrorMessage(err, 'Failed to save survey details'));
    },
  });

  const finalizeMut = useMutation({
    mutationFn: () => finalizeSurvey(survey.id),
    onSuccess: () => {
      // The stakeholder is now CLOSED. Refresh the list, the survey, analytics
      // and the export list so the newly-eligible survey appears there.
      queryClient.invalidateQueries({ queryKey: ['stakeholders'] });
      queryClient.invalidateQueries({ queryKey: ['survey', stakeholder.id] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      queryClient.invalidateQueries({ queryKey: ['completedSurveys'] });
      onClose();
    },
    onError: (err: any) => {
      alert(getErrorMessage(err, 'Failed to finalize survey'));
    },
  });

  const confirmFinalize = () => {
    if (!window.confirm(
      'Finalize this survey?\n\n' +
      'The stakeholder will be marked CLOSED and the survey becomes available for export. ' +
      'This is the same as the enumerator submitting it.'
    )) return;
    finalizeMut.mutate();
  };

  // ── Media upload (admin) ──────────────────────────────────────────────────
  // The admin can add PHOTOS to a survey. Video upload was removed by request.
  // Uploads go to the same /media/upload endpoint the app uses (admin bypasses
  // the ownership check server-side).
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploadCategory, setUploadCategory] = useState('ADDITIONAL');

  const uploadMut = useMutation({
    mutationFn: ({ file, category }: { file: File; category?: string }) =>
      uploadMedia(survey.id, file, 'PHOTO', category),
    onSuccess: () => {
      // Refresh the gallery so the new file appears (its presigned URL comes back
      // from getBySurvey), and the survey/list in case counts are shown.
      queryClient.invalidateQueries({ queryKey: ['media', survey?.id] });
      queryClient.invalidateQueries({ queryKey: ['survey', stakeholder.id] });
    },
    onError: (err: any) => {
      alert(getErrorMessage(err, 'Failed to upload file'));
    },
  });

  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (file) uploadMut.mutate({ file, category: uploadCategory });
  };

  const DOC_CATEGORIES = ['GST_DOC', 'PAN_CARD_DOC', 'ESTABLISHMENT_CERT_DOC', 'CUSTOM_DOC'];
  // PERF: don't re-filter the media array on every modal re-render (edit typing,
  // lightbox open/close); recompute only when the underlying media changes.
  const photos = useMemo(() => media.filter((m: any) => m.type === 'PHOTO' && !DOC_CATEGORIES.includes(m.photoCategory)), [media]);
  // 'DOCUMENT'-typed rows are handled by the Business Documents section below,
  // so they never appear in the photo grid regardless of photoCategory.

  // Leaves edit mode the moment you hit Save rather than after the round trip,
  // and writes the new values straight into the cached row so the detail pane and
  // the table behind it both update at once. The server's data:changed broadcast
  // then propagates the same edit to every other open admin session.
  const updateMut = useMutation({
    mutationFn: (data: any) => updateStakeholder(stakeholder.id, data),
    onMutate: async (data: any) => {
      setEditMode(false);
      await queryClient.cancelQueries({ queryKey: ['stakeholders'] });
      const previous = queryClient.getQueriesData({ queryKey: ['stakeholders'] });

      // ['stakeholders', filters, page] — patch the row wherever it appears.
      queryClient.setQueriesData({ queryKey: ['stakeholders'] }, (old: any) => {
        const list = old?.data?.data?.stakeholders;
        if (!Array.isArray(list)) return old;
        return {
          ...old,
          data: {
            ...old.data,
            data: {
              ...old.data.data,
              stakeholders: list.map((row: any) =>
                row.id === stakeholder.id ? { ...row, ...data } : row
              ),
            },
          },
        };
      });

      return { previous };
    },
    onError: (err: any, _vars, ctx: any) => {
      // Restore every snapshot we touched, then reopen the editor so the operator
      // can see and correct what failed.
      ctx?.previous?.forEach(([key, value]: [any, any]) => queryClient.setQueryData(key, value));
      setEditMode(true);
      alert(getErrorMessage(err, 'Failed to update stakeholder'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['stakeholders'] });
      queryClient.invalidateQueries({ queryKey: ['survey', stakeholder.id] });
    },
  });

  /**
   * Permanent delete.
   *
   * Not optimistic, unlike the edit above. An edit that fails can be rolled back
   * into the cache and the editor reopened; a delete that fails after the row has
   * already vanished from the table leaves the operator unsure whether it happened.
   * The row stays put until the server confirms.
   *
   * The server refuses with 409 when surveys are attached, and that message is the
   * useful one ("has 2 surveys attached…"), so it is surfaced verbatim.
   */
  const deleteMut = useMutation({
    mutationFn: () => deleteStakeholder(stakeholder.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stakeholders'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      onClose();
    },
    onError: (err: any) => {
      alert(getErrorMessage(err, 'Failed to delete stakeholder'));
    },
  });

  const confirmDelete = () => {
    const name = stakeholder.companyNameStandardized || stakeholder.companyNameOriginal || 'this stakeholder';
    // Deliberately spells out that it cannot be undone from the UI. The server does
    // keep an audit snapshot, but recovering from it is a manual database job, not
    // something the operator can do here.
    if (!window.confirm(
      `Permanently delete "${name}"?\n\n` +
      `District: ${stakeholder.district || '—'}\n\n` +
      `This cannot be undone from the admin panel.`
    )) return;
    deleteMut.mutate();
  };

  const categoryLabels: Record<string, string> = {
    BUILDING_FRONT: '🏢 Building Front', SIGNBOARD: '🪧 Signboard', INTERIOR: '🏠 Interior', STAKEHOLDER: '👤 Stakeholder', ADDITIONAL: '📸 Additional',
    DISPLAY_IMAGE: '🖼️ Display Image', HEADER_SLIDER: '🎠 Header Slider',
    GST_DOC: '📄 GST Certificate', PAN_CARD_DOC: '📄 PAN Card', ESTABLISHMENT_CERT_DOC: '📄 Establishment Certificate', CUSTOM_DOC: '📄 Custom Doc',
  };

  const isLoading = isSurveyLoading || isMediaLoading;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gallery-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gallery-header">
          <div>
            <h3 style={{ margin: 0 }}>{stakeholder.companyNameStandardized || stakeholder.companyNameOriginal}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
              {stakeholder.district} • {stakeholder.pinCode} • <span className={`badge ${stakeholder.status === 'CLOSED' ? 'badge-active' : 'badge-pending'}`}>{(stakeholder.status || 'OPEN').replace('_', ' ')}</span>
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <LoadingButton
              variant="danger"
              size="sm"
              loading={deleteMut.isPending}
              loadingText="Deleting…"
              onClick={confirmDelete}
            >
              🗑 Delete
            </LoadingButton>
            <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ fontSize: '18px', padding: '8px 12px' }}>✕</button>
          </div>
        </div>

        {isLoading ? (
          // Two chained requests back this modal: the survey, then its media
          // (which is `enabled` only once a survey id exists). The label reflects
          // which stage is running so a slow media fetch does not look stalled.
          <PageLoader label={isSurveyLoading ? 'Loading survey…' : 'Loading photos and documents…'} />
        ) : (
          <div className="gallery-body">
            <div className="gallery-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h4 className="gallery-section-title" style={{ margin: 0 }}>📋 Stakeholder Details</h4>
                {editMode ? (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditMode(false)} disabled={updateMut.isPending}>Cancel</button>
                    <button className="btn btn-primary btn-sm" onClick={() => updateMut.mutate(editData)} disabled={updateMut.isPending}>{updateMut.isPending ? 'Saving...' : 'Save'}</button>
                  </div>
                ) : (
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditMode(true)}>✏️ Edit</button>
                )}
              </div>
              {editMode ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Organization Name</label>
                    <input className="form-input" value={editData.companyNameStandardized} onChange={(e) => setEditData({...editData, companyNameStandardized: e.target.value})} />
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Address Line 1</label>
                      <input className="form-input" value={editData.addressLine1} onChange={(e) => setEditData({...editData, addressLine1: e.target.value})} />
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Address Line 2</label>
                      <input className="form-input" value={editData.addressLine2} onChange={(e) => setEditData({...editData, addressLine2: e.target.value})} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>City</label><input className="form-input" value={editData.city} onChange={(e) => setEditData({...editData, city: e.target.value})} /></div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Taluka</label><input className="form-input" value={editData.taluka} onChange={(e) => setEditData({...editData, taluka: e.target.value})} /></div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Village</label><input className="form-input" value={editData.village} onChange={(e) => setEditData({...editData, village: e.target.value})} /></div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>District</label><input className="form-input" value={editData.district} onChange={(e) => setEditData({...editData, district: e.target.value})} /></div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>State</label><input className="form-input" value={editData.state} onChange={(e) => setEditData({...editData, state: e.target.value})} /></div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}><label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>PIN Code</label><input className="form-input" value={editData.pinCode} onChange={(e) => setEditData({...editData, pinCode: e.target.value})} /></div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Latitude</label>
                      <input type="number" className="form-input" value={editData.latitude} onChange={(e) => {
                        const lat = e.target.value;
                        const numLat = parseFloat(lat);
                        const numLon = parseFloat(editData.longitude);
                        let digipin = editData.digipin;
                        if (!isNaN(numLat) && !isNaN(numLon)) {
                          digipin = getDigiPin(numLat, numLon) || digipin;
                        }
                        setEditData({...editData, latitude: lat, digipin});
                      }} />
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Longitude</label>
                      <input type="number" className="form-input" value={editData.longitude} onChange={(e) => {
                        const lon = e.target.value;
                        const numLat = parseFloat(editData.latitude);
                        const numLon = parseFloat(lon);
                        let digipin = editData.digipin;
                        if (!isNaN(numLat) && !isNaN(numLon)) {
                          digipin = getDigiPin(numLat, numLon) || digipin;
                        }
                        setEditData({...editData, longitude: lon, digipin});
                      }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Category</label>
                      <input className="form-input" value={editData.category} onChange={(e) => setEditData({...editData, category: e.target.value})} />
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>DIGIPIN</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input className="form-input" value={editData.digipin} readOnly style={{ backgroundColor: 'var(--bg-surface)' }} />
                        <CopyButton value={editData.digipin} />
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: '12px', padding: '12px', backgroundColor: 'var(--bg-input)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '8px' }}>Locked Identifiers</div>
                    <div className="gallery-info-grid">
                      <div className="gallery-info-item"><span className="gallery-info-label">GST</span><span className="gallery-info-value">{stakeholder.gstNumber || '—'}</span></div>
                      <div className="gallery-info-item"><span className="gallery-info-label">NIC Code</span><span className="gallery-info-value">{stakeholder.nicCode || '—'}</span></div>
                      <div className="gallery-info-item"><span className="gallery-info-label">Original Name</span><span className="gallery-info-value">{stakeholder.companyNameOriginal || '—'}</span></div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="gallery-info-grid">
                  {[
                    { label: 'Address', value: stakeholder.addressLine1 || stakeholder.fullAddressRaw },
                    { label: 'City', value: stakeholder.city }, { label: 'Taluka', value: stakeholder.taluka }, { label: 'Village', value: stakeholder.village },
                    { label: 'Category', value: stakeholder.category }, { label: 'GST', value: stakeholder.gstNumber }, { label: 'NIC Code', value: stakeholder.nicCode }, { label: 'NIC Description', value: stakeholder.nicDescription },
                    { label: 'Latitude', value: stakeholder.latitude }, { label: 'Longitude', value: stakeholder.longitude }, { label: 'DIGIPIN', value: stakeholder.digipin }
                  ].filter(r => r.value).map((row, i) => (
                    <div key={i} className="gallery-info-item"><span className="gallery-info-label">{row.label}</span><span className="gallery-info-value">{row.value}</span></div>
                  ))}
                </div>
              )}
            </div>
            
            {survey && (
              <div className="gallery-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <h4 className="gallery-section-title" style={{ margin: 0 }}>
                    📝 Survey Data
                    {isSurveyDraft && (
                      <span
                        className={`badge ${survey?.isDraft ? 'badge-pending' : 'badge-admin'}`}
                        style={{ marginLeft: '8px', verticalAlign: 'middle' }}
                      >
                        {survey?.isDraft ? '📝 DRAFT' : 'PARTIAL COMPLETED'}
                      </span>
                    )}
                  </h4>
                  {/* Verification actions — only for a draft (partial) survey. Once
                      finalized the survey is CLOSED and read-only here. */}
                  {isSurveyDraft && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {surveyEditMode ? (
                        <>
                          <button className="btn btn-secondary btn-sm" onClick={() => setSurveyEditMode(false)} disabled={surveyEditMut.isPending}>Cancel</button>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => surveyEditMut.mutate(surveyEdit)}
                            disabled={surveyEditMut.isPending || hasSurveyErrors}
                            title={hasSurveyErrors ? 'Fix the highlighted fields before saving' : undefined}
                          >{surveyEditMut.isPending ? 'Saving…' : 'Save Details'}</button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-secondary btn-sm" onClick={() => setSurveyEditMode(true)}>✏️ Edit Survey</button>
                          <LoadingButton variant="primary" size="sm" loading={finalizeMut.isPending} loadingText="Finalizing…" onClick={confirmFinalize}>✅ Finalize &amp; Close</LoadingButton>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {surveyEditMode ? (
                  /* ── Admin verification editor: fill in / correct before finalizing ── */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <div className="form-group" style={{ flex: 1, minWidth: '200px', marginBottom: 0 }}><label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Business Name</label><input className="form-input" value={surveyEdit.businessName} onChange={(e) => setSurveyEdit({ ...surveyEdit, businessName: e.target.value })} /></div>
                      <div className="form-group" style={{ flex: 1, minWidth: '200px', marginBottom: 0 }}><label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Owner / Proprietor</label><input className="form-input" value={surveyEdit.ownerName} onChange={(e) => setSurveyEdit({ ...surveyEdit, ownerName: e.target.value })} /></div>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <div className="form-group" style={{ flex: 1, minWidth: '160px', marginBottom: 0 }}>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Mobile</label>
                        <input className="form-input" style={surveyErrors.mobileNumber ? { borderColor: 'var(--danger, #ef4444)' } : undefined} value={surveyEdit.mobileNumber} onChange={(e) => setSurveyEdit({ ...surveyEdit, mobileNumber: e.target.value })} />
                        {surveyErrors.mobileNumber && <div style={{ color: 'var(--danger, #ef4444)', fontSize: '11px', marginTop: '4px' }}>{surveyErrors.mobileNumber}</div>}
                      </div>
                      <div className="form-group" style={{ flex: 1, minWidth: '160px', marginBottom: 0 }}>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Email</label>
                        <input className="form-input" style={surveyErrors.email ? { borderColor: 'var(--danger, #ef4444)' } : undefined} value={surveyEdit.email} onChange={(e) => setSurveyEdit({ ...surveyEdit, email: e.target.value })} />
                        {surveyErrors.email && <div style={{ color: 'var(--danger, #ef4444)', fontSize: '11px', marginTop: '4px' }}>{surveyErrors.email}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <div className="form-group" style={{ flex: 1, minWidth: '140px', marginBottom: 0 }}><label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>District</label><input className="form-input" value={surveyEdit.district} onChange={(e) => setSurveyEdit({ ...surveyEdit, district: e.target.value })} /></div>
                      <div className="form-group" style={{ flex: 1, minWidth: '140px', marginBottom: 0 }}><label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>City</label><input className="form-input" value={surveyEdit.city} onChange={(e) => setSurveyEdit({ ...surveyEdit, city: e.target.value })} /></div>
                      <div className="form-group" style={{ flex: 1, minWidth: '120px', marginBottom: 0 }}>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>PIN Code</label>
                        <input className="form-input" style={surveyErrors.pinCode ? { borderColor: 'var(--danger, #ef4444)' } : undefined} value={surveyEdit.pinCode} onChange={(e) => setSurveyEdit({ ...surveyEdit, pinCode: e.target.value })} />
                        {surveyErrors.pinCode && <div style={{ color: 'var(--danger, #ef4444)', fontSize: '11px', marginTop: '4px' }}>{surveyErrors.pinCode}</div>}
                      </div>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}><label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Business Address</label><input className="form-input" value={surveyEdit.businessAddress} onChange={(e) => setSurveyEdit({ ...surveyEdit, businessAddress: e.target.value })} /></div>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <div className="form-group" style={{ flex: 1, minWidth: '160px', marginBottom: 0 }}>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Aadhar Number</label>
                        <input className="form-input" inputMode="numeric" maxLength={12} style={surveyErrors.aadharNumber ? { borderColor: 'var(--danger, #ef4444)' } : undefined} value={surveyEdit.aadharNumber} onChange={(e) => setSurveyEdit({ ...surveyEdit, aadharNumber: e.target.value })} />
                        {surveyErrors.aadharNumber && <div style={{ color: 'var(--danger, #ef4444)', fontSize: '11px', marginTop: '4px' }}>{surveyErrors.aadharNumber}</div>}
                      </div>
                      <div className="form-group" style={{ flex: 1, minWidth: '160px', marginBottom: 0 }}>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>PAN Number</label>
                        <input className="form-input" maxLength={10} style={{ textTransform: 'uppercase', ...(surveyErrors.panNumber ? { borderColor: 'var(--danger, #ef4444)' } : {}) }} value={surveyEdit.panNumber} onChange={(e) => setSurveyEdit({ ...surveyEdit, panNumber: e.target.value.toUpperCase() })} />
                        {surveyErrors.panNumber && <div style={{ color: 'var(--danger, #ef4444)', fontSize: '11px', marginTop: '4px' }}>{surveyErrors.panNumber}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <div className="form-group" style={{ flex: 1, minWidth: '160px', marginBottom: 0 }}><label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Udyam Aadhar Reg. No.</label><input className="form-input" value={surveyEdit.udyamAadharRegNo} onChange={(e) => setSurveyEdit({ ...surveyEdit, udyamAadharRegNo: e.target.value })} /></div>
                      <div className="form-group" style={{ flex: 1, minWidth: '160px', marginBottom: 0 }}>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>GST Number</label>
                        <input className="form-input" maxLength={15} style={{ textTransform: 'uppercase', ...(surveyErrors.gstNumber ? { borderColor: 'var(--danger, #ef4444)' } : {}) }} value={surveyEdit.gstNumber} onChange={(e) => setSurveyEdit({ ...surveyEdit, gstNumber: e.target.value.toUpperCase() })} />
                        {surveyErrors.gstNumber && <div style={{ color: 'var(--danger, #ef4444)', fontSize: '11px', marginTop: '4px' }}>{surveyErrors.gstNumber}</div>}
                      </div>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}><label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Description</label><textarea className="form-input" rows={3} value={surveyEdit.description} onChange={(e) => setSurveyEdit({ ...surveyEdit, description: e.target.value })} /></div>

                    {/* ── Working Hours ── per-day Open / Closed / custom from–to. */}
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Working Hours</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {(surveyEdit.workingHours || []).map((wh: any, idx: number) => (
                          <div key={wh.day} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ width: '44px', fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>{wh.day.slice(0, 3)}</span>
                            <select
                              className="form-input"
                              style={{ width: 'auto', padding: '4px 8px', fontSize: '12px' }}
                              value={wh.type}
                              onChange={(e) => {
                                const type = e.target.value;
                                setSurveyEdit({
                                  ...surveyEdit,
                                  workingHours: surveyEdit.workingHours.map((w: any, i: number) => i === idx ? { ...w, type } : w),
                                });
                              }}
                            >
                              <option value="open_all_day">Open all day</option>
                              <option value="closed">Closed</option>
                              <option value="hours">Custom hours</option>
                            </select>
                            {wh.type === 'hours' && (
                              <>
                                <input
                                  className="form-input" placeholder="09:00" style={{ width: '70px', padding: '4px 8px', fontSize: '12px' }}
                                  value={wh.from || ''}
                                  onChange={(e) => { const from = e.target.value; setSurveyEdit({ ...surveyEdit, workingHours: surveyEdit.workingHours.map((w: any, i: number) => i === idx ? { ...w, from } : w) }); }}
                                />
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>–</span>
                                <input
                                  className="form-input" placeholder="17:00" style={{ width: '70px', padding: '4px 8px', fontSize: '12px' }}
                                  value={wh.to || ''}
                                  onChange={(e) => { const to = e.target.value; setSurveyEdit({ ...surveyEdit, workingHours: surveyEdit.workingHours.map((w: any, i: number) => i === idx ? { ...w, to } : w) }); }}
                                />
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* ── Terms & Conditions ── the three acknowledgement flags. */}
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Terms &amp; Conditions</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                          <input type="checkbox" checked={!!surveyEdit.agreedToTerms} onChange={(e) => setSurveyEdit({ ...surveyEdit, agreedToTerms: e.target.checked })} />
                          Agreed to Terms &amp; Conditions
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                          <input type="checkbox" checked={!!surveyEdit.declaredInfoCorrect} onChange={(e) => setSurveyEdit({ ...surveyEdit, declaredInfoCorrect: e.target.checked })} />
                          Declared info correct
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                          <input type="checkbox" checked={!!surveyEdit.acknowledgedDotLiability} onChange={(e) => setSurveyEdit({ ...surveyEdit, acknowledgedDotLiability: e.target.checked })} />
                          Acknowledged DOT liability
                        </label>
                      </div>
                    </div>
                  </div>
                ) : (
                <>
                <div className="gallery-info-grid">
                  {[
                    { label: 'Mobile', value: survey.mobileNumber }, { label: 'Email', value: survey.email },
                  ].filter(r => r.value).map((row, i) => (
                    <div key={i} className="gallery-info-item"><span className="gallery-info-label">{row.label}</span><span className="gallery-info-value">{row.value}</span></div>
                  ))}
                </div>

                {/* Business Category / Sub-categories are no longer shown: the
                    survey form's Category step was removed, so new surveys never
                    carry them. (The stakeholder's own `category` column, shown in
                    the table and Record Details above, is a different field and is
                    unaffected.) */}

                {/* ─── New Plan: Business Info ─── */}
                {(survey.businessName || survey.ownerName) && (
                  <div style={{ marginTop: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '8px' }}>Business Information</div>
                    <div className="gallery-info-grid">
                      {[
                        { label: 'Business Name', value: survey.businessName },
                        { label: 'Owner', value: survey.ownerName },
                        { label: 'District', value: survey.district },
                        { label: 'City', value: survey.city },
                        { label: 'PIN Code', value: survey.pinCode },
                        { label: 'Business Address', value: survey.businessAddress },
                      ].filter(r => r.value).map((row, i) => (
                        <div key={i} className="gallery-info-item"><span className="gallery-info-label">{row.label}</span><span className="gallery-info-value">{row.value}</span></div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ─── Government IDs & Registrations ─── */}
                {(survey.aadharNumber || survey.panNumber || survey.udyamAadharRegNo) && (
                  <div style={{ marginTop: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '8px' }}>Government IDs & Registrations</div>
                    <div className="gallery-info-grid">
                      {[
                        { label: 'Aadhar Card Number', value: survey.aadharNumber },
                        { label: 'PAN Card Number', value: survey.panNumber },
                        { label: 'Udyam Aadhar Reg. No.', value: survey.udyamAadharRegNo },
                      ].filter(r => r.value).map((row, i) => (
                        <div key={i} className="gallery-info-item"><span className="gallery-info-label">{row.label}</span><span className="gallery-info-value">{row.value}</span></div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ─── New Plan: Details ─── */}
                {survey.description && (
                  <div style={{ marginTop: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>Description</div>
                    <p style={{ color: 'var(--text-primary)', fontSize: '14px', lineHeight: '1.5' }}>{survey.description}</p>
                  </div>
                )}
                {survey.accommodationFacilities && Array.isArray(survey.accommodationFacilities) && survey.accommodationFacilities.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>Facilities</div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {survey.accommodationFacilities.map((f: string, i: number) => <span key={i} className="badge badge-pending">{f}</span>)}
                    </div>
                  </div>
                )}
                {survey.workingHours && Array.isArray(survey.workingHours) && (
                  <div style={{ marginTop: '12px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>Working Hours</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '4px' }}>
                      {survey.workingHours.map((wh: any, i: number) => (
                        <div key={i} style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                          <strong>{wh.day?.slice(0, 3)}:</strong> {wh.type === 'open_all_day' ? 'Open' : wh.type === 'closed' ? 'Closed' : `${wh.from}–${wh.to}`}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {survey.faq && Array.isArray(survey.faq) && survey.faq.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>FAQ</div>
                    {survey.faq.map((f: any, i: number) => (
                      <div key={i} style={{ marginBottom: '8px', padding: '8px', backgroundColor: 'var(--bg-input)', borderRadius: '6px' }}>
                        <div style={{ fontWeight: '600', fontSize: '13px', color: 'var(--text-primary)' }}>Q: {f.question}</div>
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>A: {f.answer}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ─── New Plan: Rooms & Pricing (Accommodations) ─── */}
                {survey.rooms && Array.isArray(survey.rooms) && survey.rooms.length > 0 && (
                  <div style={{ marginTop: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>Rooms & Pricing</div>
                    <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                      <thead><tr style={{ borderBottom: '1px solid var(--border)' }}><th style={{ textAlign: 'left', padding: '4px' }}>Name</th><th>Type</th><th>Guests</th><th>Price/Night</th></tr></thead>
                      <tbody>
                        {survey.rooms.map((r: any, i: number) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '4px' }}>{r.name}</td><td style={{ textAlign: 'center' }}>{r.type}</td><td style={{ textAlign: 'center' }}>{r.capacity}</td><td style={{ textAlign: 'center' }}>₹{r.price}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    {survey.saleOff > 0 && <div style={{ marginTop: '8px', fontSize: '13px' }}>Sale Off: <strong>{survey.saleOff}%</strong></div>}
                    {survey.bookingNote && <div style={{ marginTop: '4px', fontSize: '13px', color: 'var(--text-secondary)' }}>Booking Note: {survey.bookingNote}</div>}
                  </div>
                )}

                {/* ─── New Plan: Social Links ─── */}
                {survey.socialLinks && Array.isArray(survey.socialLinks) && survey.socialLinks.length > 0 && (
                  <div style={{ marginTop: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>Social Links</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {survey.socialLinks.map((sl: any, i: number) => (
                        <div key={i} style={{ fontSize: '13px' }}><strong>{sl.platform}:</strong> <a href={sl.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>{sl.url}</a></div>
                      ))}
                    </div>
                  </div>
                )}

                {/* The Business Documents step (About Business) was removed from the
                    survey form, so there is nothing to display here any more. */}

                {/* ─── New Plan: Terms ─── */}
                {(survey.agreedToTerms || survey.declaredInfoCorrect || survey.acknowledgedDotLiability) && (
                  <div style={{ marginTop: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>Terms & Conditions</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' }}>
                      <div>{survey.agreedToTerms ? '✅' : '❌'} Agreed to Terms & Conditions</div>
                      <div>{survey.declaredInfoCorrect ? '✅' : '❌'} Declared info correct</div>
                      <div>{survey.acknowledgedDotLiability ? '✅' : '❌'} Acknowledged DOT liability</div>
                    </div>
                  </div>
                )}

                {(survey.digipin || stakeholder.digipin) && (
                  <div style={{ marginTop: '16px', padding: '12px', backgroundColor: 'var(--bg-input)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>OFFICIAL DIGIPIN</span>
                      <span style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)', letterSpacing: '2px', fontFamily: 'monospace' }}>{survey.digipin || stakeholder.digipin}</span>
                    </div>
                    <CopyButton value={survey.digipin || stakeholder.digipin} label="📋 Copy" size="sm" />
                  </div>
                )}
                </>
                )}
              </div>
            )}
            
            <div className="gallery-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                <h4 className="gallery-section-title" style={{ margin: 0 }}>📷 Verification Photos ({photos.length})</h4>
                {/* Admin can add photos to any survey (upload allowed even after it
                    is finalized). Category applies to the photo. Video upload was
                    removed by request. */}
                {survey && (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <select className="form-input" style={{ width: 'auto', padding: '4px 8px', fontSize: '12px' }} value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value)} disabled={uploadMut.isPending}>
                      <option value="BUILDING_FRONT">Building Front</option>
                      <option value="SIGNBOARD">Signboard</option>
                      <option value="INTERIOR">Interior</option>
                      <option value="ADDITIONAL">Additional</option>
                    </select>
                    <input ref={photoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickPhoto} />
                    <button className="btn btn-secondary btn-sm" onClick={() => photoInputRef.current?.click()} disabled={uploadMut.isPending}>📷 Add Photo</button>
                    {uploadMut.isPending && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Uploading…</span>}
                  </div>
                )}
              </div>
              {photos.length > 0 ? (
                <div className="photo-grid">
                  {photos.map((photo: any) => (
                    <div key={photo.id} className="photo-card" onClick={() => setLightbox(photo.fileUrl)}>
                      <img src={photo.fileUrl} alt="Photo" loading="lazy" decoding="async" />
                      <div className="photo-card-overlay">
                        <span className="photo-card-category">{categoryLabels[photo.photoCategory] || photo.photoCategory}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="gallery-empty">No photos uploaded yet</div>}
            </div>
          </div>
        )}
      </div>
      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Full size" />
          <button className="lightbox-close" onClick={() => setLightbox(null)}>✕</button>
        </div>
      )}
    </div>
  );
}

/**
 * The fields captured when adding a stakeholder by hand.
 *
 * Deliberately the SAME nine as the mobile app's add form (see ADD_FIELDS in
 * mobile StakeholderListScreen.tsx), so the two entry points collect the same
 * shape and a record looks identical whichever client created it. Previously this
 * form exposed all 34 columns; it was cut to match the field workflow on request.
 *
 * DISTRICT
 * Unlike the mobile form, the admin picks the district explicitly from a
 * searchable dropdown of the real districts. The admin account has no assigned
 * district to fall back on — the mobile auto-assignment would leave the row with a
 * NULL district, which every district-filtered query excludes — so on this form it
 * is a required choice. The backend already takes an explicit district for an
 * admin as-is (it only falls back when none is sent), so no server change is
 * needed.
 *
 * Two columns shown on the detail screen are still NOT inputs here:
 *   Data Source forced to 'MANUAL', the marker that separates hand-entered rows
 *               from MCA/Udyam imports
 *   Status      new records always start OPEN
 * They are surfaced read-only below the inputs so the operator can see what the
 * record will end up with.
 *
 * Address maps to fullAddressRaw, not addressLine1 — that is the column the detail
 * views read for the ADDRESS row, so writing addressLine1 here would save a value
 * that never displays.
 */
type AddField = {
  key: string;
  label: string;
  placeholder?: string;
  maxLength?: number;
  numeric?: boolean;
  multiline?: boolean;
};

const ADD_FIELDS: AddField[] = [
  { key: 'companyNameStandardized', label: 'Organization Name *', placeholder: 'e.g. Datt Niwara Hotel', maxLength: 500 },
  { key: 'companyNameOriginal', label: 'Company Name', maxLength: 500 },
  { key: 'category', label: 'Category', placeholder: 'e.g. Worker Hostels', maxLength: 200 },
  { key: 'fullAddressRaw', label: 'Address', maxLength: 1000, multiline: true },
  { key: 'city', label: 'City', maxLength: 200 },
  { key: 'state', label: 'State', maxLength: 200 },
  { key: 'pinCode', label: 'PIN Code', numeric: true, maxLength: 10 },
  { key: 'nicCode', label: 'NIC Code', maxLength: 20 },
  { key: 'nicDescription', label: 'NIC Description', maxLength: 500, multiline: true },
];

/**
 * Create a stakeholder by hand, matching the mobile add form.
 *
 * The server assigns primaryKeyId and stamps dataSource='MANUAL', and confines a
 * non-admin to their assigned districts. The 8 server-owned columns (id,
 * primaryKeyId, createdAt, updatedAt, status, lockedById, lockedAt, dataSource)
 * are never accepted from a client.
 */
function AddStakeholderModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();

  const [form, setForm] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of ADD_FIELDS) initial[f.key] = '';
    // Every record in this dataset is Maharashtra; prefilling saves a keystroke and
    // the field stays editable.
    initial.state = 'Maharashtra';
    return initial;
  });

  const [district, setDistrict] = useState('');

  // The same district list the Enumerators page uses, cached for 10m under the
  // shared 'districts' key so opening this modal is instant after the first load.
  const { data: districtsRes, isLoading: districtsLoading } = useQuery({
    queryKey: ['districts'],
    queryFn: getDistricts,
    staleTime: 10 * 60 * 1000,
  });
  // The dropdown is keyed on the district NAME, not id: the stakeholders table
  // stores the name string, the createStakeholder endpoint expects a name, and the
  // partition/scope logic matches on it. Sending an id would store a UUID no query
  // would ever match.
  const districtNames: string[] = ((districtsRes?.data?.data as District[]) || [])
    .map(d => d.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const createMut = useMutation({
    mutationFn: () => {
      // The server schema is .strict(), so unknown keys are a 400. Only non-empty
      // fields are sent, to keep the payload to what the operator actually entered.
      const payload: Record<string, string> = { district };
      for (const f of ADD_FIELDS) {
        const v = form[f.key]?.trim();
        if (v) payload[f.key] = v;
      }
      return createStakeholder(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stakeholders'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      onClose();
    },
    onError: (err: any) => {
      // getErrorMessage already unpacks the server's validation `details` (field +
      // message). The old inline version read `detail.path`, but the backend sends
      // `detail.field`, so the field name never actually showed.
      alert(getErrorMessage(err, 'Failed to create stakeholder'));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.companyNameStandardized.trim()) {
      alert('Organization name is required.');
      return;
    }
    if (!district) {
      alert('Select a district.');
      return;
    }
    createMut.mutate();
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '12px', fontWeight: 600,
    color: 'var(--text-muted)', marginBottom: '4px',
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gallery-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
        <div className="gallery-header">
          <div>
            <h3 style={{ margin: 0 }}>Add Stakeholder</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
              Organization name and district are required. The record is created
              with source <code>MANUAL</code> and status OPEN.
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ fontSize: '18px', padding: '8px 12px' }}>✕</button>
        </div>

        <div className="gallery-body">
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {ADD_FIELDS.map((f, i) => (
              <div className="form-group" key={f.key} style={{ marginBottom: 0 }}>
                <label style={labelStyle}>
                  {f.label.endsWith(' *') ? (
                    <>{f.label.slice(0, -2)} <span style={{ color: '#e5484d' }}>*</span></>
                  ) : f.label}
                </label>
                {f.multiline ? (
                  <textarea
                    className="form-input"
                    value={form[f.key] ?? ''}
                    onChange={(e) => set(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    maxLength={f.maxLength}
                    disabled={createMut.isPending}
                    rows={2}
                    style={{ resize: 'vertical' }}
                  />
                ) : (
                  <input
                    className="form-input"
                    // inputMode rather than type=number: PIN code is digits but not
                    // a quantity, and type=number would allow 'e'/'-' and strip
                    // leading zeros.
                    inputMode={f.numeric ? 'numeric' : undefined}
                    value={form[f.key] ?? ''}
                    onChange={(e) => set(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    maxLength={f.maxLength}
                    disabled={createMut.isPending}
                    autoFocus={i === 0}
                  />
                )}
              </div>
            ))}

            {/* District — an explicit, searchable choice on the admin form.
                A text input backed by a <datalist> gives type-to-filter over the
                real districts with no extra dependency, while still accepting only
                a value from the list (enforced on submit below). */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={labelStyle}>
                District <span style={{ color: '#e5484d' }}>*</span>
              </label>
              <input
                className="form-input"
                list="add-stakeholder-districts"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                placeholder={districtsLoading ? 'Loading districts…' : 'Type to search…'}
                disabled={createMut.isPending || districtsLoading}
                autoComplete="off"
              />
              <datalist id="add-stakeholder-districts">
                {districtNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              {/* Only flag a mismatch once something has been typed, so the field
                  is not red before the operator has touched it. */}
              {district.trim() !== '' && !districtNames.includes(district) && (
                <div style={{ fontSize: '12px', color: '#e5484d', marginTop: '4px' }}>
                  Choose a district from the list.
                </div>
              )}
            </div>

            {/* Set by the server, shown so the operator is not surprised by what
                appears on the detail screen afterwards. District is no longer here:
                the admin picks it above. */}
            <div style={{
              padding: '12px', backgroundColor: 'var(--bg-input)',
              borderRadius: '8px', border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                Set automatically
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.6 }}>
                Data Source — MANUAL<br />
                Status — OPEN
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '4px' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={createMut.isPending}>
                Cancel
              </button>
              <LoadingButton
                type="submit"
                variant="primary"
                loading={createMut.isPending}
                loadingText="Creating…"
                // Only a district that exists in the list may be submitted, so a
                // typo cannot create a stakeholder in a district that does not
                // exist (which would then be invisible to every district filter).
                disabled={!districtNames.includes(district)}
                title={districtNames.includes(district) ? undefined : 'Select a district from the list first'}
              >
                Create Stakeholder
              </LoadingButton>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
