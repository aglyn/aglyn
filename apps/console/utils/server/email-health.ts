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

import {
  checkEmailCredentials,
  checkSharedSendingPool,
  describeEmailConfig,
  sharedSendingPool,
} from '@aglyn/shared-util-email'
import { operatorIdentity } from '@aglyn/aglyn/app-utils/operator-identity'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { raiseOperatorAlert } from '@aglyn/tenant-data-admin/server/operator-alerts'

/**
 * The sender domain this deployment expects in production (AGL-709/721).
 *
 * Operator configuration (AGL-2016). Hardcoded to `aglyn.com`, this health
 * check told every self-hoster their correctly-configured mail was wrong —
 * an unfixable red on a staff diagnostics page, for the one deployment shape
 * where the answer is "your domain, not ours". Derived from the operator's
 * support address so it cannot drift from the address the product actually
 * prints; falls back to the literal for a deployment that has not configured
 * an operator yet, which keeps this check's behaviour rather than turning it
 * into a second unconfigured surface.
 */
export const EXPECTED_FROM_DOMAIN =
  operatorIdentity().supportEmail?.split('@').pop() || 'aglyn.com'

/**
 * Can this deployment send mail (AGL-709), as one report: what
 * `/api/admin/email-health` answers staff, and what the operator alerts tick
 * checks on its own schedule (AGL-3377).
 *
 * With `probe`, it also asks the provider whether the key is accepted and
 * whether the shared pool can carry mail — and a rejected key or a degraded
 * pool raises `deliverability.providerCredentialsRejected`, deduped, because
 * that is the failure email itself cannot announce: the operator webhook is
 * the channel that still reaches somebody.
 */
export async function evaluateEmailHealth(options: { probe: boolean }) {
  const config = describeEmailConfig()
  const credentials =
    options.probe
      ? await checkEmailCredentials()
      : null

  // What an operator should do next, in the order it blocks delivery.
  const blockers: string[] = []
  if (config.providerProblem) {
    blockers.push(config.providerProblem)
  } else if (!config.hasApiKey) {
    // The settings the deployment's mail provider still needs, by the names
    // an operator types — the provider says which (see `mail-providers.ts`).
    blockers.push(
      `${config.missingSettings.join(' and ')} is not set on this project — ` +
        `the "${config.provider}" mail provider needs it to send. Add it where ` +
        'this deployment keeps its environment (per project, not team-wide).',
    )
  }
  if (!config.hasFrom) {
    blockers.push(
      'USAGE_EMAIL_FROM is not set — without it every sender no-ops, ' +
        `even with a valid API key. Set it to "${PLATFORM_BRAND_NAME} ` +
        `<noreply@${EXPECTED_FROM_DOMAIN}>".`,
    )
  }
  if (config.fromDomain && config.fromDomain !== EXPECTED_FROM_DOMAIN) {
    blockers.push(
      `USAGE_EMAIL_FROM sends from ${config.fromDomain}, but the verified ` +
        `sending domain is ${EXPECTED_FROM_DOMAIN}.`,
    )
  }
  // Kept by reference so the alert below can open with it.
  const rejectedKey =
    credentials?.status === 'invalid-key'
      ? `The "${config.provider}" mail provider rejected its credential, so ` +
        'mail sent through it — invites, password resets, receipts — is not ' +
        'leaving. Rotate or re-scope it.'
      : null
  if (rejectedKey) blockers.push(rejectedKey)

  /*
   * The shared pool, which this check could not see until now.
   *
   * `USAGE_EMAIL_FROM` describes ONE sender: the platform's own operational
   * mail. Every tenant site without a domain of its own sends from a pool
   * member instead, and nothing above looks at those. That gap is not
   * hypothetical — the sending key was scoped to a single domain while the
   * pool carried the transactional floor for every other site, and this
   * endpoint reported healthy throughout.
   *
   * Only probed on request, for the same reason the credential probe is: an
   * unauthenticated caller must not be able to make this deployment talk to
   * the provider.
   */
  const pool =
    options.probe
      ? await checkSharedSendingPool({ pool: sharedSendingPool() })
      : null

  /*
   * A measurement fault, reported APART from the blockers.
   *
   * `blockers` means delivery is stopped, and this is not that: mail on an
   * untracked domain arrives exactly as it should and only the click rate
   * is a lie. Folding it in would either page somebody about healthy
   * delivery or teach them that a blocker can be ignored, and the second is
   * how the real one gets missed.
   *
   * It is reported at all because the symptom is invisible: a click rate of
   * 0% reads as an audience that does not click rather than as a domain
   * that cannot count, and the last time this was wrong nobody found it in
   * the numbers.
   */
  const notices: string[] = []
  if (pool?.untracked?.length) {
    notices.push(
      `Click tracking is off for ${pool.untracked.join(', ')}. Mail from ` +
        'these domains delivers normally and reports a click rate of ' +
        'exactly 0% — a provider rewrites links only on a domain with a ' +
        'verified tracking subdomain.',
    )
  }

  const degradedPool =
    pool?.status === 'degraded'
      ? `The shared sending pool cannot carry mail on ${pool.unusable.join(', ')}. ` +
        'Every site without a sending domain of its own sends its receipts ' +
        'and password resets from a pool member, so this is those sites ' +
        'already failing rather than a warning about later.'
      : null
  if (degradedPool) blockers.push(degradedPool)

  const report = {
    ...config,
    expectedFromDomain: EXPECTED_FROM_DOMAIN,
    credentials,
    pool,
    blockers,
    notices,
    /*
     * True only when nothing known is standing in the way of delivery.
     *
     * An UNREADABLE pool is deliberately not a blocker: without a read key
     * this deployment cannot look, and refusing to call itself healthy for
     * something it cannot observe would make the self-host shape
     * permanently red. It is reported instead, so the difference between
     * "looked and it was fine" and "could not look" stays visible.
     */
    healthy: config.configured && !blockers.length,
  }
  const rejected = rejectedKey !== null
  if (options.probe && (rejected || degradedPool)) {
    // The detail OPENS with the failure that raised the alert and what it
    // stops (AGL-3432), so an unrelated blocker such as a missing sender
    // address cannot lead. The rest follow in their usual order.
    const lead = (rejectedKey ?? degradedPool) as string
    await raiseOperatorAlert('deliverability.providerCredentialsRejected', {
      dedupeKey: rejected ? 'credentials' : `pool:${pool?.unusable.join(',') ?? ''}`,
      context: {
        problem: rejected ? 'the API key was rejected' : 'the shared sending pool is degraded',
        detail: [lead, ...blockers.filter((blocker) => blocker !== lead)].join(' '),
      },
    })
  }
  return report
}
