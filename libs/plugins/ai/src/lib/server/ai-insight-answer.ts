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

// lockdown-423: via libs/plugins/ai/src/lib/server/ai-jobs-gate.ts
// The GET climbs `aiJobsGate`, whose lockdown rung is the verdict.

import { hostRoleFor } from '@aglyn/aglyn/app-utils/organizations'
import type { AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import {
  AI_INSIGHTS_COLLECTION,
  type AiInsightAnswerWire,
  type AiInsightRecord,
} from '../model/ai-insight'
import { aiJobsGate } from './ai-jobs-gate'

/**
 * One insight answer (AGL-2915): `GET /api/ai/insights/{jobId}?orgId=`.
 *
 * The figures an insight job read are not on the job document, which every
 * member of the workspace may read: they are in the org's `aiInsights`
 * collection under the job's id, which no rule lets a client read, and this
 * door is the one way to them. It climbs the jobs read gate — the release flag, the `aiGenerative`
 * entitlement and the lockdown verdict — and then answers only:
 *
 *  - the member who asked the question, while they still reach its site;
 *  - for a weekly digest, which no one asked, any member who reaches its site;
 *  - staff.
 *
 * Anyone else is told the answer does not exist, as a job they cannot read is.
 */

const ID = /^[A-Za-z0-9_-]{1,128}$/

const notFound = () => Response.json({ error: 'Not found' }, { status: 404 })

/** Whether this member may read this answer; `member` is `null` for a caller with no membership. */
export function aiInsightAnswerReadable(
  record: Pick<AiInsightRecord, 'createdBy' | 'hostId' | 'surface'>,
  caller: { uid: string; staff: boolean; member: Partial<AglynOrgMember> | null },
): boolean {
  if (caller.staff) return true
  if (!caller.member) return false
  const reachesSite = record.hostId ? hostRoleFor(caller.member, record.hostId) !== null : true
  if (!reachesSite) return false
  return record.createdBy === caller.uid || record.surface === 'digest'
}

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const url = new URL(request.url)
  const gate = await aiJobsGate(request, url.searchParams.get('orgId') ?? '')
  if (gate instanceof Response) return gate
  const { jobId } = await context.params
  if (!ID.test(jobId)) return notFound()
  const orgRef = gate.firestore.collection('orgs').doc(gate.orgId)
  const [answer, member] = await Promise.all([
    orgRef.collection(AI_INSIGHTS_COLLECTION).doc(jobId).get(),
    orgRef.collection('members').doc(gate.uid).get(),
  ])
  if (!answer.exists) return notFound()
  const record = answer.data() as AiInsightRecord & { expiresAt?: unknown }
  const readable = aiInsightAnswerReadable(record, {
    uid: gate.uid,
    staff: gate.staff,
    member: member.exists ? (member.data() as Partial<AglynOrgMember>) : null,
  })
  if (!readable) return notFound()
  // The expiry is the retention clock's, not the reader's.
  const wire: Record<string, unknown> = { ...record }
  delete wire['expiresAt']
  return Response.json(
    { answer: wire as unknown as AiInsightAnswerWire },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}

export const dynamic = 'force-dynamic'
