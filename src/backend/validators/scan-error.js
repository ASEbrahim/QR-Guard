/**
 * Custom error thrown by scan pipeline validators.
 * Each validator sets a unique `code` for the API response.
 */
export class ScanError extends Error {
  /**
   * @param {string} message — human-readable, shown to student
   * @param {string} code — machine-readable reason code for the API response
   */
  constructor(message, code) {
    super(message);
    this.name = 'ScanError';
    this.code = code;
  }
}
