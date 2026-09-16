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

import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { sendEmail } from '@aglyn/shared-util-email'
import { meterPlatformEmail } from '@aglyn/tenant-data-admin/server/email-metering'
import { filterSuppressedEmails } from '@aglyn/tenant-data-admin/server/email-suppression'
import { notifyUsers } from '@aglyn/tenant-data-admin/server/notifications'
import {
  aiAllotmentAlertCopy,
  type AiAllotmentStanding,
  type AiAllotmentThreshold,
} from '../model/ai-allotments'
import { aiAllotmentRef } from './ai-allotments'

/**
 * A SOFT allotment's 80% and 100% (AGL-2942), through the alert pipeline's
 * two channels: the console notification every usage threshold writes
 * (`billing.usage`, to `users/{uid}/notifications`) and the email beside it,
 * sent past the platform suppression list and metered as platform mail —
 * the same primitives the usage-alert sweep composes.
 *
 * Told when the request that finds the subject at a threshold is admitted,
 * rather than on the next daily sweep: an allotment is a line a manager drew
 * for one person or one site, and a day's delay is most of what a soft line
 * is for. The sweep is untouched.
 *
 * ## Who is told
 *
 * The workspace's owners and admins — the audience of every usage alert —
 * and, for a member's or a collaborator's allotment, the person it is for.
 * The person gets the words without the Billing link, which a collaborator
 * cannot open.
 *
 * ## Once per threshold per month
 *
 * The marker is `alerted: { month, threshold }` on the allotment itself,
 * claimed in a transaction before anything is sent, so two requests at the
 * line cannot both announce it. A write to the allotment clears the marker,
 * so a raised allotment announces its own next crossing.
 */

/** A crossing to announce, as the reservation measured it. */
export interface AiAllotmentAlertInput {
  orgId: string
  /** The workspace's slug, for the Billing link; `null` omits the link. */
  orgSlug: string | null
  month: string
  alerts: ReadonlyArray<{ standing: AiAllotmentStanding; threshold: AiAllotmentThreshold }>
}

/** The pipeline's primitives, replaceable in a spec. */
export interface AiAllotmentAlertChannels {
  notify: typeof notifyUsers
  send: typeof sendEmail
  filter: typeof filterSuppressedEmails
  meter: typeof meterPlatformEmail
}

const DEFAULT_CHANNELS: AiAllotmentAlertChannels = {
  notify: notifyUsers,
  send: sendEmail,
  filter: filterSuppressedEmails,
  meter: meterPlatformEmail,
}

/** The console's absolute origin for an email link, or `''` when unset. */
function consoleOrigin(): string {
  return (process.env.NEXT_PUBLIC_CONSOLE_URL ?? '').trim().replace(/\/+$/, '')
}

/** Take the marker for `threshold` this month; `false` when it was taken. */
export async function claimAiAllotmentAlert(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  subject: string,
  month: string,
  threshold: AiAllotmentThreshold,
): Promise<boolean> {
  const ref = aiAllotmentRef(firestore.collection('orgs').doc(orgId), subject)
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) return false
    const alerted = snapshot.get('alerted') as { month?: unknown; threshold?: unknown } | null
    if (alerted?.month === month && Number(alerted?.threshold) >= threshold) return false
    tx.set(ref, { alerted: { month, threshold } }, { merge: true })
    return true
  })
}

interface Recipients {
  managerUids: string[]
  managerEmails: string[]
  subjectUid: string | null
  subjectEmail: string | null
  subjectName: string
}

async function recipientsFor(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  standing: AiAllotmentStanding,
): Promise<Recipients> {
  const orgRef = firestore.collection('orgs').doc(orgId)
  const members = await orgRef.collection('members').get()
  const managerUids: string[] = []
  const managerEmails: string[] = []
  let subjectEmail: string | null = null
  let subjectName = ''
  for (const member of members.docs) {
    const role = member.get('role')
    const email = String(member.get('email') ?? '').trim()
    if (role === 'owner' || role === 'admin') {
      managerUids.push(member.id)
      if (email.includes('@')) managerEmails.push(email)
    }
    if (standing.uid && member.id === standing.uid) {
      subjectEmail = email.includes('@') ? email : null
      subjectName = String(member.get('displayName') ?? '').trim() || email
    }
  }
  if (standing.scope === 'host' && standing.hostId) {
    const host = await firestore.collection('hosts').doc(standing.hostId).get()
    subjectName =
      String(host.get('displayName') ?? '').trim() ||
      String(host.get('subdomain') ?? '').trim()
  }
  return {
    managerUids,
    managerEmails,
    subjectUid: standing.scope === 'host' ? null : standing.uid,
    subjectEmail: standing.scope === 'host' ? null : subjectEmail,
    subjectName: subjectName || (standing.scope === 'host' ? 'this' : 'A member'),
  }
}

/**
 * Announce every crossing the reservation found. Never throws, and answers
 * how many were announced — one failing crossing does not stop the next.
 */
export async function announceAiAllotmentAlerts(
  firestore: FirebaseFirestore.Firestore,
  input: AiAllotmentAlertInput,
  channels: Partial<AiAllotmentAlertChannels> = {},
): Promise<number> {
  const { notify, send, filter, meter } = { ...DEFAULT_CHANNELS, ...channels }
  let announced = 0
  for (const { standing, threshold } of input.alerts) {
    try {
      const claimed = await claimAiAllotmentAlert(
        firestore,
        input.orgId,
        standing.subject,
        input.month,
        threshold,
      )
      if (!claimed) continue
      const recipients = await recipientsFor(firestore, input.orgId, standing)
      const copy = aiAllotmentAlertCopy({
        scope: standing.scope,
        threshold,
        used: standing.used,
        credits: standing.credits,
        name: recipients.subjectName,
      })
      const link = input.orgSlug
        ? `${buildRoute(Route.MANAGE_BILLING_USAGE, { orgSlug: input.orgSlug })}#ai-allotments`
        : null
      await notify(recipients.managerUids, {
        type: 'billing.usage',
        title: copy.title,
        body: copy.body,
        orgId: input.orgId,
        ...(link ? { link } : {}),
      })
      if (recipients.subjectUid && !recipients.managerUids.includes(recipients.subjectUid)) {
        await notify([recipients.subjectUid], {
          type: 'billing.usage',
          title: copy.title,
          body: copy.body,
          orgId: input.orgId,
        })
      }
      const origin = consoleOrigin()
      const managerText = link && origin ? `${copy.body}\n\n${origin}${link}` : copy.body
      const managers = await filter(recipients.managerEmails)
      if (managers.length) {
        const result = await send({
          to: managers,
          subject: copy.title,
          text: managerText,
          context: 'ai-allotment-alert',
        })
        if (result.sent) await meter().catch(() => undefined)
      }
      const subjectAddress = recipients.subjectEmail
        ? (await filter([recipients.subjectEmail])).filter(
            (address) => !managers.includes(address),
          )
        : []
      if (subjectAddress.length) {
        const result = await send({
          to: subjectAddress,
          subject: copy.title,
          text: copy.body,
          context: 'ai-allotment-alert',
        })
        if (result.sent) await meter().catch(() => undefined)
      }
      announced += 1
    } catch (error) {
      console.error('[ai-allotments] announcing a crossing failed', input.orgId, standing.subject, error)
    }
  }
  return announced
}
