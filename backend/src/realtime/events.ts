import { emitToAdmins, emitToDistrict } from './socket';
import { logger } from '../utils/logger';

/**
 * Uniform "something changed" broadcast.
 *
 * WHY THIS EXISTS
 * Only two business events were ever emitted — stakeholder:locked and
 * stakeholder:unlocked — and the admin panel reacted to them by invalidating a
 * single query key. Everything else was silent: creating an enumerator,
 * assigning districts, editing a stakeholder, exporting surveys, appending audit
 * entries. Clients therefore only saw those changes when the operator happened to
 * navigate to the page again, which meant two admins working simultaneously saw
 * different data, and a page left open showed figures that were quietly wrong.
 *
 * The alternative to this file is a bespoke event per mutation, each needing a
 * matching handler on two clients. That rots fast: the handler is easy to forget,
 * and a missing one fails silently (no error, just stale data).
 *
 * So instead there is ONE event, `data:changed`, carrying the names of the
 * resources that moved. Clients own the mapping from resource name to whatever
 * refresh means for them — query keys in the admin panel, local SQLite reads and
 * Redux slices on mobile. Adding a mutation is a one-line emit here; if the
 * resource already exists, no client change is needed at all.
 */

/** Logical resources a client may be displaying. Keep in sync with the client maps. */
export type DataResource =
  | 'stakeholders'
  | 'enumerators'
  | 'districts'
  | 'surveys'
  | 'media'
  | 'analytics'
  | 'auditLogs'
  | 'exports';

export interface DataChangedPayload {
  resources: DataResource[];
  /** Coarse hint so a client can update in place instead of refetching. */
  action?: 'create' | 'update' | 'delete';
  /** Primary key of the affected row, when it makes sense. */
  entityId?: string;
  /**
   * Which resource `entityId` belongs to.
   *
   * Needed because `resources` is a fan-out list, not a subject: deleting an
   * enumerator names 'stakeholders' too (their locks were released), so a client
   * seeing action='delete' + entityId could not tell whether the id was an
   * enumerator or a stakeholder. Acting on the wrong one is what makes a mobile
   * device delete a row it should have kept.
   */
  entityType?: DataResource;
  /** ISO timestamp, used by clients to discard out-of-order messages. */
  at: string;
}

interface BroadcastOptions {
  action?: 'create' | 'update' | 'delete';
  entityId?: string;
  entityType?: DataResource;
  /**
   * When set, field enumerators in this district also receive the event.
   * Omit for admin-only concerns (audit logs, exports, enumerator management) so
   * we do not wake every device on the network for something it cannot see.
   */
  district?: string | null;
}

/**
 * Tell interested clients that one or more resources changed.
 *
 * Always reaches admins. Reaches a district's enumerators only when `district`
 * is supplied, which keeps mobile devices — often on metered connections — from
 * being woken by changes that are invisible to them.
 *
 * Deliberately never throws: a realtime notification is a convenience on top of
 * a write that has already committed. If the socket layer is unavailable, the
 * mutation must still be reported as successful, and clients fall back to their
 * normal focus/reconnect refetching.
 */
export function broadcastChange(
  resources: DataResource[],
  options: BroadcastOptions = {}
): void {
  if (!resources.length) return;

  const payload: DataChangedPayload = {
    resources,
    action: options.action,
    entityId: options.entityId,
    entityType: options.entityType,
    at: new Date().toISOString(),
  };

  try {
    emitToAdmins('data:changed', payload);
    if (options.district) {
      emitToDistrict(options.district, 'data:changed', payload);
    }
  } catch (err) {
    logger.error('[realtime] broadcastChange failed (write already committed):', err);
  }
}
