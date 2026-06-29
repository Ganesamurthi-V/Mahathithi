import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getEnumerators, getDistricts, createEnumerator, updateEnumerator, deleteEnumerator, assignDistricts } from '../api';
import { Enumerator, District } from '../types';

export default function EnumeratorsPage() {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState<Enumerator | null>(null);
  const [toast, setToast] = useState<{ type: string; message: string } | null>(null);

  const showToast = (type: string, message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: enumeratorsRes, isLoading: enumLoading } = useQuery({
    queryKey: ['enumerators'],
    queryFn: getEnumerators,
  });

  const { data: districtsRes } = useQuery({
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

  if (enumLoading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading enumerators...</div>;

  return (
    <>
      <div className="page-header">
        <h2>Enumerators</h2>
        <p>Manage field enumerators and their district assignments</p>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          + Create Enumerator
        </button>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Login ID</th>
              <th>Phone</th>
              <th>Districts</th>
              <th>Surveys</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
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
                        <button
                          className={`btn btn-sm ${e.isActive ? 'btn-danger' : 'btn-success'}`}
                          onClick={() => handleToggleActive(e)}
                        >
                          {e.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => handleDeleteEnumerator(e)}
                          style={{ padding: '6px 8px' }}
                          title="Delete Enumerator"
                        >
                          🗑️
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreateModal && (
        <CreateEnumeratorModal districts={districts} onClose={() => setShowCreateModal(false)} onSubmit={(data: any) => createMut.mutate(data)} />
      )}
      {showAssignModal && (
        <AssignDistrictsModal enumerator={showAssignModal} districts={districts} onClose={() => setShowAssignModal(null)} onSubmit={(id: string, dIds: string[]) => assignMut.mutate({ id, dIds })} />
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

function CreateEnumeratorModal({ districts, onClose, onSubmit }: any) {
  const [form, setForm] = useState({ loginId: '', password: '', name: '', phone: '', email: '', districtIds: [] as string[] });
  
  const toggleDistrict = (id: string) => {
    setForm(prev => ({
      ...prev, districtIds: prev.districtIds.includes(id) ? prev.districtIds.filter(d => d !== id) : [...prev.districtIds, id]
    }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Create New Enumerator</h3>
        <form onSubmit={e => { e.preventDefault(); onSubmit(form); }}>
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
              {districts.map((d: any) => (
                <label key={d.id} className="checkbox-item">
                  <input type="checkbox" checked={form.districtIds.includes(d.id)} onChange={() => toggleDistrict(d.id)} /> {d.name}
                </label>
              ))}
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create Enumerator</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AssignDistrictsModal({ enumerator, districts, onClose, onSubmit }: any) {
  const [selected, setSelected] = useState<string[]>(enumerator.districts.map((d: any) => d.id));
  const toggleDistrict = (id: string) => setSelected(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Assign Districts to {enumerator.name}</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '20px' }}>Select the districts this enumerator can access.</p>
        <div className="checkbox-list" style={{ maxHeight: '300px' }}>
          {districts.map((d: any) => (
            <label key={d.id} className="checkbox-item">
              <input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggleDistrict(d.id)} /> {d.name} ({d.stakeholdersCount})
            </label>
          ))}
        </div>
        <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--text-muted)' }}>{selected.length} district(s) selected</div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSubmit(enumerator.id, selected)}>Save Assignments</button>
        </div>
      </div>
    </div>
  );
}
