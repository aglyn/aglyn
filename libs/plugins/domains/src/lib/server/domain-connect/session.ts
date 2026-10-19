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

import { createHash, randomBytes } from 'node:crypto'
import {
  isDomainConnectTerminal,
  type DomainConnectStatus,
  type DomainConnectTemplate,
} from '../../model/domain-connect'

/*
 * A ONE-CLICK DNS SESSION, AND EVERYTHING THAT MOVES IT (AGL-3963).
 *
 * `domainConnectSessions/{id}` is written by the server alone (the rules
 * refuse every client), once per hand-off to a DNS provider. Its id is the
 * SHA-256 of the state token the provider echoes back, so the token itself
 * is never stored: the session is found by hashing what came back, and a
 * leaked document names no live token.
 *
 *     started ──provider returns──▶ applied ──DNS not there yet──▶ waiting
 *        │  └─provider says no──▶ cancelled / failed                 │
 *        │                                                          ▼
 *        └────────────── DNS resolves (from any of the three) ──▶ connected
 *     any open status, 48 h after it started ─────────────────────▶ expired
 *
 * `started` can connect without passing through `applied`: a provider page
 * that isolates itself, or a browser that drops the redirect, leaves the
 * session unanswered while the records were written all the same, and DNS
 * is the evidence the spec says to trust over the redirect anyway.
 *
 * Every transition is a pure function below, so the route, the return page
 * and the sweep cannot disagree about one.
 */

/** How long a session may wait for its records before it is given up on. */
export const DOMAIN_CONNECT_SESSION_TTL_MS = 48 * 60 * 60 * 1000

/**
 * How long an apex session waits for `www` once the root resolves. The apex
 * template writes both together, so `www` is usually there with the root;
 * after this the root connects alone rather than waiting on a name that may
 * never come.
 */
export const DOMAIN_CONNECT_TWIN_GRACE_MS = 30 * 60 * 1000

/** How long one checker holds a session before another may take it. */
export const DOMAIN_CONNECT_LEASE_MS = 60 * 1000

export interface DomainConnectSession {
  orgId: string
  hostId: string
  /** What the owner typed, validated: the domain that becomes the site's. */
  domain: string
  /** The zone root the template is applied to. */
  root: string
  /** The name under the root; empty for the root. */
  host: string
  template: DomainConnectTemplate
  /** The `www.`/apex partner the apex template writes; null for a subdomain. */
  twin: string | null
  providerId: string
  providerName: string
  serviceId: string
  status: DomainConnectStatus
  /** Why it failed, or what is still pending after a connect. A code. */
  code: string | null
  createdBy: string
  createdByEmail: string | null
  createdAtMs: number
  updatedAtMs: number
  expiresAtMs: number
  /** When the provider sent the owner back without an error. */
  appliedAtMs: number | null
  /** When the domain first resolved here, for the twin's grace. */
  resolvedAtMs: number | null
  /** A checker's hold, so the widget's poll and the sweep do not both connect. */
  leaseUntilMs: number | null
  /**
   * When the sweep should look next; null once terminal. The sweep reads the
   * smallest first and every look moves it to now, so open sessions take
   * turns and a terminal one is never read again.
   */
  nextCheckAtMs: number | null
}

export type DomainConnectSessionPatch = Partial<
  Pick<
    DomainConnectSession,
    'status' | 'code' | 'updatedAtMs' | 'appliedAtMs' | 'resolvedAtMs' | 'leaseUntilMs' | 'nextCheckAtMs'
  >
>

/** A fresh state token: 32 random bytes, base64url. */
export function newDomainConnectState(): string {
  return randomBytes(32).toString('base64url')
}

/** What a state token looks like: 32 bytes of base64url. */
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** The session id for a state token, or null for a value no token could be. */
export function domainConnectSessionId(state: unknown): string | null {
  const value = typeof state === 'string' ? state.trim() : ''
  if (!STATE_PATTERN.test(value)) return null
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export interface NewSessionInput {
  orgId: string
  hostId: string
  domain: string
  root: string
  host: string
  template: DomainConnectTemplate
  twin: string | null
  providerId: string
  providerName: string
  serviceId: string
  createdBy: string
  createdByEmail: string | null
  nowMs: number
}

export function newDomainConnectSession(input: NewSessionInput): DomainConnectSession {
  return {
    ...input,
    status: 'started',
    code: null,
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + DOMAIN_CONNECT_SESSION_TTL_MS,
    appliedAtMs: null,
    resolvedAtMs: null,
    leaseUntilMs: null,
    nextCheckAtMs: input.nowMs,
  }
}

/** Provider error codes the spec names; anything else is `server_error`. */
const PROVIDER_ERRORS = new Set([
  'invalid_request',
  'unauthorized_client',
  'access_denied',
  'unsupported_response_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
])

/**
 * The provider sent the owner back, with `error` when it did not apply.
 * Only a `started` session moves: a second return, or one after the sweep
 * connected it, changes nothing. `access_denied` is the owner declining.
 */
export function sessionAfterReturn(
  session: DomainConnectSession,
  error: string | null,
  nowMs: number,
): DomainConnectSessionPatch | null {
  if (session.status !== 'started') return null
  if (!error) return { status: 'applied', appliedAtMs: nowMs, updatedAtMs: nowMs }
  if (error === 'access_denied') {
    return { status: 'cancelled', code: 'access_denied', updatedAtMs: nowMs, nextCheckAtMs: null }
  }
  return {
    status: 'failed',
    code: `provider:${PROVIDER_ERRORS.has(error) ? error : 'server_error'}`,
    updatedAtMs: nowMs,
    nextCheckAtMs: null,
  }
}

/** What a DNS check found for the session's names. */
export interface SessionDnsFinding {
  /** The typed domain points here. */
  primary: boolean
  /** The twin points here; null when the session has none. */
  twin: boolean | null
}

export type SessionStep =
  /** Nothing to do: terminal, or nothing changed. */
  | { kind: 'none' }
  /** Write this and stop. */
  | { kind: 'update'; patch: DomainConnectSessionPatch }
  /** Connect the domain, with this twin, and record what that answers. */
  | { kind: 'connect'; twin: string | null; patch: DomainConnectSessionPatch }

/** Whether the session is past its 48 hours. */
export function sessionExpired(session: DomainConnectSession, nowMs: number): boolean {
  return nowMs >= session.expiresAtMs
}

/**
 * The next step for an open session given what DNS says now.
 *
 * - The domain resolves: connect it. The twin rides along when it resolves
 *   too; an apex session gives `www` {@link DOMAIN_CONNECT_TWIN_GRACE_MS}
 *   to catch up, then connects the root alone.
 * - It does not, and 48 h have passed: expired.
 * - It does not: an applied session is now waiting; a started one stays
 *   started, since nothing says the owner approved anything yet.
 */
export function sessionAfterDnsCheck(
  session: DomainConnectSession,
  found: SessionDnsFinding,
  nowMs: number,
): SessionStep {
  if (isDomainConnectTerminal(session.status)) return { kind: 'none' }
  if (found.primary) {
    const resolvedAtMs = session.resolvedAtMs ?? nowMs
    if (session.twin && found.twin !== true && nowMs - resolvedAtMs < DOMAIN_CONNECT_TWIN_GRACE_MS) {
      return session.resolvedAtMs === null || session.status !== 'waiting'
        ? { kind: 'update', patch: { status: 'waiting', resolvedAtMs, updatedAtMs: nowMs } }
        : { kind: 'none' }
    }
    return {
      kind: 'connect',
      twin: session.twin && found.twin === true ? session.twin : null,
      patch: { resolvedAtMs, updatedAtMs: nowMs },
    }
  }
  if (sessionExpired(session, nowMs)) {
    return { kind: 'update', patch: { status: 'expired', code: 'dns-not-pointed', updatedAtMs: nowMs } }
  }
  if (session.status === 'applied') {
    return { kind: 'update', patch: { status: 'waiting', updatedAtMs: nowMs } }
  }
  return { kind: 'none' }
}

/** What `connectHostCustomDomain` answered, reduced to what the session records. */
export type SessionConnectOutcome =
  | { ok: 'connected'; servingPending: boolean }
  | {
      ok: 'refused'
      code: 'unknown-site' | 'taken' | 'not-configured' | 'attach-failed' | 'held-elsewhere'
    }

/**
 * The session after a connect. A name the platform could not attach yet
 * (`not-configured`, `attach-failed`) is still CLAIMED by the site, and the
 * attachment completer retries it, so it is connected with the shortfall in
 * `code`; a name another site holds, or held elsewhere, fails.
 */
export function sessionAfterConnect(
  outcome: SessionConnectOutcome,
  nowMs: number,
): DomainConnectSessionPatch {
  if (outcome.ok === 'connected') {
    return {
      status: 'connected',
      code: outcome.servingPending ? 'serving-pending' : null,
      updatedAtMs: nowMs,
      leaseUntilMs: null,
    }
  }
  if (outcome.code === 'not-configured' || outcome.code === 'attach-failed') {
    return { status: 'connected', code: 'attach-pending', updatedAtMs: nowMs, leaseUntilMs: null }
  }
  return { status: 'failed', code: outcome.code, updatedAtMs: nowMs, leaseUntilMs: null }
}
