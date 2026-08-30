import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getEnumerators, getDistricts, createEnumerator, updateEnumerator, deleteEnumerator, assignDistricts } from '../api';
import { Enumerator, District } from '../types';
import {
  LoadingButton,
  TableSkeletonWithHeader,
  RefetchOverlay,
  InlineLoader,
  SkeletonBlock,
} from '../components/Loading';

export default function EnumeratorsPage() {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState<Enumerator | null>(null);
  const [toast, setToast] = useState<{ type: string; message: string } | null>(null);

  const showToast = (type: string, message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: enumeratorsRes, isLoading: enumLoading, isFetching: enumFetching } = useQuery({
    queryKey: ['enumerators'],
    queryFn: getEnumerators,
  });

  const { data: districtsRes, isLoading: districtsLoading } = useQuery({
    queryKey: ['districts'],
    queryFn: getDistricts,
    // PERF: districts change rarely — cache for 10m so opening/closing the
    // create/assign modals doesn't refetch the list every time.
    staleTime: 10 * 60_000,
  });

  const enumerators: Enumerator[] = enumeratorsRes?.data?.data || [];
  const districts: District[] = districtsRes?.data?.data || [];

  const createMut = useMutation({
    mutationFn: createEnumerator,
    onSuccess: (res, vars) => {
      showToast('success', `Enumerator "${vars.name}" created successfully`);
      setShowCreateModal(false);
      queryClient.invalidateQueries({ queryKey: ['enumerators'] });
    },
    onError: (err: any) => {
      showToast('error', err.response?.data?.error?.message || 'Failed to create enumerator');
    }
  });

  const toggleActiveMut = useMutation({
    mutationFn: (e: Enumerator) => updateEnumerator(e.id, { isActive: !e.isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enumerators'] });
    }
  });

  const assignMut = useMutation({
    mutationFn: ({ id, dIds }: { id: string, dIds: string[] }) => assignDistricts(id, dIds),
    onSuccess: () => {
      showToast('success', 'Districts assigned successfully');
      setShowAssignModal(null);
      queryClient.invalidateQueries({ queryKey: ['enumerators'] });
    }
  });

  const deleteMut = useMutation({
    mutationFn: deleteEnumerator,
    onSuccess: () => {
      showToast('success', 'Enumerator deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['enumerators'] });
    },
    onError: (err: any) => {
      showToast('error', err.response?.data?.error?.message || 'Failed to delete enumerator');
    }
  });

  const handleToggleActive = (e: Enumerator) => toggleActiveMut.mutate(e);
  const handleDeleteEnumerator = (e: Enumerator) => {
    if (window.confirm(`Are you sure you want to delete enumerator "${e.name}"?`)) {
      deleteMut.mutate(e.id);
    }
  };

  // Which specific row is mid-request. TanStack exposes the in-flight `variables`
  // for a pending mutation, which lets a shared mutation drive a per-row spinner
  // instead of every row reacting to the same global isPending flag.
  const togglingId = toggleActiveMut.isPending ? toggleActiveMut.variables?.id : undefined;
  const deletingId = deleteMut.isPending ? deleteMut.variables : undefined;

  const TABLE_HEADERS = ['Name', 'Login ID', 'Phone', 'Districts', 'Surveys', 'Status', 'Actions'];

  // First load shows a table-shaped skeleton rather than replacing the whole page
  // with text, so the header and Create button stay usable and nothing shifts.
  if (enumLoading) {
    return (
      <>
        <div className="page-header">
          <h2>Enumerators</h2>
          <p>Manage field enumerators and their district assignments</p>
        </div>
        <div style={{ marginBottom: '20px' }}>
          <button className="btn btn-primary" disabled>+ Create Enumerator</button>
        </div>
        <TableSkeletonWithHeader
          headers={TABLE_HEADERS}
          rows={6}
          widths={['65%', '50%', '45%', '80%', '25%', '55%', '85%']}
        />
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h2>Enumerators</h2>
        <p>Manage field enumerators and their district assignments</p>
      </div>

      <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          + Create Enumerator
        </button>
        {/* A mutation invalidates ['enumerators'], so the list refetches after
            every create/activate/delete. Surfacing it explains why rows change. */}
        {enumFetching && <InlineLoader label="Refreshing list…" />}
      </div>

      <RefetchOverlay active={enumFetching}>
        <table>
          <thead>
            <tr>
              {TABLE_HEADERS.map((h) => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {enumerators.length === 0 && (
              <tr>
                <td colSpan={TABLE_HEADERS.length} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  No enumerators yet. Create one to get started.
                </td>
              </tr>
            )}
            {enumerators.map((e) => (
              <tr key={e.id}>
                <td style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{e.name}</td>
                <td><code style={{ fontSize: '12px', background: 'var(--bg-input)', padding: '2px 6px', borderRadius: '4px' }}>{e.loginId}</code></td>
                <td>{e.phone || '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {e.districts.length > 0
                      ? e.districts.map((d) => (
                          <span key={d.id} className="badge badge-active" style={{ fontSize: '10px' }}>{d.name}</span>
                        ))
                      : <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>None assigned</span>
                    }
                  </div>
                </td>
                <td>{e.surveysCount}</td>
                <td>
                  {e.isAdmin
                    ? <span className="badge badge-admin">Admin</span>
                    : e.isActive
                      ? <span className="badge badge-active">Active</span>
                      : <span className="badge badge-inactive">Inactive</span>
                  }
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setShowAssignModal(e)}>
                      📍 Districts
                    </button>
                    {!e.isAdmin && (
                      <>
                        {/* Scoped to THIS row via the mutation's in-flight
                            variables. A bare `isPending` would spin every row's
                            button at once, implying the whole table was busy. */}
                        <LoadingButton
                          variant={e.isActive ? 'danger' : 'success'}
                          size="sm"
                          loading={togglingId === e.id}
                          loadingText="Saving…"
                          onClick={() => handleToggleActive(e)}
                        >
                          {e.isActive ? 'Deactivate' : 'Activate'}
                        </LoadingButton>
                        <LoadingButton
                          variant="danger"
                          size="sm"
                          loading={deletingId === e.id}
                          onClick={() => handleDeleteEnumerator(e)}
                          style={{ padding: '6px 8px' }}
                          title="Delete Enumerator"
                        >
                          {deletingId === e.id ? '' : '🗑️'}
                        </LoadingButton>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </RefetchOverlay>

      {showCreateModal && (
        <CreateEnumeratorModal
          districts={districts}
          districtsLoading={districtsLoading}
          submitting={createMut.isPending}
          onClose={() => setShowCreateModal(false)}
          onSubmit={(data: any) => createMut.mutate(data)}
        />
      )}
      {showAssignModal && (
        <AssignDistrictsModal
          enumerator={showAssignModal}
          districts={districts}
          districtsLoading={districtsLoading}
          submitting={assignMut.isPending}
          onClose={() => setShowAssignModal(null)}
          onSubmit={(id: string, dIds: string[]) => assignMut.mutate({ id, dIds })}
        />
      )}

      {toast && (
        <div className="toast-container">
          <div className={`toast ${toast.type}`}>
            {toast.type === 'success' ? '✅' : '❌'} {toast.message}
          </div>
        </div>
      )}
    </>
  );
}

function CreateEnumeratorModal({ districts, districtsLoading, submitting, onClose, onSubmit }: any) {
  const [form, setForm] = useState({ loginId: '', password: '', name: '', phone: '', email: '', districtIds: [] as string[] });
  
  const toggleDistrict = (id: string) => {
    setForm(prev => ({
      ...prev, districtIds: prev.districtIds.includes(id) ? prev.districtIds.filter(d => d !== id) : [...prev.districtIds, id]
    }));
  };

  return (
    // While submitting, ignore the overlay click that would otherwise close the
    // modal mid-request and leave the operator unsure whether it succeeded.
    <div className="modal-overlay" onClick={submitting ? undefined : onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Create New Enumerator</h3>
        <form onSubmit={e => { e.preventDefault(); if (!submitting) onSubmit(form); }}>
          <div className="form-group">
            <label>Login ID *</label>
            <input className="form-input" required value={form.loginId} onChange={e => setForm({ ...form, loginId: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Password *</label>
            <input type="password" className="form-input" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Full Name *</label>
            <input className="form-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Phone</label>
            <input className="form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" className="form-input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Assign Districts</label>
            <div className="checkbox-list">
              {/* The districts query is cached for 10 minutes, so this is usually
                  instant — but on a cold open the list would otherwise render as
                  an empty box with no explanation. */}
              {districtsLoading ? (
                <div style={{ padding: '12px' }}>
                  {[1, 2, 3, 4].map((i) => (
                    <SkeletonBlock key={i} height={14} width={`${70 - i * 6}%`} style={{ margin: '8px 0' }} />
                  ))}
                </div>
              ) : districts.length === 0 ? (
                <div style={{ padding: '12px', fontSize: '13px', color: 'var(--text-muted)' }}>No districts available.</div>
              ) : (
                districts.map((d: any) => (
                  <label key={d.id} className="checkbox-item">
                    <input type="checkbox" checked={form.districtIds.includes(d.id)} onChange={() => toggleDistrict(d.id)} /> {d.name}
                  </label>
                ))
              )}
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
            <LoadingButton type="submit" variant="primary" loading={submitting} loadingText="Creating…">
              Create Enumerator
            </LoadingButton>
          </div>
        </form>
      </div>
    </div>
  );
}

function AssignDistrictsModal({ enumerator, districts, districtsLoading, submitting, onClose, onSubmit }: any) {
  const [selected, setSelected] = useState<string[]>(enumerator.districts.map((d: any) => d.id));
  const toggleDistrict = (id: string) => setSelected(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Assign Districts to {enumerator.name}</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '20px' }}>Select the districts this enumerator can access.</p>
        <div className="checkbox-list" style={{ maxHeight: '300px' }}>
          {districtsLoading ? (
            <div style={{ padding: '12px' }}>
              {[1, 2, 3, 4, 5].map((i) => (
                <SkeletonBlock key={i} height={14} width={`${75 - i * 5}%`} style={{ margin: '8px 0' }} />
              ))}
            </div>
          ) : districts.length === 0 ? (
            <div style={{ padding: '12px', fontSize: '13px', color: 'var(--text-muted)' }}>No districts available.</div>
          ) : (
            districts.map((d: any) => (
              <label key={d.id} className="checkbox-item">
                <input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggleDistrict(d.id)} /> {d.name} ({d.stakeholdersCount})
              </label>
            ))
          )}
        </div>
        <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--text-muted)' }}>{selected.length} district(s) selected</div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <LoadingButton
            variant="primary"
            loading={submitting}
            loadingText="Saving…"
            onClick={() => onSubmit(enumerator.id, selected)}
          >
            Save Assignments
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}
