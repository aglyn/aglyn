/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * A non-2xx answer from a vendor the platform calls on a customer's behalf
 * — a model provider, a payment processor, a mail relay.
 *
 * `message` is a fixed, customer-safe sentence the caller chose; the
 * vendor's own words describe OUR account with them (a key, a rate limit, a
 * balance) and name the vendor to a white-label org's users, so they go to
 * the log beside `requestId` and never travel in this object.
 */
export class UpstreamServiceError extends Error {
  override readonly name: string = 'UpstreamServiceError'
  /** The vendor's HTTP status, or null when the failure had none. */
  readonly status: number | null
  /**
   * Whether the vendor said "come back later" rather than "this request is
   * wrong": a rate limit or an overload. Everything else — a bad request,
   * an authentication failure, a vendor fault — is not, and a caller must
   * not retry it in a loop.
   */
  readonly retryable: boolean
  /** The vendor's request id, when it sent one — the log's join key. */
  readonly requestId: string | null

  constructor(
    message: string,
    options: { status: number | null; retryable: boolean; requestId?: string | null },
  ) {
    super(message)
    this.status = options.status
    this.retryable = options.retryable
    this.requestId = options.requestId ?? null
    Object.setPrototypeOf(this, new.target.prototype)
    if (Error.captureStackTrace) Error.captureStackTrace(this, new.target)
  }
}

export default UpstreamServiceError
