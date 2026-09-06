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

/**
 * `/v1/pipelines` (AGL-2606) — the stages a deal moves through, read-only.
 *
 * A pipeline is how one business sells, and its stages are named by the
 * people who sell that way; the API reads them so a deal can be created in
 * the right one and never edits them. What it does do is SEED one: an
 * organization that has never opened the CRM has no pipeline, and a deal
 * cannot exist without a stage, so the first deal created without naming a
 * pipeline gets a default one built from `DEFAULT_DEAL_STAGES` — the same
 * set a console would seed — stamped for the site that deal names.
 *
 * An ARCHIVED pipeline (AGL-2620) is still read — the deals it closed name
 * it — but it takes no new deal: a create that names one is refused, and
 * the default is picked among the active ones.
 */
import {
  CRM_COLLECTIONS,
  type CrmDealStage,
  type CrmPipeline,
  createResourceUid,
  consentGroupForHost,
  crmScopeTokens,
  DEFAULT_DEAL_STAGES,
  isPipelineArchived,
} from '@aglyn/aglyn/server'
import { apiJson, ApiErrors } from '@aglyn/tenant-data-admin'
import { FieldPath } from 'firebase-admin/firestore'
import { type ApiV1Context, requireScope } from '../api-v1'
import { crmCollection, crmCreateStamp, crmTimes, isoFromMs, listCrm } from './crm-shared'

/** Stages in pipeline order, whatever order the document holds them in. */
export function orderedStages(pipeline: Pick<CrmPipeline, 'stages'>): CrmDealStage[] {
  return [...(pipeline.stages ?? [])].sort((a, b) => a.order - b.order)
}

/** The pipeline object as published. */
export function pipelineView(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = (doc.data() ?? {}) as Partial<CrmPipeline>
  return {
    id: doc.id,
    object: 'pipeline',
    name: data.name ?? null,
    isDefault: data.isDefault === true,
    archived: isPipelineArchived(data),
    archivedAt: isPipelineArchived(data) ? isoFromMs(data.archivedAt) : null,
    stages: orderedStages({ stages: data.stages ?? [] }).map((stage) => ({
      id: stage.id,
      name: stage.name,
      order: stage.order,
      probability: stage.probability,
      kind: stage.kind,
    })),
    siteId: data.hostId ?? null,
    ...crmTimes(data as FirebaseFirestore.DocumentData),
  }
}

/** A pipeline as the deal handlers use it: its id beside its stages. */
export interface ResolvedPipeline {
  id: string
  pipeline: CrmPipeline
}

/**
 * The pipeline a deal lands in.
 *
 * Named → that one, or a refusal naming `pipelineId`. Unnamed → the default
 * among the pipelines VISIBLE FROM the deal's site, because a pipeline is
 * scoped like every CRM row and a deal in a pipeline its own site cannot
 * read is a deal the console renders with no stage. The visibility query is
 * one `array-contains-any` on the site's own tokens, and the default is
 * picked in memory: `isDefault` first, then the lowest id, so two consoles
 * seeding at once still agree. None at all → one is created here.
 */
export async function resolvePipeline(
  ctx: ApiV1Context,
  siteId: string,
  pipelineId: string | undefined,
  options: { allowArchived?: boolean } = {},
): Promise<ResolvedPipeline | { error: string }> {
  const collection = crmCollection(ctx, CRM_COLLECTIONS.pipelines)
  if (pipelineId) {
    const snap = await collection.doc(pipelineId).get()
    if (!snap.exists) return { error: 'No such pipeline in this organization' }
    const pipeline = snap.data() as CrmPipeline
    if (!options.allowArchived && isPipelineArchived(pipeline)) {
      return { error: 'This pipeline is archived — create the deal in an active one' }
    }
    return { id: snap.id, pipeline }
  }
  const org = ctx.org as Record<string, unknown>
  const tokens = crmScopeTokens(org, consentGroupForHost(org, siteId))
  // Ordered, because a `limit()` with no `orderBy` is a random sample: fifty
  // is more pipelines than any org has, but the bound has to be a bound.
  const visible = await collection
    .where('visibleTo', 'array-contains-any', tokens)
    .orderBy(FieldPath.documentId())
    .limit(50)
    .get()
  const candidates = [...visible.docs]
    .filter((doc) => !isPipelineArchived(doc.data() as CrmPipeline))
    .sort((a, b) => a.id.localeCompare(b.id))
  const chosen =
    candidates.find((doc) => doc.get('isDefault') === true) ?? candidates[0]
  if (chosen) return { id: chosen.id, pipeline: chosen.data() as CrmPipeline }

  const id = createResourceUid()
  const seeded: CrmPipeline = {
    name: 'Sales',
    // A COPY: the module's default set must stay what the next seed starts
    // from once a merchant edits this pipeline's stages.
    stages: DEFAULT_DEAL_STAGES.map((stage) => ({ ...stage })),
    isDefault: true,
    archivedAt: null,
    ...crmCreateStamp(ctx, siteId),
  }
  await collection.doc(id).create(seeded)
  return { id, pipeline: seeded }
}

export async function handlePipelines(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const denied = requireScope(ctx, 'crm:read')
  if (denied) return denied
  if (request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'GET' },
    })
  }
  const collection = crmCollection(ctx, CRM_COLLECTIONS.pipelines)
  const [, pipelineId] = segments
  if (!pipelineId) return listCrm(ctx, collection, url, [], pipelineView)
  const snap = await collection.doc(pipelineId).get()
  if (!snap.exists) {
    return ApiErrors.notFound({ message: 'No such pipeline', headers: ctx.headers })
  }
  return apiJson(pipelineView(snap), { headers: ctx.headers })
}
