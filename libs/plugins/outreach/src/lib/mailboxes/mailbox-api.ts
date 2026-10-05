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

import type { SenderReadiness } from '@aglyn/shared-util-email'
import type { OutreachMailbox, OutreachMailboxProvider, OutreachSendWindow } from '../model/outreach.types'

/**
 * THE MAILBOX ROUTES' CONTRACT (AGL-2978): what the Mailboxes panel sends,
 * what the routes answer, and the fragment a connect comes back through.
 * Client-safe — types, constants and two string functions.
 */

/** Every reason a mailbox route refuses with, for a caller to branch on. */
export type OutreachApiRefusalReason =
  | 'unauthenticated'
  | 'email-unverified'
  | 'org-required'
  | 'not-a-member'
  | 'not-org-wide'
  | 'permission'
  | 'entitlement'
  | 'not-configured'
  | 'method-not-allowed'
  | 'invalid-request'
  | 'mailbox-not-found'
  | 'not-your-mailbox'
  | 'mailbox-limit'
  | 'state-invalid'
  | 'state-expired'
  | 'state-user-mismatch'
  | 'state-org-mismatch'
  | 'state-replayed'
  | 'state-superseded'
  | 'code-rejected'
  | 'refresh-token-missing'
  | 'scopes-missing'
  | 'identity-unverified'
  | 'account-mismatch'
  | 'reconnect-required'
  | 'invalid-settings'
  | 'rate-limited'
  /** The Google account has no Gmail service: off for it, or not yet provisioned. */
  | 'mail-service-unavailable'
  /** Google refused the account itself, such as an administrator barring Gmail API access. */
  | 'google-refused'
  | 'google-unavailable'

export interface OutreachApiRefusal {
  error: string
  reason: OutreachApiRefusalReason
}

/** A reason `GET outreach/mailboxes/availability` answers `configured: false`. */
export type OutreachMailboxAvailabilityGate =
  | { gate: 'google'; missing: string[] }
  | { gate: 'microsoft'; missing: string[] }
  | { gate: 'state' }
  | { gate: 'redirect' }

/** `GET outreach/mailboxes/availability` */
export interface OutreachMailboxAvailability {
  /** Whether a Google mailbox can be connected: `providers.google`. */
  configured: boolean
  /**
   * Whether each provider's mailboxes can be connected here (AGL-3489): its
   * client configured, and the state secret and redirect every connect
   * needs. Absent from an older deployment, which connects Google only.
   */
  providers?: Record<OutreachMailboxProvider, boolean>
  /**
   * Which gates refused, so an operator reading the response knows what to
   * set: the Google client (`google`) or the Microsoft app registration
   * (`microsoft`), each with the names of its missing variables, the state
   * signing secret (`state`), or the console origin to register
   * (`redirect`). Absent when every gate is open.
   */
  missing?: OutreachMailboxAvailabilityGate[]
  /**
   * Whether the viewer is an organization owner or admin, who may change,
   * pause and disconnect any member's mailbox. The routes decide this on
   * every call; the panel reads it to offer only what will be allowed.
   */
  canManageAll: boolean
}

/** `POST outreach/mailboxes/connect` */
export interface OutreachConnectRequest {
  orgId: string
  /** Whose consent screen the connect goes to; Google when omitted. */
  provider?: OutreachMailboxProvider
  /** The account to suggest on Microsoft's sign-in, such as a mailbox being reconnected. */
  loginHint?: string
}
export interface OutreachConnectResponse {
  /** The provider's consent address; the browser goes there. */
  url: string
}

/** `POST outreach/mailboxes/connect/complete` */
export interface OutreachConnectCompleteRequest {
  orgId: string
  code: string
  state: string
  /** The browser's IANA timezone, for a new mailbox's sending window. */
  timezone?: string
}
export interface OutreachConnectCompleteResponse {
  ok: true
  mailbox: OutreachMailbox
  /** False when an existing mailbox for the account was reconnected. */
  created: boolean
  /** Pending addresses of the member's that the provider's send-as list confirmed. */
  confirmedAliases: string[]
}

/** `POST outreach/mailboxes/settings` — every field but the ids is optional. */
export interface OutreachMailboxSettingsRequest {
  orgId: string
  mailboxId: string
  sendAs?: string
  displayName?: string
  dailyCap?: number
  window?: OutreachSendWindow
  timezone?: string
  /**
   * Whether the warm-up ramp applies (AGL-3228). `false` clears it, so an
   * established mailbox sends at its cap from today; `true` starts one now
   * when none is running.
   */
  warmUp?: boolean
}

/** `POST outreach/mailboxes/status` */
export interface OutreachMailboxStatusRequest {
  orgId: string
  mailboxId: string
  paused: boolean
}

export interface OutreachMailboxResponse {
  ok: true
  mailbox: OutreachMailbox
}

/**
 * `POST outreach/mailboxes/test` — `{ mailboxId, to? }`. `to` is the address
 * the test goes to; left off, the account's own (AGL-3228).
 */
export interface OutreachMailboxTestResponse {
  ok: true
  /** The address the test went to. */
  sentTo: string
  gmailMessageId: string
  sentAtMs: number
}

/** `POST outreach/mailboxes/disconnect` */
export interface OutreachMailboxDisconnectResponse {
  ok: true
  /**
   * What became of the grant at the provider: `revoked`, `already-invalid`,
   * `kept-for-other-mailbox` when another mailbox still uses the account,
   * `unsupported` for a Microsoft grant, which no app can revoke itself, or
   * `failed` when Google could not be told — the stored grant is deleted
   * either way.
   */
  revocation: 'revoked' | 'already-invalid' | 'kept-for-other-mailbox' | 'unsupported' | 'failed'
}

/**
 * `POST outreach/mailboxes/readiness` — `{ mailboxId, fresh? }`. How
 * receivers judge mail from the address the mailbox sends as (AGL-3328):
 * `readiness` is null for a consumer Gmail address, whose records are
 * Google's own and have nothing for its owner to publish.
 */
export interface OutreachMailboxReadinessResponse {
  ok: true
  /** The address whose domain was read. */
  sendAs: string
  readiness: SenderReadiness | null
}

/**
 * The fragment key a connect returns through (AGL-2978).
 *
 * Google redirects to the callback route with the authorization code in the
 * query; the callback moves it into the FRAGMENT of the Mailboxes page, which
 * no server receives — not in a request line, not in a `Referer` — and the
 * page takes it out of the address bar before it finishes the connect with
 * the member's own session. The cross-domain session handoff uses the
 * fragment for the same reason.
 */
export const OUTREACH_CONNECT_FRAGMENT_KEY = 'outreachConnect'

/** Why a connect came back without a code. */
export type OutreachConnectReturnError = 'access_denied' | 'expired' | 'google_error'

export type OutreachConnectReturn =
  | { kind: 'code'; code: string; state: string }
  /** `provider` names a Microsoft connect; an error without it was Google's. */
  | { kind: 'error'; reason: OutreachConnectReturnError; provider?: OutreachMailboxProvider }

/** The fragment for a connect's return, without the leading `#`. */
export function buildConnectReturnFragment(value: OutreachConnectReturn): string {
  const params = new URLSearchParams()
  if (value.kind === 'code') {
    params.set(OUTREACH_CONNECT_FRAGMENT_KEY, 'code')
    params.set('code', value.code)
    params.set('state', value.state)
  } else {
    params.set(OUTREACH_CONNECT_FRAGMENT_KEY, 'error')
    params.set('reason', value.reason)
    if (value.provider === 'microsoft') params.set('provider', value.provider)
  }
  return params.toString()
}

const RETURN_ERRORS: readonly OutreachConnectReturnError[] = ['access_denied', 'expired', 'google_error']

/** A connect's return read off a location hash, or `null` when it carries none. */
export function parseConnectReturnFragment(hash: string | null | undefined): OutreachConnectReturn | null {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''))
  const kind = params.get(OUTREACH_CONNECT_FRAGMENT_KEY)
  if (kind === 'code') {
    const code = params.get('code') ?? ''
    const state = params.get('state') ?? ''
    return code && state ? { kind: 'code', code, state } : null
  }
  if (kind === 'error') {
    const reason = params.get('reason') as OutreachConnectReturnError | null
    return {
      kind: 'error',
      reason: reason && RETURN_ERRORS.includes(reason) ? reason : 'google_error',
      ...(params.get('provider') === 'microsoft' ? { provider: 'microsoft' as const } : {}),
    }
  }
  return null
}
