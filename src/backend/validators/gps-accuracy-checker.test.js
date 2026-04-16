import { describe, it, expect } from 'vitest';
import { checkGpsAccuracy } from './gps-accuracy-checker.js';

describe('GpsAccuracyChecker', () => {
  it('should pass for accuracy within limit', () => {
    expect(() => checkGpsAccuracy(50)).not.toThrow();
    expect(() => checkGpsAccuracy(150)).not.toThrow();
  });

  it('should reject accuracy > 150m', () => {
    expect(() => checkGpsAccuracy(200)).toThrow('Location verification failed');
  });

  it('should reject accuracy === 0 (likely spoofed)', () => {
    expect(() => checkGpsAccuracy(0)).toThrow('Location verification failed');
  });

  it('should reject null/undefined accuracy', () => {
    expect(() => checkGpsAccuracy(null)).toThrow('Location verification failed');
    expect(() => checkGpsAccuracy(undefined)).toThrow('Location verification failed');
  });

  it('should pass for boundary value 150', () => {
    expect(() => checkGpsAccuracy(150)).not.toThrow();
  });

  it('should reject for 150.01', () => {
    expect(() => checkGpsAccuracy(150.01)).toThrow();
  });
});
