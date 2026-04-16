/**
 * FingerprintJS integration — open-source v4 via CDN.
 * Returns a stable visitor ID for device binding.
 */

let fpPromise = null;

async function getFingerprint() {
  if (!fpPromise) {
    // Load FingerprintJS open-source v4
    const FingerprintJS = await import('https://openfpcdn.io/fingerprintjs/v4');
    fpPromise = FingerprintJS.load();
  }
  const fp = await fpPromise;
  const result = await fp.get();
  return result.visitorId;
}
