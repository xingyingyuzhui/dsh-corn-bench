// @ts-check

/**
 * A request-level verify rejection (nothing was registered or sampled). Callers
 * surface it as `ok:false` with `errorCode` and `details`.
 */
export class VerifyRequestError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, any>} [details]
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'VerifyRequestError'
    this.code = code
    this.details = details
  }
}
