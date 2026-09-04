import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDistricts } from '../api';
import { District } from '../types';
import { StatCardSkeleton, TableSkeletonWithHeader, InlineLoader } from '../components/Loading';

const TABLE_HEADERS = [
  'District',
  'State',
  'Stakeholders',
  'Completed Surveys',
  'Coverage',
  'Assigned Enumerators',
];

export default function DistrictsPage() {
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['districts'],
    queryFn: getDistricts,
    staleTime: 60000, // 1 minute cache
  });

  const districts: District[] = data?.data?.data || [];
  const isRefreshing = isFetching && !isLoading;

  // Filtering is done client-side, not through the API. The route returns all ~36
  // districts in a single response, so there is nothing to page through and no
  // reason to spend a round trip per keystroke — this filters instantly and works
  // just as well offline from the cached response. That also means no debounce is
  // needed, unlike the Stakeholders page which queries 295K rows server-side.
  const [name, setName] = React.useState('');
  const [activity, setActivity] = React.useState<'' | 'with' | 'without'>('');
  const [assignment, setAssignment] = React.useState<'' | 'assigned' | 'unassigned'>('');

  const visible = React.useMemo(() => {
    const q = name.trim().toLowerCase();

    return districts
      .filter((d) => {
        if (q && !d.name.toLowerCase().includes(q)) return false;

        const done = d.completedSurveysCount || 0;
        if (activity === 'with' && done === 0) return false;
        if (activity === 'without' && done > 0) return false;

        const assigned = (d.enumeratorsCount || 0) > 0;
        if (assignment === 'assigned' && !assigned) return false;
        if (assignment === 'unassigned' && assigned) return false;

        return true;
      })
      // Districts with survey activity first, then by stakeholder volume. The
      // server returns them alphabetically, which buries the handful actually
      // being worked on among ~36 rows of zeros. Sorted here rather than
      // server-side so alphabetical order stays available to other consumers.
      .sort(
        (a, b) =>
          (b.completedSurveysCount || 0) - (a.completedSurveysCount || 0) ||
          (b.stakeholdersCount || 0) - (a.stakeholdersCount || 0)
      );
  }, [districts, name, activity, assignment]);

  const filtersActive = name.trim() !== '' || activity !== '' || assignment !== '';
  const resetFilters = () => { setName(''); setActivity(''); setAssignment(''); };

  // Stat cards intentionally summarise the FILTERED set, so the numbers always
  // describe what is on screen. With filters cleared this is the full total.
  const shownStakeholders = visible.reduce((sum, d) => sum + (d.stakeholdersCount || 0), 0);
  const shownCompleted = visible.reduce((sum, d) => sum + (d.completedSurveysCount || 0), 0);

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Districts</h2>
          <p>Maharashtra districts and their stakeholder coverage</p>
        </div>
        {isRefreshing && <InlineLoader label="Refreshing…" />}
      </div>

      <div className="stat-grid">
        {isLoading ? (
          <StatCardSkeleton count={3} />
        ) : (
          <>
            <div className="stat-card blue">
              <div className="stat-icon">📍</div>
              <div className="stat-value">{visible.length}</div>
              <div className="stat-label">{filtersActive ? `Districts (of ${districts.length})` : 'Total Districts'}</div>
            </div>
            <div className="stat-card green">
              <div className="stat-icon">🏢</div>
              <div className="stat-value">{shownStakeholders.toLocaleString()}</div>
              <div className="stat-label">{filtersActive ? 'Stakeholders (filtered)' : 'Total Stakeholders'}</div>
            </div>
            <div className="stat-card orange">
              <div className="stat-icon">✅</div>
              <div className="stat-value">{shownCompleted.toLocaleString()}</div>
              <div className="stat-label">{filtersActive ? 'Completed Surveys (filtered)' : 'Completed Surveys'}</div>
            </div>
          </>
        )}
      </div>

      {/* Filters. No submit button and no debounce: this narrows an array already
          in memory, so results update as you type. */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '2', minWidth: '200px' }}>
            <label htmlFor="district-name" style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>
              District Name
            </label>
            <input
              id="district-name"
              className="form-input"
              placeholder="Search by name…"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div style={{ flex: '1', minWidth: '170px' }}>
            <label htmlFor="district-activity" style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>
              Survey Activity
            </label>
            <select
              id="district-activity"
              className="form-input"
              value={activity}
              onChange={(e) => setActivity(e.target.value as '' | 'with' | 'without')}
            >
              <option value="">All</option>
              <option value="with">Has completed surveys</option>
              <option value="without">No surveys yet</option>
            </select>
          </div>

          <div style={{ flex: '1', minWidth: '170px' }}>
            <label htmlFor="district-assignment" style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' }}>
              Enumerators
            </label>
            <select
              id="district-assignment"
              className="form-input"
              value={assignment}
              onChange={(e) => setAssignment(e.target.value as '' | 'assigned' | 'unassigned')}
            >
              <option value="">All</option>
              <option value="assigned">Assigned</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>

          <button
            className="btn btn-secondary"
            onClick={resetFilters}
            disabled={!filtersActive}
            style={{ height: '42px' }}
          >
            Reset
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '16px', fontSize: '13px', color: 'var(--text-muted)' }}>
        Showing {visible.length} of {districts.length} districts
      </div>

      {isLoading ? (
        <TableSkeletonWithHeader
          headers={TABLE_HEADERS}
          rows={8}
          widths={['55%', '45%', '30%', '35%', '70%', '60%']}
        />
      ) : (
      <div className="table-container">
        <table>
          <thead>
            <tr>
              {TABLE_HEADERS.map((h) => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={TABLE_HEADERS.length} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  {filtersActive ? 'No districts match these filters.' : 'No districts found.'}
                </td>
              </tr>
            )}
            {visible.map((d) => {
              const total = d.stakeholdersCount || 0;
              const done = d.completedSurveysCount || 0;
              // Recomputed rather than reading d.coverage so an older backend that
              // does not send the field still renders a correct percentage.
              const pct = total > 0 ? (done / total) * 100 : 0;
              return (
                <tr key={d.id}>
                  <td style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{d.name}</td>
                  <td>{d.state}</td>
                  <td>{total.toLocaleString()}</td>
                  <td style={{ fontWeight: done > 0 ? 600 : 400, color: done > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {done.toLocaleString()}
                  </td>
                  <td style={{ minWidth: '150px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div
                        style={{ flex: 1, height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}
                        role="progressbar"
                        aria-valuenow={Number(pct.toFixed(2))}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${d.name} survey coverage`}
                      >
                        {/* Sub-1% coverage still shows a sliver so "started" reads
                            differently from "nothing yet". */}
                        <div style={{ width: `${pct > 0 ? Math.max(pct, 1.5) : 0}%`, height: '100%', background: 'var(--primary)' }} />
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', minWidth: '48px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {done === 0 ? '0%' : pct < 0.01 ? '<0.01%' : `${pct.toFixed(2)}%`}
                      </span>
                    </div>
                  </td>
                  <td>
                    {d.enumeratorsCount > 0
                      ? <span className="badge badge-active">{d.enumeratorsCount} assigned</span>
                      : <span className="badge badge-pending">None</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </>
  );
}
