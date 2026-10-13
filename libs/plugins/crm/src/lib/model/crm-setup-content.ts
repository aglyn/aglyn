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

// Modules by their own paths, never the `@aglyn/aglyn` barrel: the console
// server's boot reaches this file through the CRM's setup writers.
import {
  CONTACT_FIELD_TYPES,
  CONTACT_FIELDS_MAX_PER_ORG,
  fieldDefinitionsForObject,
  isContactFieldType,
} from '@aglyn/aglyn/app-utils/contact-custom-fields'
import {
  type ContactFieldDefinition,
  type ContactFieldType,
  type CrmDealStage,
  type CrmFieldObject,
  CRM_FIELD_OBJECT_LABELS,
  CRM_FIELD_OBJECTS,
  crmFieldListFields,
  DEFAULT_DEAL_STAGES,
  isCrmFieldObject,
  normalizeContactFieldKey,
} from '@aglyn/aglyn/app-utils/crm'
import type { PluginDraftCheck } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import {
  activePipelines,
  clampProbability,
  newPipelineDocument,
  newStageId,
  PIPELINE_NAME_MAX,
  type PipelineDoc,
  type PipelineWriteContext,
  pipelineNameProblem,
  renumberStages,
  sortedStages,
  stagesProblem,
} from './deal-board-model'

/**
 * CRM SETUP ANOTHER PLUGIN ASKS FOR (AGL-3746): a deal pipeline with its
 * stages, and a custom field on a CRM object — what a person sets up in
 * CRM → Deals → Pipelines and CRM → Fields, as pure rules.
 *
 * Aglyn AI's build asks for them through the CRM's writers on the
 * resource-drafts seam (`server/crm-setup-writers.server.ts`). Neither has a
 * draft state: a pipeline and a field are in use once saved, as the console's
 * own saves are. So every rule here is the console's, read from the modules
 * the console reads:
 *
 *  - A PIPELINE is `newPipelineDocument` with the stages asked for in place
 *    of the default set, held to `stagesProblem` (exactly one Won and one
 *    Lost, at least one open stage) and named under `pipelineNameProblem`
 *    (unique among the active pipelines, without case). Stage ids are
 *    `newStageId`'s slugs.
 *  - A FIELD is the Fields section's create: a key derived from the label by
 *    `normalizeContactFieldKey`, one of `CONTACT_FIELD_TYPES`, the choices
 *    the drawer allows, landing last on its object's tab, org-wide.
 *
 * IDEMPOTENT BY NAME. Asked twice, nothing is made twice: an active pipeline
 * is matched by name and a stage within it by name, a field by label or key
 * within its object, all without case. A match is brought to what was
 * asked — missing stages added, stages put in the asked order, a
 * probability set — and nothing is ever removed: a stage may hold deals and
 * a field values, and removing either is a person's decision.
 */

// ── Pipelines ─────────────────────────────────────────────────────────────

/** The resource the CRM's pipeline writer is registered under. */
export const CRM_PIPELINE_SETUP_RESOURCE = 'crm-pipeline'

/** The longest stage name, as long as a pipeline's name. */
export const CRM_SETUP_STAGE_NAME_MAX = PIPELINE_NAME_MAX

/** The most open stages one ask sets; a board wider than this does not read. */
export const CRM_SETUP_OPEN_STAGES_MAX = 12

/** A pipeline as one ask states it, once read. */
export interface CrmPipelineSetup {
  name: string
  /** An active pipeline to rename to `name`, by its current name. */
  renameFrom: string | null
  /** The open stages, in order, each with the probability asked for, if any. */
  stages: Array<{ name: string; probability: number | null }>
  /** What the Won and Lost stages are called, where the ask says. */
  wonStage: string | null
  lostStage: string | null
  /** Whether this becomes the pipeline a new deal lands in. */
  makeDefault: boolean
}

const WON_NAME = /^(closed[\s-]*)?won$/i
const LOST_NAME = /^(closed[\s-]*)?lost$/i
/** "Discovery (20%)": a stage's name with its probability. */
const STAGE_WITH_PROBABILITY = /^(.*?)\s*\(\s*(\d{1,3}(?:\.\d+)?)\s*%?\s*\)\s*$/

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** One listed stage, read: its name and the probability written after it. */
export function readCrmSetupStage(entry: string): { name: string; probability: number | null } {
  const raw = text(entry)
  const match = STAGE_WITH_PROBABILITY.exec(raw)
  if (!match) return { name: raw, probability: null }
  return { name: text(match[1]), probability: clampProbability(match[2]) }
}

/**
 * A pipeline's content, read and judged. Pure. A stage listed as Won or
 * Lost ("Won", "Closed Lost") names the closing stage rather than adding an
 * open one, since every pipeline already has exactly one of each.
 */
export function readCrmPipelineSetup(
  content: Readonly<Record<string, unknown>>,
): { ok: true; value: CrmPipelineSetup } | { ok: false; problems: string[] } {
  const problems: string[] = []
  const name = text(content['name'])
  if (!name) problems.push('A pipeline needs a name.')
  else if (name.length > PIPELINE_NAME_MAX) problems.push(`A pipeline's name is at most ${PIPELINE_NAME_MAX} characters.`)
  let wonStage = text(content['wonStage']) || null
  let lostStage = text(content['lostStage']) || null
  const listed = Array.isArray(content['stages']) ? content['stages'] : []
  const stages: CrmPipelineSetup['stages'] = []
  for (const entry of listed) {
    if (typeof entry !== 'string') {
      problems.push('Each stage is a name.')
      break
    }
    const stage = readCrmSetupStage(entry)
    if (!stage.name) continue
    if (WON_NAME.test(stage.name)) {
      wonStage ??= stage.name
      continue
    }
    if (LOST_NAME.test(stage.name)) {
      lostStage ??= stage.name
      continue
    }
    if (stage.name.length > CRM_SETUP_STAGE_NAME_MAX) {
      problems.push(`A stage's name is at most ${CRM_SETUP_STAGE_NAME_MAX} characters.`)
      break
    }
    if (stages.some((one) => same(one.name, stage.name))) continue
    stages.push(stage)
  }
  if (stages.length > CRM_SETUP_OPEN_STAGES_MAX) {
    problems.push(`A pipeline is set up with at most ${CRM_SETUP_OPEN_STAGES_MAX} open stages.`)
  }
  for (const closing of [wonStage, lostStage]) {
    if (closing && closing.length > CRM_SETUP_STAGE_NAME_MAX) {
      problems.push(`A stage's name is at most ${CRM_SETUP_STAGE_NAME_MAX} characters.`)
    }
  }
  if (wonStage && lostStage && same(wonStage, lostStage)) problems.push('The Won and Lost stages need different names.')
  if (problems.length) return { ok: false, problems }
  return {
    ok: true,
    value: {
      name,
      renameFrom: text(content['renameFrom']) || null,
      stages,
      wonStage,
      lostStage,
      makeDefault: content['makeDefault'] === true,
    },
  }
}

/** The `crm-pipeline` writer's check: whether the content is a pipeline ask, with its name and stages. Pure. */
export function checkCrmPipelineSetup(content: Readonly<Record<string, unknown>>): PluginDraftCheck {
  const read = readCrmPipelineSetup(content)
  if (read.ok === false) return { ok: false, problems: read.problems }
  return { ok: true, facts: { name: read.value.name, stages: read.value.stages.map((one) => one.name) } }
}

/**
 * The probability an open stage takes when the ask names none: spread over
 * the pipeline by position, to the nearest 5 — the first of four stages 20,
 * the last 80 — so a weighted forecast grows as a deal moves right.
 */
export function crmSetupStageProbability(index: number, count: number): number {
  const spread = ((index + 1) / (count + 1)) * 100
  return Math.min(95, Math.max(5, Math.round(spread / 5) * 5))
}

/**
 * The stages a pipeline ends up with: the open stages asked for, in the asked
 * order, each an existing stage of that name where there is one (its id kept,
 * so the deals in it stay), then the open stages the ask did not name, as
 * they were, then Won and Lost, renamed where asked. Nothing is removed.
 */
export function mergeCrmSetupStages(
  existing: readonly CrmDealStage[],
  setup: Pick<CrmPipelineSetup, 'stages' | 'wonStage' | 'lostStage'>,
): CrmDealStage[] {
  const sorted = sortedStages({ stages: [...existing] })
  const opens = sorted.filter((stage) => stage.kind === 'open')
  const taken: CrmDealStage[] = [...sorted]
  const listed: CrmDealStage[] = setup.stages.map((asked, index) => {
    const found = opens.find((stage) => same(stage.name, asked.name))
    if (found) return asked.probability === null ? found : { ...found, probability: asked.probability }
    const stage: CrmDealStage = {
      id: newStageId(asked.name, taken),
      name: asked.name,
      order: 0,
      probability: asked.probability ?? crmSetupStageProbability(index, setup.stages.length),
      kind: 'open',
      forecastCategory: 'pipeline',
    }
    taken.push(stage)
    return stage
  })
  const unlisted = opens.filter((stage) => !listed.some((one) => one.id === stage.id))
  const closing = (kind: 'won' | 'lost', name: string | null): CrmDealStage[] =>
    sorted
      .filter((stage) => stage.kind === kind)
      .map((stage) => (name ? { ...stage, name } : stage))
  return renumberStages([
    ...listed,
    ...unlisted,
    ...closing('won', setup.wonStage),
    ...closing('lost', setup.lostStage),
  ])
}

/** What saving a pipeline ask comes to against the pipelines the member's site can read. */
export type CrmPipelineSetupPlan =
  | {
      kind: 'create'
      document: Record<string, unknown>
      /** Pipelines whose default flag comes off, because this one takes it. */
      defaultsOff: string[]
    }
  | {
      kind: 'update'
      id: string
      name: string
      /** The fields that change; empty when the pipeline already is what was asked. */
      patch: { name?: string; stages?: CrmDealStage[]; isDefault?: true }
      defaultsOff: string[]
    }
  | { kind: 'refuse'; error: string }

/**
 * Create, or bring an existing pipeline to the ask. Pure.
 *
 * The pipeline is the active one called `renameFrom`, else the active one
 * called `name`; with neither, a new one, which is also the default when the
 * site reads no active pipeline yet (the board's seed would have made it so)
 * or when asked.
 */
export function planCrmPipelineSetup(
  setup: CrmPipelineSetup,
  pipelines: readonly PipelineDoc[],
  context: PipelineWriteContext,
): CrmPipelineSetupPlan {
  const active = activePipelines(pipelines)
  const named = (name: string | null) => (name ? active.find((one) => same(String(one.name ?? ''), name)) : undefined)
  const target = named(setup.renameFrom) ?? named(setup.name)
  const defaultsOff = (keep: string | null) =>
    active.filter((one) => one.isDefault && one.$id !== keep).map((one) => one.$id)

  if (!target) {
    const problem = pipelineNameProblem(setup.name, pipelines)
    if (problem) return { kind: 'refuse', error: problem }
    // Stages asked for replace the default open stages; none asked keeps
    // them all, as the console's New pipeline does.
    const stages = mergeCrmSetupStages(
      setup.stages.length ? DEFAULT_DEAL_STAGES.filter((stage) => stage.kind !== 'open') : DEFAULT_DEAL_STAGES,
      setup,
    )
    const invalid = stagesProblem(stages)
    if (invalid) return { kind: 'refuse', error: invalid }
    const isDefault = setup.makeDefault || active.length === 0
    return {
      kind: 'create',
      document: { ...newPipelineDocument(setup.name, context), stages, isDefault },
      defaultsOff: isDefault ? defaultsOff(null) : [],
    }
  }

  const patch: { name?: string; stages?: CrmDealStage[]; isDefault?: true } = {}
  // A name that differs only in case is the same pipeline, and keeps its own.
  if (!same(String(target.name ?? ''), setup.name)) {
    const problem = pipelineNameProblem(setup.name, pipelines, target.$id)
    if (problem) return { kind: 'refuse', error: problem }
    patch.name = setup.name
  }
  const current = sortedStages(target)
  const stages = mergeCrmSetupStages(current, setup)
  const invalid = stagesProblem(stages)
  if (invalid) return { kind: 'refuse', error: invalid }
  if (JSON.stringify(stages) !== JSON.stringify(renumberStages(current))) patch.stages = stages
  if (setup.makeDefault && !target.isDefault) patch.isDefault = true
  return {
    kind: 'update',
    id: target.$id,
    name: patch.name ?? target.name,
    patch,
    defaultsOff: patch.isDefault ? defaultsOff(target.$id) : [],
  }
}

/** What a pipeline's writer reports: its open stages in order, and its closing stages. */
export function crmPipelineSetupFacts(stages: readonly CrmDealStage[]): Readonly<Record<string, unknown>> {
  const sorted = sortedStages({ stages: [...stages] })
  return {
    stages: sorted.filter((stage) => stage.kind === 'open').map((stage) => `${stage.name} (${stage.probability}%)`),
    wonStage: sorted.find((stage) => stage.kind === 'won')?.name ?? null,
    lostStage: sorted.find((stage) => stage.kind === 'lost')?.name ?? null,
  }
}

// ── Custom fields ─────────────────────────────────────────────────────────

/** The resource the CRM's custom field writer is registered under. */
export const CRM_FIELD_SETUP_RESOURCE = 'crm-field'

/** How many choices a Choice field may declare, and how long each and a label may be: the field drawer's. */
export const CRM_FIELD_OPTIONS_MAX = 50
export const CRM_FIELD_OPTION_MAX_LENGTH = 120
export const CRM_FIELD_LABEL_MAX_LENGTH = 80

/** One choice per entry, trimmed, blanks dropped, duplicates collapsed, at most the drawer's count. */
export function crmFieldOptions(entries: readonly string[]): string[] {
  const seen = new Set<string>()
  const options: string[] = []
  for (const entry of entries) {
    const option = String(entry ?? '').trim().slice(0, CRM_FIELD_OPTION_MAX_LENGTH)
    if (!option || seen.has(option)) continue
    seen.add(option)
    options.push(option)
    if (options.length >= CRM_FIELD_OPTIONS_MAX) break
  }
  return options
}

/** A custom field as one ask states it, once read. */
export interface CrmFieldSetup {
  object: CrmFieldObject
  label: string
  /** The key its values are stored under, derived from the label. */
  key: string
  type: ContactFieldType
  /** The choices, for `select`; empty otherwise. */
  options: string[]
  required: boolean
}

/** A field's content, read and judged. Pure. */
export function readCrmFieldSetup(
  content: Readonly<Record<string, unknown>>,
): { ok: true; value: CrmFieldSetup } | { ok: false; problems: string[] } {
  const problems: string[] = []
  const object = content['object']
  if (!isCrmFieldObject(object)) problems.push(`A field describes one of ${CRM_FIELD_OBJECTS.join(', ')}.`)
  const type = content['type']
  if (!isContactFieldType(type)) problems.push(`A field's type is one of ${CONTACT_FIELD_TYPES.join(', ')}.`)
  const label = text(content['label'])
  const key = normalizeContactFieldKey(label)
  if (!label) problems.push('A field needs a label.')
  else if (label.length > CRM_FIELD_LABEL_MAX_LENGTH) {
    problems.push(`A field's label is at most ${CRM_FIELD_LABEL_MAX_LENGTH} characters.`)
  } else if (!key) problems.push('A field’s label needs a letter to make its key from.')
  const listed = Array.isArray(content['options']) ? content['options'].filter((one): one is string => typeof one === 'string') : []
  const options = type === 'select' ? crmFieldOptions(listed) : []
  if (type === 'select' && !options.length) problems.push('A Choice field needs its choices.')
  if (problems.length) return { ok: false, problems }
  return {
    ok: true,
    value: {
      object: object as CrmFieldObject,
      label,
      key: key as string,
      type: type as ContactFieldType,
      options,
      required: content['required'] === true,
    },
  }
}

/** The `crm-field` writer's check: whether the content is a field ask, with the key it derives. Pure. */
export function checkCrmFieldSetup(content: Readonly<Record<string, unknown>>): PluginDraftCheck {
  const read = readCrmFieldSetup(content)
  if (read.ok === false) return { ok: false, problems: read.problems }
  return { ok: true, facts: { object: read.value.object, key: read.value.key, type: read.value.type } }
}

/** A stored definition, as the writer reads one: its document id beside it. */
export type CrmFieldDefinitionDoc = ContactFieldDefinition & { $id: string }

/** What saving a field ask comes to against every definition the org holds. */
export type CrmFieldSetupPlan =
  | { kind: 'create'; document: Record<string, unknown> }
  /** The field exists; `options` are the choices its Choice list gains, empty when none. */
  | { kind: 'existing'; id: string; label: string; options: string[] }
  | { kind: 'refuse'; status: 403 | 409; error: string }

/**
 * Create the field, or find it. Pure.
 *
 * An active field on the same object with the same label or key is the
 * field: a re-run makes nothing, and a Choice field gains only the choices it
 * lacks. A retired field keeps its key, as the drawer says, so a key a
 * retired field holds is refused rather than reused — its old values would
 * read back as the new field's. The org's ceiling counts every definition,
 * retired ones included, as the Fields section's read does.
 */
export function planCrmFieldSetup(
  setup: CrmFieldSetup,
  definitions: readonly CrmFieldDefinitionDoc[],
  context: { hostId: string; now: Date; visibleTo: readonly string[] },
): CrmFieldSetupPlan {
  const ofObject = fieldDefinitionsForObject(definitions, setup.object)
  const match = ofObject.find(
    (one) => !one.retiredAt && (same(String(one.label ?? ''), setup.label) || one.key === setup.key),
  )
  if (match) {
    const missing =
      match.type === 'select' && setup.type === 'select'
        ? setup.options.filter((option) => !(match.options ?? []).includes(option))
        : []
    const room = Math.max(0, CRM_FIELD_OPTIONS_MAX - (match.options ?? []).length)
    return { kind: 'existing', id: match.$id, label: match.label, options: missing.slice(0, room) }
  }
  const retired = ofObject.find((one) => one.retiredAt && one.key === setup.key)
  if (retired) {
    return {
      kind: 'refuse',
      status: 409,
      error:
        `A retired ${CRM_FIELD_OBJECT_LABELS[setup.object].toLowerCase()} field, “${retired.label}”, keeps the key ` +
        `“${setup.key}”. Restore it in CRM → Fields, or give this field another name.`,
    }
  }
  if (definitions.length >= CONTACT_FIELDS_MAX_PER_ORG) {
    return {
      kind: 'refuse',
      status: 403,
      error: `An organization keeps at most ${CONTACT_FIELDS_MAX_PER_ORG} custom fields. Retire or delete one in CRM → Fields first.`,
    }
  }
  const order = ofObject.reduce((highest, one) => Math.max(highest, Number(one.order) || 0), -1) + 1
  return {
    kind: 'create',
    document: {
      key: setup.key,
      label: setup.label,
      type: setup.type,
      ...(setup.type === 'select' ? { options: setup.options } : {}),
      required: setup.required,
      order,
      retiredAt: null,
      ...crmFieldListFields({ key: setup.key, label: setup.label, required: setup.required, object: setup.object }),
      hostId: context.hostId,
      visibleTo: [...context.visibleTo],
      createdAt: context.now,
      updatedAt: context.now,
    },
  }
}
