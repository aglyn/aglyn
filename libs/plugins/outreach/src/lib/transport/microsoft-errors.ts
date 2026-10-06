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

import { GmailTransportError, type GmailTransportErrorCode } from './gmail-errors'

/**
 * WHAT A MICROSOFT CALL CAN FAIL WITH (AGL-3489), mapped onto the
 * transport's one error type so a caller decides the same three things it
 * decides for Google: reconnect, retry later, or give up.
 *
 * Microsoft answers in two dialects as well: the identity platform's token
 * endpoint (`{ error: 'invalid_grant', error_description: 'AADSTS…' }`) and
 * Graph (`{ error: { code: 'ErrorAccessDenied', message } }`).
 */

/** The token endpoint's error body, mapped. */
export function microsoftTokenEndpointError(status: number, body: unknown): GmailTransportError {
  const record = (body ?? {}) as { error?: unknown; error_description?: unknown }
  const reason = typeof record.error === 'string' ? record.error : null
  const described = typeof record.error_description === 'string' ? record.error_description : ''
  // The AADSTS code alone: the description goes on to name the tenant and the user.
  const aadsts = /AADSTS\d+/.exec(described)?.[0] ?? null
  const init = { status, providerReason: aadsts ?? reason }
  if (reason === 'invalid_grant' || reason === 'interaction_required') {
    return new GmailTransportError(
      'invalid_grant',
      'Microsoft refused the mailbox grant. The mailbox must be connected again.',
      init,
    )
  }
  if (reason === 'invalid_client' || reason === 'unauthorized_client') {
    return new GmailTransportError(
      'client_misconfigured',
      'Microsoft refused this deployment’s app registration. Check its client id and secret.',
      init,
    )
  }
  if (reason === 'invalid_scope' || reason === 'consent_required') {
    return new GmailTransportError('insufficient_scope', 'Microsoft refused a requested permission.', init)
  }
  return new GmailTransportError(
    status >= 500 ? 'unavailable' : 'invalid_request',
    `Microsoft’s token endpoint refused the request${aadsts ? ` (${aadsts})` : '.'}`,
    init,
  )
}

const QUOTA = new Set(['ErrorQuotaExceeded', 'ErrorSubmissionQuotaExceeded', 'ErrorExceededMessageLimit'])
const SCOPE = new Set(['ErrorAccessDenied', 'AccessDenied', 'Authorization_RequestDenied'])
const NO_MAILBOX = new Set([
  'MailboxNotEnabledForRESTAPI',
  'MailboxNotHostedInExchangeOnline',
  'ErrorMailboxNotEnabledForRESTAPI',
])
const NOT_FOUND = new Set(['ErrorItemNotFound', 'ErrorInvalidIdMalformed', 'ResourceNotFound'])

/** A Graph error response, mapped. */
export function graphApiError(
  status: number,
  body: unknown,
  init: { retryAfterMs?: number | null } = {},
): GmailTransportError {
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error
  const code = typeof error?.code === 'string' ? error.code : null
  const message = typeof error?.message === 'string' ? error.message : ''
  const detail = message ? `: ${message.slice(0, 200)}` : '.'
  const make = (transportCode: GmailTransportErrorCode, text: string) =>
    new GmailTransportError(transportCode, text, { status, providerReason: code, retryAfterMs: init.retryAfterMs })

  if (status === 429) return make('rate_limited', 'Microsoft is rate-limiting this mailbox. Try again later.')
  if (code && QUOTA.has(code)) return make('quota_exceeded', 'This mailbox has spent its Microsoft sending limit.')
  if (code && NO_MAILBOX.has(code)) {
    return make('mail_service_unavailable', 'This Microsoft account has no Exchange Online mailbox.')
  }
  if (status >= 500) return make('unavailable', `Microsoft Graph is unavailable${detail}`)
  if (status === 401) return make('unauthorized', 'Microsoft Graph refused the mailbox’s access token.')
  if (status === 403 && code && SCOPE.has(code)) {
    return make('insufficient_scope', 'The mailbox grant is missing a permission Sequences needs.')
  }
  if (status === 404 || (code && NOT_FOUND.has(code))) return make('not_found', `Microsoft Graph found nothing there${detail}`)
  if (status === 400) return make('invalid_request', `Microsoft Graph refused the request${detail}`)
  if (status === 403) return make('forbidden', `Microsoft Graph refused the request${detail}`)
  return make('unexpected', `Microsoft Graph answered ${status}${detail}`)
}
