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
 * Can a prospect still reach us? (AGL-2586)
 *
 * The contact form, the sales enquiry and the demo request are the three
 * revenue-shaped journeys on the marketing site, and every health check that
 * existed before this one measured a COMPONENT: Firestore reachable, crons
 * beating, a page rendering. A form whose page renders perfectly, answers
 * `{ received: true }`, and then files the lead nowhere is invisible to all
 * of them — and it is indistinguishable, from the outside, from nobody
 * having asked.
 *
 * ## What the three forms actually are
 *
 * They are not code. All three are besigner-authored form nodes bound to
 * FORM ENTITIES at `hosts/{hostId}/forms/{formId}`, and every one of them
 * posts to the single `/api/forms/submit` route. So there is no per-form
 * handler to check; what decides whether a submission is stored, filed as a
 * lead, filed under a campaign and announced to a human is DATA on those
 * documents, read at submit time:
 *
 *  - `routing.lead === true` is what turns a stored submission into a lead.
 *    Flip it off and the form still answers 200, the Inbox still shows a row,
 *    and the Leads list — the one sales works — stays empty.
 *  - `consentFieldName` names the ONE field that is the marketing opt-in, and
 *    `readFormDeclaredConsent` looks it up by that exact name. Rename or
 *    delete the field and consent silently stops being recorded forever,
 *    which downstream is indistinguishable from consent never given.
 *  - `campaignIds` is what files the person under the campaign that mails
 *    them. Unlink it and they are captured and never contacted.
 *
 * None of those is a bug the type checker, a render canary or an uptime ping
 * can see. Each is one console edit away, and each fails silently.
 *
 * ## NOTHING IS WRITTEN — the pollution decision for this journey
 *
 * A synthetic that posts a real submission every five minutes would file
 * fake leads into `hosts/{hostId}/leads` and `orgs/{orgId}/contacts` — the
 * collections a HUMAN works — inflate the form's own `stats.submissions`,
 * increment `counters/formSubmissions`, which is the document the customer
 * is INVOICED from, and notify every site manager. That is an abuse vector
 * built by hand, so this takes the other option AGL-2586 allows: it asserts
 * reachability and authorization WITHOUT committing the write.
 *
 * Concretely, it runs every gate `/api/forms/submit` runs before its first
 * write, through the same shared functions the route calls, and grades the
 * verdicts. If this says the next submission would be accepted and routed,
 * it is because the real predicates said so about the real documents.
 *
 * ## What it therefore does NOT prove
 *
 * That Firestore will accept the write. The submit route writes with the
 * Admin SDK, so it is not subject to security rules, and Firestore
 * reachability is already the one check the root `/api/health` makes. This
 * covers the layer above that: the configuration drift that turns a working
 * endpoint into a lead shredder.
 *
 * ## Cost
 *
 * One alias query, one host document, one org document, one counter document
 * and one small collection read of the host's forms, memoised per instance
 * for `PROBE_TTL_MS`. The endpoint is public, so that memo is what bounds
 * what anyone can make it spend.
 */
import * as Aglyn from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  getOrgForHost,
  visitorWriteRefusal,
} from '@aglyn/tenant-data-admin'

import { marketingHost } from '../render/canary'
import {
  configuredLeadFormFloor,
  funnelIntakeHealth,
  funnelRoutingHealth,
  type FunnelFormFacts,
  type FunnelIntakeCheck,
  type FunnelRoutingCheck,
} from './funnel-verdict'

/**
 * Five minutes, matching every sibling subsystem probe. It bounds what a
 * public unauthenticated endpoint can be made to cost while staying well
 * inside the fifteen-minute monitor interval, so the memo is never what
 * delays a red.
 */
export const PROBE_TTL_MS = 5 * 60_000

/**
 * Which site's funnel is watched — CONFIGURED, never a literal.
 *
 *   1. `AGLYN_FUNNEL_HOST`, the explicit answer and the escape hatch.
 *   2. Whatever the marketing render canary already watches. Reusing it
 *      rather than deriving a second answer is the point: two settings that
 *      can disagree about which site is ours would eventually disagree, and
 *      then one of the two probes would be watching a site nobody publishes
 *      to — which is exactly the AGL-1617 defect, in a new place.
 *   3. **Nothing.** No Aglyn fallback, so this file names no Aglyn host and
 *      the self-host ratchet has nothing to allowlist.
 */
export function funnelHost(): string | null {
  const explicit = process.env['AGLYN_FUNNEL_HOST']?.trim()
  if (explicit) return explicit
  return marketingHost()
}

/** Forms read per probe. Far above any real funnel; a ceiling, not a filter. */
const FORM_READ_LIMIT = 200

/** Both verdicts, and the host document read once for the pair. */
export interface FunnelProbeResult {
  intake: FunnelIntakeCheck
  routing: FunnelRoutingCheck
}

/**
 * Resolve the watched alias to a host document id.
 *
 * A key-only query, uncached, because a probe that reads a cached answer is
 * a probe reporting the past — the exact property the health contract opens
 * with. `hosts` is queryable by `subdomain` and `cname` only, and the
 * `cname--` sentinel is what picks between them, exactly as `getHost` does.
 */
async function resolveHostId(alias: string): Promise<string | null> {
  const firestore = firebaseAdmin.app().firestore()
  const byCname = alias.startsWith('cname--')
  const query = byCname
    ? firestore.collection('hosts').where('cname', '==', alias.slice('cname--'.length))
    : firestore.collection('hosts').where('subdomain', '==', alias)
  const found = await query.select().limit(1).get()
  return found.size ? (found.docs[0] as { id: string }).id : null
}

/**
 * Run the funnel probe. Never throws: an exception is `unavailable` on both
 * halves, because a monitoring probe must not become the outage it reports.
 */
export async function probeFunnel(
  alias: string | null,
  required: number = configuredLeadFormFloor(),
): Promise<FunnelProbeResult> {
  const startedAt = Date.now()
  const elapsed = () => Date.now() - startedAt
  if (!alias) {
    return {
      intake: funnelIntakeHealth({ kind: 'not-configured' }, 0, 0),
      routing: funnelRoutingHealth(null, required, 0),
    }
  }
  let hostId: string | null
  try {
    hostId = await resolveHostId(alias)
  } catch {
    return {
      intake: funnelIntakeHealth({ kind: 'unavailable' }, 0, elapsed()),
      routing: funnelRoutingHealth(null, required, elapsed()),
    }
  }
  if (!hostId) {
    return {
      intake: funnelIntakeHealth({ kind: 'host-unresolved' }, 0, elapsed()),
      routing: funnelRoutingHealth(null, required, elapsed()),
    }
  }
  // Both halves in parallel: each is independent, and the endpoint's worst
  // case stays one round trip rather than two.
  const [intake, routing] = await Promise.all([
    probeIntake(hostId, startedAt),
    probeRouting(hostId, required, startedAt),
  ])
  return { intake, routing }
}

/**
 * Every gate `/api/forms/submit` clears before its first write, in the order
 * the route clears them, through the same functions.
 *
 * The per-IP rate limiter is deliberately NOT among them. It is keyed by
 * caller address and fails soft by design, so asking it here would measure
 * this probe's own budget rather than a visitor's, and could only ever
 * produce a red about the monitor.
 */
async function probeIntake(
  hostId: string,
  startedAt: number,
): Promise<FunnelIntakeCheck> {
  const elapsed = () => Date.now() - startedAt
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const [hostSnapshot, paused, owningOrg, counterSnapshot] = await Promise.all([
      hostRef.get(),
      // `intent: 'write'` rather than a request, because there is no visitor
      // request here and the gate must be asked the question a submission
      // would ask it, not the one a GET would.
      visitorWriteRefusal({ hostId, intent: 'write', surface: 'form' }),
      getOrgForHost(hostId),
      hostRef.collection('counters').doc('formSubmissions').get(),
    ])
    const memberRoles =
      (hostSnapshot.get('memberRoles') as Record<string, string> | undefined) ?? {}
    // The audience `notifyHostManagers` fans a `content.formSubmission` out
    // to, derived here the same way it derives it there.
    const recipients = Object.values(memberRoles).filter(
      (role) => role === 'admin' || role === 'editor',
    ).length
    if (paused) return funnelIntakeHealth({ kind: 'paused' }, recipients, elapsed())
    const orgBilling = owningOrg?.org
    const used = Number(counterSnapshot.get(Aglyn.submissionMonthKey()) ?? 0)
    if (!Aglyn.checkFormSubmissionQuota(orgBilling as never, used).allowed) {
      return funnelIntakeHealth({ kind: 'quota-exhausted' }, recipients, elapsed())
    }
    if (Aglyn.checkFormSubmissionAbuseCeiling(orgBilling as never, used).exceeded) {
      return funnelIntakeHealth({ kind: 'ceiling-tripped' }, recipients, elapsed())
    }
    if (recipients <= 0) {
      return funnelIntakeHealth({ kind: 'unattended' }, recipients, elapsed())
    }
    return funnelIntakeHealth({ kind: 'open' }, recipients, elapsed())
  } catch {
    // The error is dropped, never reported: this body is public and a
    // Firestore error message can carry project ids and document paths.
    return funnelIntakeHealth({ kind: 'unavailable' }, 0, elapsed())
  }
}

/** The site's lead-routing forms, reduced to the facts the verdict needs. */
async function probeRouting(
  hostId: string,
  required: number,
  startedAt: number,
): Promise<FunnelRoutingCheck> {
  const elapsed = () => Date.now() - startedAt
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('forms')
      .limit(FORM_READ_LIMIT)
      .get()
    const forms: FunnelFormFacts[] = []
    for (const doc of snapshot.docs) {
      const data = doc.data() as Record<string, unknown>
      if (data['archivedAt']) continue
      const routing = data['routing'] as { lead?: unknown } | undefined
      if (routing?.lead !== true) continue
      const declaredFields = Array.isArray(data['fields'])
        ? (data['fields'] as { fieldName?: unknown }[])
        : []
      forms.push({
        consentFieldName:
          typeof data['consentFieldName'] === 'string'
            ? data['consentFieldName']
            : undefined,
        fieldNames: declaredFields.map((field) => String(field?.fieldName ?? '')),
        // Read through the shared reader the submit route stamps rows with,
        // so "filed under a campaign" means here exactly what it means there.
        campaignCount: Aglyn.readCampaignIds(data).length,
      })
    }
    return funnelRoutingHealth(forms, required, elapsed())
  } catch {
    return funnelRoutingHealth(null, required, elapsed())
  }
}
