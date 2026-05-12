import crypto from 'node:crypto';

/**
 * QR token format: `<base64-payload>.<base64-hmac>` where the HMAC is
 * computed over the base64-payload string (not the raw JSON) so the
 * validator can verify the signature without re-encoding.
 *
 * HS256 (HMAC-SHA256) keyed by QR_SIGNING_SECRET (server-only, never sent
 * to the client). The shared secret approach is appropriate here because
 * there is a single signer (the server) and a single verifier (the same
 * server); asymmetric signing buys nothing.
 *
 * The signature is the first line of defence at Layer 1 of the scan
 * pipeline. The downstream DB-freshness check still runs after a valid
 * signature, so even a forged-but-valid signature still has to match a
 * row in qr_tokens to pass.
 */

const SEPARATOR = '.';
const DEFAULT_DEV_SECRET = 'dev-qr-signing-secret-not-for-production';

/**
 * Returns the active signing secret, or throws if production was
 * misconfigured. Mirrors the SESSION_SECRET handling in server.js so
 * deployments fail loudly rather than silently signing with a default.
 *
 * @returns {string}
 */
export function getSigningSecret() {
  const secret = process.env.QR_SIGNING_SECRET;
  if (!secret || secret === DEFAULT_DEV_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'QR_SIGNING_SECRET is not set or uses the default development value. ' +
        'Production refuses to issue QR tokens without a real secret.',
      );
    }
    return DEFAULT_DEV_SECRET;
  }
  return secret;
}

/**
 * Signs a base64-encoded payload string and returns the full token in
 * `<payload>.<hmac>` form. The hmac segment is also base64-encoded so the
 * full token is a single ASCII string suitable for QR rendering.
 *
 * @param {string} base64Payload
 * @returns {string}
 */
export function signPayload(base64Payload) {
  const secret = getSigningSecret();
  const signature = crypto
    .createHmac('sha256', secret)
    .update(base64Payload)
    .digest('base64');
  return `${base64Payload}${SEPARATOR}${signature}`;
}

/**
 * Verifies a signed token. Returns the base64-payload portion on success;
 * throws otherwise. Uses timingSafeEqual to avoid leaking signature bytes
 * via response timing.
 *
 * @param {string} token  `<base64-payload>.<base64-hmac>` form
 * @returns {string}      the base64-payload portion (caller decodes)
 * @throws {Error}        when the token shape, signature, or secret is invalid
 */
export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes(SEPARATOR)) {
    throw new Error('Malformed QR token: missing signature');
  }
  const idx = token.lastIndexOf(SEPARATOR);
  const base64Payload = token.slice(0, idx);
  const providedSig = token.slice(idx + 1);
  if (!base64Payload || !providedSig) {
    throw new Error('Malformed QR token: empty segment');
  }

  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(base64Payload)
    .digest('base64');

  // Length-mismatched buffers throw inside timingSafeEqual; guard upfront
  // so we return the same "invalid signature" error in both cases instead
  // of leaking which check failed.
  const a = Buffer.from(expectedSig);
  const b = Buffer.from(providedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('QR token signature invalid');
  }

  return base64Payload;
}
