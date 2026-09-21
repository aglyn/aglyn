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

import type { OutreachMailbox, OutreachSendWindow } from '../model/outreach.types'

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
  | 'google-unavailable'

export interface OutreachApiRefusal {
  error: string
  reason: OutreachApiRefusalReason
}

/** A reason `GET outreach/mailboxes/availability` answers `configured: false`. */
export type OutreachMailboxAvailabilityGate =
  | { gate: 'google'; missing: string[] }
  | { gate: 'state' }
  | { gate: 'redirect' }

/** `GET outreach/mailboxes/availability` */
export interface OutreachMailboxAvailability {
  configured: boolean
  /**
   * When not configured, which gates refused, so an operator reading the
   * response knows what to set: the Google client (`google`, with the names
   * of the missing variables), the state signing secret (`state`), or the
   * console origin to register (`redirect`). Absent when configured.
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
}
export interface OutreachConnectResponse {
  /** Google's consent address; the browser goes there. */
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
  /** Pending addresses of the member's that Gmail's send-as list confirmed. */
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

/** `POST outreach/mailboxes/test` */
export interface OutreachMailboxTestResponse {
  ok: true
  /** The account's own address the test went to. */
  sentTo: string
  gmailMessageId: string
  sentAtMs: number
}

/** `POST outreach/mailboxes/disconnect` */
export interface OutreachMailboxDisconnectResponse {
  ok: true
  /**
   * What became of the grant at Google: `revoked`, `already-invalid`,
   * `kept-for-other-mailbox` when another mailbox still uses the account,
   * or `failed` when Google could not be told — the stored grant is deleted
   * either way.
   */
  revocation: 'revoked' | 'already-invalid' | 'kept-for-other-mailbox' | 'failed'
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
  | { kind: 'error'; reason: OutreachConnectReturnError }

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
    return { kind: 'error', reason: reason && RETURN_ERRORS.includes(reason) ? reason : 'google_error' }
  }
  return null
}
