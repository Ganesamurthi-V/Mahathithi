import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { searchStakeholders, updateStakeholder, getSurveyByStakeholder, getMediaBySurvey } from '../api';

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
  const [filters, setFilters] = useState({ name: '', district: '', pinCode: '', category: '', status: '' });
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
  // PERF: don't re-filter the media array on every modal re-render (edit typing,
  // lightbox open/close); recompute only when the underlying media changes.
  const photos = useMemo(() => media.filter((m: any) => m.type === 'PHOTO'), [media]);
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
                  <div className="form-group" style={{ marginBottom: 0 }}><label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Category</label><input className="form-input" value={editData.category} onChange={(e) => setEditData({...editData, category: e.target.value})} /></div>
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
