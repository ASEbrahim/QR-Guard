import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test pipeline ordering via spies — mock all validators
vi.mock('./qr-validator.js', () => ({
  validateQrToken: vi.fn(),
}));
vi.mock('./device-checker.js', () => ({
  checkDevice: vi.fn(),
}));
vi.mock('./ip-validator.js', () => ({
  checkIp: vi.fn(),
}));
vi.mock('./gps-accuracy-checker.js', () => ({
  checkGpsAccuracy: vi.fn(),
}));
vi.mock('./geofence-checker.js', () => ({
  checkGeofence: vi.fn(),
}));
vi.mock('./audit-logger.js', () => ({
  logAudit: vi.fn(),
}));

import { verifyScan } from './scan-verifier.js';
import { validateQrToken } from './qr-validator.js';
import { checkDevice } from './device-checker.js';
import { checkIp } from './ip-validator.js';
import { checkGpsAccuracy } from './gps-accuracy-checker.js';
import { checkGeofence } from './geofence-checker.js';
import { logAudit } from './audit-logger.js';
import { ScanError } from './scan-error.js';

const baseScanData = {
  studentId: 'student-1',
  qrPayload: 'dGVzdA==',
  gpsLat: 29.31,
  gpsLng: 47.98,
  gpsAccuracy: 30,
  deviceFingerprint: 'fp_test',
  clientIp: '1.2.3.4',
};

describe('ScanVerifier — pipeline order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateQrToken.mockResolvedValue({ sessionId: 's1', courseId: 'c1' });
    checkDevice.mockResolvedValue();
    checkIp.mockResolvedValue({ country: 'Kuwait', proxy: false, skipped: false });
    checkGpsAccuracy.mockReturnValue();
    checkGeofence.mockResolvedValue();
    logAudit.mockResolvedValue();
  });

  it('should call all 5 validators + audit on success', async () => {
    const result = await verifyScan(baseScanData);

    expect(result.success).toBe(true);
    expect(validateQrToken).toHaveBeenCalledOnce();
    expect(checkDevice).toHaveBeenCalledOnce();
    expect(checkIp).toHaveBeenCalledOnce();
    expect(checkGpsAccuracy).toHaveBeenCalledOnce();
    expect(checkGeofence).toHaveBeenCalledOnce();
    expect(logAudit).toHaveBeenCalledOnce();
  });

  it('should short-circuit at layer 1 — layers 2-5 not called', async () => {
    validateQrToken.mockRejectedValue(new ScanError('QR expired', 'qr_expired'));

    const result = await verifyScan(baseScanData);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('qr_expired');
    expect(checkDevice).not.toHaveBeenCalled();
    expect(checkIp).not.toHaveBeenCalled();
    expect(checkGpsAccuracy).not.toHaveBeenCalled();
    expect(checkGeofence).not.toHaveBeenCalled();
    // Audit ALWAYS runs
    expect(logAudit).toHaveBeenCalledOnce();
  });

  it('should short-circuit at layer 2 — layers 3-5 not called', async () => {
    checkDevice.mockRejectedValue(new ScanError('Device not recognized', 'device_mismatch'));

    const result = await verifyScan(baseScanData);

    expect(result.reason).toBe('device_mismatch');
    expect(validateQrToken).toHaveBeenCalledOnce(); // layer 1 ran
    expect(checkIp).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledOnce();
  });

  it('should short-circuit at layer 5 — geofence fail', async () => {
    checkGeofence.mockRejectedValue(new ScanError('Outside classroom area', 'outside_geofence'));

    const result = await verifyScan(baseScanData);

    expect(result.reason).toBe('outside_geofence');
    // All 4 prior layers ran
    expect(validateQrToken).toHaveBeenCalledOnce();
    expect(checkDevice).toHaveBeenCalledOnce();
    expect(checkIp).toHaveBeenCalledOnce();
    expect(checkGpsAccuracy).toHaveBeenCalledOnce();
    expect(logAudit).toHaveBeenCalledOnce();
  });

  it('should enforce pipeline order (call sequence)', async () => {
    const callOrder = [];
    validateQrToken.mockImplementation(async () => { callOrder.push(1); return { sessionId: 's1', courseId: 'c1' }; });
    checkDevice.mockImplementation(async () => { callOrder.push(2); });
    checkIp.mockImplementation(async () => { callOrder.push(3); return { skipped: false }; });
    checkGpsAccuracy.mockImplementation(() => { callOrder.push(4); });
    checkGeofence.mockImplementation(async () => { callOrder.push(5); });
    logAudit.mockImplementation(async () => { callOrder.push(6); });

    await verifyScan(baseScanData);

    expect(callOrder).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
