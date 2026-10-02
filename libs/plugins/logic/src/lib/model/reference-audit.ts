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

import type { InteractionStepBase, SiteInteraction } from '@aglyn/aglyn'
import type { HostVariable } from '@aglyn/aglyn'

/**
 * Reference-integrity audit (wave v7): id references (AGL-261) are
 * rename-safe but not delete-safe — deleting a workflow leaves actions
 * pointing at nothing, and the executors fail silently at run time.
 * This pure audit cross-checks every reference an automation, workflow,
 * or computed variable holds against the ids/names that still exist,
 * so the console can surface broken wiring before a visitor hits it.
 */
export interface ReferenceIssue {
  /** What holds the broken reference. */
  source: 'action' | 'workflow' | 'variable' | 'screen'
  sourceId: string
  /** Display name of the holder. */
  sourceName: string
  /** What the reference points at ("workflow", "dataset", …). */
  refType: string
  /** The dangling id or name as stored. */
  missing: string
}

/** A screen's composed nodes, for canvas-reference auditing (AGL-345). */
export interface ScreenAuditEntry {
  $id: string
  name?: string
  nodes: Record<string, { props?: Record<string, unknown> } | undefined>
}

/**
 * A stored workflow, as far as the audit reads one: its name and the function
 * each step calls, by id and by the name it had when the step was written.
 */
export interface AuditedWorkflow {
  $id: string
  name?: string
  steps?: Array<{ functionId?: string; functionName?: string }>
}

/**
 * A site variable as the audit reads one: computed variables also carry the
 * workflow that computes them, by id and by the name it had when picked.
 */
export interface AuditedVariable extends HostVariable {
  $id: string
  workflowId?: string
  workflowName?: string
}

/**
 * A stored automation step, as this audit reads it (AGL-3080): whatever its
 * type, the references a step that acts on a record may carry, each by id and
 * by the name it had when picked. The step vocabulary is the workflows
 * plugin's; the audit reads only these fields of it.
 */
export interface AuditedActionStep extends InteractionStepBase {
  workflowId?: string
  workflowName?: string
  datasetId?: string
  datasetName?: string
  listId?: string
  listName?: string
  campaignId?: string
  campaignName?: string
  overlayId?: string
  overlayName?: string
  webhookId?: string
  webhookName?: string
  screenId?: string
}

/** A stored automation, as this audit reads it. */
export interface AuditedAction extends SiteInteraction<AuditedActionStep> {
  $id: string
}

export interface ReferenceAuditInput {
  actions?: AuditedAction[]
  workflows?: AuditedWorkflow[]
  variables?: AuditedVariable[]
  /** Screen node maps to scan for entity/screen-link references. */
  screens?: ScreenAuditEntry[]
  /** Known-good targets: doc ids AND display names both resolve. */
  known: {
    workflows?: Set<string>
    functions?: Set<string>
    datasets?: Set<string>
    lists?: Set<string>
    campaigns?: Set<string>
    overlays?: Set<string>
    webhooks?: Set<string>
    /** New reference kinds (AGL-345). */
    screens?: Set<string>
    products?: Set<string>
    collections?: Set<string>
    categories?: Set<string>
  }
}

const resolves = (
  known: Set<string> | undefined,
  id?: string,
  name?: string,
): boolean => {
  const cleanId = id?.trim()
  const cleanName = name?.trim()
  if (!cleanId && !cleanName) return true // Nothing referenced.
  if (!known) return true // Target kind not loaded — don't cry wolf.
  return Boolean(
    (cleanId && known.has(cleanId)) || (cleanName && known.has(cleanName)),
  )
}

export function auditHostReferences(
  input: ReferenceAuditInput,
): ReferenceIssue[] {
  const issues: ReferenceIssue[] = []
  const { known } = input

  for (const action of input.actions ?? []) {
    const push = (refType: string, missing: string) =>
      issues.push({
        source: 'action',
        sourceId: action.$id,
        sourceName: action.name ?? action.$id,
        refType,
        missing,
      })
    for (const step of action.steps ?? []) {
      if (step.type === 'runWorkflow') {
        if (!resolves(known.workflows, step.workflowId, step.workflowName)) {
          push('workflow', step.workflowId || step.workflowName || '')
        }
      } else if (
        step.type === 'datasetAppend' ||
        step.type === 'updateDataset'
      ) {
        if (!resolves(known.datasets, step.datasetId, step.datasetName)) {
          push('dataset', step.datasetId || step.datasetName || '')
        }
      } else if (step.type === 'enrollList') {
        if (!resolves(known.lists, step.listId, step.listName)) {
          push('list', step.listId || step.listName || '')
        }
      } else if (step.type === 'assignCampaign') {
        if (!resolves(known.campaigns, step.campaignId, step.campaignName)) {
          push('campaign', step.campaignId || step.campaignName || '')
        }
      } else if (step.type === 'showOverlay') {
        if (!resolves(known.overlays, step.overlayId, step.overlayName)) {
          push('overlay', step.overlayId || step.overlayName || '')
        }
      } else if (step.type === 'webhookPost') {
        if (!resolves(known.webhooks, step.webhookId, step.webhookName)) {
          push('webhook', step.webhookId || step.webhookName || '')
        }
      } else if (step.type === 'redirect') {
        // Screen-id redirects (AGL-339) go stale when the screen is
        // deleted/unpublished.
        if (!resolves(known.screens, step.screenId)) {
          push('screen', step.screenId || '')
        }
      }
    }
  }

  for (const workflow of input.workflows ?? []) {
    for (const step of workflow.steps ?? []) {
      if (!resolves(known.functions, step.functionId, step.functionName)) {
        issues.push({
          source: 'workflow',
          sourceId: workflow.$id,
          sourceName: workflow.name ?? workflow.$id,
          refType: 'function',
          missing: step.functionId || step.functionName || '',
        })
      }
    }
  }

  for (const variable of input.variables ?? []) {
    if (!resolves(known.workflows, variable.workflowId, variable.workflowName)) {
      issues.push({
        source: 'variable',
        sourceId: variable.$id,
        sourceName: variable.name ?? variable.$id,
        refType: 'workflow',
        missing: variable.workflowId || variable.workflowName || '',
      })
    }
  }

  // Canvas node references (AGL-345): screen links, commerce entities,
  // and repeat datasets persisted in component props.
  const NODE_PROP_TARGETS: Array<{
    prop: string
    refType: string
    known: Set<string> | undefined
  }> = [
    { prop: 'screenId', refType: 'screen', known: known.screens },
    { prop: 'productId', refType: 'product', known: known.products },
    { prop: 'collectionId', refType: 'collection', known: known.collections },
    { prop: 'categoryId', refType: 'category', known: known.categories },
    { prop: 'repeatDataset', refType: 'dataset', known: known.datasets },
  ]
  for (const screen of input.screens ?? []) {
    for (const node of Object.values(screen.nodes ?? {})) {
      const props = node?.props ?? {}
      for (const target of NODE_PROP_TARGETS) {
        const value = props[target.prop]
        if (typeof value !== 'string' || !value.trim()) continue
        if (!resolves(target.known, value)) {
          issues.push({
            source: 'screen',
            sourceId: screen.$id,
            sourceName: screen.name ?? screen.$id,
            refType: target.refType,
            missing: value,
          })
        }
      }
    }
  }

  return issues
}
