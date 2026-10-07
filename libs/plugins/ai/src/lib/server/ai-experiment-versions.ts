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
// The gate carries the org verdict; the handler adds the site's own below,
// with the host document in hand.

import {
  checkEntitlement,
  encodeStoredNodes,
  hostRoleCanWrite,
} from '@aglyn/aglyn/server'
import { pageContentRootId } from '@aglyn/aglyn/app-utils/page-markdown'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { lockdownRefusal } from '@aglyn/tenant-data-admin/server/lockdown'
import { getAiJob, writeAiJobAudit } from '../jobs/ai-jobs'
import type { AiJob } from '../model/ai-jobs.types'
import {
  readAiExperimentVariants,
  type AiExperimentVariantsProposalView,
} from '../model/ai-experiment-proposal'
import { applyAiExperimentVariantCopy } from '../runtime/experiment-variant-copy'
import { AI_SEO_APPLY_VERSIONING_COPY } from './ai-seo-apply'
import { aiJobsGate } from './ai-jobs-gate'

/**
 * A page's or a section's A/B variants as draft versions (AGL-3603):
 * `POST /api/ai/experiments/versions { orgId, hostId, jobId, screenId, nodeId? }`.
 *
 * An `experiment` job proposes the variants' copy. For an email that copy IS
 * the variant, and the editor holds it. For a page or a section the variant is
 * a version of the page, which the editor only pins — so this door makes one
 * per proposed variant past the first: the page's PUBLISHED version is
 * copied, the variant's headline and body are put into the region the test
 * varies (`runtime/experiment-variant-copy.ts`), and the copy is stored as a
 * new unpublished version named for the variant.
 *
 * ## Nothing goes live
 *
 * The published version, the screen's `versionId` and the experiment document
 * are never touched. The A/B testing editor pins each new version to its
 * variant as an unsaved change; the person reviews the versions, saves the
 * test and starts it. The first proposed variant is the copy as it stands, so
 * it is the control and pins the published version, as the editor's default
 * already does.
 *
 * ## The rungs
 *
 * The jobs read gate (membership, the release flag, `aiGenerative`, the org
 * lockdown); then the site — the job's and the org's — a role that writes the
 * site's content, the site's own lockdown verdict, and the `versioning`
 * entitlement, because a page that already has a version gains retained
 * history here, which is what that entitlement sells. Nothing spends a token.
 *
 * Idempotent: each version's id is derived from the job and the variant, so
 * a second press finds the versions the first made.
 */

const ID_CHARS = /^[A-Za-z0-9_-]{1,100}$/

/** The id a job's variant version is stored under. */
export function aiExperimentVersionId(jobId: string, index: number): string {
  return `ab-${jobId}-${index}`
}

/** What a version made from a variant is named in the versions list. */
export function aiExperimentVersionName(name: string, index: number): string {
  const label = name.replace(/\s+/g, ' ').trim() || `Variant ${index + 1}`
  return `A/B: ${label}`.slice(0, 80)
}

export interface AiExperimentVersionsInput {
  hostId: string
  screenId: string
  /** A section test's element; `null` for a page test. */
  nodeId: string | null
  job: Pick<AiJob, '$id'>
  proposal: AiExperimentVariantsProposalView
  uid: string
  now?: Date
}

export interface AiExperimentVersionsResult {
  /** One per variant past the control, in order. */
  versions: Array<{ index: number; name: string; versionId: string; changed: string[] }>
  skipped: Array<{ index: number; reason: string }>
  /** Why no version could be made at all, customer-safe; `null` when one could. */
  refusal: string | null
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Make the versions. Exported for the spec, which drives it against a Firestore double. */
export async function createAiExperimentVersions(
  firestore: FirebaseFirestore.Firestore,
  input: AiExperimentVersionsInput,
): Promise<AiExperimentVersionsResult> {
  const now = input.now ?? new Date()
  const screenRef = firestore.collection('hosts').doc(input.hostId).collection('screens').doc(input.screenId)
  const screen = await screenRef.get()
  const empty = (refusal: string): AiExperimentVersionsResult => ({ versions: [], skipped: [], refusal })
  if (!screen.exists || screen.get('deletedAt')) return empty('The page under test no longer exists.')
  const publishedId = str(screen.get('versionId'))
  const source = publishedId ? await screenRef.collection('versions').doc(publishedId).get() : null
  const sourceData = source?.exists ? (source.data() as Record<string, unknown>) : null
  const nodes = sourceData ? decodeStoredNodes<Record<string, unknown>>(sourceData['nodes']) : null
  if (!sourceData || !nodes) return empty('The page has no published version to start from.')
  const rootId = typeof sourceData['rootId'] === 'string' ? sourceData['rootId'] : undefined
  const regionRootId = input.nodeId ?? pageContentRootId(nodes as never, rootId)

  const versions: AiExperimentVersionsResult['versions'] = []
  const skipped: AiExperimentVersionsResult['skipped'] = []
  for (const [index, variant] of input.proposal.variants.entries()) {
    // The first variant is the copy as it stands: the control, on the published version.
    if (index === 0) continue
    const versionId = aiExperimentVersionId(input.job.$id, index)
    const name = aiExperimentVersionName(variant.name, index)
    const versionRef = screenRef.collection('versions').doc(versionId)
    const earlier = await versionRef.get()
    if (earlier.exists && !earlier.get('deletedAt')) {
      versions.push({ index, name: str(earlier.get('displayName')) || name, versionId, changed: [] })
      continue
    }
    const result = applyAiExperimentVariantCopy(
      nodes,
      { headline: variant.headline, body: variant.body },
      regionRootId,
    )
    if (!result.changed.length) {
      skipped.push({ index, reason: result.reason ?? 'Nothing on the page took the variant’s copy.' })
      continue
    }
    // Compressed at rest, as every write of a version's nodes is.
    const packed = encodeStoredNodes(result.nodes)
    await versionRef.set({
      ...sourceData,
      nodes: packed ? Buffer.from(packed) : result.nodes,
      displayName: name,
      createdAt: now,
      updatedAt: now,
      createdBy: input.uid,
    })
    versions.push({ index, name, versionId, changed: result.changed })
  }
  return { versions, skipped, refusal: null }
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>
  } catch {
    body = {}
  }
  const gate = await aiJobsGate(request, String(body['orgId'] ?? ''))
  if (gate instanceof Response) return gate
  const hostId = str(body['hostId'])
  const jobId = str(body['jobId'])
  const screenId = str(body['screenId'])
  const nodeId = str(body['nodeId']) || null
  if (!ID_CHARS.test(hostId) || !ID_CHARS.test(jobId) || !ID_CHARS.test(screenId)) {
    return Response.json({ error: 'Name the site, the page under test and the variants to make' }, { status: 400 })
  }
  if (nodeId !== null && !ID_CHARS.test(nodeId)) {
    return Response.json({ error: 'That is not a section of the page' }, { status: 400 })
  }
  const { firestore, orgId, uid, staff, org, decoded } = gate

  const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
  const host = hostSnapshot.exists ? (hostSnapshot.data() as Record<string, unknown>) : null
  if (!host || host['orgId'] !== orgId) {
    return Response.json({ error: 'Unknown site' }, { status: 404 })
  }
  const role = ((host['memberRoles'] ?? {}) as Record<string, unknown>)[uid]
  if (!staff && !hostRoleCanWrite(role)) {
    return Response.json({ error: 'Editing requires the editor role' }, { status: 403 })
  }
  const locked = await lockdownRefusal({
    request,
    staff,
    uid,
    org: org as Record<string, unknown>,
    host: host as never,
  })
  if (locked) return locked
  if (!checkEntitlement(org, 'versioning')) {
    return Response.json({ error: AI_SEO_APPLY_VERSIONING_COPY }, { status: 403 })
  }

  const job = await getAiJob(firestore, orgId, jobId)
  if (!job || job.kind !== 'experiment' || job.hostId !== hostId) {
    return Response.json({ error: 'Unknown variants' }, { status: 404 })
  }
  if (job.status !== 'done') {
    return Response.json({ error: 'The variants are still being written' }, { status: 409 })
  }
  const proposal = readAiExperimentVariants(
    (job.outputs ?? []).find((output) => output.resource === 'experiment')?.proposal,
  )
  if (!proposal || proposal.target === 'email') {
    return Response.json({ error: 'These variants are not a page’s or a section’s' }, { status: 409 })
  }
  if (proposal.target === 'section' && !nodeId) {
    return Response.json({ error: 'Pick the section under test first' }, { status: 400 })
  }

  const result = await createAiExperimentVersions(firestore, {
    hostId,
    screenId,
    nodeId: proposal.target === 'section' ? nodeId : null,
    job,
    proposal,
    uid,
  })
  if (result.refusal) return Response.json({ error: result.refusal }, { status: 409 })
  const made = result.versions.filter((entry) => entry.changed.length)
  if (made.length) {
    await writeAiJobAudit(firestore, {
      action: 'ai.job.apply',
      actorUid: uid,
      actorEmail: decoded.email ?? null,
      orgId,
      jobId,
      after: { hostId, screenId, versions: made.map((entry) => entry.versionId) },
    })
  }
  return Response.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } })
}

export const dynamic = 'force-dynamic'
