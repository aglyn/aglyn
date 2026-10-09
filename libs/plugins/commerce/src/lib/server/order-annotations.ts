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

import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { liftLegacyOrder, orderNoteUpdate, restockAnswer, type RestockResolution } from '../model'
import { bodyOf, gate, resolved, validId, type ProductsWriteDeps } from './products-write'

/*
 * `POST /api/commerce/order-note` and `POST /api/commerce/order-restock-answer`
 * (AGL-3651, AGL-3652): the order dialog's "Add note" and its restock
 * question, for the native apps.
 *
 * The console makes both writes from the browser, as an `updateDoc` of the
 * order's `timeline` (and `restockCheck`), the only two fields the Firestore
 * rules let a member write on an order. Both are read-then-append, so a
 * stale seed would drop an event another tab wrote. These routes run the
 * console's own computation (`model/order-annotations.ts`, which the console
 * imports too) inside a transaction on the stored order, under the gate the
 * rules put on that write: a verified member with a write role on the site,
 * or staff, while the site, its org and the platform are not frozen.
 */

type Reply = Parameters<PluginApiHandler>[1]

function missing(res: Reply) {
  return res.status(400).json({ error: 'Missing site or order' })
}

/** Adds a note to an order's timeline. */
export function createOrderNoteHandler(options: ProductsWriteDeps = {}): PluginApiHandler {
  return async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const deps = resolved(options)
    const body = bodyOf(req)
    const { hostId, orderId } = body
    if (!validId(hostId) || !validId(orderId)) return missing(res)
    if (typeof body['note'] !== 'string' || !body['note'].trim()) return res.status(400).json({ error: 'Write a note first' })
    try {
      const door = await gate(req, res, hostId, deps)
      if (!door) return
      const db = deps.firestore()
      const orderRef = db.collection('hosts').doc(hostId).collection('orders').doc(orderId)
      const answer = await db.runTransaction(async (tx) => {
        const stored = await tx.get(orderRef)
        if (!stored.exists) return { status: 404, body: { error: 'This order no longer exists' } }
        const order = liftLegacyOrder((stored.data() ?? {}) as never)
        const update = orderNoteUpdate(order, body['note'] as string, deps.now())
        if (!update) return { status: 400, body: { error: 'Write a note first' } }
        tx.update(orderRef, update)
        return { status: 200, body: { ok: true, timeline: update.timeline } }
      })
      return res.status(answer.status).json(answer.body)
    } catch (error) {
      console.error('[commerce/order-note]', error)
      return res.status(500).json({ error: 'The note could not be added' })
    }
  }
}

const RESOLUTIONS: readonly RestockResolution[] = ['restocked', 'dismissed']

/**
 * Answers an order's open restock question. `flaggedAtMs` names the question
 * the person saw; an answer never lands on a newer one. It moves no stock, as
 * in the console: it only clears the question.
 */
export function createOrderRestockAnswerHandler(options: ProductsWriteDeps = {}): PluginApiHandler {
  return async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const deps = resolved(options)
    const body = bodyOf(req)
    const { hostId, orderId } = body
    if (!validId(hostId) || !validId(orderId)) return missing(res)
    const resolution = body['resolution'] as RestockResolution
    const flaggedAtMs = Number(body['flaggedAtMs'])
    if (!RESOLUTIONS.includes(resolution) || !Number.isFinite(flaggedAtMs)) {
      return res.status(400).json({ error: 'Choose restocked or no restock' })
    }
    try {
      const door = await gate(req, res, hostId, deps)
      if (!door) return
      const db = deps.firestore()
      const orderRef = db.collection('hosts').doc(hostId).collection('orders').doc(orderId)
      const answer = await db.runTransaction(async (tx) => {
        const stored = await tx.get(orderRef)
        if (!stored.exists) return { status: 404, body: { error: 'This order no longer exists' } }
        const order = liftLegacyOrder((stored.data() ?? {}) as never)
        const verdict = restockAnswer(order, flaggedAtMs, resolution, door.uid, deps.now())
        if (verdict.verdict !== 'recorded') return { status: 200, body: { ok: true, verdict: verdict.verdict } }
        tx.update(orderRef, verdict.update)
        return { status: 200, body: { ok: true, verdict: 'recorded' } }
      })
      return res.status(answer.status).json(answer.body)
    } catch (error) {
      console.error('[commerce/order-restock-answer]', error)
      return res.status(500).json({ error: 'The answer could not be recorded' })
    }
  }
}

export const orderNoteHandler = createOrderNoteHandler()
export const orderRestockAnswerHandler = createOrderRestockAnswerHandler()
