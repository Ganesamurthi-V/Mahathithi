/**
 * Minimal JWT inspection for the access token.
 *
 * We only ever need the `exp` claim so the app can refresh proactively instead
 * of waiting for a request to 401. Signature verification is deliberately NOT
 * done here — that is the server's job, and the client has no secret. Treat the
 * result as a scheduling hint, never as an authorisation decision.
 *
 * Written without a dependency (and without atob, which React Native does not
 * reliably provide) so this cannot break a release build.
 */

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Decode base64url into a byte-string (one char per byte, latin1 style).
 *
 * A full UTF-8 decode is unnecessary: the only claim we read is `exp`, whose
 * value is always ASCII digits. Multi-byte characters elsewhere in the payload
 * (an enumerator's name, say) may come out mangled in this string, which is
 * fine because we never read them — we regex out `exp` specifically. Doing it
 * this way avoids shipping a UTF-8 decoder for no benefit.
 */
function base64UrlToByteString(input: string): string {
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';

  let out = '';
  for (let i = 0; i < b64.length; i += 4) {
    const c0 = B64_ALPHABET.indexOf(b64[i]);
    const c1 = B64_ALPHABET.indexOf(b64[i + 1]);
    const c2 = B64_ALPHABET.indexOf(b64[i + 2]);
    const c3 = B64_ALPHABET.indexOf(b64[i + 3]);

    // Any character outside the alphabet means this is not valid base64.
    if (c0 < 0 || c1 < 0) return '';

    const n = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3);

    out += String.fromCharCode((n >> 16) & 0xff);
    if (b64[i + 2] !== '=' && c2 >= 0) out += String.fromCharCode((n >> 8) & 0xff);
    if (b64[i + 3] !== '=' && c3 >= 0) out += String.fromCharCode(n & 0xff);
  }
  return out;
}

/**
 * Unix seconds at which the token expires, or null if it cannot be determined.
 * Returning null is treated by callers as "assume it needs refreshing".
 */
export function getTokenExpiry(token: string | null | undefined): number | null {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const payload = base64UrlToByteString(parts[1]);
    if (!payload) return null;

    const match = /"exp"\s*:\s*(\d+)/.exec(payload);
    if (!match) return null;

    const exp = parseInt(match[1], 10);
    return Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/** Seconds until the token expires. Negative once expired, null if unknown. */
export function getSecondsUntilExpiry(token: string | null | undefined): number | null {
  const exp = getTokenExpiry(token);
  if (exp === null) return null;
  return exp - Math.floor(Date.now() / 1000);
}

/**
 * Should we refresh this token now?
 *
 * `skewSeconds` is a safety margin so we renew slightly ahead of the real
 * deadline. It covers request latency and any clock drift between device and
 * server, both of which would otherwise let a request go out with a token that
 * expires in flight.
 *
 * An unreadable token returns true: better to attempt a refresh we did not need
 * than to send a request we know nothing about. A failed refresh is harmless
 * here because it never logs the user out on its own.
 */
export function shouldRefreshToken(
  token: string | null | undefined,
  skewSeconds: number = 120
): boolean {
  if (!token) return true;
  const remaining = getSecondsUntilExpiry(token);
  if (remaining === null) return true;
  return remaining <= skewSeconds;
}
