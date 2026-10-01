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
import type { MailProvider } from './mail-provider'
import {
  mailProvider,
  mailProviderProblem,
  mailProviderReads,
} from './mail-providers'

export interface EmailConfigReport {
  /** The provider has its settings and a sender is set — mail will at least be attempted. */
  configured: boolean
  /** The id of the provider mail is handed to — see `mail-providers.ts`. */
  provider: string
  /** Settings that provider still needs before it can send, as an operator names them. */
  missingSettings: string[]
  /**
   * Set when the operator chose a provider this process does not have: why
   * no mail is sent. Not the same as a missing key — see `mailProviderProblem`.
   */
  providerProblem: string | null
  /** The provider has what it needs to send. */
  hasApiKey: boolean
  hasFrom: boolean
  /**
   * The configured sender, e.g. `Aglyn <noreply@aglyn.com>`. Not a secret —
   * it appears in the headers of every message we send.
   */
  from: string | null
  /** Domain part of the sender, which is what must be verified with the provider. */
  fromDomain: string | null
}

/**
 * Describes the email configuration without revealing the API key.
 *
 * Answers "is this environment able to send mail?" — the question that is
 * otherwise only answerable by emailing a real person and waiting.
 */
export function describeEmailConfig(): EmailConfigReport {
  const { provider, missingSettings, from } = getEmailConfig()
  const match = from?.match(/<([^>]+)>/)
  const address = (match?.[1] ?? from ?? '').trim()
  const domain = address.includes('@') ? address.split('@').pop()! : null
  return {
    configured: !missingSettings.length && Boolean(from),
    provider,
    missingSettings,
    providerProblem: mailProviderProblem(),
    hasApiKey: !missingSettings.length,
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
  /** HTTP status the provider answered the probe with, when it answered. */
  probeStatus?: number
  detail?: string
}

/**
 * Whether the provider accepts this deployment's credential — asked without
 * sending anything to anybody, and without leaving anything behind that
 * reads as failed mail. How it asks is the provider's own (see its
 * `checkCredentials`).
 *
 * An answer this cannot get is `unknown`, never `invalid-key`: this feeds a
 * staff diagnostics screen whose whole value is that a red line means
 * something. A provider with no probe is `unknown` for the same reason.
 *
 * It cannot confirm that *domain verification* has completed — only a real
 * send does that.
 */
export async function checkEmailCredentials(
  provider: MailProvider = mailProvider(),
): Promise<EmailCredentialReport> {
  const problem = mailProviderProblem(provider)
  if (problem) return { status: 'unconfigured', detail: problem }
  if (provider.missingSettings().length) return { status: 'unconfigured' }
  if (!provider.checkCredentials) {
    return {
      status: 'unknown',
      detail:
        `The "${provider.id}" mail provider has no credential probe; a test ` +
        'send is the way to know it delivers.',
    }
  }
  try {
    return await provider.checkCredentials()
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
 * Read through the provider's READS, deliberately, and never with the
 * sending credential. A sending-scoped key has no read permission, so asking
 * it about domains yields an authorization error that says nothing about the
 * domains — which is exactly how a pool the key could not send from reported
 * healthy. A provider that cannot read answers `unreadable`, which is the
 * honest answer and not a pass: the caller must not treat "I could not look"
 * as "I looked and it was fine".
 *
 * `not-applicable` covers the self-host shape. The pool is a property of the
 * Aglyn platform; an operator running their own deployment sends from their
 * own domain and has no pool to be degraded.
 */
export async function checkSharedSendingPool(options: {
  pool: string[]
  /** The provider to ask; the deployment's own by default. */
  provider?: MailProvider
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

  const reads = mailProviderReads(options.provider ?? mailProvider())
  const unmet = reads.unmet()
  if (unmet) {
    return {
      status: 'unreadable',
      domains: [],
      unusable: [],
      untracked: [],
      detail: `${unmet} The shared pool cannot be inspected without it.`,
    }
  }

  try {
    const byName = new Map(
      (await reads.sendingDomains()).map((row) => [row.name.toLowerCase(), row]),
    )
    const domains = pool.map((domain) => {
      const row = byName.get(domain.toLowerCase())
      return {
        domain,
        status: row?.status ?? 'absent',
        present: row !== undefined,
        clickTracking: row?.clickTracking ?? null,
        openTracking: row?.openTracking ?? null,
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
