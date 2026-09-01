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

import { getEmailConfig } from './send-email'

/**
 * Where the credential probe asks its question.
 *
 * Deliberately NOT the send endpoint. A probe aimed at `/emails` is a send
 * attempt however empty its body is: it consumes an API call, and Resend
 * records it in the account's logs as a `422` on `POST /emails` with no
 * recipient, no subject and nothing identifying the caller — a line an
 * operator reading that dashboard has to treat as failed mail. A domain read
 * cannot create a message and cannot be mistaken for one.
 */
export const RESEND_DOMAINS_ENDPOINT = 'https://api.resend.com/domains'

/**
 * Resend error names that mean the key itself was not accepted, as opposed to
 * a key that authenticated and merely lacks read scope. Matched by NAME, not
 * status: `401` and `403` each cover both meanings.
 */
const REFUSED_KEY_ERRORS = new Set([
  'missing_api_key',
  'validation_error',
  'suspended_api_key',
])

/**
 * Resend error names that mean the key authenticated and was then denied this
 * particular read. A sending-scoped key — the shape Aglyn provisions — always
 * lands here, and reaching this answer at all required Resend to recognize
 * the credential, which is exactly what the probe is asking.
 */
const AUTHENTICATED_BUT_UNSCOPED_ERRORS = new Set([
  'restricted_api_key',
  'invalid_permission',
])

/** The `name` Resend puts on an error body, or `''` for anything else. */
function resendErrorName(body: string): string {
  try {
    const parsed = JSON.parse(body) as { name?: unknown }
    return typeof parsed?.name === 'string' ? parsed.name : ''
  } catch {
    return ''
  }
}

export interface EmailConfigReport {
  /** Both env vars present — mail will at least be attempted. */
  configured: boolean
  hasApiKey: boolean
  hasFrom: boolean
  /**
   * The configured sender, e.g. `Aglyn <noreply@aglyn.com>`. Not a secret —
   * it appears in the headers of every message we send.
   */
  from: string | null
  /** Domain part of the sender, which is what must be verified in Resend. */
  fromDomain: string | null
}

/**
 * Describes the email configuration without revealing the API key.
 *
 * Answers "is this environment able to send mail?" — the question that is
 * otherwise only answerable by emailing a real person and waiting.
 */
export function describeEmailConfig(): EmailConfigReport {
  const { apiKey, from } = getEmailConfig()
  const match = from?.match(/<([^>]+)>/)
  const address = (match?.[1] ?? from ?? '').trim()
  const domain = address.includes('@') ? address.split('@').pop()! : null
  return {
    configured: Boolean(apiKey && from),
    hasApiKey: Boolean(apiKey),
    hasFrom: Boolean(from),
    from: from ?? null,
    fromDomain: domain,
  }
}

export type EmailCredentialStatus =
  | 'ok'
  | 'unconfigured'
  | 'invalid-key'
  | 'unknown'

export interface EmailCredentialReport {
  status: EmailCredentialStatus
  /** HTTP status Resend answered the probe with, when it answered. */
  probeStatus?: number
  detail?: string
}

/**
 * Checks whether `RESEND_API_KEY` is actually accepted by Resend — without
 * sending anything to anybody, and without leaving anything behind that reads
 * as failed mail.
 *
 * How: a `GET` of the domains collection. The question is only ever "does
 * Resend recognize this credential", so the probe reads the ERROR NAME rather
 * than the status, because `401` and `403` each carry both meanings:
 *
 * - `2xx` — the key is accepted and has read scope → `ok`
 * - `restricted_api_key` / `invalid_permission` — Resend authenticated the
 *   key and then denied it this read. A sending-scoped key, which is what
 *   Aglyn provisions, always answers this way, and getting the answer proves
 *   the credential works → `ok`
 * - `missing_api_key` / `validation_error` / `suspended_api_key` — the key
 *   itself was refused → `invalid-key`
 * - anything else → `unknown`
 *
 * An unrecognized rejection is `unknown`, never `invalid-key`: this feeds a
 * staff diagnostics screen whose whole value is that a red line means
 * something, and a shape we have not seen before is not evidence that a
 * working key is broken.
 *
 * It cannot confirm that *domain verification* has completed — only a real
 * send does that.
 */
export async function checkEmailCredentials(): Promise<EmailCredentialReport> {
  const { apiKey } = getEmailConfig()
  if (!apiKey) return { status: 'unconfigured' }

  try {
    const response = await fetch(RESEND_DOMAINS_ENDPOINT, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const detail = (await response.text().catch(() => '')).slice(0, 300)

    if (response.status >= 200 && response.status < 300) {
      return { status: 'ok', probeStatus: response.status }
    }
    if (response.status === 401 || response.status === 403) {
      const name = resendErrorName(detail)
      if (AUTHENTICATED_BUT_UNSCOPED_ERRORS.has(name)) {
        return { status: 'ok', probeStatus: response.status }
      }
      if (REFUSED_KEY_ERRORS.has(name)) {
        return { status: 'invalid-key', probeStatus: response.status, detail }
      }
    }
    return { status: 'unknown', probeStatus: response.status, detail }
  } catch (error) {
    return {
      status: 'unknown',
      detail: String((error as Error)?.message ?? error).slice(0, 300),
    }
  }
}

/** One pool member, as the provider reports it. */
export interface SharedPoolDomainReport {
  domain: string
  /** `verified` when the provider will accept mail on it. */
  status: string
  /** False when the provider has never heard of it. */
  present: boolean
  /**
   * Whether the provider will rewrite links on this domain to measure clicks.
   *
   * Reported because the symptom of it being off is INVISIBLE. A provider
   * counts a click by rewriting every `<a href>` to a tracking host, so a
   * domain without one produces a click rate of exactly 0% — which reads on a
   * dashboard as an audience that does not click, not as a domain that cannot
   * count. The last time this was wrong nobody found it by looking at the
   * numbers; it was found by reading a delivered message's source.
   *
   * `null` when the provider's listing does not say, so "it did not tell us"
   * is never reported as "it is off".
   */
  clickTracking: boolean | null
  /** The same, for the open pixel. */
  openTracking: boolean | null
}

export type SharedPoolStatus =
  /** No platform pool applies to this deployment. */
  | 'not-applicable'
  /** No read credential, so the pool cannot be inspected. */
  | 'unreadable'
  | 'ok'
  | 'degraded'

export interface SharedPoolReport {
  status: SharedPoolStatus
  domains: SharedPoolDomainReport[]
  /** Members the provider will not accept mail on right now. */
  unusable: string[]
  /**
   * Members that will carry mail but cannot measure a click on it.
   *
   * Reported APART from {@link unusable} because the two are different
   * severities and conflating them would be wrong in both directions: a
   * member here is delivering perfectly, and a member in `unusable` is not
   * delivering at all. This one does not degrade the pool — see
   * {@link SharedPoolReport.status} — it is a measurement fault, and stopping
   * mail over it would be the control causing the outage.
   */
  untracked: string[]
  detail?: string
}

/**
 * Whether the shared platform pool can actually carry mail.
 *
 * The pool is the delivery floor: a site with no domain of its own sends its
 * receipts, password resets and booking confirmations from a member of it. So
 * a degraded pool is not a warning about a future problem, it is every such
 * site's transactional mail already failing — which is why the caller treats
 * this as a blocker rather than a note.
 *
 * Read with `RESEND_READ_API_KEY`, deliberately, and never with the sending
 * key. A sending-scoped key has no read permission, so asking it about domains
 * yields an authorization error that says nothing about the domains — which is
 * exactly how a pool the key could not send from reported healthy. Without a
 * read key this answers `unreadable`, which is the honest answer and not a
 * pass: the caller must not treat "I could not look" as "I looked and it was
 * fine".
 *
 * `not-applicable` covers the self-host shape. The pool is a property of the
 * Aglyn platform; an operator running their own deployment sends from their
 * own domain and has no pool to be degraded.
 */
export async function checkSharedSendingPool(options: {
  pool: string[]
  readApiKey?: string
  endpoint?: string
}): Promise<SharedPoolReport> {
  const pool = options.pool.filter(Boolean)
  if (!pool.length) {
    return {
      status: 'not-applicable',
      domains: [],
      unusable: [],
      untracked: [],
    }
  }

  const key = String(options.readApiKey ?? '').trim()
  if (!key) {
    return {
      status: 'unreadable',
      domains: [],
      unusable: [],
      untracked: [],
      detail:
        'RESEND_READ_API_KEY is not set, so the shared pool cannot be ' +
        'inspected. The sending key has no read permission and would report ' +
        'an authorization error rather than the state of the domains.',
    }
  }

  try {
    const response = await fetch(options.endpoint ?? RESEND_DOMAINS_ENDPOINT, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    })
    if (response.status < 200 || response.status >= 300) {
      return {
        status: 'unreadable',
        domains: [],
        unusable: [],
        untracked: [],
        detail: `The provider answered ${response.status} to the domain read.`,
      }
    }
    const payload = (await response.json().catch(() => null)) as
      | {
          data?: Array<{
            name?: unknown
            status?: unknown
            click_tracking?: unknown
            open_tracking?: unknown
          }>
        }
      | null
    /**
     * A tri-state, and the third state matters: a listing that does not carry
     * the field must not be reported as the field being false. Off is a fault
     * somebody should fix; unknown is a question this probe could not ask.
     */
    const flag = (value: unknown): boolean | null =>
      typeof value === 'boolean' ? value : null
    const byName = new Map<
      string,
      { status: string; click: boolean | null; open: boolean | null }
    >()
    for (const row of payload?.data ?? []) {
      const name = String(row?.name ?? '').toLowerCase()
      if (!name) continue
      byName.set(name, {
        status: String(row?.status ?? 'unknown'),
        click: flag(row?.click_tracking),
        open: flag(row?.open_tracking),
      })
    }
    const domains = pool.map((domain) => {
      const row = byName.get(domain.toLowerCase())
      return {
        domain,
        status: row?.status ?? 'absent',
        present: row !== undefined,
        clickTracking: row?.click ?? null,
        openTracking: row?.open ?? null,
      }
    })
    const unusable = domains
      .filter((entry) => entry.status !== 'verified')
      .map((entry) => entry.domain)
    /*
     * Only a definite `false` counts. A member the provider did not describe
     * is already reported by `present`, and listing it here as well would
     * send an operator to fix a setting they cannot see.
     */
    const untracked = domains
      .filter((entry) => entry.clickTracking === false)
      .map((entry) => entry.domain)
    return {
      /*
       * `untracked` deliberately does NOT degrade the pool. `degraded` is
       * read as "transactional mail is failing right now" and is treated as a
       * blocker; a domain that delivers but does not count clicks is neither.
       * Folding the two together would either raise a false alarm about
       * delivery or teach an operator to ignore the real one.
       */
      status: unusable.length ? 'degraded' : 'ok',
      domains,
      unusable,
      untracked,
      ...(untracked.length
        ? {
            detail:
              `Click tracking is off for ${untracked.join(', ')}. Mail from ` +
              'these domains delivers normally and reports a click rate of ' +
              'exactly 0%, because the provider rewrites links only on a ' +
              'domain that has a verified tracking subdomain.',
          }
        : {}),
    }
  } catch (error) {
    return {
      status: 'unreadable',
      domains: [],
      unusable: [],
      untracked: [],
      detail: String((error as Error)?.message ?? error).slice(0, 300),
    }
  }
}
