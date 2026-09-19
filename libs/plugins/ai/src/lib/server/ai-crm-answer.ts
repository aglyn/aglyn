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

import {
  AI_CRM_ANSWERS_COLLECTION,
  AI_CRM_FACTS_RESOURCES,
  AI_CRM_IMPORT_FACTS_RESOURCE,
  readAiCrmProposal,
  type AiCrmAnswerRecord,
  type AiCrmAnswerWire,
  type AiCrmProposal,
} from '../model/ai-crm'
import { aiCrmAccessRefusal } from '../jobs/ai-crm-access'
import { aiJobsGate } from './ai-jobs-gate'

/**
 * One CRM answer (AGL-2917): `GET /api/ai/crm/{jobId}?orgId=`.
 *
 * What a `crm` job wrote from a record is not on the job document, which
 * every member of the workspace may read: it is in the org's `aiCrmAnswers`
 * collection under the job's id, which no rule lets a client read, and this
 * door is the one way to it. It climbs the jobs read gate — the release flag,
 * the `aiGenerative` entitlement and the lockdown verdict — and then answers:
 *
 *  - a record's summary to any member the CRM lets read the record, since
 *    the summary is the record's, asked once while its timeline is unchanged;
 *  - an email draft or an import's matches only to the member who asked,
 *    since each was written from what that member typed or chose;
 *  - staff, as the CRM lets staff read a record.
 *
 * Either way the CRM is asked again, as the member reading, before anything
 * is served: a member who lost the record since, or a workspace that switched
 * the CRM off, is told the answer does not exist, as a job they cannot read is.
 */

const ID = /^[A-Za-z0-9_-]{1,128}$/

const notFound = () => Response.json({ error: 'Not found' }, { status: 404 })

/** The CRM resource and record an answer was written from, by what it answers. */
export function aiCrmAnswerSubject(proposal: AiCrmProposal): { resource: string; id: string } {
  return proposal.kind === 'mapping'
    ? { resource: AI_CRM_IMPORT_FACTS_RESOURCE, id: proposal.collection }
    : { resource: AI_CRM_FACTS_RESOURCES[proposal.record.kind], id: proposal.record.id }
}

/** Whether an answer of this kind may be read by anyone other than the member who asked. */
export function aiCrmAnswerShared(proposal: AiCrmProposal): boolean {
  return proposal.kind === 'record'
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
  const answer = await gate.firestore
    .collection('orgs')
    .doc(gate.orgId)
    .collection(AI_CRM_ANSWERS_COLLECTION)
    .doc(jobId)
    .get()
  if (!answer.exists) return notFound()
  const record = (answer.data() ?? {}) as Partial<AiCrmAnswerRecord>
  const proposal = readAiCrmProposal(record.proposal)
  if (!proposal || typeof record.createdBy !== 'string') return notFound()
  if (!gate.staff && !aiCrmAnswerShared(proposal) && record.createdBy !== gate.uid) return notFound()
  const refusal = await aiCrmAccessRefusal({
    firestore: gate.firestore,
    orgId: gate.orgId,
    hostId: record.hostId ?? null,
    ...aiCrmAnswerSubject(proposal),
    org: gate.org,
    uid: gate.uid,
    staff: gate.staff,
  })
  if (refusal) return notFound()
  const wire: AiCrmAnswerWire = {
    jobId,
    hostId: record.hostId ?? null,
    createdBy: record.createdBy,
    proposal,
  }
  return Response.json({ answer: wire }, { status: 200, headers: { 'Cache-Control': 'no-store' } })
}

export const dynamic = 'force-dynamic'
