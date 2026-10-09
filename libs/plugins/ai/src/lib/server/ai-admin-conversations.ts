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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import {
  composeStaffAiAssistRow,
  composeStaffAiJobRow,
  isStaffAiConversationKind,
  STAFF_AI_CONVERSATIONS_PAGE,
  staffAiCrmResult,
  staffAiInsightResult,
  staffAiJobResultCollection,
  type StaffAiJobResult,
  type StaffAiConversationKind,
  type StaffAiConversationsResponse,
} from '../usage/staff-org-ai-conversations'

/**
 * `/api/ai/admin/conversations` (AGL-3675): one page of what an org asked
 * Aglyn AI and what it answered, for the staff org page.
 *
 * `?orgId=` and `?kind=assist|jobs`, newest first, and `?after=<id>` for the
 * next page. Staff-gated exactly as `/api/ai/admin/org` is. The collections
 * it reads have no client rules at all — default-deny for every browser —
 * which is why the read is here, on the Admin SDK.
 *
 * ## Every page read is audited, and the audit holds no text
 *
 * Unlike the usage card, which loads with the page and so writes no audit
 * row, this route returns what a person typed, and staff read it only when
 * they ask to. Each page writes an `org.ai-conversations-viewed` access row
 * naming who read which list of which org and how many rows came back. The
 * Privacy policy says our audit log records an AI job "without the text of
 * its brief or of what it wrote", so the row carries none of it.
 */

/** Members read to name who asked; past it a row shows the uid alone. */
const MEMBERS_SCAN = 500

const ACTION = 'org.ai-conversations-viewed'
/** The same read, of one account's requests across every org (AGL-3660). */
const USER_ACTION = 'user.ai-requests-viewed'

type Firestore = FirebaseFirestore.Firestore
type OrgRef = FirebaseFirestore.DocumentReference

/** One page of a collection under the org, newest first, after the document `after` names. */
async function readPage(
  orgRef: OrgRef,
  collection: 'assistExchanges' | 'aiJobs',
  after: string | null,
): Promise<{ docs: FirebaseFirestore.QueryDocumentSnapshot[]; next: string | null }> {
  let query = orgRef.collection(collection).orderBy('createdAt', 'desc').limit(STAFF_AI_CONVERSATIONS_PAGE + 1)
  if (after) {
    const cursor = await orgRef.collection(collection).doc(after).get()
    if (cursor.exists) query = query.startAfter(cursor)
  }
  const snapshot = await query.get()
  const docs = snapshot.docs.slice(0, STAFF_AI_CONVERSATIONS_PAGE)
  const next = snapshot.docs.length > STAFF_AI_CONVERSATIONS_PAGE ? docs[docs.length - 1]?.id ?? null : null
  return { docs, next }
}

async function readMembers(orgRef: OrgRef): Promise<Map<string, Record<string, unknown>>> {
  const snapshot = await orgRef.collection('members').limit(MEMBERS_SCAN).get()
  return new Map(snapshot.docs.map((doc) => [doc.id, doc.data() ?? {}]))
}

/** The documents `refs` name, by id, in one round trip; a missing one is absent. */
async function readAll(
  db: Firestore,
  refs: FirebaseFirestore.DocumentReference[],
): Promise<Map<string, Record<string, unknown>>> {
  if (!refs.length) return new Map()
  const snapshots = await db.getAll(...refs)
  return new Map(
    snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data() ?? {}]),
  )
}

/** The org a document under `orgs/{orgId}/…` is filed in. */
const orgOf = (doc: FirebaseFirestore.DocumentSnapshot): string | null =>
  doc.ref.parent.parent?.id ?? null

/**
 * One page of what ONE ACCOUNT asked Aglyn AI (AGL-3660), across every
 * organization it has asked in — including one it has since left, which is
 * the history a support question about it needs. Collection-group reads on
 * the creator, newest first (`firebase-firestore.indexes.json`).
 */
export async function readStaffAccountAiRequests(
  db: Firestore,
  uid: string,
  kind: StaffAiConversationKind,
  after: string | null,
): Promise<StaffAiConversationsResponse> {
  const group = kind === 'assist' ? 'assistExchanges' : 'aiJobs'
  const field = kind === 'assist' ? 'uid' : 'createdBy'
  let query = db
    .collectionGroup(group)
    .where(field, '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(STAFF_AI_CONVERSATIONS_PAGE + 1)
  if (after) {
    // The cursor is the document's PATH: an id is unique only within one org.
    const cursor = await db.doc(after).get()
    if (cursor.exists) query = query.startAfter(cursor)
  }
  const snapshot = await query.get()
  const docs = snapshot.docs.slice(0, STAFF_AI_CONVERSATIONS_PAGE)
  const next =
    snapshot.docs.length > STAFF_AI_CONVERSATIONS_PAGE ? (docs[docs.length - 1]?.ref.path ?? null) : null
  const none = new Map<string, Record<string, unknown>>()
  if (kind === 'assist') {
    const signals = await readAll(
      db,
      docs.map((doc) => doc.ref.parent.parent!.collection('assistSignals').doc(doc.id)),
    )
    return {
      kind,
      rows: docs.map((doc) => ({
        ...composeStaffAiAssistRow(doc.id, doc.data() ?? {}, signals.get(doc.id) ?? null, none),
        orgId: orgOf(doc),
      })),
      next,
    }
  }
  const results = await readJobResults(
    db,
    docs.map((doc) => ({ key: doc.ref.path, orgRef: doc.ref.parent.parent!, id: doc.id, kind: doc.get('kind') })),
  )
  return {
    kind,
    rows: docs.map((doc) => ({
      ...composeStaffAiJobRow(doc.id, doc.data() ?? {}, results.get(doc.ref.path) ?? null, none),
      orgId: orgOf(doc),
    })),
    next,
  }
}

/** The insight or CRM answer kept beside each job that keeps one, by the caller's key. */
async function readJobResults(
  db: Firestore,
  jobs: ReadonlyArray<{ key: string; orgRef: OrgRef; id: string; kind: unknown }>,
): Promise<Map<string, StaffAiJobResult | null>> {
  const wanted = jobs.flatMap((job) => {
    const collection = staffAiJobResultCollection(job.kind)
    return collection ? [{ ...job, collection, ref: job.orgRef.collection(collection).doc(job.id) }] : []
  })
  const out = new Map<string, StaffAiJobResult | null>()
  if (!wanted.length) return out
  // `getAll` answers in the order it was asked.
  const snapshots = await db.getAll(...wanted.map((job) => job.ref))
  wanted.forEach((job, index) => {
    const snapshot = snapshots[index]
    const data = snapshot?.exists ? (snapshot.data() ?? {}) : null
    out.set(job.key, job.collection === 'aiInsights' ? staffAiInsightResult(data) : staffAiCrmResult(data))
  })
  return out
}

/** One page of the org's conversations of `kind`. Exported for the spec. */
export async function readStaffAiConversations(
  db: Firestore,
  orgId: string,
  kind: StaffAiConversationKind,
  after: string | null,
): Promise<StaffAiConversationsResponse> {
  const orgRef = db.collection('orgs').doc(orgId)
  if (kind === 'assist') {
    const [{ docs, next }, members] = await Promise.all([readPage(orgRef, 'assistExchanges', after), readMembers(orgRef)])
    // The signal shares the exchange's id (AGL-1972): the route, the model, the cost and the thumbs.
    const signals = await readAll(db, docs.map((doc) => orgRef.collection('assistSignals').doc(doc.id)))
    return {
      kind,
      rows: docs.map((doc) => ({
        ...composeStaffAiAssistRow(doc.id, doc.data() ?? {}, signals.get(doc.id) ?? null, members),
        orgId,
      })),
      next,
    }
  }
  const [{ docs, next }, members] = await Promise.all([readPage(orgRef, 'aiJobs', after), readMembers(orgRef)])
  const insightIds = docs.filter((doc) => staffAiJobResultCollection(doc.get('kind')) === 'aiInsights').map((doc) => doc.id)
  const crmIds = docs.filter((doc) => staffAiJobResultCollection(doc.get('kind')) === 'aiCrmAnswers').map((doc) => doc.id)
  const [insights, crm] = await Promise.all([
    readAll(db, insightIds.map((id) => orgRef.collection('aiInsights').doc(id))),
    readAll(db, crmIds.map((id) => orgRef.collection('aiCrmAnswers').doc(id))),
  ])
  return {
    kind,
    rows: docs.map((doc) => {
      const collection = staffAiJobResultCollection(doc.get('kind'))
      const result =
        collection === 'aiInsights'
          ? staffAiInsightResult(insights.get(doc.id) ?? null)
          : collection === 'aiCrmAnswers'
            ? staffAiCrmResult(crm.get(doc.id) ?? null)
            : null
      return { ...composeStaffAiJobRow(doc.id, doc.data() ?? {}, result, members), orgId }
    }),
    next,
  }
}

/** One job of an org, as a one-row page — what an activity row's job link opens. */
export async function readStaffAiJob(
  db: Firestore,
  orgId: string,
  jobId: string,
): Promise<StaffAiConversationsResponse> {
  const orgRef = db.collection('orgs').doc(orgId)
  const [doc, members] = await Promise.all([orgRef.collection('aiJobs').doc(jobId).get(), readMembers(orgRef)])
  if (!doc.exists) return { kind: 'jobs', rows: [], next: null }
  const results = await readJobResults(db, [{ key: jobId, orgRef, id: jobId, kind: doc.get('kind') }])
  return {
    kind: 'jobs',
    rows: [{ ...composeStaffAiJobRow(doc.id, doc.data() ?? {}, results.get(jobId) ?? null, members), orgId }],
    next: null,
  }
}

async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const orgId = String(query.orgId ?? '')
  // An account's requests across every org (AGL-3660), for the staff
  // account page; exactly one of the two is the subject.
  const uid = String(query.uid ?? '')
  if (!orgId === !uid) return Response.json({ error: 'Pass orgId or uid' }, { status: 400 })
  // One job, for a link from an activity or audit row to the job behind it.
  const jobId = typeof query.jobId === 'string' && query.jobId ? query.jobId : null
  const kind = query.kind
  if (!isStaffAiConversationKind(kind)) {
    return Response.json({ error: 'kind must be assist or jobs' }, { status: 400 })
  }
  const after = typeof query.after === 'string' && query.after ? query.after : null

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const db = firebaseAdmin.app().firestore()
    if (uid) {
      const page = await readStaffAccountAiRequests(db, uid, kind, after)
      // Written before the words leave, as for an org; filed against the
      // account so its page's "Data access by staff" lists the read.
      await addAdminAudit(db, {
        actorUid: decoded.uid,
        action: USER_ACTION,
        target: `users/${uid}`,
        subjectUid: uid,
        before: null,
        after: { kind, rows: page.rows.length, after },
      })
      return Response.json(page, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (!(await db.collection('orgs').doc(orgId).get()).exists) {
      return Response.json({ error: 'No such organization' }, { status: 404 })
    }
    const page = jobId
      ? await readStaffAiJob(db, orgId, jobId)
      : await readStaffAiConversations(db, orgId, kind, after)
    // Written before the words leave: a read the log cannot record is not served.
    await addAdminAudit(db, {
      actorUid: decoded.uid,
      action: ACTION,
      target: `orgs/${orgId}`,
      before: null,
      after: { kind: jobId ? 'jobs' : kind, rows: page.rows.length, after, ...(jobId ? { jobId } : {}) },
    })
    return Response.json(page, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[ai/admin/conversations]', error)
    return Response.json({ error: 'The conversations could not be read.' }, { status: 500 })
  }
}

export { handler as GET }
