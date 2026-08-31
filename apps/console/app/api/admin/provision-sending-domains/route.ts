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
import {
  claimUnprovisionedHosts,
  listPendingSendingDomains,
} from '@aglyn/tenant-data-admin'
import { isCronAuthorized, isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import {
  provisionPendingSendingDomains,
  sendingDomainCapacity,
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
  const capacity = sendingDomainCapacity()

  try {
    if (dryRun) {
      const pending = await listPendingSendingDomains(BATCH)
      return Response.json({
        dryRun: true,
        capacity,
        pending: pending.length,
        // Domains only. A dry run must not print a DKIM key, and there is no
        // reason for one to leave this process at all.
        domains: pending.map((entry) => entry.record.domain),
      })
    }

    /*
     * Claim first, then provision.
     *
     * The BACKSTOP, not the schedule. A dedicated domain is claimed when an org
     * reaches a plan that carries one, from the billing webhook, which is where
     * the transition is observable. This sweep catches what that signal cannot:
     * a dropped webhook, a plan set by hand, a site created under an org that
     * was already paying.
     *
     * It no longer claims for every host it sees. A site whose plan carries no
     * dedicated domain is skipped and reported as `skippedUnentitled` — it is
     * not failing, and it is not waiting for anything. Its mail leaves on the
     * shared pool, which needs no per-site provisioning at all.
     *
     * Before the provision step rather than after, so a site claimed on this
     * run is provisioned on this run instead of waiting for the next one.
     */
    const claims = await claimUnprovisionedHosts(BATCH)
    const summary = await provisionPendingSendingDomains(BATCH)

    /*
     * The ceiling is the one outcome an operator has to act on, and it is
     * silent otherwise: every new site simply never becomes able to send. So
     * it is logged loudly and reported distinctly rather than folded into the
     * failure count.
     */
    if (summary.atCapacity) {
      console.error(
        `[provision-sending-domains] AT CAPACITY (${capacity}). New sites ` +
          'cannot send until the provider plan and ' +
          'AGLYN_SENDING_DOMAIN_CAPACITY are both raised.',
      )
    }

    return Response.json({
      ...summary,
      claimed: claims.claimed,
      skippedUnentitled: claims.skippedUnentitled,
      capacity,
    })
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
