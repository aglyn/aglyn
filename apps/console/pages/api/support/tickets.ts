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

import { firebaseAdmin, getOrgForUser } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

const MAX_BODY = 5000

/**
 * Support tickets (AGL-142): paid subscribers open tickets and thread
 * messages with staff. Data lives at `supportTickets/{id}` + `messages` —
 * deliberately absent from the Firestore rules (default-deny), so every
 * read/write passes this route: paid-plan gate for subscribers, `staff`
 * claim for the support side. Tickets are org-scoped (AGL-238): keyed by
 * the caller's organization, whose doc carries the plan.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const authorization = req.headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    const firestore = app.firestore()
    const isStaff = Boolean(decoded['staff'])
    const resolved = await getOrgForUser(
      decoded.uid,
      String(req.query['orgId'] ?? req.body?.orgId ?? '') || null,
    )
    const orgId = resolved?.orgId ?? null

    // Paid gate for subscriber operations (staff bypasses).
    const requirePaid = () => {
      const plan = resolved?.org?.plan
      return Boolean(plan && plan !== 'free')
    }

    const ticketsRef = firestore.collection('supportTickets')

    if (req.method === 'GET') {
      const ticketId = String(req.query['ticketId'] ?? '')
      if (ticketId) {
        const ticketSnapshot = await ticketsRef.doc(ticketId).get()
        const ticket = ticketSnapshot.data()
        if (!ticket) return res.status(404).json({ error: 'Unknown ticket' })
        if (
          !isStaff &&
          ticket['orgId'] !== orgId &&
          ticket['tenantId'] !== decoded.uid
        ) {
          return res.status(403).json({ error: 'Not your ticket' })
        }
        const messages = await ticketsRef
          .doc(ticketId)
          .collection('messages')
          .orderBy('createdAt', 'asc')
          .limit(200)
          .get()
        return res.status(200).json({
          ticket: { $id: ticketSnapshot.id, ...ticket },
          messages: messages.docs.map((doc) => ({
            $id: doc.id,
            ...doc.data(),
            createdAt: doc.get('createdAt')?.toMillis?.() ?? null,
          })),
        })
      }
      if (!isStaff && !orgId) return res.status(200).json({ tickets: [] })
      const listQuery = isStaff
        ? ticketsRef.orderBy('updatedAt', 'desc').limit(100)
        : ticketsRef.where('orgId', '==', orgId).limit(100)
      const snapshot = await listQuery.get()
      return res.status(200).json({
        tickets: snapshot.docs.map((doc) => ({
          $id: doc.id,
          ...doc.data(),
          createdAt: doc.get('createdAt')?.toMillis?.() ?? null,
          updatedAt: doc.get('updatedAt')?.toMillis?.() ?? null,
        })),
      })
    }

    if (req.method === 'POST') {
      if (!requirePaid()) {
        return res.status(403).json({
          error: 'Support tickets are for paid plans — see Billing',
        })
      }
      const subject = String(req.body?.subject ?? '')
        .trim()
        .slice(0, 150)
      const body = String(req.body?.body ?? '')
        .trim()
        .slice(0, MAX_BODY)
      if (!subject || !body) {
        return res.status(400).json({ error: 'Missing subject or message' })
      }
      const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
      const ticketRef = ticketsRef.doc()
      await ticketRef.set({
        orgId,
        subject,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      })
      await ticketRef.collection('messages').add({
        authorId: decoded.uid,
        authorEmail: decoded.email ?? null,
        staff: false,
        body,
        createdAt: now,
      })
      return res.status(200).json({ ticketId: ticketRef.id })
    }

    if (req.method === 'PATCH') {
      const ticketId = String(req.body?.ticketId ?? '')
      if (!ticketId) return res.status(400).json({ error: 'Missing ticket' })
      const ticketSnapshot = await ticketsRef.doc(ticketId).get()
      const ticket = ticketSnapshot.data()
      if (!ticket) return res.status(404).json({ error: 'Unknown ticket' })
      if (
        !isStaff &&
        ticket['orgId'] !== orgId &&
        ticket['tenantId'] !== decoded.uid
      ) {
        return res.status(403).json({ error: 'Not your ticket' })
      }
      const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
      const body = String(req.body?.body ?? '')
        .trim()
        .slice(0, MAX_BODY)
      const status = String(req.body?.status ?? '')
      const updates: Record<string, unknown> = { updatedAt: now }
      if (body) {
        await ticketsRef.doc(ticketId).collection('messages').add({
          authorId: decoded.uid,
          authorEmail: decoded.email ?? null,
          staff: isStaff,
          body,
          createdAt: now,
        })
        // A reply reopens a closed ticket unless the caller also closes it.
        updates['status'] = 'open'
      }
      if (status === 'open' || status === 'closed') {
        updates['status'] = status
      }
      await ticketsRef.doc(ticketId).set(updates, { merge: true })
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Support operation failed' })
  }
}
