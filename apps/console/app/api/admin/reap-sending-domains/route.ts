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
 * COLLECT THE SENDING DOMAINS THAT OUTLIVED THEIR SITE.
 *
 * A dedicated sending domain is a plan-capped domain object at the mail
 * provider, three records in our own DNS zone, and a place in the re-check
 * sweep. Nothing about deleting a site reclaims any of that on its own, and
 * two failure shapes leave it standing:
 *
 *   - a teardown the provider or the zone refused, which
 *     `teardownSendingDomain` reports and explicitly leaves "for the next
 *     pass"; and
 *   - an erasure, which must not be blocked by a vendor and therefore records
 *     the debt on the label claim rather than waiting on one.
 *
 * This is the next pass. It is the only thing in the platform that closes
 * either, so a stopped sweep means slots accumulating against a ceiling that
 * refuses NEW sites when it is reached — which is why it carries a
 * `SCHEDULED_JOBS` row and shows red on `/api/health/crons`.
 *
 * ## Daily, not frequent
 *
 * Nothing waits on this. A slot released a few hours later costs nothing,
 * whereas the provisioning sweep beside it is what makes a new site able to
 * send at all. Daily also keeps the whole-collection walk to once a day.
 *
 * ## What it will not touch
 *
 * The shared pool. `shared1.mail.aglyn.app` … `shared4` are verified, live,
 * and owned by no host — which is precisely the description of an orphan — so
 * they are refused by name in the planner AND again inside
 * `teardownSendingDomain`, and reported at the top of every response.
 *
 * A GET reports the plan and writes nothing.
 */

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  listSendingLabelClaims,
  readSendingDomainTeardownByLabel,
  recordSendingDomainDebt,
  releaseHostSendingDomain,
} from '@aglyn/tenant-data-admin'
import { isCronAuthorized, isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import {
  planSendingDomainReap,
  type ClaimOwnership,
  type SendingDomainClaim,
} from '../../../../utils/server/reap-sending-domains'
import { teardownSendingDomain } from '../../../../utils/server/provision-sending-domain'

export const dynamic = 'force-dynamic'

/** Claim documents read per page while walking the collection. */
const CLAIM_PAGE = 200

/**
 * The most claims one run walks before reporting and stopping.
 *
 * A ceiling rather than a refusal, unlike the artifact reaper's. Nothing here
 * is deleted BECAUSE a scan found no claim for it — every candidate is chosen
 * from a claim this run actually read and an owner it actually looked up — so
 * a partial walk yields a smaller correct answer rather than a wrong one. The
 * remainder is picked up tomorrow, in document-id order from the top; the
 * number is reported so a walk that is being truncated every day is visible.
 */
const MAX_CLAIMS_SCANNED = 50_000

/** How long an inferred orphan must have stood before it may be reaped. */
const MIN_AGE_HOURS = 24

/** Ceiling on releases per run. */
const MAX_REAPS = 100

/** Owner documents fetched per `getAll`. */
const OWNER_BATCH = 200

async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders, query, body } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>

  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'Sending-domain reaping is not configured (CRON_SECRET).' },
      { status: 501 },
    )
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  // The mark `/api/health/crons` reads to notice this job going AWAY. On the
  // invocation, not on the work: a sweep that finds nothing to reap still
  // proves the schedule is alive, and finding nothing is the healthy day.
  if (method === 'POST') await recordCronBeat('reap-sending-domains')

  const dryRun = isCronDryRun({ method, query, body })

  try {
    const firestore = firebaseAdmin.app().firestore()

    // Every claim, in pages. Ordered by document id inside
    // `listSendingLabelClaims` — see the note there on why not by a field.
    const claims: SendingDomainClaim[] = []
    let cursor: string | null = null
    for (;;) {
      const page = await listSendingLabelClaims({
        limit: CLAIM_PAGE,
        after: cursor,
      })
      claims.push(...page)
      if (page.length < CLAIM_PAGE) break
      if (claims.length >= MAX_CLAIMS_SCANNED) break
      cursor = page[page.length - 1]?.label ?? null
      if (!cursor) break
    }

    /*
     * The owners, read in batches rather than one lookup per claim.
     *
     * Both questions are `exists`, and a `getAll` answers two hundred of them
     * in one round trip. The host's CURRENT label is read too: a host that
     * lives but pins something else is an orphaned claim of a different shape
     * — a domain restart that half-ran — and it leaks exactly the same slot.
     */
    const hostIds = [
      ...new Set(claims.map((claim) => claim.hostId).filter(Boolean)),
    ] as string[]
    const orgIds = [
      ...new Set(claims.map((claim) => claim.orgId).filter(Boolean)),
    ] as string[]

    const hostLabels = new Map<string, string | null>()
    for (let index = 0; index < hostIds.length; index += OWNER_BATCH) {
      const refs = hostIds
        .slice(index, index + OWNER_BATCH)
        .map((id) => firestore.collection('hosts').doc(id))
      if (!refs.length) continue
      for (const snapshot of await firestore.getAll(...refs)) {
        if (!snapshot.exists) continue
        hostLabels.set(
          snapshot.id,
          String(snapshot.get('sendingLabel') ?? '').trim() || null,
        )
      }
    }

    const liveOrgIds = new Set<string>()
    for (let index = 0; index < orgIds.length; index += OWNER_BATCH) {
      const refs = orgIds
        .slice(index, index + OWNER_BATCH)
        .map((id) => firestore.collection('orgs').doc(id))
      if (!refs.length) continue
      for (const snapshot of await firestore.getAll(...refs)) {
        if (snapshot.exists) liveOrgIds.add(snapshot.id)
      }
    }

    const plan = planSendingDomainReap(
      claims.map((claim) => ({
        ...claim,
        owner: {
          hostExists: claim.hostId ? hostLabels.has(claim.hostId) : false,
          hostLabel: claim.hostId ? (hostLabels.get(claim.hostId) ?? null) : null,
          orgExists: claim.orgId ? liveOrgIds.has(claim.orgId) : false,
        } satisfies ClaimOwnership,
      })),
      { minAgeHours: MIN_AGE_HOURS, maxReaps: MAX_REAPS, now: Date.now() },
    )

    /*==========================================
     * ⛔ THE ONE LINE THAT MUST NEVER HAVE CONTENT AFTER IT.
     *
     * A pool member with a label claim means something has handed a reserved
     * name to a site. Nothing was reaped — the planner refuses them — but the
     * operator has to know before reading anything else in this report.
     *=========================================*/
    if (plan.poolProtected.length) {
      console.error(
        '[reap-sending-domains] SHARED POOL MEMBERS HAVE LABEL CLAIMS:',
        plan.poolProtected.join(', '),
        '— nothing was torn down, and nothing may be. A reserved label has ' +
          'been claimed by something; find the writer before the next run.',
      )
    }

    let released = 0
    let stillOwed = 0
    const settled: string[] = []
    const owed: { domain: string; detail: string }[] = []

    if (!dryRun) {
      for (const candidate of plan.toReap) {
        const teardown = await readSendingDomainTeardownByLabel(
          candidate.label,
        ).catch(() => null)
        if (!teardown) {
          // The claim went away between the plan and the act — another run,
          // or a re-provision. Nothing owed and nothing to do.
          continue
        }

        const result = await teardownSendingDomain(teardown).catch(() => ({
          outcome: 'failed' as const,
          detail: 'threw',
        }))

        /*
         * `skipped` with no provider id is a real release: the id and the DKIM
         * key are stored by one write and the zone records are only written
         * once a key exists, so a claim that never got an id has nothing at
         * either vendor. Anything else that is not `removed` stays owed.
         */
        const nothingProvisioned =
          result.outcome === 'skipped' && !teardown.providerDomainId
        if (result.outcome === 'removed' || nothingProvisioned) {
          await releaseHostSendingDomain(teardown)
          released += 1
          settled.push(candidate.domain)
          console.warn(
            `[reap-sending-domains] released ${candidate.domain} ` +
              `(${candidate.reason}) — provider slot freed and zone records ` +
              'removed.',
          )
          continue
        }

        const detail = result.detail || result.outcome
        await recordSendingDomainDebt(teardown, detail)
        stillOwed += 1
        owed.push({ domain: candidate.domain, detail })
        console.error(
          `[reap-sending-domains] ${candidate.domain} is STILL HELD ` +
            `(${detail}) after ${candidate.attempts + 1} attempts — the ` +
            'provider slot and the zone records remain. Check the mail ' +
            'provider and DNS credentials.',
        )
      }

      if (released || stillOwed) {
        await firestore
          .collection('adminAudit')
          .add({
            actorUid: 'system:cron',
            action: 'email.sending-domains.reap',
            target: 'sendingLabels',
            after: { released: settled, stillOwed: owed },
            at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          })
          .catch(() => undefined)
      }
    }

    return Response.json(
      {
        dryRun,
        scanned: plan.scanned,
        truncated: plan.scanned >= MAX_CLAIMS_SCANNED,
        live: plan.live,
        orphans: plan.toReap.length,
        released,
        stillOwed,
        tooNew: plan.tooNew,
        deferredByCap: plan.deferredByCap,
        foreign: plan.foreign,
        unusable: plan.unusable,
        // ⛔ Always empty. See the log line above.
        poolProtected: plan.poolProtected,
        // Domains only — a report must never carry a DKIM key.
        candidates: plan.toReap.map((candidate) => ({
          domain: candidate.domain,
          reason: candidate.reason,
          attempts: candidate.attempts,
        })),
        owed,
      },
      { status: 200 },
    )
  } catch (error) {
    // Never a vendor body: an error the provider wrote can quote the request
    // it is complaining about, and the request carries the credential.
    console.error(
      '[reap-sending-domains] sweep failed',
      (error as { name?: string })?.name ?? 'unknown',
    )
    return Response.json({ error: 'Sending-domain reaping failed' }, { status: 500 })
  }
}

export { handler as GET, handler as POST }

/** The walk covers every claim on the platform; the default 10s is not enough. */
export const maxDuration = 60
