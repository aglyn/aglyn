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

import { WAIVERS_PERMISSIONS } from '../constants/bundle-common'
import {
  draftChangesText,
  normalizeWaiverDraft,
  waiverSnapshot,
  type WaiverStatus,
  type WaiverTemplate,
} from '../model/waiver'
import { waiverSiteOrigin } from '../model/waiver-share'
import { waiverBusinessContact } from '../model/waiver-signature'
import { isDocumentId, newWaiversId, waiversDb, waiversRefs } from './db'
import { json, refuse, waiversGate } from './gate'

/*==========================================
 * THE WAIVERS A SITE OFFERS (AGL-4042). Reading them is for anyone who may
 * take signatures (the window needs to pick one); writing, publishing and
 * retiring them is `manageWaivers`. Every saved change to the words bumps
 * the version and freezes the previous words in `versions/`, so a signature
 * always names the text it agreed to.
 *
 * Every write also mirrors the waiver's title and status to the site's
 * `waiverTitles`, in the same batch or transaction, which is what the
 * Besigner's waiver picker lists. A waiver written before the mirror existed
 * carries no `listedAtMs`, and the next read of the site's list mirrors it.
 *=========================================*/

const READERS = [WAIVERS_PERMISSIONS.manage, WAIVERS_PERMISSIONS.collect] as const
const MAX_WAIVERS = 200

/** What the picker reads of one waiver: its title and whether to list it, nothing of its words. */
export function waiverTitleRow(
  waiver: Pick<WaiverTemplate, 'title' | 'status' | 'version' | 'updatedAtMs'>,
): Record<string, unknown> {
  return {
    title: waiver.title,
    status: waiver.status,
    // A retired waiver takes no signatures, so no element should be pointed at it.
    pickable: waiver.status !== 'retired',
    version: waiver.version,
    updatedAtMs: waiver.updatedAtMs,
  }
}

/** One waiver as the console reads it. */
function view(id: string, data: Record<string, unknown>): WaiverTemplate {
  return { ...(data as unknown as WaiverTemplate), id }
}

/** `GET waivers/templates?hostId=`: the site's waivers, newest change first. `POST`: save one. */
export async function templatesRoute(request: Request): Promise<Response> {
  if (request.method === 'GET') {
    const staff = await waiversGate(request, { permission: READERS })
    if (staff instanceof Response) return staff
    const snapshot = await waiversRefs
      .waivers(staff.orgId)
      .where('hostId', '==', staff.hostId)
      .orderBy('updatedAtMs', 'desc')
      .limit(MAX_WAIVERS)
      .get()
    // Mirror any waiver written before the picker's list existed, once.
    const unlisted = snapshot.docs.filter((doc) => !doc.get('listedAtMs'))
    if (unlisted.length) {
      const listedAtMs = Date.now()
      const batch = waiversDb().batch()
      for (const doc of unlisted) {
        batch.set(waiversRefs.title(staff.hostId, doc.id), waiverTitleRow(view(doc.id, doc.data())))
        batch.update(doc.ref, { listedAtMs })
      }
      await batch.commit()
    }
    return json({
      waivers: snapshot.docs.map((doc) => view(doc.id, doc.data())),
      timeZone: staff.timeZone,
      // Where a share link opens: the store's own site (AGL-4042), or `null`
      // for a site with no public address, whose link stays the console's.
      signPageOrigin: waiverSiteOrigin(staff.host),
      // How the consent tells signers to reach the business, worked out the
      // way the signing page does; `null` is a site that names no way at all,
      // which the console says so the staff can add one.
      businessContact: waiverBusinessContact(staff.host as never),
    })
  }
  if (request.method !== 'POST') return refuse(405, 'Method not allowed')
  const staff = await waiversGate(request, { permission: WAIVERS_PERMISSIONS.manage })
  if (staff instanceof Response) return staff
  const normalized = normalizeWaiverDraft(staff.body['waiver'])
  if (normalized.ok === false) return refuse(400, normalized.error)
  const draft = normalized.draft
  const nowMs = Date.now()
  const rawId = staff.body['waiverId']
  if (rawId === undefined || rawId === null || rawId === '') {
    const count = await waiversRefs.waivers(staff.orgId).where('hostId', '==', staff.hostId).limit(MAX_WAIVERS).get()
    if (count.size >= MAX_WAIVERS) return refuse(409, `A site can keep up to ${MAX_WAIVERS} waivers. Retire one you no longer use.`)
    const id = newWaiversId()
    const waiver: Omit<WaiverTemplate, 'id'> & { listedAtMs: number } = {
      ...draft,
      orgId: staff.orgId,
      hostId: staff.hostId,
      status: 'draft',
      version: 1,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      publishedAtMs: null,
      updatedBy: staff.uid,
      listedAtMs: nowMs,
    }
    const batch = waiversDb().batch()
    batch.set(waiversRefs.waiver(staff.orgId, id), waiver)
    batch.set(waiversRefs.title(staff.hostId, id), waiverTitleRow(waiver))
    batch.set(waiversRefs.versions(staff.orgId, id).doc('1'), {
      version: 1,
      ...waiverSnapshot(draft),
      savedAtMs: nowMs,
      savedBy: staff.uid,
    })
    await batch.commit()
    return json({ waiver: view(id, waiver as unknown as Record<string, unknown>) }, 201)
  }
  if (!isDocumentId(rawId)) return refuse(400, 'Unknown waiver')
  const ref = waiversRefs.waiver(staff.orgId, rawId)
  const saved = await waiversDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const current = snapshot.exists ? view(rawId, snapshot.data() as Record<string, unknown>) : null
    if (!current || current.hostId !== staff.hostId) return null
    const bumps = draftChangesText(current, draft)
    const version = bumps ? current.version + 1 : current.version
    const next = { ...waiverSnapshot(draft), version, updatedAtMs: nowMs, updatedBy: staff.uid, listedAtMs: nowMs }
    transaction.update(ref, next)
    transaction.set(waiversRefs.title(staff.hostId, rawId), waiverTitleRow({ ...current, ...next }))
    if (bumps) {
      transaction.set(waiversRefs.versions(staff.orgId, rawId).doc(String(version)), {
        version,
        ...waiverSnapshot(draft),
        savedAtMs: nowMs,
        savedBy: staff.uid,
      })
    }
    return { ...current, ...next }
  })
  if (!saved) return refuse(404, 'Unknown waiver')
  return json({ waiver: saved })
}

const STATUS_FOR: Record<string, WaiverStatus> = { publish: 'published', unpublish: 'draft', retire: 'retired' }

/** `GET waivers/template?hostId=&waiverId=`: one waiver and its versions. `POST {action}`: publish, unpublish, retire. */
export async function templateRoute(request: Request): Promise<Response> {
  if (request.method === 'GET') {
    const staff = await waiversGate(request, { permission: READERS })
    if (staff instanceof Response) return staff
    const waiverId = new URL(request.url).searchParams.get('waiverId')
    if (!isDocumentId(waiverId)) return refuse(400, 'Unknown waiver')
    const snapshot = await waiversRefs.waiver(staff.orgId, waiverId).get()
    if (!snapshot.exists || snapshot.get('hostId') !== staff.hostId) return refuse(404, 'Unknown waiver')
    const versions = await waiversRefs.versions(staff.orgId, waiverId).orderBy('version', 'desc').limit(100).get()
    return json({
      waiver: view(waiverId, snapshot.data() as Record<string, unknown>),
      versions: versions.docs.map((doc) => doc.data()),
    })
  }
  if (request.method !== 'POST') return refuse(405, 'Method not allowed')
  const staff = await waiversGate(request, { permission: WAIVERS_PERMISSIONS.manage })
  if (staff instanceof Response) return staff
  const waiverId = staff.body['waiverId']
  const status = STATUS_FOR[String(staff.body['action'] ?? '')]
  if (!isDocumentId(waiverId)) return refuse(400, 'Unknown waiver')
  if (!status) return refuse(400, 'Choose publish, unpublish or retire.')
  const ref = waiversRefs.waiver(staff.orgId, waiverId)
  const snapshot = await ref.get()
  if (!snapshot.exists || snapshot.get('hostId') !== staff.hostId) return refuse(404, 'Unknown waiver')
  const nowMs = Date.now()
  const batch = waiversDb().batch()
  batch.update(ref, {
    status,
    updatedAtMs: nowMs,
    updatedBy: staff.uid,
    listedAtMs: nowMs,
    ...(status === 'published' ? { publishedAtMs: nowMs } : {}),
  })
  batch.set(
    waiversRefs.title(staff.hostId, waiverId),
    waiverTitleRow({ ...view(waiverId, snapshot.data() as Record<string, unknown>), status, updatedAtMs: nowMs }),
  )
  await batch.commit()
  const updated = await ref.get()
  return json({ waiver: view(waiverId, updated.data() as Record<string, unknown>) })
}
