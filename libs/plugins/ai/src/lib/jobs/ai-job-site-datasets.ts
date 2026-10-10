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
import {
  aiLayoutStarterPhotos,
  type AiLayoutPicturePhoto,
  type AiLayoutPictureSlot,
} from '../layout-language/ai-layout-pictures'
import { aiSiteWords } from '../model/ai-site-job'
import type { AiJobAdmissionContext } from './ai-job-admission'
import { aiOriginJobId } from './ai-job-draft-ids'
import { aiSiteProductPhotoSrc } from './ai-job-site-content'
import { aiLayoutStockPhotoSource } from './ai-layout-stock-photos'
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
 *  - PICTURED where the plan lists it the way a gallery is listed (Zach,
 *    2026-10-10: a ceramic artist's "Selected work" came back as text-only
 *    cards, where it had been an image-led gallery): a portfolio's pieces, a
 *    team, a menu, classes and events, and services or offerings whose
 *    section says it shows them in pictures (`aiSiteDatasetPicturesOf`). Such
 *    a dataset gets an Image field, and each record a stock photo of its own
 *    name in the site's craft, copied into the site's library — never one the
 *    job already placed, else a starter photo — searched in code, so it
 *    costs no credits (`aiSiteDatasetRecordPhotos`).
 *  - LISTED by the pages built after it: each section naming it repeats over
 *    the dataset (`aiSiteDatasetListings`, a `records` listing the layout
 *    compiler draws, its card led by the record's photo where it has one),
 *    and a page the plan made its record template binds its fields by id,
 *    its photo the record's, and keeps the address field the writer added.
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
  /**
   * Whether its records carry a photo, and of what (AGL-3616): `things` for a
   * portfolio's pieces, a menu, classes; `people` for a team. Absent for a
   * list a visitor reads rather than looks at: questions, steps, hours.
   */
  pictures?: AiSiteDatasetPictures
}

/** What a dataset's records are pictured as: things or people. */
export type AiSiteDatasetPictures = 'things' | 'people'

/** A list of questions, voices or plain facts: read, never pictured. */
const READ_ONLY_LIST =
  /\b(faqs?|questions?|q ?& ?a|answers?|testimonials?|reviews?|quotes?|voices|hours|opening|steps?|process|policies|policy|terms|stats?|numbers|figures|milestones|timeline|values|benefits|reasons|features|requirements|checklist|ingredients|donations?|needs|partners|sponsors|supporters|roles|positions|jobs|openings)\b/i
/** A list of people: its photos are of the business's people. */
const PEOPLE_LIST =
  /\b(team|staff|people|crew|instructors?|teachers?|tutors?|stylists?|barbers?|therapists?|coaches?|trainers?|chefs?|doctors?|dentists?|hygienists?|practitioners?|artists?|musicians?|performers?|speakers?|founders?|members?)\b/i
/** A list a visitor looks at before reading: pictured wherever it is listed. */
const PICTURED_LIST =
  /\b(portfolio|pieces?|works?|projects?|gallery|galleries|collections?|series|menus?|dishes|plates|drinks|cocktails|wines?|beers?|coffees?|pastries|cakes|products?|items|events?|classes|class|workshops?|courses?|retreats?|tours?|trips?|adventures?|experiences?|rooms?|suites?|cabins?|properties|listings|homes|venues?|spaces?|recipes?|artworks?|paintings?|prints?|photos?|photographs?|designs?|commissions?|builds?|vehicles?|animals?|pets?|plants?|flowers?|bouquets?|arrangements?|case studies)\b/i
/** A section that says it shows its items in pictures: a gallery, a grid of photos, tiles. */
const PICTURED_SECTION =
  /\b(gallery|galleries|grid|images?|photos?|photographs?|pictures?|lightbox|portfolio|showcase|tiles?|visuals?|lookbook|carousel|slideshow|mosaic|thumbnails?)\b/i

/**
 * Whether a dataset's records carry a photo, read off the plan (AGL-3616):
 * its name and the names of the sections that list it. Questions, voices and
 * plain facts never; people as people; a list a visitor looks at — pieces,
 * dishes, classes, events, rooms — always; any other list (services,
 * offerings, programs) only where a section that lists it says it shows them
 * in pictures, or names one of those. A dataset no page lists is not
 * pictured. Pure.
 */
export function aiSiteDatasetPicturesOf(
  dataset: Pick<AiBuildPlanCreate, 'name'>,
  sections: readonly string[],
): AiSiteDatasetPictures | null {
  if (!sections.length) return null
  const own = dataset.name
  if (READ_ONLY_LIST.test(own)) return null
  if (PEOPLE_LIST.test(own)) return 'people'
  if (PICTURED_LIST.test(own)) return 'things'
  if (sections.some((section) => READ_ONLY_LIST.test(section) && !PICTURED_SECTION.test(section))) return null
  if (sections.some((section) => PEOPLE_LIST.test(section))) return 'people'
  if (sections.some((section) => PICTURED_LIST.test(section) || PICTURED_SECTION.test(section))) return 'things'
  return null
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
  const sectionNames: string[] = []
  for (const screen of screens) {
    for (const section of screen.sections) {
      if (!section.uses.some((ref) => namesDataset(ref, dataset.name))) continue
      shownIn.push(`${screen.title} › ${section.name}${section.items ? ` (${section.items} items)` : ''}`)
      sectionNames.push(section.name)
    }
  }
  const recordPages = screens.some((screen) => !!screen.record && namesDataset(screen.record.dataset, dataset.name))
  const form = create.find((entry) => entry.kind === 'form' && !!entry.writesTo && namesDataset(entry.writesTo, dataset.name))
  // A form's dataset holds its submissions: nobody's photo.
  const pictures = form ? null : aiSiteDatasetPicturesOf(dataset, sectionNames)
  return {
    shownIn: shownIn.slice(0, 8),
    recordPages,
    ...(form ? { forForm: { name: form.name, fields: form.fields.slice(0, AI_SITE_FORM_DATASET_FIELDS_MAX) } } : {}),
    ...(pictures ? { pictures } : {}),
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
    ...(raw.pictures === 'things' || raw.pictures === 'people' ? { pictures: raw.pictures } : {}),
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

/** The wall clock a dataset's photos may take inside its pass: the 20 seconds a page's pictures had (AGL-3660). */
export const AI_SITE_DATASET_PHOTOS_BUDGET_MS = 20_000

/** The field a pictured dataset's photo is kept in, where the plan gave it none. */
export const AI_SITE_DATASET_IMAGE_FIELD = 'Image'

/** A planned field that already names a record's photo. */
const IMAGE_FIELD_NAME =
  /^(?:main |cover |hero |featured? )?(?:image|photo|picture|photograph|thumbnail|headshot|portrait|cover)s?$/i

/** One record's photo: the address its Image shows, and the library asset placed, which no page shows again. */
export interface AiSiteDatasetRecordPhoto {
  /** The media library's CDN path, or a starter's site path; `null` for none. */
  src: string | null
  /** The `media:` reference of the stock photo placed, or `null` for a starter. */
  placed: string | null
}

/**
 * A photo for each record of a pictured dataset (AGL-3616), in order: a stock
 * photo of the record's own name, in the site's craft ("ceramic speckled
 * serving bowl"), copied into the site's library, where the deployment has a
 * stock library — never twice in the dataset nor one another part of the job
 * placed, inside {@link AI_SITE_DATASET_PHOTOS_BUDGET_MS} — else a starter
 * photo, as a page's empty picture takes one. A team is searched as the
 * business's people. The photo is kept as the asset's CDN path, the form a
 * product keeps (`aiSiteProductPhotoSrc`), so a replace in the library still
 * reaches it. No AI model is asked, so no credits; never throws.
 */
export async function aiSiteDatasetRecordPhotos(input: {
  job: Pick<AiJob, '$id' | 'hostId' | 'createdBy' | 'inputs' | 'brief'>
  /** The dataset, as the plan named it. */
  name: string
  /** Each record's name, by position. */
  names: readonly string[]
  pictures: AiSiteDatasetPictures
  signal?: AbortSignal
  stockPhotos?: typeof aiLayoutStockPhotoSource
}): Promise<AiSiteDatasetRecordPhoto[]> {
  const { job } = input
  if (!input.names.length || !job.hostId) return input.names.map(() => ({ src: null, placed: null }))
  const people = input.pictures === 'people'
  const slots: AiLayoutPictureSlot[] = input.names.map((name, index) => ({
    imageId: `record${index}`,
    frameId: null,
    iconId: null,
    alt: name.trim() || input.name,
    // The record card's own shape: a team's portraits stand, pieces sit wide.
    aspect: people ? 4 / 5 : 4 / 3,
    sectionIndex: 0,
    role: people ? ('about' as const) : ('gallery' as const),
  }))
  const seed = `${job.$id}:records`
  let found: ReadonlyArray<AiLayoutPicturePhoto | null> = []
  try {
    const source = (input.stockPhotos ?? aiLayoutStockPhotoSource)(
      {
        hostId: job.hostId,
        uid: job.createdBy,
        seed,
        business: aiSiteWords(job.inputs).about || job.brief,
        sectionNames: [input.name],
        jobId: aiOriginJobId(job),
        // Each record may try its name, its object and the site's world.
        searches: slots.length * 3,
        ...(input.signal ? { signal: input.signal } : {}),
      },
      { budgetMs: AI_SITE_DATASET_PHOTOS_BUDGET_MS },
    )
    if (source) found = await source(slots)
  } catch (error) {
    console.warn('ai site dataset: the stock photos failed; starter photos fill them', { error: String(error) })
  }
  const starters = aiLayoutStarterPhotos(slots, seed)
  const hostId = job.hostId
  return slots.map((_slot, index) => {
    const stock = aiSiteProductPhotoSrc(found[index]?.src, hostId)
    if (stock) return { src: stock, placed: found[index]?.src ?? null }
    return { src: aiSiteProductPhotoSrc(starters[index]?.src, hostId), placed: null }
  })
}

/**
 * A designed dataset's content with its records' photos (AGL-3616): the
 * planned field that names a photo ("Image", "Photo") becomes the data
 * plugin's `image` field, else one called "Image" is added after the others,
 * and each record holds its photo there; a record with none holds nothing.
 * Pure.
 */
export function aiSiteDatasetContentWithPhotos(
  content: Record<string, unknown>,
  photos: ReadonlyArray<string | null>,
): Record<string, unknown> {
  const fields = (Array.isArray(content['fields']) ? content['fields'] : []) as Array<{ name: string; type?: string }>
  const named = fields.find((field) => IMAGE_FIELD_NAME.test(str(field.name)))
  const fieldName = named ? named.name : AI_SITE_DATASET_IMAGE_FIELD
  const nextFields = named
    ? fields.map((field) => (field === named ? { ...field, type: 'image' } : field))
    : [...fields, { name: AI_SITE_DATASET_IMAGE_FIELD, type: 'image' }]
  const records = (Array.isArray(content['records']) ? content['records'] : []) as Array<Record<string, unknown>>
  return {
    ...content,
    fields: nextFields,
    records: records.map((record, index) => {
      const next = { ...record }
      delete next[fieldName]
      const photo = photos[index]
      return photo ? { ...next, [fieldName]: photo } : next
    }),
  }
}

export interface AiSiteDatasetRunnerDeps {
  generate?: typeof generateAiDataset
  writerFor?: typeof pluginResourceDraftWriter
  /** Where a pictured dataset's photos come from; the stock library, else the starters, otherwise. */
  photos?: typeof aiSiteDatasetRecordPhotos
}

/** The fields and record names a written dataset reports, as its output's proposal keeps them. */
interface AiSiteDatasetProposal {
  fields: AiLayoutListingField[]
  /** Each record's name: its first field's value. */
  recordNames: string[]
  addressField: string | null
  /** The field each record's photo is in, where it has one (AGL-3616). */
  imageField?: string | null
  /** The library photos its records show (`media:` references), which no page places again. */
  photos?: string[]
}

function proposalOf(output: Pick<AiJobOutput, 'proposal'>): AiSiteDatasetProposal {
  const raw = (output.proposal ?? {}) as Partial<AiSiteDatasetProposal>
  return {
    fields: Array.isArray(raw.fields)
      ? raw.fields.filter((field) => field && typeof field.id === 'string' && field.id).map((field) => ({ id: field.id, name: str(field.name) || field.id, type: str(field.type) || 'text' }))
      : [],
    recordNames: Array.isArray(raw.recordNames) ? raw.recordNames.map(str).filter(Boolean).slice(0, 12) : [],
    addressField: str(raw.addressField) || null,
    imageField: str(raw.imageField) || null,
    photos: Array.isArray(raw.photos) ? raw.photos.map(str).filter((src) => src.startsWith('media:')).slice(0, 24) : [],
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
  const photosFor = deps.photos ?? aiSiteDatasetRecordPhotos
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
      const facts = written.facts as { fields?: AiLayoutListingField[]; addressField?: string | null; imageField?: string | null }
      const again = output(
        written.id,
        written.name || creation.name,
        { fields: facts.fields ?? [], recordNames: [], addressField: facts.addressField ?? null, imageField: facts.imageField ?? null },
        0,
      )
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
    const designed = aiDatasetDraftContent(creation.name, generation.value, { recordPages: input.recordPages })
    // A list a visitor looks at keeps its records' photos (AGL-3616): searched
    // in code, never asked of the model, so they cost no credits.
    const photos = input.pictures
      ? await photosFor({
          job,
          name: creation.name,
          names: generation.value.records.map((values) => values[0] ?? ''),
          pictures: input.pictures,
          ...(signal ? { signal } : {}),
        }).catch(() => [] as AiSiteDatasetRecordPhoto[])
      : []
    const content = input.pictures
      ? aiSiteDatasetContentWithPhotos(designed, generation.value.records.map((_values, index) => photos[index]?.src ?? null))
      : designed
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
    const facts = result.facts as {
      fields?: AiLayoutListingField[]
      records?: number
      addressField?: string | null
      imageField?: string | null
    }
    const placed = photos.flatMap((photo) => (photo.placed ? [photo.placed] : []))
    const proposal: AiSiteDatasetProposal = {
      fields: facts.fields ?? [],
      recordNames: generation.value.records.map((values) => values[0] ?? '').filter(Boolean).slice(0, 12),
      addressField: facts.addressField ?? null,
      ...(facts.imageField ? { imageField: facts.imageField } : {}),
      ...(placed.length ? { photos: placed } : {}),
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
  datasets: ReadonlyArray<{ id: string; name: string; records?: string[]; fields?: AiLayoutListingField[]; imageField?: string | null }>,
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
        // Its card leads with the record's photo (AGL-3616).
        ...(dataset.imageField ? { imageField: dataset.imageField } : {}),
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
        // The address field is the record page's, never a card's words; the
        // photo is the card's picture, never its words (AGL-3616).
        fields: proposal.fields.filter((field) => field.id !== proposal.addressField && field.id !== proposal.imageField),
        imageField: proposal.imageField ?? null,
      },
    ]
  })
  return aiDatasetListingsOf(made, input.screens)
}

/** The library photos the site's datasets' records show (AGL-3616), which a page does not place again. */
export function aiSiteDatasetPlacedPhotos(outputs: readonly AiJobOutput[]): string[] {
  return [
    ...new Set(
      outputs
        .filter((output) => output.resource === 'draft' && output.draftResource === AI_SITE_DATASET_RESOURCE)
        .flatMap((output) => proposalOf(output).photos ?? []),
    ),
  ]
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
