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

import type {
  PluginApiHandler,
  PluginApiRequest,
  PluginApiResponse,
} from '@aglyn/aglyn/app-utils/api-plugins'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { pluginTextGenerator } from '@aglyn/aglyn/plugin-manager/plugin-text-generation'
import {
  EmailNotVerifiedError,
  firebaseAdmin,
  verifyConsoleIdToken,
} from '@aglyn/tenant-data-admin/server/firebase-admin'
import { getOrgForHost } from '@aglyn/tenant-data-admin/server/organizations'
import { FieldValue } from 'firebase-admin/firestore'
import {
  DROP_OFF_ACTIONS,
  DROP_OFF_WATCHES_MAX,
  dropOffAutomationContent,
  funnelWatches,
  normalizeDropOffWatch,
  type DropOffAction,
} from '../model/drop-off'
import { funnelRange } from '../model/funnel-compute'
import { normalizeFunnelDefinition } from '../model/funnel-definition'
import { labelStepFromInventory, stepInventoryProblem } from '../model/funnel-inventory'
import {
  checkFunnelProposal,
  FUNNEL_BRIEF_MAX_CHARS,
  FUNNEL_PROPOSAL_SYSTEM,
  funnelProposalPrompt,
} from '../model/funnel-proposal'
import {
  FUNNEL_FEATURE,
  FUNNEL_JOURNEYS_COLLECTION,
  FUNNEL_MAX_RANGE_DAYS,
  FUNNELS_COLLECTION,
  FUNNELS_MAX_PER_SITE,
} from '../model/funnels.types'
import { forgetFunnelHostState } from './funnel-host-state'
import { readFunnelInventory } from './funnel-inventory.server'
import { funnelResult } from './funnel-results.server'

/**
 * The funnels plugin's console doors (AGL-3605), all `POST` with a JSON body
 * naming the site:
 *
 * - `funnels/inventory` — the pages and records the step pickers list. Any
 *   member of the site.
 * - `funnels/results` — one funnel over a range. Any member of the site.
 * - `funnels/save` / `funnels/delete` — a site's admins and editors (the
 *   `author` role edits content and does not decide what the site measures).
 *   A save is checked step by step against the site's inventory. The first
 *   funnel switches the site's recording on (`funnelRecording` on the host
 *   document) and deleting the last switches it off, and both answers say so,
 *   so the editor can drop the site's cached pages — the published page reads
 *   the switch from the host document it was rendered with.
 * - `funnels/propose` — "Create with AI": a description becomes a checked
 *   draft through the workspace's text generator (core's text-generation
 *   seam), which applies the AI plugin's own permission, plan, switch and
 *   credit rules. Nothing is saved.
 * - `funnels/act` — "Act on this drop-off": a watch on one step of a funnel
 *   and an automation that starts on it, DRAFTED switched off through the
 *   `automation` draft writer (core's resource-drafts seam, which the
 *   workflows plugin fills with its own role, plan, room and schema rules).
 *   Nothing runs until a person switches the automation on. See
 *   `model/drop-off.ts`.
 *
 * Every door but the inventory needs the paid analytics tier
 * ({@link FUNNEL_FEATURE}); the plan is read from the site's own workspace.
 */

type Role = 'admin' | 'editor' | 'author' | 'viewer' | string

interface SiteCaller {
  uid: string
  staff: boolean
  role: Role | null
  hostData: Record<string, unknown>
  orgId: string | null
  org: Record<string, unknown> | null
  firestore: any
}

const MANAGING_ROLES: ReadonlySet<string> = new Set(['admin', 'editor'])

function bearer(req: PluginApiRequest): string | null {
  const header = req.headers['authorization']
  const value = Array.isArray(header) ? header[0] : header
  return value && value.startsWith('Bearer ') ? value.slice('Bearer '.length) : null
}

/**
 * Who is asking, about which site, and what their workspace's plan holds — or
 * the refusal, already sent. `manage` asks for the admin or editor role.
 */
export async function resolveSiteCaller(
  req: PluginApiRequest,
  res: PluginApiResponse,
  options: { manage: boolean; entitled: boolean },
): Promise<SiteCaller | null> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return null
  }
  const hostId = String(req.body?.hostId ?? '')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(hostId)) {
    res.status(400).json({ error: 'Missing site' })
    return null
  }
  const token = bearer(req)
  if (!token) {
    res.status(401).json({ error: 'Unauthenticated' })
    return null
  }
  let decoded: { uid: string; [claim: string]: unknown }
  try {
    decoded = await verifyConsoleIdToken(token)
  } catch (error) {
    if (error instanceof EmailNotVerifiedError) {
      res.status(403).json({ error: 'Verify your email to continue', reason: 'email-unverified' })
    } else {
      res.status(401).json({ error: 'Unauthenticated' })
    }
    return null
  }
  const firestore = firebaseAdmin.app().firestore()
  const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
  if (!hostSnapshot.exists) {
    res.status(404).json({ error: 'Unknown site' })
    return null
  }
  const hostData = (hostSnapshot.data() ?? {}) as Record<string, unknown>
  const staff = decoded['staff'] === true
  const role = ((hostData['memberRoles'] ?? {}) as Record<string, Role>)[decoded.uid] ?? null
  if (!staff && !role) {
    res.status(403).json({ error: 'You are not a member of this site' })
    return null
  }
  if (options.manage && !staff && !MANAGING_ROLES.has(String(role))) {
    res.status(403).json({ error: 'Only a site admin or editor can change its funnels' })
    return null
  }
  const owner = await getOrgForHost(hostId).catch(() => null)
  const org = (owner?.org as Record<string, unknown> | undefined) ?? null
  if (options.entitled && !checkEntitlement(org as never, FUNNEL_FEATURE)) {
    res.status(403).json({
      error: "Funnels come with per-page analytics, which this workspace's plan does not include",
      reason: 'entitlement',
    })
    return null
  }
  return { uid: decoded.uid, staff, role, hostData, orgId: owner?.orgId ?? null, org, firestore }
}

const funnelsRef = (firestore: any, hostId: string) =>
  // Spelled out (FUNNELS_COLLECTION) so the repo's host-collection sweeps find it.
  firestore.collection('hosts').doc(hostId).collection('funnels')

/** Switches the site's recording to `on` when it is not already; says whether it moved. */
async function setRecording(firestore: any, hostId: string, hostData: Record<string, unknown>, on: boolean) {
  if ((hostData['funnelRecording'] === true) === on) return false
  await firestore.collection('hosts').doc(hostId).update({ funnelRecording: on })
  return true
}

const millis = (value: any): number =>
  typeof value?.toMillis === 'function' ? value.toMillis() : Number(value) || 0

export const funnelsInventoryHandler: PluginApiHandler = async (req, res) => {
  const caller = await resolveSiteCaller(req, res, { manage: false, entitled: false })
  if (!caller) return
  const hostId = String(req.body.hostId)
  res.status(200).json({ inventory: await readFunnelInventory(caller.firestore, hostId, caller.hostData) })
}

export const funnelsSaveHandler: PluginApiHandler = async (req, res) => {
  const caller = await resolveSiteCaller(req, res, { manage: true, entitled: true })
  if (!caller) return
  const hostId = String(req.body.hostId)
  const funnelId = String(req.body.funnelId ?? '').trim()
  if (funnelId && !/^[A-Za-z0-9_-]{1,64}$/.test(funnelId)) {
    return res.status(400).json({ error: 'Unknown funnel' })
  }
  const normalized = normalizeFunnelDefinition(req.body.funnel)
  if ('error' in normalized) return res.status(400).json({ error: normalized.error })
  const inventory = await readFunnelInventory(caller.firestore, hostId, caller.hostData)
  for (const [index, step] of normalized.funnel.steps.entries()) {
    const problem = stepInventoryProblem(step, inventory)
    if (problem) return res.status(400).json({ error: `Step ${index + 1}: ${problem}` })
  }
  const steps = normalized.funnel.steps.map((step) => labelStepFromInventory(step, inventory))
  const collection = funnelsRef(caller.firestore, hostId)
  const ref = collection.doc(funnelId || createResourceUid())
  if (funnelId) {
    const existing = await ref.get()
    if (!existing.exists) return res.status(404).json({ error: 'Unknown funnel' })
  } else {
    const count = await collection.count().get()
    if (Number(count.data().count ?? 0) >= FUNNELS_MAX_PER_SITE) {
      return res
        .status(409)
        .json({ error: `A site keeps up to ${FUNNELS_MAX_PER_SITE} funnels. Delete one to add another.` })
    }
  }
  await ref.set(
    {
      name: normalized.funnel.name,
      steps,
      updatedAt: FieldValue.serverTimestamp(),
      ...(funnelId ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid }),
    },
    { merge: true },
  )
  const recordingChanged = await setRecording(caller.firestore, hostId, caller.hostData, true)
  forgetFunnelHostState(hostId)
  res.status(200).json({ funnelId: ref.id, recordingChanged })
}

export const funnelsDeleteHandler: PluginApiHandler = async (req, res) => {
  const caller = await resolveSiteCaller(req, res, { manage: true, entitled: false })
  if (!caller) return
  const hostId = String(req.body.hostId)
  const funnelId = String(req.body.funnelId ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(funnelId)) return res.status(400).json({ error: 'Unknown funnel' })
  const collection = funnelsRef(caller.firestore, hostId)
  await collection.doc(funnelId).delete()
  const left = await collection.limit(1).get()
  const recordingChanged = left.empty
    ? await setRecording(caller.firestore, hostId, caller.hostData, false)
    : false
  forgetFunnelHostState(hostId)
  res.status(200).json({ deleted: true, recordingChanged })
}

export const funnelsResultsHandler: PluginApiHandler = async (req, res) => {
  const caller = await resolveSiteCaller(req, res, { manage: false, entitled: true })
  if (!caller) return
  const hostId = String(req.body.hostId)
  const funnelId = String(req.body.funnelId ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(funnelId)) return res.status(400).json({ error: 'Unknown funnel' })
  const range = funnelRange(req.body.from, req.body.to, FUNNEL_MAX_RANGE_DAYS)
  if ('error' in range) return res.status(400).json({ error: range.error })
  const snapshot = await funnelsRef(caller.firestore, hostId).doc(funnelId).get()
  if (!snapshot.exists) return res.status(404).json({ error: 'Unknown funnel' })
  const normalized = normalizeFunnelDefinition(snapshot.data())
  if ('error' in normalized) return res.status(422).json({ error: normalized.error })
  const result = await funnelResult({
    firestore: caller.firestore,
    hostId,
    funnelId,
    steps: normalized.funnel.steps,
    version: millis(snapshot.get('updatedAt')),
    ...range,
    fresh: req.body.fresh === true,
  })
  res.status(200).json({ result })
}

export const funnelsProposeHandler: PluginApiHandler = async (req, res) => {
  const caller = await resolveSiteCaller(req, res, { manage: true, entitled: true })
  if (!caller) return
  const hostId = String(req.body.hostId)
  const brief = String(req.body.brief ?? '').trim()
  if (!brief) return res.status(400).json({ error: 'Describe the funnel first.' })
  if (brief.length > FUNNEL_BRIEF_MAX_CHARS) {
    return res.status(400).json({ error: `Keep the description under ${FUNNEL_BRIEF_MAX_CHARS} characters.` })
  }
  if (!caller.orgId) return res.status(400).json({ error: 'This site is not part of a workspace' })
  const generator = pluginTextGenerator()
  if (!generator) return res.status(404).json({ error: 'AI is not available for this workspace' })
  const inventory = await readFunnelInventory(caller.firestore, hostId, caller.hostData)
  const answer = await generator.generator.generate({
    orgId: caller.orgId,
    hostId,
    uid: caller.uid,
    staff: caller.staff,
    org: caller.org,
    purpose: 'funnels-propose',
    system: FUNNEL_PROPOSAL_SYSTEM,
    prompt: funnelProposalPrompt(brief, inventory),
    maxTokens: 1_200,
  })
  if ('error' in answer) {
    return res.status(answer.status).json({ error: answer.error, reason: answer.reason })
  }
  const checked = checkFunnelProposal(answer.text, inventory)
  if ('error' in checked) return res.status(422).json({ error: checked.error })
  res.status(200).json(checked.proposal)
}

/** The draft writer's resource, as the workflows plugin registers it. */
const AUTOMATION_RESOURCE = 'automation'

/** How far back a new watch looks for people who already left. */
const BACKFILL_LIMIT = 500

export const funnelsActHandler: PluginApiHandler = async (req, res) => {
  const caller = await resolveSiteCaller(req, res, { manage: true, entitled: true })
  if (!caller) return
  const hostId = String(req.body.hostId)
  const funnelId = String(req.body.funnelId ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(funnelId)) return res.status(400).json({ error: 'Unknown funnel' })
  const action = String(req.body.action ?? '') as DropOffAction
  if (!DROP_OFF_ACTIONS.includes(action)) {
    return res.status(400).json({ error: 'Pick an email or a task.' })
  }
  if (!caller.orgId) return res.status(400).json({ error: 'This site is not part of a workspace' })
  const drafts = pluginResourceDraftWriter(AUTOMATION_RESOURCE)
  if (!drafts) return res.status(404).json({ error: 'Automations are not available for this workspace' })

  const ref = funnelsRef(caller.firestore, hostId).doc(funnelId)
  const snapshot = await ref.get()
  if (!snapshot.exists) return res.status(404).json({ error: 'Unknown funnel' })
  const normalized = normalizeFunnelDefinition(snapshot.data())
  if ('error' in normalized) return res.status(422).json({ error: normalized.error })
  const { funnel } = normalized
  const read = normalizeDropOffWatch(req.body, funnel.steps.length)
  if ('error' in read) return res.status(400).json({ error: read.error })
  const watch = read.watch
  const watches = funnelWatches(snapshot.get('dropOffWatches'), funnel.steps.length)
  const watched = watches.some((one) => one.step === watch.step && one.afterHours === watch.afterHours)
  if (!watched && watches.length >= DROP_OFF_WATCHES_MAX) {
    return res.status(409).json({
      error: `A funnel follows up on up to ${DROP_OFF_WATCHES_MAX} drop-offs. Remove one from its automations first.`,
    })
  }

  const context = {
    orgId: caller.orgId,
    hostId,
    uid: caller.uid,
    org: caller.org,
    now: new Date(),
  }
  const refusal = await drafts.writer.refusal(context)
  if (refusal) return res.status(refusal.status).json({ error: refusal.error })
  const draft = dropOffAutomationContent({ funnelId, funnelName: funnel.name, steps: funnel.steps, watch, action })
  const check = drafts.writer.check(draft.content, { hostId })
  if (check.ok === false) return res.status(422).json({ error: check.problems[0] })
  const written = await drafts.writer.write({
    ...context,
    id: createResourceUid(),
    name: draft.name,
    content: draft.content,
  })
  if (written.ok === false) return res.status(written.status).json({ error: written.error })

  if (!watched) {
    await ref.update({ dropOffWatches: FieldValue.arrayUnion(watch) })
    forgetFunnelHostState(hostId)
    // People identified within the wait who are already past due are looked
    // at on the next tick rather than never: a watch applies from today.
    const since = Date.now() - (watch.afterHours * 60 * 60 * 1000 + 24 * 60 * 60 * 1000)
    const recent = await caller.firestore
      .collection('hosts')
      .doc(hostId)
      .collection(FUNNEL_JOURNEYS_COLLECTION)
      .where('identifiedAt', '>=', since)
      .limit(BACKFILL_LIMIT)
      .get()
    if (!recent.empty) {
      const batch = caller.firestore.batch()
      for (const doc of recent.docs) batch.update(doc.ref, { dropOffCheckAt: Date.now() })
      await batch.commit()
    }
  }
  res.status(200).json({ automationId: written.id, name: written.name, replayed: written.replayed })
}
