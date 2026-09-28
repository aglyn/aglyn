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
 * WHAT THE RUNTIME TEACHES THE GATEWAY LEDGER (AGL-3326).
 *
 * The ledger learns from outcomes, and the runtime is where outcomes
 * happen: the send job counts a SEND the moment an email leaves, the sync
 * counts a BLOCK when a hard bounce reads as the gateway refusing the
 * sender, and the sync counts a DELIVERY for every email step that is a
 * day old with no bounce against it — the one verdict a small sender never
 * hears in words, so it is inferred from silence, and only after
 * {@link OUTREACH_GATEWAY_DELIVERED_AFTER_MS} of it.
 *
 * Every count is filed against the MAILBOX's sending domain (AGL-3328):
 * a gateway refuses a sender, so the ledger that holds the next send is the
 * one keyed `sendingDomain × gateway`.
 *
 * Which gateway a block is filed under is read from the bounce itself
 * where it can be: a DSN's `Remote-MTA` names the server that refused,
 * and `*.ess.barracudanetworks.com` is Barracuda whatever the MX says
 * today. A bounce that names no known gateway is filed under the domain's
 * own intel, looked up if it never was.
 */

import { outreachEmailDomain } from '../engine/do-not-contact-domain'
import { OUTREACH_GATEWAY_DELIVERED_AFTER_MS, outreachMailGatewayOfHost } from '../engine/mail-gateway'
import type { OutreachEnrollment } from '../model/outreach.types'
import {
  type OutreachResolveMx,
  readOutreachDomainIntel,
  recordOutreachGatewayOutcome,
} from '../storage/domain-intel-store'
import { outreachOrgCollection } from '../storage/outreach-records'

type Firestore = FirebaseFirestore.Firestore

/** A gateway block, counted against the gateway the bounce names — see the module note. */
export async function recordOutreachGatewayBlock(
  firestore: Firestore,
  input: {
    orgId: string
    email: string
    remoteMta: string | null
    /** The domain the mailbox sends from, whose ledger the block is counted on (AGL-3328). */
    sendingDomain: string | null
    /** The bounce's diagnostic, kept scrubbed of addresses for the ledger. */
    diagnostic?: string | null
    resolveMx: OutreachResolveMx
    nowMs: number
  },
): Promise<void> {
  const domain = outreachEmailDomain(input.email)
  if (!domain) return
  let gateway = outreachMailGatewayOfHost(input.remoteMta)
  if (!gateway) {
    const intel = await readOutreachDomainIntel(firestore, input.orgId, [input.email], {
      resolveMx: input.resolveMx,
      nowMs: input.nowMs,
    })
    gateway = intel.get(input.email)?.gateway ?? null
  }
  if (!gateway || gateway === 'none') return
  await recordOutreachGatewayOutcome(firestore, input.orgId, {
    sendingDomain: input.sendingDomain,
    gateway,
    outcome: 'blocked',
    atMs: input.nowMs,
    detail: input.diagnostic ?? null,
  })
}

/**
 * The email steps of an enrollment that count as delivered now: those a
 * day old, less the last one sent when the enrollment bounced — a bounce
 * answers the last send — and less the ones already credited.
 */
export function outreachDeliveredStepCount(
  enrollment: Pick<OutreachEnrollment, 'status' | 'stepRecords'>,
  nowMs: number,
): number {
  const emails = (enrollment.stepRecords ?? []).filter((record) => record?.kind === 'email')
  const bounced = enrollment.status === 'bounced' ? emails.slice(0, -1) : emails
  return bounced.filter((record) => Number(record.atMs) <= nowMs - OUTREACH_GATEWAY_DELIVERED_AFTER_MS).length
}

/**
 * Credits every watched enrollment's day-old, unbounced email steps to the
 * ledger as delivered — see the module note — and marks each enrollment
 * with how many it has credited, so the next run credits only what is new.
 * Answers how many deliveries it counted.
 */
export async function creditOutreachGatewayDeliveries(
  firestore: Firestore,
  input: {
    orgId: string
    enrollments: readonly OutreachEnrollment[]
    /** The domain the mailbox sends from, whose ledger the deliveries are credited to (AGL-3328). */
    sendingDomain: string | null
    resolveMx: OutreachResolveMx
    nowMs: number
  },
): Promise<number> {
  const due = input.enrollments
    .map((enrollment) => ({
      enrollment,
      delivered: outreachDeliveredStepCount(enrollment, input.nowMs),
    }))
    .filter(({ enrollment, delivered }) => delivered > Math.max(0, Number(enrollment.gatewayDeliveredSteps) || 0))
  if (!due.length) return 0
  const intel = await readOutreachDomainIntel(
    firestore,
    input.orgId,
    due.map(({ enrollment }) => enrollment.email),
    { resolveMx: input.resolveMx, nowMs: input.nowMs },
  )
  const enrollments = outreachOrgCollection(firestore, input.orgId, 'enrollments')
  let counted = 0
  for (const { enrollment, delivered } of due) {
    const domain = outreachEmailDomain(enrollment.email)
    const gateway = intel.get(enrollment.email)?.gateway ?? null
    // A domain that could not be looked up is credited on a later run, when it can be.
    if (!domain || !gateway || gateway === 'none') continue
    const fresh = delivered - Math.max(0, Number(enrollment.gatewayDeliveredSteps) || 0)
    await recordOutreachGatewayOutcome(firestore, input.orgId, {
      sendingDomain: input.sendingDomain,
      gateway,
      outcome: 'delivered',
      count: fresh,
      atMs: input.nowMs,
    })
    try {
      await enrollments.doc(enrollment.id).update({ gatewayDeliveredSteps: delivered })
      counted += fresh
    } catch (error) {
      console.error('[outreach] the delivery credit could not be marked on the enrollment', error)
    }
  }
  return counted
}
