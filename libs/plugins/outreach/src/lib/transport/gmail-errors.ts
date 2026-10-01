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
 * WHAT A GOOGLE CALL CAN FAIL WITH, AS OUTREACH ACTS ON IT (AGL-2978).
 *
 * Google answers in two dialects — the OAuth token endpoint's
 * `{ error: 'invalid_grant' }` and the Gmail API's
 * `{ error: { code, status, errors: [{ reason }] } }` — and a caller should
 * not have to speak either. Every failure the transport raises is one
 * {@link GmailTransportError} carrying the three decisions a caller makes:
 *
 * - `reconnectRequired` — the grant itself is gone (revoked, expired, a
 *   password change, a scope removed). Nothing will work until the rep
 *   connects again, so the mailbox goes to `reconnect_required`.
 * - `retryable` — the request may succeed later as it stands (a rate limit,
 *   an outage, a dropped connection). `retryAfterMs` says when, if Google
 *   said.
 * - neither — the request itself is wrong, or the deployment is (a bad
 *   client id or secret), and retrying it changes nothing.
 */

export type GmailTransportErrorCode =
  /** The refresh token was refused: revoked, expired or otherwise dead. */
  | 'invalid_grant'
  /** The grant is missing a scope the call needs. */
  | 'insufficient_scope'
  /** The OAuth client id or secret was refused — a deployment problem. */
  | 'client_misconfigured'
  /** Rate-limited, still after backing off. */
  | 'rate_limited'
  /** The account's sending or API quota for the day is spent. */
  | 'quota_exceeded'
  /** Google answered 5xx, still after backing off. */
  | 'unavailable'
  /** The request never got an answer: a network failure or a timeout. */
  | 'network'
  /** The access token was refused even after a fresh one was minted. */
  | 'unauthorized'
  /** The account has no Gmail service (a Workspace user without Gmail). */
  | 'mail_service_unavailable'
  | 'not_found'
  /** Google refused the request as malformed. */
  | 'invalid_request'
  | 'forbidden'
  /** An answer the transport could not read. */
  | 'unexpected'

export interface GmailTransportErrorInit {
  status?: number | null
  retryAfterMs?: number | null
  /** The provider's own reason string, kept for logs and health rows. */
  providerReason?: string | null
}

const RECONNECT: ReadonlySet<GmailTransportErrorCode> = new Set([
  'invalid_grant',
  'insufficient_scope',
])

const RETRYABLE: ReadonlySet<GmailTransportErrorCode> = new Set([
  'rate_limited',
  'unavailable',
  'network',
])

export class GmailTransportError extends Error {
  readonly code: GmailTransportErrorCode
  readonly status: number | null
  readonly retryAfterMs: number | null
  readonly providerReason: string | null

  constructor(code: GmailTransportErrorCode, message: string, init: GmailTransportErrorInit = {}) {
    super(message)
    this.name = 'GmailTransportError'
    this.code = code
    this.status = init.status ?? null
    this.retryAfterMs = init.retryAfterMs ?? null
    this.providerReason = init.providerReason ?? null
  }

  /** The grant is gone; the mailbox needs connecting again. */
  get reconnectRequired(): boolean {
    return RECONNECT.has(this.code)
  }

  /** The same request may succeed later. */
  get retryable(): boolean {
    return RETRYABLE.has(this.code)
  }
}

/** Whether a thrown value says the mailbox's grant is gone. */
export function isReconnectRequired(error: unknown): boolean {
  return error instanceof GmailTransportError && error.reconnectRequired
}

/** The OAuth token endpoint's error body: `{ error, error_description }`. */
export function tokenEndpointError(status: number, body: unknown): GmailTransportError {
  const record = (body ?? {}) as { error?: unknown; error_description?: unknown }
  const reason = typeof record.error === 'string' ? record.error : null
  const described = typeof record.error_description === 'string' ? record.error_description : ''
  if (reason === 'invalid_grant') {
    return new GmailTransportError(
      'invalid_grant',
      'Google refused the mailbox grant. The mailbox must be connected again.',
      { status, providerReason: reason },
    )
  }
  if (reason === 'invalid_client' || reason === 'unauthorized_client') {
    return new GmailTransportError(
      'client_misconfigured',
      'Google refused this deployment’s OAuth client. Check its client id and secret.',
      { status, providerReason: reason },
    )
  }
  if (reason === 'invalid_scope') {
    return new GmailTransportError('insufficient_scope', 'Google refused a requested scope.', {
      status,
      providerReason: reason,
    })
  }
  return new GmailTransportError(
    status >= 500 ? 'unavailable' : 'invalid_request',
    `Google’s token endpoint refused the request${described ? `: ${described.slice(0, 200)}` : '.'}`,
    { status, providerReason: reason },
  )
}

interface GoogleApiErrorBody {
  error?: {
    code?: number
    message?: string
    status?: string
    errors?: Array<{ reason?: string; message?: string }>
    details?: Array<{ reason?: string }>
  }
}

/** Every reason string a Gmail API error body carries. */
function apiReasons(body: unknown): string[] {
  const error = (body as GoogleApiErrorBody | null)?.error
  return [
    ...(error?.errors ?? []).map((entry) => entry?.reason),
    ...(error?.details ?? []).map((entry) => entry?.reason),
    error?.status,
  ].filter((reason): reason is string => typeof reason === 'string' && reason.length > 0)
}

/** Whether a Gmail API 403 is a rate limit, which backs off like a 429. */
export function isRateLimitBody(body: unknown): boolean {
  return apiReasons(body).some((reason) =>
    ['rateLimitExceeded', 'userRateLimitExceeded', 'RESOURCE_EXHAUSTED'].includes(reason),
  )
}

/** A Gmail API error response, mapped. */
export function gmailApiError(
  status: number,
  body: unknown,
  init: { retryAfterMs?: number | null } = {},
): GmailTransportError {
  const reasons = apiReasons(body)
  const providerReason = reasons[0] ?? null
  const has = (...names: string[]) => reasons.some((reason) => names.includes(reason))
  const message = (body as GoogleApiErrorBody | null)?.error?.message
  const detail = typeof message === 'string' && message ? `: ${message.slice(0, 200)}` : '.'
  const make = (code: GmailTransportErrorCode, text: string) =>
    new GmailTransportError(code, text, { status, providerReason, retryAfterMs: init.retryAfterMs })

  if (status === 429 || (status === 403 && isRateLimitBody(body))) {
    return make('rate_limited', 'Gmail is rate-limiting this mailbox. Try again later.')
  }
  if (has('dailyLimitExceeded', 'quotaExceeded')) {
    return make('quota_exceeded', 'This mailbox has spent its Gmail quota for the day.')
  }
  if (has('insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
    return make('insufficient_scope', 'The mailbox grant is missing a permission Sequences needs.')
  }
  if (status >= 500) return make('unavailable', `Gmail is unavailable${detail}`)
  if (status === 401) return make('unauthorized', 'Gmail refused the mailbox’s access token.')
  if (status === 400 && has('failedPrecondition') && /mail service not enabled/i.test(String(message))) {
    return make('mail_service_unavailable', 'This Google account has no Gmail service.')
  }
  if (status === 404) return make('not_found', `Gmail found nothing there${detail}`)
  if (status === 400) return make('invalid_request', `Gmail refused the request${detail}`)
  if (status === 403) return make('forbidden', `Gmail refused the request${detail}`)
  return make('unexpected', `Gmail answered ${status}${detail}`)
}

/** The refusal reasons a route answers a Google failure with. */
export type GoogleFailureReason =
  | 'mail-service-unavailable'
  | 'google-refused'
  | 'rate-limited'
  | 'google-unavailable'

/** How a route answers one Google failure: its status, its reason and the sentence a person reads. */
export interface GoogleFailureAnswer {
  status: number
  reason: GoogleFailureReason
  error: string
}

/** What a person reads when the Google account behind a mailbox has no Gmail. */
export const OUTREACH_MAIL_SERVICE_UNAVAILABLE_MESSAGE =
  'This Google account does not have Gmail turned on yet. A new Google Workspace user can take up to a day ' +
  'before Gmail is ready; otherwise ask your Workspace administrator to turn Gmail on for the account. ' +
  'Then try again.'

/**
 * A Google failure a route could not handle itself, answered by whose failure
 * it is. Every route that talks to Google on a person's behalf answers
 * through this one decision.
 *
 * Only an answer Google did not give — an outage, a dropped connection, a
 * body that could not be read — or a request Google called malformed (which
 * is this code's to fix) is a 5xx. A refusal about the ACCOUNT is the
 * person's to act on: an account with no Gmail, one an administrator has
 * barred from the Gmail API, or one Google is rate-limiting. Those are 4xx
 * with a sentence that says what to do, so they do not page as an outage.
 *
 * Every failure is logged with Google's own code, status and reason, which is
 * the one place an operator can read what Google actually said. A value that
 * is not a {@link GmailTransportError} is rethrown: it is not Google's.
 */
export function googleFailureAnswer(error: unknown, route: string): GoogleFailureAnswer {
  if (!(error instanceof GmailTransportError)) throw error
  const detail = {
    code: error.code,
    status: error.status,
    providerReason: error.providerReason,
    message: error.message,
  }
  switch (error.code) {
    case 'mail_service_unavailable':
      console.warn(`[outreach] ${route}: the Google account has no Gmail service`, detail)
      return { status: 422, reason: 'mail-service-unavailable', error: OUTREACH_MAIL_SERVICE_UNAVAILABLE_MESSAGE }
    case 'forbidden':
      console.warn(`[outreach] ${route}: Google refused the account`, detail)
      return {
        status: 422,
        reason: 'google-refused',
        error:
          `Google refused this account's request: ${error.message} ` +
          'If it is a Google Workspace account, ask its administrator whether Gmail API access is allowed for it.',
      }
    case 'rate_limited':
    case 'quota_exceeded':
      console.warn(`[outreach] ${route}: Google is limiting the account`, detail)
      return {
        status: 429,
        reason: 'rate-limited',
        error:
          error.code === 'quota_exceeded'
            ? 'This Google account has used its Gmail quota for today. Try again tomorrow.'
            : 'Google is rate-limiting this account. Try again in a few minutes.',
      }
    default:
      console.error(`[outreach] ${route}: Google call failed`, detail)
      return {
        status: 502,
        reason: 'google-unavailable',
        error: error.retryable
          ? 'Google did not answer. Try again in a moment.'
          : `Google refused the request: ${error.message}`,
      }
  }
}
