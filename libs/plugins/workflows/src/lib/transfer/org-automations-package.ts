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

/*==========================================
 * ORG AUTOMATIONS AS PACKAGE ITEMS (AGL-3535).
 *
 * An item is what an org automation does: its name, trigger, steps and
 * the sites it runs on. Never whether it is switched on, which sites
 * paused it, or who wrote it — so one exported and imported back is
 * `identical`, and an import never switches anything on.
 *
 * What it names: its sites (`site`), and what its steps reach — an email
 * list, a campaign, a dataset, a subscription topic, a member who owns or
 * is assigned. A step names a list, a campaign and a dataset by id AND by
 * name, and the engine finds one by its name when the id is empty — so a
 * dropped reference clears the id and keeps the name, and the step finds
 * the workspace's own list of that name when it runs.
 *
 * Pure: the server half (`org-automations-package.server.ts`) reads and
 * writes.
 *=========================================*/

import type { PackageDependency } from '@aglyn/aglyn/data-transfer/package'
import { remapPackageReference, TRANSFER_SITE_KIND } from '@aglyn/aglyn/data-transfer/package-plan'
import { hostIdsFromScope, hostScopeToken, ORG_SCOPE_TOKEN } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  orgAutomationStoredSharing,
  readOrgAutomation,
  type OrgAutomationFields,
} from '../model/org-automations'

/** The resource key, and so the kind every automation item carries. */
export const ORG_AUTOMATIONS_TRANSFER_KEY = 'workflows.org-automations'

/** The kinds a step's references are named under. */
export const ORG_AUTOMATION_REFERENCE_KINDS = {
  list: 'email.lists',
  campaign: 'marketing.campaigns',
  dataset: 'data.datasets',
  topic: 'email.topics',
  member: 'member',
} as const

/** An org automation as a package carries it. */
export type OrgAutomationPackageContent = Omit<OrgAutomationFields, 'enabled'>

type StepRecord = Record<string, unknown>

/** Each step field that names something, with the kind it names. */
const STEP_REFERENCES: ReadonlyArray<{ field: string; kind: string }> = [
  { field: 'listId', kind: ORG_AUTOMATION_REFERENCE_KINDS.list },
  { field: 'campaignId', kind: ORG_AUTOMATION_REFERENCE_KINDS.campaign },
  { field: 'datasetId', kind: ORG_AUTOMATION_REFERENCE_KINDS.dataset },
  { field: 'topicId', kind: ORG_AUTOMATION_REFERENCE_KINDS.topic },
  { field: 'ownerUid', kind: ORG_AUTOMATION_REFERENCE_KINDS.member },
  { field: 'assigneeUid', kind: ORG_AUTOMATION_REFERENCE_KINDS.member },
]

/**
 * The package content of a stored automation, or of an incoming item, read
 * by the save route's own reader — so an item the reader refuses is `null`
 * here and a problem at the dry run.
 */
export function orgAutomationPackageContent(source: unknown): OrgAutomationPackageContent | null {
  /*
   * A stored automation that runs on all sites except some carries that as the
   * sweep's marker, never as `sharing`. The package says it as the choice
   * (AGL-4047), so an import works the sites out from the workspace it lands
   * in, and a new site there gets it as it would here.
   */
  const stored = source && typeof source === 'object' && !('sharing' in source)
    ? orgAutomationStoredSharing(source as Record<string, unknown>)
    : null
  const read = readOrgAutomation(stored ? { ...(source as Record<string, unknown>), sharing: stored } : source)
  if (read.ok === false) return null
  const { name, trigger, steps, visibleTo, sharing } = read.value
  return { name, trigger, steps, visibleTo, ...(sharing?.mode === 'allExcept' ? { sharing } : {}) }
}

/** The incoming content as stored, before it is judged: whatever the file holds, shaped like an automation. */
export function rawOrgAutomationContent(source: unknown): OrgAutomationPackageContent {
  const raw = (source && typeof source === 'object' ? source : {}) as Partial<OrgAutomationPackageContent>
  return {
    name: String(raw.name ?? ''),
    trigger: (raw.trigger ?? { event: '', conditions: null, combinator: null }) as OrgAutomationPackageContent['trigger'],
    steps: Array.isArray(raw.steps) ? raw.steps : [],
    visibleTo: Array.isArray(raw.visibleTo) ? raw.visibleTo : [],
    ...(raw.sharing ? { sharing: raw.sharing } : {}),
  }
}

/** The sites an all-sites-except automation leaves out, or none. */
function exceptHostIdsOf(content: OrgAutomationPackageContent): readonly string[] {
  return content.sharing?.mode === 'allExcept' ? content.sharing.exceptHostIds : []
}

export function orgAutomationDependencies(content: OrgAutomationPackageContent): PackageDependency[] {
  const deps: PackageDependency[] = []
  const seen = new Set<string>()
  const add = (kind: string, id: unknown) => {
    if (typeof id !== 'string' || !id.trim() || seen.has(`${kind}/${id}`)) return
    seen.add(`${kind}/${id}`)
    deps.push({ kind, id })
  }
  for (const hostId of hostIdsFromScope(content.visibleTo)) add(TRANSFER_SITE_KIND, hostId)
  for (const hostId of exceptHostIdsOf(content)) add(TRANSFER_SITE_KIND, hostId)
  for (const step of content.steps ?? []) {
    for (const { field, kind } of STEP_REFERENCES) add(kind, (step as unknown as StepRecord)[field])
  }
  return deps
}

/**
 * The automation with every reference moved through `idMap`. A dropped site
 * leaves the placement; a dropped step reference clears its id and keeps
 * its name (see the block header).
 */
export function remapOrgAutomationIds(
  content: OrgAutomationPackageContent,
  idMap: ReadonlyMap<string, string>,
): OrgAutomationPackageContent {
  const visibleTo = content.visibleTo.flatMap((token) => {
    if (token === ORG_SCOPE_TOKEN) return [token]
    const [hostId] = hostIdsFromScope([token])
    if (!hostId) return [token]
    const mapped = remapPackageReference(idMap, TRANSFER_SITE_KIND, hostId)
    return mapped ? [hostScopeToken(mapped)] : []
  })
  const steps = (content.steps ?? []).map((step) => {
    const record = { ...(step as unknown as StepRecord) }
    for (const { field, kind } of STEP_REFERENCES) {
      const id = record[field]
      if (typeof id !== 'string' || !id) continue
      record[field] = remapPackageReference(idMap, kind, id) ?? ''
    }
    return record as unknown as OrgAutomationPackageContent['steps'][number]
  })
  /*
   * A site left out that the plan drops stays out of nothing: it is not
   * there. If none is left, the reader refuses it rather than run it on
   * every site (AGL-4047).
   */
  const sharing =
    content.sharing?.mode === 'allExcept'
      ? {
          sharing: {
            mode: 'allExcept' as const,
            exceptHostIds: exceptHostIdsOf(content).flatMap((hostId) => {
              const mapped = remapPackageReference(idMap, TRANSFER_SITE_KIND, hostId)
              return mapped ? [mapped] : []
            }),
          },
        }
      : {}
  return { ...content, visibleTo: visibleTo as OrgAutomationPackageContent['visibleTo'], steps, ...sharing }
}

export const ORG_AUTOMATION_PACKAGE_RULES = [
  {
    id: 'off',
    label: 'An imported automation arrives switched off',
    reason:
      'An automation acts on every site it runs on the moment it is on, so an import never switches one on. One you replace keeps whether it was on.',
  },
  {
    id: 'pauses',
    label: 'Each site’s own pause stays',
    reason: 'Pausing an automation is a site’s own decision, so a replace keeps the sites that paused it, and nothing about pausing travels in a package.',
  },
] as const
