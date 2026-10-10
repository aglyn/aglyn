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

import { checkDatasetQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { isAiPlanNewRef, type AiBuildPlanCreate, type AiBuildPlanScreen } from '../model/ai-build-plan'
import type { AiJob, AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import type { AiPlanCapabilities } from '../model/ai-plan-capabilities'
import { AI_SITE_DATASETS_MAX } from '../model/ai-site-job'
import { AI_STEP_TIERS } from '../providers/catalog'
import { aiModelForStep } from '../providers/routing'
import {
  AI_DATASET_MAX_TOKENS,
  AI_DATASET_STEP,
  aiDatasetDraftContent,
  generateAiDataset,
} from '../runtime/ai-dataset-generation'
import {
  aiLayoutListingId,
  aiLayoutRecordsPlacements,
  type AiLayoutListing,
  type AiLayoutListingField,
  type AiLayoutListingScreen,
} from '../layout-language/ai-layout-listings'
import type { AiJobAdmissionContext } from './ai-job-admission'
import { AI_DATASET_DRAFT_RESOURCE } from './ai-build-unit-outcome'
import { aiJobStepBudget } from './ai-job-budget'
import { aiGenerationSpent, aiUnspentOutcome } from './ai-job-generation'
import { aiPluginDraftAdmissionRefusal } from './ai-job-plugin-drafts'
import type { AiJobStepContext, AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'

/**
 * A SITE START'S DATASETS (AGL-3616): "Aglyn AI can also use/create datasets
 * too for whatever it needs" (Zach, 2026-10-10).
 *
 * A site whose content is a list of like things — a restaurant's menu, a
 * studio's team, a contractor's services, a photographer's portfolio, an
 * events list, its questions and answers — keeps it as a DATASET, the way the
 * docs teach a person to: the owner edits one record and every page listing
 * it follows. On a workspace that may create datasets, the site plan creates
 * one for such content (`create`, kind `dataset`) and names it in the `uses`
 * of each section that lists it. The scaffold then builds each dataset as a
 * unit of its own, after the layout and before the form (which may write
 * its submissions to one) and the pages:
 *
 *  - DESIGNED by the `submit_dataset` generation (`ai-dataset-generation.ts`):
 *    the planned fields typed, at most a few more, and 3 to 12 records seeded
 *    from the brief. Nothing anybody did not say: no review, testimonial,
 *    rating, quote or person's name, no price the brief does not state.
 *  - WRITTEN by the data plugin's `dataset` writer — this plugin never names
 *    the datasets collection — with every rule the console's datasets route
 *    has: the member's role and `data.manage`, `release_data_store`,
 *    `dataStore` (Starter and up), `datasetsPerOrg` counted inside the create,
 *    `recordsPerDataset` and the storage band.
 *  - LISTED by the pages built after it: each section naming it repeats over
 *    the dataset (`aiSiteDatasetListings`, a `records` listing the layout
 *    compiler draws), and a page the plan made its record template binds its
 *    fields by id and keeps the address field the writer added.
 *
 * Where datasets cannot be created — the Free taste, Starter's two used up,
 * the data store not released — the plan is told so and creates none, so its
 * sections write the items out. A dataset unit that fails or is refused
 * leaves the pages that list it built without it (they say so), and its
 * record page is not built.
 */

/** The most datasets one site start creates. */
export { AI_SITE_DATASETS_MAX } from '../model/ai-site-job'

/** The resource the data plugin's writer is registered under. */
export const AI_SITE_DATASET_RESOURCE = AI_DATASET_DRAFT_RESOURCE

/** What the site's plugin list calls the plugin, for "Turn on Data for this site". */
const DATA_PLUGIN_LABEL = 'Data'

/** The input a dataset unit's own job carries what it needs in. */
export const AI_SITE_DATASET_INPUT = 'siteDataset'

/** What a dataset unit's job is told beside its creation. */
export interface AiSiteDatasetInput {
  /** The sections that list it, by page: "Menu › Our dishes (12 items)". */
  shownIn: string[]
  /** Whether a page of the plan is its record template. */
  recordPages: boolean
  /**
   * The form of the plan that writes its submissions to it (AGL-3616), by
   * name, with that form's planned fields; absent where no form does.
   */
  forForm?: { name: string; fields: string[] }
}

/** What a dataset row says when its design could not be written: our failure, refunded. */
export const AI_SITE_DATASET_NOT_WRITTEN_COPY = 'This dataset could not be added this time.'

/** The note a written dataset carries on the job's page. */
export function aiSiteDatasetNote(records: number): string {
  return `${records} ${records === 1 ? 'record' : 'records'} to start, in Data. Edit them there and every page that lists them follows.`
}

/** The note a record template's row adds: the binding is the member's to save (rule 13). */
export const AI_SITE_RECORD_PAGE_NOTE =
  'A page per record is drafted, not live: open Page Properties → Record pages to save it.'

/** ASSUMED: what one dataset pass reads and writes beside its generation: the site, the writer's reads and its transaction. */
export const AI_SITE_DATASET_WRITES_MS = 2_000

/** One dataset's pass: its generation and re-ask at its ceiling, and its writes. */
export const AI_SITE_DATASET_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS[AI_DATASET_STEP],
  maxTokens: AI_DATASET_MAX_TOKENS,
  lookups: 0,
  ownReadsMs: AI_SITE_DATASET_WRITES_MS,
})

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The plan's reference to a dataset as a section names it: `new:<name>`, compared lowercased. */
function namesDataset(ref: string, name: string): boolean {
  return isAiPlanNewRef(ref) && ref.slice(ref.indexOf(':') + 1).trim().toLowerCase() === name.trim().toLowerCase()
}

/** The plan's datasets, in plan order, at most the most a start creates. */
export function aiSitePlanDatasets(plan: Pick<AiJobPlan, 'create'>): AiBuildPlanCreate[] {
  return plan.create.filter((entry) => entry.kind === 'dataset').slice(0, AI_SITE_DATASETS_MAX)
}

/** Where the plan lists a dataset, in words its design reads, whether a page is its record template, and the form that writes to it. */
export function aiSiteDatasetInputOf(
  dataset: Pick<AiBuildPlanCreate, 'name'>,
  screens: readonly AiBuildPlanScreen[],
  create: readonly AiBuildPlanCreate[] = [],
): AiSiteDatasetInput {
  const shownIn: string[] = []
  for (const screen of screens) {
    for (const section of screen.sections) {
      if (!section.uses.some((ref) => namesDataset(ref, dataset.name))) continue
      shownIn.push(`${screen.title} › ${section.name}${section.items ? ` (${section.items} items)` : ''}`)
    }
  }
  const recordPages = screens.some((screen) => !!screen.record && namesDataset(screen.record.dataset, dataset.name))
  const form = create.find((entry) => entry.kind === 'form' && !!entry.writesTo && namesDataset(entry.writesTo, dataset.name))
  return {
    shownIn: shownIn.slice(0, 8),
    recordPages,
    ...(form ? { forForm: { name: form.name, fields: form.fields.slice(0, AI_SITE_FORM_DATASET_FIELDS_MAX) } } : {}),
  }
}

/** Whether a plan screen is the record template of a dataset the plan creates, and which. */
export function aiSiteRecordTemplateOf(screen: Pick<AiBuildPlanScreen, 'record'>): string | null {
  const ref = screen.record?.dataset
  return ref && isAiPlanNewRef(ref) ? ref.slice(ref.indexOf(':') + 1).trim() : null
}

function datasetInputOf(job: Pick<AiJob, 'inputs'>): AiSiteDatasetInput {
  const raw = (job.inputs?.[AI_SITE_DATASET_INPUT] ?? {}) as Partial<AiSiteDatasetInput>
  const form = raw.forForm && typeof raw.forForm === 'object' ? raw.forForm : null
  return {
    shownIn: Array.isArray(raw.shownIn) ? raw.shownIn.map(str).filter(Boolean).slice(0, 8) : [],
    recordPages: raw.recordPages === true,
    ...(form && str(form.name)
      ? {
          forForm: {
            name: str(form.name),
            fields: Array.isArray(form.fields) ? form.fields.map(str).filter(Boolean).slice(0, AI_SITE_FORM_DATASET_FIELDS_MAX) : [],
          },
        }
      : {}),
  }
}

/** The most fields a form's dataset is designed with: the data plugin writer's own ceiling is higher. */
export const AI_SITE_FORM_DATASET_FIELDS_MAX = 12

/** The field types a planned `Name:type` may name, as the data plugin's writer takes them. */
const FORM_DATASET_FIELD_TYPES = ['text', 'number', 'integer', 'boolean', 'list'] as const

/** A planned field as a person reads it: `fullName` and `full_name` are "Full name". */
export function aiSiteDatasetFieldName(planned: string): string {
  const words = planned
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : ''
}

/**
 * A dataset a form writes to, as the data plugin's writer takes it
 * (AGL-3616): designed with no model, since its records are the
 * submissions. Its fields are its planned ones — or, where the plan gave it
 * none, the form's — each a person's words for it, text unless the plan
 * typed it as `Name:type`, never required, so a submission that leaves one
 * blank is still a record. It starts with no records. Pure.
 */
export function aiSiteFormDatasetContent(
  name: string,
  planned: readonly string[],
  form: { fields: readonly string[] },
): Record<string, unknown> {
  const specs = (planned.length ? planned : form.fields).slice(0, AI_SITE_FORM_DATASET_FIELDS_MAX)
  const seen = new Set<string>()
  const fields: Array<{ name: string; type: string }> = []
  for (const spec of specs) {
    const at = spec.lastIndexOf(':')
    const typed = at > 0 ? spec.slice(at + 1).trim().toLowerCase() : ''
    const type = (FORM_DATASET_FIELD_TYPES as readonly string[]).includes(typed) ? typed : 'text'
    const fieldName = aiSiteDatasetFieldName(type === typed ? spec.slice(0, at) : spec).slice(0, 60)
    if (!fieldName || seen.has(fieldName.toLowerCase())) continue
    seen.add(fieldName.toLowerCase())
    fields.push({ name: fieldName, type })
  }
  return { name, fields, records: [] }
}

/** The note a form's dataset carries on the job's page. */
export function aiSiteFormDatasetNote(form: string): string {
  return `Empty to start: each submission of the form “${form}” is added here, in Data.`
}

const limitReview = (message: string) => ({ reason: 'limit' as const, message, findings: [] })

export interface AiSiteDatasetRunnerDeps {
  generate?: typeof generateAiDataset
  writerFor?: typeof pluginResourceDraftWriter
}

/** The fields and record names a written dataset reports, as its output's proposal keeps them. */
interface AiSiteDatasetProposal {
  fields: AiLayoutListingField[]
  /** Each record's name: its first field's value. */
  recordNames: string[]
  addressField: string | null
  /**
   * The fields most of its first records leave empty, by id (AGL-3616): a
   * tour's venues not yet known. A card never binds one — it would print
   * nothing on most records — so its listing leaves them out.
   */
  sparseFields?: string[]
}

/**
 * The fields of a designed dataset that its records leave empty on most of
 * them — every record, or more than half — by the id the data plugin gave
 * each (AGL-3616). Its first field is the record's name and is never one. The
 * live low-tide-hollow start (beta.239) seeded its tour dates with no venue,
 * rightly inventing none, and its cards bound the venue as their eyebrow.
 */
export function aiDatasetSparseFields(
  dataset: { fields: ReadonlyArray<{ name: string }>; records: ReadonlyArray<ReadonlyArray<string | undefined>> },
  written: readonly AiLayoutListingField[],
): string[] {
  if (!dataset.records.length) return []
  const idOf = (name: string, column: number) =>
    written.find((field) => field.name.trim().toLowerCase() === name.trim().toLowerCase())?.id ?? written[column]?.id ?? null
  return dataset.fields.flatMap((field, column) => {
    if (column === 0) return []
    const filled = dataset.records.filter((values) => (values[column] ?? '').trim()).length
    const id = idOf(field.name, column)
    return id && filled * 2 <= dataset.records.length ? [id] : []
  })
}

function proposalOf(output: Pick<AiJobOutput, 'proposal'>): AiSiteDatasetProposal {
  const raw = (output.proposal ?? {}) as Partial<AiSiteDatasetProposal>
  return {
    fields: Array.isArray(raw.fields)
      ? raw.fields.filter((field) => field && typeof field.id === 'string' && field.id).map((field) => ({ id: field.id, name: str(field.name) || field.id, type: str(field.type) || 'text' }))
      : [],
    recordNames: Array.isArray(raw.recordNames) ? raw.recordNames.map(str).filter(Boolean).slice(0, 12) : [],
    addressField: str(raw.addressField) || null,
    sparseFields: Array.isArray(raw.sparseFields) ? raw.sparseFields.map(str).filter(Boolean) : [],
  }
}

/**
 * The dataset unit's runner, on the job the scaffold derived for it: the one
 * creation its plan carries, designed by the model and written by the data
 * plugin, under the creation's own id. A pass repeated after its write finds
 * the dataset the writer wrote and reports it again, spending nothing.
 */
export function createAiSiteDatasetRunner(deps: AiSiteDatasetRunnerDeps = {}): AiJobStepRunner {
  const generate = deps.generate ?? generateAiDataset
  const writerFor = deps.writerFor ?? pluginResourceDraftWriter
  return async (context): Promise<AiJobStepOutcome> => {
    const { job, firestore, signal } = context
    const model = context.modelFor?.(AI_DATASET_STEP) ?? aiModelForStep(AI_DATASET_STEP)
    const creation = (job.plan as AiJobPlan | null)?.create?.find((entry) => entry.kind === 'dataset')
    const keeper = writerFor(AI_SITE_DATASET_RESOURCE)
    if (!job.hostId || !creation) return { ...aiUnspentOutcome(model), failure: 'Open the site before adding its data.' }
    if (!keeper) return { ...aiUnspentOutcome(model), failure: 'Datasets are not available on this site.' }
    const host = await firestore.collection('hosts').doc(job.hostId).get()
    const hostSubdomain = str(host.get('subdomain')) || null
    const output = (id: string, name: string, proposal: AiSiteDatasetProposal, records: number): AiJobOutput => ({
      resource: 'draft',
      draftResource: AI_SITE_DATASET_RESOURCE,
      id,
      hostId: job.hostId ?? null,
      hostSubdomain,
      label: name,
      note: aiSiteDatasetNote(records),
      proposal: proposal as unknown as Record<string, unknown>,
    })
    const input = datasetInputOf(job)
    // Asked again under the same id: the dataset already written.
    const written = await keeper.writer.read({ hostId: job.hostId, id: job.$id })
    if (written) {
      const facts = written.facts as { fields?: AiLayoutListingField[]; addressField?: string | null }
      const again = output(written.id, written.name || creation.name, { fields: facts.fields ?? [], recordNames: [], addressField: facts.addressField ?? null }, 0)
      return aiUnspentOutcome(model, {
        outputs: [input.forForm ? { ...again, note: aiSiteFormDatasetNote(input.forForm.name) } : again],
      })
    }
    // A form's dataset (AGL-3616): its records are the submissions, so it is
    // designed from the plan with no model, and starts empty.
    if (input.forForm) {
      const content = aiSiteFormDatasetContent(creation.name, creation.fields, input.forForm)
      const checked = keeper.writer.check(content, { hostId: job.hostId })
      if (checked.ok === false) {
        console.error('ai site dataset: the dataset writer refused a form dataset we made', { orgId: job.orgId, jobId: job.$id, problems: checked.problems })
        return { ...aiUnspentOutcome(model), failure: AI_SITE_DATASET_NOT_WRITTEN_COPY }
      }
      const result = await keeper.writer.write({
        orgId: job.orgId,
        hostId: job.hostId,
        uid: job.createdBy,
        org: (context.org ?? null) as Readonly<Record<string, unknown>> | null,
        now: context.now,
        id: job.$id,
        name: creation.name,
        content,
      })
      if (result.ok === false) {
        if (result.status === 400) return { ...aiUnspentOutcome(model), failure: AI_SITE_DATASET_NOT_WRITTEN_COPY }
        return { ...aiUnspentOutcome(model), review: limitReview(result.error) }
      }
      const facts = result.facts as { fields?: AiLayoutListingField[]; addressField?: string | null }
      return aiUnspentOutcome(model, {
        outputs: [
          {
            ...output(result.id, result.name, { fields: facts.fields ?? [], recordNames: [], addressField: null }, 0),
            note: aiSiteFormDatasetNote(input.forForm.name),
          },
        ],
      })
    }
    const generation = await generate({
      brief: job.brief,
      merchantWords: job.brief,
      name: creation.name,
      why: creation.why,
      fields: creation.fields,
      shownIn: input.shownIn,
      recordPages: input.recordPages,
      model,
      maxTokens: AI_SITE_DATASET_BUDGET.maxTokens(model),
      ...(signal ? { signal } : {}),
    })
    const spent = aiGenerationSpent(generation)
    if (generation.status === 'refused') return { ...spent, refused: true }
    if (generation.status === 'needs_input') return { ...spent, failure: generation.message }
    const content = aiDatasetDraftContent(creation.name, generation.value, { recordPages: input.recordPages })
    // The data plugin's own rules, before anything is written: content we
    // made that its model refuses is our failure, refunded.
    const checked = keeper.writer.check(content, { hostId: job.hostId })
    if (checked.ok === false) {
      console.error('ai site dataset: the dataset writer refused a dataset we made', { orgId: job.orgId, jobId: job.$id, problems: checked.problems })
      return { ...spent, failure: AI_SITE_DATASET_NOT_WRITTEN_COPY }
    }
    const result = await keeper.writer.write({
      orgId: job.orgId,
      hostId: job.hostId,
      uid: job.createdBy,
      org: (context.org ?? null) as Readonly<Record<string, unknown>> | null,
      now: context.now,
      id: job.$id,
      name: creation.name,
      content,
    })
    if (result.ok === false) {
      if (result.status === 400) return { ...spent, failure: AI_SITE_DATASET_NOT_WRITTEN_COPY }
      // The allowance, the role, the plan or the flag: the workspace's to change.
      return { ...spent, review: limitReview(result.error) }
    }
    const facts = result.facts as { fields?: AiLayoutListingField[]; records?: number; addressField?: string | null }
    const proposal: AiSiteDatasetProposal = {
      fields: facts.fields ?? [],
      recordNames: generation.value.records.map((values) => values[0] ?? '').filter(Boolean).slice(0, 12),
      addressField: facts.addressField ?? null,
      sparseFields: aiDatasetSparseFields(generation.value, facts.fields ?? []),
    }
    return { ...spent, outputs: [output(result.id, result.name, proposal, facts.records ?? generation.value.records.length)] }
  }
}

export const runAiSiteDatasetUnit = createAiSiteDatasetRunner()

/**
 * Whether a dataset may be created for this member on this site, asked before
 * its first pass so a refusal spends nothing; `null` admits. The data plugin
 * must run here (on for the workspace and the site, past its release flag),
 * and its writer says whether this member may make one now: the role, the
 * plan, the flag, the allowance.
 */
export async function aiSiteDatasetRefusal(
  context: Pick<AiJobStepContext, 'firestore' | 'org' | 'now'> & { job: Pick<AiJob, 'orgId' | 'hostId' | 'createdBy'> },
  deps: { admission?: typeof aiPluginDraftAdmissionRefusal; writerFor?: (resource: string) => ReturnType<typeof pluginResourceDraftWriter> } = {},
): Promise<string | null> {
  const { job } = context
  if (!job.hostId) return 'Open the site first.'
  const writerFor = deps.writerFor ?? pluginResourceDraftWriter
  const admission: AiJobAdmissionContext = {
    firestore: context.firestore,
    orgId: job.orgId,
    hostId: job.hostId,
    inputs: {},
    org: context.org ?? null,
    uid: job.createdBy,
  }
  const refused = await (deps.admission ?? aiPluginDraftAdmissionRefusal)(admission, {
    kind: 'site',
    drafts: [{ resource: AI_SITE_DATASET_RESOURCE, label: DATA_PLUGIN_LABEL }],
    writerFor: (resource) => writerFor(resource)?.writer ?? null,
    ownerFor: (resource) => writerFor(resource)?.pluginId ?? null,
    now: context.now,
  })
  return refused?.error ?? null
}

/**
 * A site plan's dataset capability on this workspace (AGL-3616): where the
 * workspace's plan includes datasets, whether the data plugin runs here and
 * this member may create one now, and how many a start may make. A clause the
 * plan's turn completes is the reason where it may not.
 */
export async function aiSitePlanDatasetCapability(
  capabilities: AiPlanCapabilities,
  context: Parameters<typeof aiSiteDatasetRefusal>[0],
  deps: Parameters<typeof aiSiteDatasetRefusal>[1] = {},
): Promise<AiPlanCapabilities> {
  if (!capabilities.create.dataset.allowed) return capabilities
  const refusal = await aiSiteDatasetRefusal(context, deps).catch((error: unknown) => {
    console.error('ai site plan: the dataset admission failed', { orgId: context.job.orgId, error })
    return 'datasets could not be checked just now'
  })
  const left = Math.min(AI_SITE_DATASETS_MAX, checkDatasetQuota(context.org as never, 0).limit)
  const dataset = refusal
    ? { allowed: false, left: 0, reason: `datasets cannot be created here: ${refusal.replace(/\.$/, '')}` }
    : { allowed: true, left, reason: null }
  return { ...capabilities, create: { ...capabilities.create, dataset } }
}

/**
 * A `records` listing for each dataset that was made and that a section of the
 * plan names (AGL-3616). Its fields, where none are given, are read off the
 * site's inventory when the page is designed (`aiLayoutListingsWithDatasets`).
 */
export function aiDatasetListingsOf(
  datasets: ReadonlyArray<{ id: string; name: string; records?: string[]; fields?: AiLayoutListingField[] }>,
  screens: readonly AiLayoutListingScreen[],
): AiLayoutListing[] {
  return datasets.flatMap((dataset) => {
    const placements = aiLayoutRecordsPlacements(dataset, screens)
    if (!placements.length) return []
    return [
      {
        id: aiLayoutListingId('records', dataset.id),
        kind: 'records' as const,
        name: dataset.name,
        records: dataset.records ?? [],
        datasetId: dataset.id,
        ...(dataset.fields?.length ? { fields: dataset.fields } : {}),
        placements,
      },
    ]
  })
}

/**
 * The site's datasets a layout or a page unit is handed (AGL-3616), each a
 * `records` listing with the sections of the plan's pages that name it, once
 * its unit wrote it. A dataset not yet written, or one that failed, lists
 * nowhere: the pages built without it write the items out.
 */
export function aiSiteDatasetListings(input: {
  outputs: readonly AiJobOutput[]
  datasets: ReadonlyArray<Pick<AiBuildPlanCreate, 'name'>>
  screens: readonly AiLayoutListingScreen[]
  /** The ids each dataset's unit delivered, by plan name lowercased. */
  delivered: ReadonlyMap<string, string>
}): AiLayoutListing[] {
  const made = input.datasets.flatMap((dataset) => {
    const id = input.delivered.get(dataset.name.trim().toLowerCase())
    const output = id
      ? input.outputs.find((entry) => entry.resource === 'draft' && entry.draftResource === AI_SITE_DATASET_RESOURCE && entry.id === id)
      : undefined
    if (!id || !output) return []
    const proposal = proposalOf(output)
    return [
      {
        id,
        // Placed by the name the plan's sections gave it.
        name: dataset.name,
        records: proposal.recordNames,
        // The address field is the record page's, never a card's words; a
        // field most records leave empty is no card's either (AGL-3616).
        fields: proposal.fields.filter(
          (field, index) => field.id !== proposal.addressField && (index === 0 || !proposal.sparseFields?.includes(field.id)),
        ),
      },
    ]
  })
  return aiDatasetListingsOf(made, input.screens)
}

/** What a page is told about the datasets built before it. */
export function aiSiteDatasetBriefLines(outputs: readonly AiJobOutput[]): string[] {
  const datasets = outputs.filter((output) => output.resource === 'draft' && output.draftResource === AI_SITE_DATASET_RESOURCE)
  return datasets.flatMap((output) => {
    const names = proposalOf(output).recordNames
    return names.length
      ? [`This site's dataset “${output.label}” holds: ${names.map((name) => `“${name}”`).join(', ')}. Where a page names one, name it as written; never name one that is not in this list.`]
      : []
  })
}
