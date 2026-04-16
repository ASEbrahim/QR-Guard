import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkIp } from './ip-validator.js';

// Mock ip-api.com responses — never hit the real API in tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('IpValidator', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should pass for Kuwait IP without VPN', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ status: 'success', country: 'Kuwait', proxy: false }),
    });

    const result = await checkIp('1.2.3.4');
    expect(result.country).toBe('Kuwait');
    expect(result.skipped).toBe(false);
  });

  it('should reject non-Kuwait country', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ status: 'success', country: 'United States', proxy: false }),
    });

    await expect(checkIp('1.2.3.4')).rejects.toThrow('Location verification failed');
  });

  it('should reject VPN/proxy', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ status: 'success', country: 'Kuwait', proxy: true }),
    });

    await expect(checkIp('1.2.3.4')).rejects.toThrow('Location verification failed');
  });

  it('should FAIL-OPEN on API timeout', async () => {
    mockFetch.mockRejectedValueOnce(new Error('AbortError'));

    const result = await checkIp('1.2.3.4');
    expect(result.skipped).toBe(true);
  });

  it('should FAIL-OPEN on private/localhost IP (API returns fail status)', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ status: 'fail', message: 'private range' }),
    });

    const result = await checkIp('127.0.0.1');
    expect(result.skipped).toBe(true);
  });
});
