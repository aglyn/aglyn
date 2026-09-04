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
 * FINISH THE SITES THAT HAVE ASKED FOR A SENDING DOMAIN.
 *
 * The console half of the request/issue split. A site's claim
 * (`ensureHostSendingDomain`) is a Firestore write anybody can make, including
 * the tenant runtime at the moment a site first tries to send. Turning that
 * claim into a domain that can sign needs two credentials the tenant runtime
 * must never hold, so the work happens here.
 *
 * ## Why this is a route and not the platform job beat
 *
 * The beat runs in the tenant app, which is the whole problem: `run-jobs` is a
 * tenant route, and a job registered there executes in a process that serves
 * published sites. `RESEND_DOMAINS_API_KEY` is full access — it can list every
 * domain in the account, read the account's API keys and mint more — and
 * `VERCEL_TOKEN` can write our DNS zone. Neither may be one bug away from a
 * site request, and `sending-domain-credential-isolation.spec.ts` enforces
 * that by sweeping the tree.
 *
 * So this rides `CRON_SECRET` alongside the other console-side scheduled work.
 * The re-check sweep that moves `records-issued` to `verified` stays on the
 * beat, because it reads DNS and holds no credential at all.
 *
 * ## It is safe to run at any time, by hand or on a schedule
 *
 * Every step is idempotent: a claim already holding a key makes no provider
 * call, and a record already in the zone is skipped rather than duplicated. A
 * GET reports what WOULD be done and writes nothing, which is the shape an
 * operator wants when the account is near its domain ceiling.
 */

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { listPendingSendingDomains } from '@aglyn/tenant-data-admin'
import { isCronAuthorized, isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import {
  provisionPendingSendingDomains,
  readSendingDomainCapacity,
} from '../../../../utils/server/provision-sending-domain'

export const dynamic = 'force-dynamic'

/**
 * How many claims one invocation finishes.
 *
 * Small, and smaller than the re-check sweep's batch, because each one is two
 * vendor round trips rather than three DNS lookups. The provider's global rate
 * limit is ten requests a second across the whole account, and a burst that
 * spends it is a burst that also stalls the SENDS — which share it.
 */
const BATCH = 10

async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders, query, body } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>

  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'Sending-domain provisioning is not configured (CRON_SECRET).' },
      { status: 501 },
    )
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  // The mark `/api/health/crons` reads to notice this job going AWAY. Stamped
  // on the invocation rather than on the work: a sweep that finds nothing to
  // provision still proves the schedule is alive, and a job that silently
  // stopped being scheduled would leave every new site unable to send with
  // nothing saying so.
  if (method === 'POST') await recordCronBeat('provision-sending-domains')

  const dryRun = isCronDryRun({ method, query, body })

  try {
    if (dryRun) {
      const pending = await listPendingSendingDomains(BATCH)
      /*
       * The ceiling STATE, not just the configured number.
       *
       * `capacity` alone says what the limit is; what an operator came here
       * to learn is whether the queue below it is waiting on vendor work or
       * on a purchase. Reported here rather than only in the sweep's logs
       * because a dry run is the surface somebody looks at deliberately, and
       * the ceiling is otherwise visible only to whoever was reading stderr
       * when the sweep last ran.
       */
      const ceiling = await readSendingDomainCapacity()
      return Response.json({
        dryRun: true,
        ...ceiling,
        pending: pending.length,
        // Domains only. A dry run must not print a DKIM key, and there is no
        // reason for one to leave this process at all.
        domains: pending.map((entry) => entry.record.domain),
      })
    }

    /*
     * IT FINISHES CLAIMS; IT DOES NOT CREATE THEM.
     *
     * This used to claim a domain for any entitled site that had none, as a
     * backstop for a dropped upgrade webhook. Neither exists any more: a
     * dedicated subdomain is requested by a person from the sending domains
     * card, so there is no automatic signal to be a backstop for, and a sweep
     * that invented claims would be the largest automatic draw on the ceiling
     * of the three that were removed.
     *
     * What is left is the half that was always vendor work: take each claim a
     * merchant made and turn it into a domain that can sign.
     */
    const summary = await provisionPendingSendingDomains(BATCH)
    const ceiling = await readSendingDomainCapacity()

    /*
     * The ceiling is the one outcome an operator has to act on, and it is
     * silent otherwise: new sites simply stop getting a domain of their own,
     * and the only visible symptom is a delivery reputation that stops
     * improving. So it is logged loudly and reported distinctly rather than
     * folded into the failure count.
     *
     * It is not an outage, and the message must not read as one. A site with
     * no dedicated domain sends its receipts on the shared pool, so what the
     * ceiling costs is the isolation a dedicated domain buys — not the mail.
     * Saying otherwise would send an operator to fix an emergency at the
     * provider that is really a purchasing decision.
     */
    if (summary.atCapacity) {
      console.error(
        `[provision-sending-domains] AT CAPACITY (${ceiling.held}/` +
          `${ceiling.capacity}). Sites that asked for a dedicated domain keep ` +
          'sending on the shared pool and stay there, so their reputation is ' +
          'pooled with every other unprovisioned site. Raise ' +
          'AGLYN_SENDING_DOMAIN_CAPACITY once the provider allowance covers ' +
          'it, or move merchants onto domains they own — see the per-domain ' +
          'line for which lever pulls on what.',
      )
    } else if (ceiling.low) {
      /*
       * THE WARNING THAT ARRIVES IN TIME TO ACT ON.
       *
       * The at-capacity line above is the moment it is already too late to
       * avoid: sites that asked for isolation are being pooled instead. Buying
       * the provider's domain add-on is a billing change plus a configuration
       * deploy, which is hours at best, so a ceiling that is only observable
       * at the ceiling cannot be met without a gap.
       *
       * A warning rather than an error, because nothing is wrong yet. It is
       * emitted on every run inside the band rather than once on crossing it:
       * a single edge-triggered line is one an operator has to have been
       * watching for, and this is read from a log search after somebody
       * noticed something else.
       */
      console.warn(
        `[provision-sending-domains] domain headroom low: ${ceiling.held}/` +
          `${ceiling.capacity} used, ${ceiling.remaining} left. Raise ` +
          'AGLYN_SENDING_DOMAIN_CAPACITY before it runs out — past it, a ' +
          'merchant who asks for a dedicated domain silently keeps the pooled ' +
          'one instead.',
      )
    }

    return Response.json({ ...summary, ...ceiling })
  } catch (error) {
    // Never a provider body: an error the vendor wrote can carry the request
    // it is complaining about, and the request carries the credential.
    console.error(
      '[provision-sending-domains] sweep failed',
      (error as { name?: string })?.name ?? 'unknown',
    )
    return Response.json({ error: 'Provisioning sweep failed' }, { status: 500 })
  }
}

export const GET = handler
export const POST = handler
