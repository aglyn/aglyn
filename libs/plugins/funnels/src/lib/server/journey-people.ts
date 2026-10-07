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

import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import { hostEventRecipientActed } from '@aglyn/aglyn/app-utils/host-events'
import { SITE_JOURNEY_ID_PATTERN } from '@aglyn/aglyn/app-utils/site-journey'
import type {
  PluginPersonErasureReport,
  PluginPersonErasureRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { FieldValue } from 'firebase-admin/firestore'
import type { JourneyStepRecord } from '../model/funnels.types'
import { FUNNEL_JOURNEYS_COLLECTION } from '../model/funnels.types'
import { funnelHostState } from './funnel-host-state'

/**
 * A RECORDED VISIT THAT A PERSON IDENTIFIED (AGL-3605).
 *
 * A visit is anonymous — a random id in one browser tab — until the visitor
 * identifies themselves through a door that verifies it: a form they
 * submitted, whose route names the visit its page was on beside the address
 * typed (`journeyId` on the host event's context). Only then does the visit
 * carry `personEmail`, and only a visit that carries one is ever looked at by
 * the drop-off sweep, is given an email step, or counts as the same visitor
 * as another visit of theirs.
 *
 * What the address is added to: one document under the site, already
 * consent-gated (the visit exists only because the visitor's analytics
 * consent allowed it), expiring with the visit, and erased with the person.
 */

/** How old a visit's last step may be for a submission to identify it. */
export const IDENTIFY_MAX_AGE_MS = 6 * 60 * 60 * 1000

/** The most of one person's visits read together. */
export const PERSON_JOURNEYS_MAX = 20

/** How soon after identifying a person the sweep first looks at them. */
const FIRST_CHECK_DELAY_MS = 60 * 1000

const journeys = (firestore: any, hostId: string) =>
  firestore.collection('hosts').doc(hostId).collection(FUNNEL_JOURNEYS_COLLECTION)

interface ListenerContext {
  actor?: { email?: string | null } | null
  journeyId?: string | null
}

/**
 * The host event listener's one job: a person's own action (a form
 * submission) that names the visit it ended identifies that visit. Never
 * creates a visit, and never re-labels one that already names someone else.
 */
export async function identifyJourneyFromEvent(
  firestore: any,
  hostId: string,
  event: string,
  context: ListenerContext | undefined,
  now: number = Date.now(),
): Promise<boolean> {
  const journeyId = String(context?.journeyId ?? '')
  if (!SITE_JOURNEY_ID_PATTERN.test(journeyId)) return false
  if (!hostEventRecipientActed(event)) return false
  const email = normalizeContactEmail(context?.actor?.email)
  if (!email) return false
  const state = await funnelHostState(firestore, hostId, now)
  if (!state.recording) return false
  const ref = journeys(firestore, hostId).doc(journeyId)
  const snapshot = await ref.get()
  if (!snapshot.exists) return false
  const lastAt = Number(snapshot.get('lastAt') ?? 0)
  if (!(now - lastAt <= IDENTIFY_MAX_AGE_MS)) return false
  const named = snapshot.get('personEmail')
  if (typeof named === 'string' && named && named !== email) return false
  await ref.update({
    personEmail: email,
    identifiedAt: now,
    ...(state.watched.length ? { dropOffCheckAt: now + FIRST_CHECK_DELAY_MS } : {}),
  })
  return true
}

export interface PersonJourney {
  id: string
  steps: JourneyStepRecord[]
  lastAt: number
  fired: string[]
}

/** Every visit of one person on a site that the site still keeps, newest last. */
export async function readPersonJourneys(
  firestore: any,
  hostId: string,
  email: string,
): Promise<PersonJourney[]> {
  const rows = await journeys(firestore, hostId)
    .where('personEmail', '==', email)
    .limit(PERSON_JOURNEYS_MAX)
    .get()
  return rows.docs
    .map((doc: any) => {
      const data = doc.data() ?? {}
      return {
        id: doc.id,
        steps: Array.isArray(data.steps) ? data.steps : [],
        lastAt: Number(data.lastAt ?? 0),
        fired: Object.keys(data.left ?? {}),
      }
    })
    .sort((a: PersonJourney, b: PersonJourney) => a.lastAt - b.lastAt)
}

/** One delivery event, as the platform's `host.email.engaged` event carries it. */
export interface EngagementEvent {
  to: string
  type: string
  at: number
  firstOfType: boolean
}

/**
 * An email the site sent a person was opened, or a link in it clicked: an
 * `email` step on that person's latest visit, so a funnel can show whether a
 * follow-up brought anyone back. The first open and the first click of each
 * message only — the delivery log already decided which events those are —
 * and only for a person a visit on this site identified.
 */
export async function recordEmailEngagementSteps(
  firestore: any,
  hostId: string,
  events: readonly EngagementEvent[],
  now: number = Date.now(),
): Promise<number> {
  const counted = events.filter(
    (event) => event.firstOfType && (event.type === 'opened' || event.type === 'clicked'),
  )
  if (!counted.length) return 0
  const state = await funnelHostState(firestore, hostId, now)
  if (!state.recording) return 0
  let written = 0
  for (const event of counted) {
    const email = normalizeContactEmail(event.to)
    if (!email) continue
    const person = await readPersonJourneys(firestore, hostId, email)
    const latest = person[person.length - 1]
    if (!latest) continue
    const at = Number.isFinite(event.at) && event.at > 0 ? Math.min(event.at, now) : now
    await journeys(firestore, hostId)
      .doc(latest.id)
      .update({
        steps: FieldValue.arrayUnion({ t: 'email', k: event.type, at }),
        ...(state.watched.length ? { dropOffCheckAt: now } : {}),
      })
    written += 1
  }
  return written
}

/**
 * The funnels plugin's share of a person erasure: every visit a person
 * identified, on every site of the workspace, is deleted — the visit is about
 * them once it names them. A dry run counts.
 */
export async function eraseFunnelPerson(
  firestore: any,
  request: Pick<PluginPersonErasureRequest, 'orgId' | 'email' | 'dryRun'>,
): Promise<PluginPersonErasureReport> {
  const email = normalizeContactEmail(request.email)
  if (!email) return { journeys: 0 }
  const hosts = await firestore.collection('hosts').where('orgId', '==', request.orgId).get()
  let count = 0
  for (const host of hosts.docs) {
    const named = host.ref.collection(FUNNEL_JOURNEYS_COLLECTION).where('personEmail', '==', email)
    if (request.dryRun) {
      count += Number((await named.count().get()).data().count ?? 0)
      continue
    }
    for (;;) {
      const rows = await named.limit(200).get()
      if (rows.empty) break
      count += rows.size
      const batch = firestore.batch()
      for (const row of rows.docs) batch.delete(row.ref)
      await batch.commit()
      if (rows.size < 200) break
    }
  }
  return { journeys: count }
}
