import { Prisma } from '@prisma/client';

/**
 * Advisory lock namespaces. The two-argument form `pg_advisory_xact_lock(ns, key)` keeps an
 * id that happens to hash to the same integer as a district or business name from being treated
 * as the same lock. Every namespace in the application is listed HERE so two features cannot
 * accidentally pick the same number.
 */
export const LOCK_NS_ENUMERATOR = 1;
export const LOCK_NS_DISTRICT = 2;
/** One lock per normalised business name + district: serialises "check, then insert". */
export const LOCK_NS_STAKEHOLDER_NAME = 3;
/** Serialises allocation of the next primary_key_id. */
export const LOCK_NS_STAKEHOLDER_KEY = 4;

/**
 * Take a transaction-scoped advisory lock (released at commit or rollback).
 *
 * $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void, and $queryRaw cannot
 * deserialise a void column (PostgreSQL 17 / Prisma 6).
 */
export async function advisoryXactLock(
  tx: Prisma.TransactionClient,
  namespace: number,
  key: string,
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${namespace}::int, hashtext(${key}))`);
}
