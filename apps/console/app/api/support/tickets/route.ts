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

import {
  pluginRequestFromWeb,
  responseDueAt,
  supportForPlan,
  supportTierRank,
  type OrgPlan,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForUser,
  isImpersonationSession,
  notifyStaff,
} from '@aglyn/tenant-data-admin'

const MAX_BODY = 5000

/**
 * Support tickets (AGL-142): paid subscribers open tickets and thread
 * messages with staff. Data lives at `supportTickets/{id}` + `messages` —
 * deliberately absent from the Firestore rules (default-deny), so every
 * read/write passes this route: paid-plan gate for subscribers, `staff`
 * claim for the support side. Tickets are org-scoped (AGL-238): keyed by
 * the caller's organization, whose doc carries the plan.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body: payload, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = app.firestore()
    const isStaff = Boolean(decoded['staff'])
    const resolved = await getOrgForUser(
      decoded.uid,
      String(query['orgId'] ?? payload?.orgId ?? '') || null,
    )
    const orgId = resolved?.orgId ?? null

    // Ticket access is DERIVED from the support ladder, not a second copy of
    // it (AGL-1103). This was `plan !== 'free'`, which is now wrong in a way
    // no test would catch: Starter is forum-only, so a hardcoded paid check
    // would keep letting it open tickets we have not committed to answer.
    // A tier with no first-response window has no ticket channel, by
    // definition — one place decides, and the gate cannot drift from the copy.
    const requireTicketSupport = () =>
      supportForPlan(resolved?.org?.plan as OrgPlan | null).firstResponse !== null

    const ticketsRef = firestore.collection('supportTickets')

    if (method === 'GET') {
      const ticketId = String(query['ticketId'] ?? '')
      if (ticketId) {
        const ticketSnapshot = await ticketsRef.doc(ticketId).get()
        const ticket = ticketSnapshot.data()
        if (!ticket) return Response.json({ error: 'Unknown ticket' }, { status: 404 })
        if (!isStaff && ticket['orgId'] !== orgId) {
          return Response.json({ error: 'Not your ticket' }, { status: 403 })
        }
        const messages = await ticketsRef
          .doc(ticketId)
          .collection('messages')
          .orderBy('createdAt', 'asc')
          .limit(200)
          .get()
        return Response.json({
          ticket: {
            $id: ticketSnapshot.id,
            ...ticket,
            // Timestamps do not survive JSON as anything a client can read
            // (AGL-1103) — the other two were already converted below, and a
            // new one added to the document silently would not have been.
            createdAt: ticketSnapshot.get('createdAt')?.toMillis?.() ?? null,
            updatedAt: ticketSnapshot.get('updatedAt')?.toMillis?.() ?? null,
            responseDueAt:
              ticketSnapshot.get('responseDueAt')?.toMillis?.() ?? null,
            firstRespondedAt:
              ticketSnapshot.get('firstRespondedAt')?.toMillis?.() ?? null,
          },
          messages: messages.docs.map((doc) => ({
            $id: doc.id,
            ...doc.data(),
            createdAt: doc.get('createdAt')?.toMillis?.() ?? null,
          })),
        }, { status: 200 })
      }
      if (!isStaff && !orgId) return Response.json({ tickets: [] }, { status: 200 })
      const listQuery = isStaff
        ? ticketsRef.orderBy('updatedAt', 'desc').limit(100)
        : ticketsRef.where('orgId', '==', orgId).limit(100)
      const snapshot = await listQuery.get()
      return Response.json({
        tickets: snapshot.docs.map((doc) => ({
          $id: doc.id,
          ...doc.data(),
          createdAt: doc.get('createdAt')?.toMillis?.() ?? null,
          updatedAt: doc.get('updatedAt')?.toMillis?.() ?? null,
          responseDueAt: doc.get('responseDueAt')?.toMillis?.() ?? null,
          firstRespondedAt: doc.get('firstRespondedAt')?.toMillis?.() ?? null,
        })),
      }, { status: 200 })
    }

    if (method === 'POST') {
      if (!requireTicketSupport()) {
        // Names the actual boundary. "Paid plans" was already misleading and
        // is now false: Starter is paid and forum-only.
        return Response.json({
          error: 'Support tickets start on Pro — see Billing',
        }, { status: 403 })
      }
      const subject = String(payload?.subject ?? '')
        .trim()
        .slice(0, 150)
      const body = String(payload?.body ?? '')
        .trim()
        .slice(0, MAX_BODY)
      if (!subject || !body) {
        return Response.json({ error: 'Missing subject or message' }, { status: 400 })
      }
      const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
      const ticketRef = ticketsRef.doc()
      // What this org is owed, resolved at OPEN time and frozen on the ticket
      // (AGL-1103). Deriving it later from `org.plan` would silently rewrite
      // history: a downgrade would retire a breach that already happened, and
      // an upgrade would invent one that never did. The plan is stamped beside
      // it so a disputed ticket can be read without reconstructing billing.
      const plan = resolved?.org?.plan ?? null
      const commitment = supportForPlan(plan as OrgPlan | null)
      const openedAtMs = Date.now()
      const dueAtMs = responseDueAt(commitment, openedAtMs)
      await ticketRef.set({
        orgId,
        subject,
        status: 'open',
        plan,
        supportTier: commitment.tier,
        supportTierRank: supportTierRank(commitment.tier),
        // Null for a tier with no commitment. The staff queue treats a missing
        // due date as "no clock", not as "overdue since 1970".
        responseDueAt: dueAtMs
          ? firebaseAdmin.firestore.Timestamp.fromMillis(dueAtMs)
          : null,
        firstRespondedAt: null,
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
      // Staff have no other signal a ticket exists (AGL-850) — land them on the
      // exact ticket in the staff queue.
      await notifyStaff({
        type: 'support.ticketOpened',
        title: `New support ticket: ${subject}`,
        body: decoded.email ? `From ${decoded.email}` : undefined,
        link: `/admin/support?ticketId=${ticketRef.id}`,
        orgId: orgId ?? undefined,
      })
      return Response.json({ ticketId: ticketRef.id }, { status: 200 })
    }

    if (method === 'PATCH') {
      const ticketId = String(payload?.ticketId ?? '')
      if (!ticketId) return Response.json({ error: 'Missing ticket' }, { status: 400 })
      const ticketSnapshot = await ticketsRef.doc(ticketId).get()
      const ticket = ticketSnapshot.data()
      if (!ticket) return Response.json({ error: 'Unknown ticket' }, { status: 404 })
      if (!isStaff && ticket['orgId'] !== orgId) {
        return Response.json({ error: 'Not your ticket' }, { status: 403 })
      }
      const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
      const body = String(payload?.body ?? '')
        .trim()
        .slice(0, MAX_BODY)
      const status = String(payload?.status ?? '')
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
        // Stop the SLA clock on the FIRST staff reply (AGL-1103). Without
        // this, `responseDueAt` is a deadline nothing can ever satisfy — the
        // queue would show every ticket we ever answered as still owed, which
        // is the same shape as a control that is configured, tested and never
        // called. `firstRespondedAt` is write-once: a later staff message must
        // not move it, or a slow first answer is erased by a fast second one.
        if (isStaff && !ticket['firstRespondedAt']) {
          updates['firstRespondedAt'] = now
        }
        // A subscriber replying needs to reach staff (AGL-850); a staff reply
        // is outbound to the customer, so it raises no staff notification.
        if (!isStaff) {
          await notifyStaff({
            type: 'support.ticketReply',
            title: `Ticket reply: ${String(ticket['subject'] ?? '')}`,
            body: decoded.email ? `From ${decoded.email}` : undefined,
            link: `/admin/support?ticketId=${ticketId}`,
            orgId: (ticket['orgId'] as string | undefined) ?? undefined,
          })
        }
      }
      if (status === 'open' || status === 'closed') {
        updates['status'] = status
      }
      await ticketsRef.doc(ticketId).set(updates, { merge: true })
      return Response.json({ ok: true }, { status: 200 })
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Support operation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST, handler as PATCH }
