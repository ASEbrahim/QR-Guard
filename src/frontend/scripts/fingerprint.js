/**
 * FingerprintJS integration — open-source via CDN.
 * Returns a stable visitor ID for device binding.
 *
 * Pinned to v4.5 (not the floating `v4`) so a breaking change in a future
 * 4.x doesn't silently ship to production. Browsers do not support the
 * `integrity` attribute on dynamic import() today; pinning to a concrete
 * version is the best SRI-equivalent available for ESM modules.
 * If the CDN is ever compromised, the next step is to self-host this file.
 */

const FINGERPRINTJS_URL = 'https://openfpcdn.io/fingerprintjs/v4.5';

let fpPromise = null;

async function getFingerprint() {
  if (!fpPromise) {
    const FingerprintJS = await import(FINGERPRINTJS_URL);
    fpPromise = FingerprintJS.load();
  }
  const fp = await fpPromise;
  const result = await fp.get();
  return result.visitorId;
}
