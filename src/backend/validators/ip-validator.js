import { IP_API_TIMEOUT_MS, IP_API_EXPECTED_COUNTRY } from '../config/constants.js';
import { ScanError } from './scan-error.js';

/**
 * Layer 3: Check IP country via ip-api.com + VPN/proxy flag.
 * FAIL-OPEN: if the API times out or errors, the scan proceeds.
 * The skip is logged to the audit log so the instructor can see it.
 *
 * @param {string} clientIp — the student's IP address
 * @returns {Promise<{country: string, proxy: boolean, skipped: boolean}>}
 * @throws {ScanError} code='location_failed' if country != Kuwait or VPN/proxy detected
 */
export async function checkIp(clientIp) {
  // In dev, req.ip is localhost — ip-api.com rejects private IPs.
  // FAIL-OPEN handles this: API returns an error, we skip the check.
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IP_API_TIMEOUT_MS);

    const res = await fetch(`http://ip-api.com/json/${clientIp}?fields=status,country,proxy`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json();

    if (data.status !== 'success') {
      // API couldn't resolve the IP (private IP, etc.) — FAIL-OPEN
      console.warn(`[ip-validator] ip-api.com returned status="${data.status}" for IP ${clientIp}, proceeding (FAIL-OPEN)`);
      return { country: 'unknown', proxy: false, skipped: true };
    }

    if (data.country !== IP_API_EXPECTED_COUNTRY) {
      throw new ScanError('Location verification failed', 'location_failed');
    }

    if (data.proxy) {
      throw new ScanError('Location verification failed', 'location_failed');
    }

    return { country: data.country, proxy: data.proxy, skipped: false };
  } catch (err) {
    // If it's our ScanError, rethrow
    if (err instanceof ScanError) throw err;

    // Any other error (timeout, network, parse) — FAIL-OPEN
    console.warn(`[ip-validator] ip-api.com request failed: ${err.message}, proceeding (FAIL-OPEN)`);
    return { country: 'unknown', proxy: false, skipped: true };
  }
}
