/** A positive whole number from the environment, or `fallback` when unset or invalid. */
export function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** true/false/1/0 from the environment, or `fallback` for anything else. */
export function boolEnv(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return fallback;
}

/** A comma-separated list from the environment, or null when unset or empty. */
export function listEnv(name: string): string[] | null {
  const items = (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return items.length > 0 ? items : null;
}
