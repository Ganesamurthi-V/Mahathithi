import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { searchStakeholders, updateStakeholder, getSurveyByStakeholder, getMediaBySurvey } from '../api';
import { getDigiPin } from '../utils/digipin';

// PERF: pure helper hoisted to module scope so it isn't re-created each render
// and a memoized row can reference it without breaking memoization.
const getStatusBadge = (status: string) => {
  const map: Record<string, string> = { PENDING: 'badge-pending', IN_PROGRESS: 'badge-active', IN_REVIEW: 'badge-admin', CLOSED: 'badge-active' };
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

export default function StakeholdersPage() {
  const [filters, setFilters] = useState({ name: '', district: '', pinCode: '', digipin: '', category: '', status: '' });
  const [debouncedFilters, setDebouncedFilters] = useState(filters);
  const [page, setPage] = useState(1);
  const [selectedStakeholder, setSelectedStakeholder] = useState<any>(null);

  // Debounce filter changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
      setPage(1); // Reset to page 1 on search
    }, 500);
    return () => clearTimeout(timer);
  }, [filters]);

  const { data, isLoading } = useQuery({
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
  const total = data?.data?.data?.pagination?.total || data?.data?.data?.total || data?.data?.data?.length || 0;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setDebouncedFilters(filters);
    setPage(1);
  };

  // PERF: stable handler reference so memoized rows don't re-render on every keystroke.
  const handleSelect = useCallback((s: any) => setSelectedStakeholder(s), []);

  return (
    <>
      <div className="page-header">
        <h2>Stakeholders</h2>
        <p>Browse and verify stakeholder submissions with photos and videos</p>
      </div>

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
              <option value="PENDING">Open</option>
              <option value="CLOSED">Closed</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" style={{ height: '42px' }} disabled={isLoading}>
            {isLoading ? '...' : '🔍 Search'}
          </button>
        </form>
      </div>

      <div style={{ marginBottom: '16px', fontSize: '13px', color: 'var(--text-muted)' }}>
        Showing {stakeholders.length} results {total > 0 && `of ${total.toLocaleString()} total`}
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Organization</th>
              <th>District</th>
              <th>City / Taluka</th>
              <th>PIN Code</th>
              <th>DIGIPIN</th>
              <th>Category</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {stakeholders.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  {isLoading ? 'Searching...' : 'No stakeholders found. Try adjusting your search filters.'}
                </td>
              </tr>
            )}
            {stakeholders.map((s: any) => (
              <StakeholderRow key={s.id} s={s} onSelect={handleSelect} />
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '24px' }}>
        <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</button>
        <span style={{ display: 'flex', alignItems: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>Page {page}</span>
        <button className="btn btn-secondary btn-sm" disabled={stakeholders.length < 20} onClick={() => setPage(page + 1)}>Next →</button>
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
  const DOC_CATEGORIES = ['UDYOG_AADHAR_DOC', 'AADHAR_CARD_DOC', 'PAN_CARD_DOC', 'CANCELLED_CHEQUE_DOC', 'CUSTOM_DOC'];
  // PERF: don't re-filter the media array on every modal re-render (edit typing,
  // lightbox open/close); recompute only when the underlying media changes.
  const photos = useMemo(() => media.filter((m: any) => m.type === 'PHOTO' && !DOC_CATEGORIES.includes(m.photoCategory)), [media]);
  const videos = useMemo(() => media.filter((m: any) => m.type === 'VIDEO'), [media]);

  const updateMut = useMutation({
    mutationFn: (data: any) => updateStakeholder(stakeholder.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stakeholders'] });
      setEditMode(false);
    },
    onError: (err: any) => {
      alert(err.response?.data?.error?.message || 'Failed to update stakeholder');
    }
  });

  const categoryLabels: Record<string, string> = {
    BUILDING_FRONT: '🏢 Building Front', SIGNBOARD: '🪧 Signboard', INTERIOR: '🏠 Interior', STAKEHOLDER: '👤 Stakeholder', ADDITIONAL: '📸 Additional',
    DISPLAY_IMAGE: '🖼️ Display Image', HEADER_SLIDER: '🎠 Header Slider',
    UDYOG_AADHAR_DOC: '📄 Udyog Aadhar', AADHAR_CARD_DOC: '📄 Aadhar Card', PAN_CARD_DOC: '📄 PAN Card', CANCELLED_CHEQUE_DOC: '📄 Cancelled Cheque', CUSTOM_DOC: '📄 Custom Doc',
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
          <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ fontSize: '18px', padding: '8px 12px' }}>✕</button>
        </div>

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>Loading verification data...</div>
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
                        <button type="button" className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(editData.digipin)}>Copy</button>
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
                <h4 className="gallery-section-title">📝 Survey Data</h4>
                <div className="gallery-info-grid">
                  {[
                    { label: 'Contact Person', value: survey.contactPerson }, { label: 'Designation', value: survey.designation },
                    { label: 'Mobile', value: survey.mobileNumber }, { label: 'Email', value: survey.email },
                    { label: 'Website', value: survey.website }, { label: 'Org Type', value: survey.organizationType },
                    { label: 'Remarks', value: survey.remarks },
                  ].filter(r => r.value).map((row, i) => (
                    <div key={i} className="gallery-info-item"><span className="gallery-info-label">{row.label}</span><span className="gallery-info-value">{row.value}</span></div>
                  ))}
                </div>

                {/* ─── New Plan: Category & Sub-categories ─── */}
                {survey.businessCategory && (
                  <div style={{ marginTop: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>Business Category</div>
                    <span className="badge badge-active">{survey.businessCategory}</span>
                    {survey.subCategories && survey.subCategories.length > 0 && (
                      <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {survey.subCategories.map((sc: string, i: number) => <span key={i} className="badge badge-pending">{sc}</span>)}
                      </div>
                    )}
                  </div>
                )}

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
                        { label: 'Taluka', value: survey.taluka },
                        { label: 'Village', value: survey.village },
                        { label: 'PIN Code', value: survey.pinCode },
                        { label: 'Business Address', value: survey.businessAddress },
                        { label: 'Working Address', value: survey.workingAddress },
                        { label: 'Male Employees', value: survey.maleEmployees?.toString() },
                        { label: 'Female Employees', value: survey.femaleEmployees?.toString() },
                        { label: 'Landline', value: survey.landline },
                        { label: 'Alternate Mobile', value: survey.alternateMobile },
                        { label: 'Alternate Email', value: survey.alternateEmail },
                        { label: 'Aadhar', value: survey.aadharNumber ? `XXXX-XXXX-${survey.aadharNumber.slice(-4)}` : undefined },
                        { label: 'Udyam Aadhar', value: survey.udyamAadharRegNo },
                        { label: 'GST Number', value: survey.gstNumber },
                        { label: 'FSSAI Number', value: survey.fssaiNumber },
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

                {/* ─── New Plan: Documents & Certifications ─── */}
                {(survey.aboutBusiness || survey.registeredTravelForLife || survey.registeredGreenLeaf || survey.receivedTourismAward) && (
                  <div style={{ marginTop: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>Business Documents</div>
                    {survey.aboutBusiness && <p style={{ fontSize: '13px', color: 'var(--text-primary)', marginBottom: '8px' }}>{survey.aboutBusiness}</p>}
                    <div className="gallery-info-grid">
                      {[
                        { label: 'Travel for Life', value: survey.registeredTravelForLife ? 'Yes' : 'No' },
                        { label: 'Green Leaf Rating', value: survey.registeredGreenLeaf ? 'Yes' : 'No' },
                        { label: 'Tourism Award', value: survey.receivedTourismAward ? 'Yes' : 'No' },
                      ].map((row, i) => (
                        <div key={i} className="gallery-info-item"><span className="gallery-info-label">{row.label}</span><span className="gallery-info-value">{row.value}</span></div>
                      ))}
                    </div>
                  </div>
                )}

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
                    <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(survey.digipin || stakeholder.digipin)}>📋 Copy</button>
                  </div>
                )}
              </div>
            )}
            
            <div className="gallery-section">
              <h4 className="gallery-section-title">📷 Verification Photos ({photos.length})</h4>
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

            <div className="gallery-section">
              <h4 className="gallery-section-title">📄 Business Documents</h4>
              {(() => {
                const docs = media.filter((m: any) => ['UDYOG_AADHAR_DOC', 'AADHAR_CARD_DOC', 'PAN_CARD_DOC', 'CANCELLED_CHEQUE_DOC', 'CUSTOM_DOC'].includes(m.photoCategory));
                return docs.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                    {docs.map((doc: any) => (
                      <div key={doc.id} style={{ padding: '12px', backgroundColor: 'var(--bg-input)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '8px' }}>{categoryLabels[doc.photoCategory] || doc.photoCategory}</div>
                        {doc.mimeType?.startsWith('image/') ? (
                          <img src={doc.fileUrl} alt={doc.fileName} style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '6px', cursor: 'pointer', marginBottom: '8px' }} onClick={() => setLightbox(doc.fileUrl)} />
                        ) : (
                          <div style={{ width: '100%', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-surface)', borderRadius: '6px', marginBottom: '8px' }}>
                            <span style={{ fontSize: '32px' }}>📄</span>
                          </div>
                        )}
                        <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: 'var(--primary)', wordBreak: 'break-all' }}>{doc.fileName || 'View Document'}</a>
                      </div>
                    ))}
                  </div>
                ) : <div className="gallery-empty">No documents uploaded yet</div>;
              })()}
            </div>

            <div className="gallery-section">
              <h4 className="gallery-section-title">🎥 Verification Video ({videos.length})</h4>
              {videos.length > 0 ? (
                <div className="video-grid">
                  {videos.map((video: any) => (
                    <div key={video.id} className="video-card">
                      <video controls preload="metadata" style={{ width: '100%', borderRadius: '8px' }}><source src={video.fileUrl} />No video</video>
                    </div>
                  ))}
                </div>
              ) : <div className="gallery-empty">No video uploaded yet</div>}
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
