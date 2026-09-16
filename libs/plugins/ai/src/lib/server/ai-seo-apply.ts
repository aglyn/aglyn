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
  createResourceUid,
  encodeStoredNodes,
  hostRoleCanWrite,
} from '@aglyn/aglyn/server'
import { pageContentRootId } from '@aglyn/aglyn/app-utils/page-markdown'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { lockdownRefusal } from '@aglyn/tenant-data-admin/server/lockdown'
import { logAiSeoApplied } from '../activity/ai-activity'
import {
  aiJobSummary,
  getAiJob,
  recordAiJobApplied,
  writeAiJobAudit,
} from '../jobs/ai-jobs'
import type { AiJob, AiJobApplied } from '../model/ai-jobs.types'
import { aiSeoAuditView, aiSeoJobTarget, type AiSeoAuditView } from '../model/ai-seo'
import { applyAiSeoContentFixes } from '../runtime/seo-content-fixes'
import { aiJobsGate } from './ai-jobs-gate'

/**
 * Apply a site audit (AGL-2910): `POST /api/ai/seo/apply { orgId, hostId, jobId }`.
 *
 * "Apply all" does two things and neither changes what the published site
 * serves.
 *
 * - **Content fixes open a NEW version per page.** The page's published
 *   version is copied, the fixes are applied to the copy — an image
 *   description, the page's one main heading — and the copy is stored as a
 *   new unpublished version. The published version and the screen's
 *   `versionId` are never touched: a person opens the draft, looks, and
 *   publishes it through the door that already exists.
 * - **Listing values are STAGED, not written.** A page's search title and
 *   description are served straight from the screen document, so writing
 *   them would publish them. The apply records which pages have values
 *   waiting; the page's SEO card offers them, and its Save SEO is the write.
 *
 * The site-wide proposals — structured data and the agent guidance — are the
 * site SEO form's to save, and the card puts them there as unsaved edits; this
 * door never writes the host document.
 *
 * Idempotent per job: a page this job already opened a version for keeps
 * that version, so a second press opens nothing new.
 *
 * ## The rungs
 *
 * The jobs read gate (membership, the release flag, `aiGenerative`, the org
 * lockdown), then the site: it must be the job's and the org's, the caller
 * must hold a role that writes the site's content — the role creating a
 * version asks for — and the site's own lockdown verdict must admit a write.
 * Nothing here spends a token, so there is no reservation.
 */

const ID_CHARS = /^[A-Za-z0-9_-]{1,100}$/

/** The version history sentence the versions route gives, for a plan without it. */
export const AI_SEO_APPLY_VERSIONING_COPY =
  'Version history requires a Pro plan — see Billing to upgrade'

export interface AiSeoApplyInput {
  orgId: string
  hostId: string
  job: AiJob
  view: AiSeoAuditView
  uid: string
  /** Whether the org's plan keeps more than one version of a page. */
  versioning: boolean
  now?: Date
}

export interface AiSeoApplyResult {
  job: AiJob
  /** The version each page's content fixes went into; `fixes` is 0 for one opened by an earlier apply. */
  versions: Array<{ screenId: string; versionId: string; name: string; fixes: number }>
  /** Pages whose listing values wait in their SEO card. */
  staged: string[]
  skipped: Array<{ screenId: string; reason: string }>
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * Open the versions and record the apply. Exported for the spec, which drives
 * it against a Firestore double and proves what it leaves alone.
 */
export async function applyAiSeoAudit(
  firestore: FirebaseFirestore.Firestore,
  input: AiSeoApplyInput,
): Promise<AiSeoApplyResult> {
  const now = input.now ?? new Date()
  const hostRef = firestore.collection('hosts').doc(input.hostId)
  const opened = { ...(input.job.applied?.versions ?? {}) }
  const staged = new Set(input.job.applied?.staged ?? [])
  const names = new Map(input.view.report.pages.map((page) => [page.screenId, page.name]))
  const versions: AiSeoApplyResult['versions'] = []
  const skipped: AiSeoApplyResult['skipped'] = []

  for (const fix of Object.values(input.view.fixes)) {
    const screenId = fix.screenId
    const name = names.get(screenId) ?? screenId
    if (Object.keys(fix.values).length) staged.add(screenId)
    if (!fix.content.length) continue
    const screenRef = hostRef.collection('screens').doc(screenId)

    const earlier = opened[screenId]
    if (earlier && (await screenRef.collection('versions').doc(earlier).get()).exists) {
      versions.push({ screenId, versionId: earlier, name, fixes: 0 })
      continue
    }
    if (!input.versioning) {
      skipped.push({ screenId, reason: AI_SEO_APPLY_VERSIONING_COPY })
      continue
    }
    const screenSnapshot = await screenRef.get()
    if (!screenSnapshot.exists || screenSnapshot.get('deletedAt')) {
      skipped.push({ screenId, reason: 'The page no longer exists.' })
      continue
    }
    const publishedId = str(screenSnapshot.get('versionId'))
    const source = publishedId ? await screenRef.collection('versions').doc(publishedId).get() : null
    const sourceData = source?.exists ? (source.data() as Record<string, unknown>) : null
    const nodes = sourceData ? decodeStoredNodes<Record<string, unknown>>(sourceData['nodes']) : null
    if (!sourceData || !nodes) {
      skipped.push({ screenId, reason: 'The page has no published version to start from.' })
      continue
    }
    const rootId = typeof sourceData['rootId'] === 'string' ? sourceData['rootId'] : undefined
    const result = applyAiSeoContentFixes(
      nodes,
      fix.content,
      pageContentRootId(nodes as never, rootId),
    )
    if (!result.applied.length) {
      skipped.push({ screenId, reason: result.skipped[0]?.reason ?? 'Nothing on the page needed changing.' })
      continue
    }
    const versionId = createResourceUid()
    // Compressed at rest, as every write of a version's nodes is.
    const packed = encodeStoredNodes(result.nodes)
    await screenRef
      .collection('versions')
      .doc(versionId)
      .create({
        ...sourceData,
        nodes: packed ? Buffer.from(packed) : result.nodes,
        displayName: 'SEO fixes',
        createdAt: now,
        updatedAt: now,
        createdBy: input.uid,
      })
    opened[screenId] = versionId
    versions.push({ screenId, versionId, name, fixes: result.applied.length })
  }

  const applied: AiJobApplied = {
    // The Admin SDK stores a `Date` as the timestamp the type describes.
    at: now as unknown as AiJobApplied['at'],
    by: input.uid,
    versions: opened,
    staged: [...staged],
  }
  const job = await recordAiJobApplied(firestore, input.orgId, input.job.$id, applied, now)
  return { job, versions, staged: [...staged], skipped }
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
  if (!ID_CHARS.test(hostId) || !ID_CHARS.test(jobId)) {
    return Response.json({ error: 'Name the site and the audit to apply' }, { status: 400 })
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

  const job = await getAiJob(firestore, orgId, jobId)
  if (!job || job.kind !== 'seo' || job.hostId !== hostId || aiSeoJobTarget(job.inputs) !== 'site') {
    return Response.json({ error: 'Unknown audit' }, { status: 404 })
  }
  if (job.status !== 'done') {
    return Response.json({ error: 'The audit is still running — apply it once it has finished' }, { status: 409 })
  }
  const view = aiSeoAuditView(job.outputs ?? [])
  if (!view) {
    return Response.json({ error: 'This audit has nothing to apply' }, { status: 409 })
  }

  const result = await applyAiSeoAudit(firestore, {
    orgId,
    hostId,
    job,
    view,
    uid,
    versioning: checkEntitlement(org, 'versioning'),
  })
  const opened = result.versions.filter((entry) => entry.fixes > 0)
  await writeAiJobAudit(firestore, {
    action: 'ai.job.apply',
    actorUid: uid,
    actorEmail: decoded.email ?? null,
    orgId,
    jobId,
    after: {
      hostId,
      versions: Object.fromEntries(opened.map((entry) => [entry.screenId, entry.versionId])),
      staged: result.staged,
    },
  })
  if (opened.length || result.staged.length) {
    await logAiSeoApplied(orgId, { uid, email: decoded.email ?? null }, {
      jobId,
      hostId,
      hostName: str(host['displayName']) || null,
      versions: opened.length,
      staged: result.staged.length,
    }).catch((error) => console.error('ai seo apply activity failed', { orgId, jobId, error }))
  }
  return Response.json(
    {
      job: aiJobSummary(result.job),
      versions: result.versions,
      staged: result.staged,
      skipped: result.skipped,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}

export const dynamic = 'force-dynamic'
