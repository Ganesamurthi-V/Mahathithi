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

  const ENUM_KEY = ['enumerators'];

  /**
   * Rewrite the cached enumerator list in place.
   *
   * The cache holds the raw axios response, so the array lives at
   * `response.data.data`. Rebuilding the wrapper preserves that shape while
   * swapping the array, which is what lets the table re-render instantly.
   */
  const patchEnumeratorCache = (fn: (list: Enumerator[]) => Enumerator[]) => {
    queryClient.setQueryData(ENUM_KEY, (old: any) => {
      if (!old?.data?.data) return old;
      return { ...old, data: { ...old.data, data: fn(old.data.data as Enumerator[]) } };
    });
  };

  /**
   * Snapshot the list, apply an optimistic edit, and hand the snapshot back so
   * onError can restore it. Cancelling in-flight fetches first stops a response
   * that was already on the wire from overwriting the optimistic value.
   */
  const beginOptimistic = async (fn: (list: Enumerator[]) => Enumerator[]) => {
    await queryClient.cancelQueries({ queryKey: ENUM_KEY });
    const previous = queryClient.getQueryData(ENUM_KEY);
    patchEnumeratorCache(fn);
    return { previous };
  };

  const rollback = (ctx: any) => {
    if (ctx?.previous !== undefined) queryClient.setQueryData(ENUM_KEY, ctx.previous);
  };

  // The modal closes the moment you submit rather than after the server answers.
  // Creation needs a server-generated id, so the new row cannot be faked into the
  // cache — but the operator does not have to sit and watch a spinner for it. The
  // row arrives via the invalidation below (and via the data:changed broadcast,
  // which is also what puts it on every OTHER admin's screen).
  const createMut = useMutation({
    mutationFn: createEnumerator,
    onMutate: (vars: any) => {
      setShowCreateModal(false);
      showToast('info', `Creating "${vars.name}"…`);
    },
    onSuccess: (_res, vars: any) => {
      showToast('success', `Enumerator "${vars.name}" created successfully`);
    },
    onError: (err: any, vars: any) => {
      // Reopening would lose the typed values, so report clearly instead and let
      // the operator retry from a fresh form.
      showToast('error', `Could not create "${vars?.name}": ${err.response?.data?.error?.message || 'request failed'}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ENUM_KEY });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });

  // Activate/Deactivate flips in the cache immediately — the badge and button
  // label change on click, with no wait at all. If the server rejects it, the
  // previous list is restored and a toast explains why.
  const toggleActiveMut = useMutation({
    mutationFn: (e: Enumerator) => updateEnumerator(e.id, { isActive: !e.isActive }),
    onMutate: (e: Enumerator) =>
      beginOptimistic((list) =>
        list.map((row) => (row.id === e.id ? { ...row, isActive: !e.isActive } : row))
      ),
    onError: (err: any, e, ctx) => {
      rollback(ctx);
      showToast('error', `Could not update "${e.name}": ${err.response?.data?.error?.message || 'request failed'}`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ENUM_KEY }),
  });

  // District badges update on the row straight away, using the names resolved
  // from the already-cached districts list.
  const assignMut = useMutation({
    mutationFn: ({ id, dIds }: { id: string, dIds: string[] }) => assignDistricts(id, dIds),
    onMutate: async ({ id, dIds }) => {
      setShowAssignModal(null);
      const all: District[] = (queryClient.getQueryData(['districts']) as any)?.data?.data || [];
      const next = dIds
        .map((dId) => all.find((d) => d.id === dId))
        .filter(Boolean)
        .map((d: any) => ({ id: d.id, name: d.name }));
      return beginOptimistic((list) =>
        list.map((row) => (row.id === id ? { ...row, districts: next } : row))
      );
    },
    onSuccess: () => showToast('success', 'Districts assigned successfully'),
    onError: (err: any, _vars, ctx) => {
      rollback(ctx);
      showToast('error', err.response?.data?.error?.message || 'Failed to assign districts');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ENUM_KEY });
      queryClient.invalidateQueries({ queryKey: ['districts'] });
    },
  });

  // Deletion is a soft delete (isActive = false) rather than a row removal, so
  // the optimistic edit mirrors exactly what the server will do — the row stays
  // and turns Inactive.
  const deleteMut = useMutation({
    mutationFn: deleteEnumerator,
    // Removes the row outright. This used to set isActive = false, which mirrored
    // the old soft-delete endpoint — so a "deleted" enumerator stayed in the table
    // as INACTIVE, indistinguishable from one that was merely deactivated, with no
    // way to get rid of it. The endpoint deletes for real now, so the row goes.
    onMutate: (id: string) =>
      beginOptimistic((list) => list.filter((row) => row.id !== id)),
    onSuccess: () => showToast('success', 'Enumerator permanently deleted'),
    onError: (err: any, _id, ctx) => {
      // Rollback restores the row, which matters more than before: the server
      // refuses with 409 when the account has surveys or phone validations
      // attached, and that message names them. Without the rollback the row would
      // vanish from the table while still existing on the server.
      rollback(ctx);
      showToast('error', err.response?.data?.error?.message || 'Failed to delete enumerator');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ENUM_KEY });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      queryClient.invalidateQueries({ queryKey: ['districts'] });
    },
  });

  const handleToggleActive = (e: Enumerator) => toggleActiveMut.mutate(e);
  const handleDeleteEnumerator = (e: Enumerator) => {
    // Spells out that this is permanent and points at Deactivate as the reversible
    // option, because the two buttons sat next to each other doing the same thing
    // until now and the distinction is new.
    if (window.confirm(
      `Permanently delete "${e.name}" (${e.loginId})?\n\n` +
      `The account and its district assignments are removed for good. ` +
      `If they have recorded any surveys the server will refuse — use Deactivate ` +
      `instead, which blocks login without losing the record.\n\n` +
      `This cannot be undone.`
    )) {
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
            {toast.type === 'success' ? '✅' : toast.type === 'info' ? '⏳' : '❌'} {toast.message}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The password policy, mirroring validatePassword() in backend admin.routes.ts.
 *
 * Duplicated deliberately: the server is the authority and still enforces every one
 * of these, but it reports only the FIRST failure, one per round trip. Typing a
 * password that misses three rules meant three submissions and three separate
 * errors, with the rules never stated anywhere. Showing them live turns that into
 * no round trips.
 *
 * If the server-side rules change, these must change with them — the mismatch would
 * show up as a form that says the password is fine and then gets a 400.
 */
const PASSWORD_RULES: { label: string; test: (v: string) => boolean }[] = [
  { label: 'At least 10 characters', test: v => v.length >= 10 },
  { label: 'One uppercase letter (A-Z)', test: v => /[A-Z]/.test(v) },
  { label: 'One lowercase letter (a-z)', test: v => /[a-z]/.test(v) },
  { label: 'One number (0-9)', test: v => /[0-9]/.test(v) },
  { label: 'One special character (!@#$…)', test: v => /[^A-Za-z0-9]/.test(v) },
];

function CreateEnumeratorModal({ districts, districtsLoading, submitting, onClose, onSubmit }: any) {
  const [form, setForm] = useState({ loginId: '', password: '', name: '', phone: '', email: '', districtIds: [] as string[] });
  // Rules stay hidden until the field is touched, so an untouched form is not a
  // wall of red crosses before the operator has typed anything.
  const [passwordTouched, setPasswordTouched] = useState(false);

  const ruleResults = PASSWORD_RULES.map(r => ({ ...r, ok: r.test(form.password) }));
  const passwordValid = ruleResults.every(r => r.ok);
  const showRules = passwordTouched || form.password.length > 0;

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
        <form
          onSubmit={e => {
            e.preventDefault();
            // Guard as well as disabling the button: Enter in a text input submits
            // the form directly and bypasses the button's disabled state.
            if (submitting) return;
            if (!passwordValid) {
              setPasswordTouched(true);
              return;
            }
            onSubmit(form);
          }}
        >
          <div className="form-group">
            <label>Login ID *</label>
            <input className="form-input" required value={form.loginId} onChange={e => setForm({ ...form, loginId: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Password *</label>
            <input
              type="password"
              className="form-input"
              required
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              onBlur={() => setPasswordTouched(true)}
              // Stops the browser autofilling an admin's own saved credentials into
              // a form that creates a different person's account.
              autoComplete="new-password"
              aria-describedby="password-rules"
              aria-invalid={showRules && !passwordValid}
            />
            {showRules && (
              <ul
                id="password-rules"
                // aria-live so a screen reader announces rules being satisfied as
                // they are typed, rather than the list changing silently.
                aria-live="polite"
                style={{
                  listStyle: 'none', margin: '8px 0 0', padding: 0,
                  display: 'grid', gap: '4px',
                }}
              >
                {ruleResults.map(r => (
                  <li
                    key={r.label}
                    style={{
                      fontSize: '12px',
                      display: 'flex', alignItems: 'center', gap: '6px',
                      color: r.ok ? 'var(--success, #30a46c)' : 'var(--text-muted)',
                    }}
                  >
                    {/* aria-hidden on the glyph: the met/unmet state is carried by
                        the text below, so a reader should not announce "check". */}
                    <span aria-hidden="true" style={{ width: '12px', display: 'inline-block' }}>
                      {r.ok ? '✓' : '○'}
                    </span>
                    <span>{r.label}</span>
                    <span style={{ position: 'absolute', left: '-9999px' }}>
                      {r.ok ? ' — met' : ' — not met'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
            <LoadingButton
              type="submit"
              variant="primary"
              loading={submitting}
              loadingText="Creating…"
              disabled={!passwordValid}
              title={passwordValid ? undefined : 'Password does not meet all requirements yet'}
            >
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
