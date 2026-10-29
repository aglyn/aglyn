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

import { mediaRefFromCdnPath } from '@aglyn/aglyn/app-utils/media-ref'
import { checkDatasetQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { pluginRecordIndex } from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import {
  AI_BUILD_PLAN_LIMITS,
  AI_PLAN_NEW_REF_PREFIX,
  isAiPlanNewRef,
  type AiBuildPlan,
  type AiBuildPlanCreate,
  type AiBuildPlanScreen,
} from '../model/ai-build-plan'
import type { AiInventoryDataset, AiSiteInventory } from '../model/ai-site-inventory'
import { AI_TYPED_LIST_MIN_ITEMS } from '../runtime/ai-doctrine-validators'
import type { AiJob, AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import type { AiPlanCapabilities } from '../model/ai-plan-capabilities'
import { AI_SITE_DATASETS_MAX } from '../model/ai-site-job'
import { AI_STEP_TIERS } from '../providers/catalog'
import { aiModelForStep } from '../providers/routing'
import {
  AI_DATASET_MAX_TOKENS,
  AI_DATASET_PLACEHOLDER_CODE,
  AI_DATASET_STEP,
  aiDatasetDraftContent,
  aiDatasetListedAsPast,
  aiDatasetRealRecords,
  aiDatasetSampleDates,
  aiDatasetWithoutInstructions,
  aiDatasetWithoutPlaceholders,
  generateAiDataset,
  type AiDatasetSplit,
} from '../runtime/ai-dataset-generation'
import type { AiDataset } from '../tools/ai-dataset-tool'
import {
  aiLayoutListingId,
  aiLayoutRecordBaseOf,
  aiLayoutRecordsPlacements,
  type AiLayoutListing,
  type AiLayoutListingField,
  type AiLayoutListingScreen,
} from '../layout-language/ai-layout-listings'
import {
  aiLayoutNeutralStarterRun,
  aiLayoutSeedNumber,
  aiLayoutStarterPhotos,
  type AiLayoutPicturePhoto,
  type AiLayoutPictureReport,
  type AiLayoutPictureSlot,
} from '../layout-language/ai-layout-pictures'
import { aiSiteWords } from '../model/ai-site-job'
import { aiSiteIsStarterSrc, type AiSitePhotos, type AiSiteStarterList, type AiStockRefusedPicks } from '../model/ai-site-photos'
import type { AiJobAdmissionContext } from './ai-job-admission'
import { aiOriginJobId } from './ai-job-draft-ids'
import { aiSiteProductPhotoSrc } from './ai-job-site-content'
import {
  aiLayoutStockPhotoSource,
  aiStockJobPhotosOf,
  aiStockPhotoWordsOf,
  aiStockRecordScene,
  aiStockStem,
} from './ai-layout-stock-photos'
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
 *    has: the member's "Manage data" (`data.manage`), `release_data_store`,
 *    `dataStore` (Starter and up), `datasetsPerOrg` counted inside the create,
 *    `recordsPerDataset` and the storage band. Each seeded record's
 *    reference and filter index is that writer's to stamp, with the data
 *    plugin's `datasetIntegrityFields` (`server/dataset-drafts.ts`), so this
 *    file writes no record of its own: its `'records'` is a listing's kind and
 *    its `values` a section group's.
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
  /**
   * The sections of one page that each list part of it, and the value of a
   * planned field each lists (AGL-4065, {@link aiSiteDatasetSplitOf}):
   * absent where no page lists it twice.
   */
  split?: AiDatasetSplit
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

/**
 * The note a dataset that starts with samples carries (AGL-4065): the brief
 * gave no entries for the list, so its rows are samples to replace.
 */
export function aiSiteDatasetSampleNote(records: number, samples: number): string {
  return samples >= records
    ? `${records} sample ${records === 1 ? 'record' : 'records'} to start, made because the brief gave none: replace them with your own in Data, and every page that lists them follows.`
    : `${records} records to start, ${samples} of them ${samples === 1 ? 'a sample' : 'samples'} to replace with your own, in Data. Edit them there and every page that lists them follows.`
}

/**
 * The note a dataset written with no records carries (AGL-4065): where its
 * rows go. A list the brief gives no entries for starts with samples
 * (`AI_DATASET_LIST_WITHOUT_ENTRIES`), so this is the one whose samples were
 * placeholders even after the re-ask, or a start that makes none. Its band
 * stays on every page that lists it — its heading, one honest line, and the
 * live list the owner's first row fills.
 */
export function aiSiteDatasetEmptyNote(name: string): string {
  return `No ${name} rows yet: add them in Data › ${name}, and every page that lists them follows.`
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
  dataset: Pick<AiBuildPlanCreate, 'name'> & Partial<Pick<AiBuildPlanCreate, 'fields'>>,
  screens: readonly AiBuildPlanScreen[],
  create: readonly AiBuildPlanCreate[] = [],
): AiSiteDatasetInput {
  const shownIn: string[] = []
  const sectionNames: string[] = []
  let split: AiDatasetSplit | null = null
  for (const screen of screens) {
    const here: string[] = []
    for (const section of screen.sections) {
      if (!section.uses.some((ref) => namesDataset(ref, dataset.name))) continue
      shownIn.push(`${screen.title} › ${section.name}${section.items ? ` (${section.items} items)` : ''}`)
      sectionNames.push(section.name)
      here.push(section.name)
    }
    // A page that lists it twice lists part of it in each (AGL-4065).
    split ??= aiSiteDatasetSplitOf({ name: dataset.name, fields: dataset.fields ?? [] }, here)
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
    ...(split && !form ? { split } : {}),
  }
}

// ── Two lists of one dataset on one page (AGL-4065) ─────────────────────

/** A planned field that can tell a page's lists of one dataset apart: a status, a stage, a category. */
const SPLIT_FIELD =
  /^(?:status|state|stage|timing|when|category|categories|type|kind|group|section|season|period|collection|series|occasion)$/i

/** Words a section's name frames its records with, which name no value of theirs. */
const SPLIT_FRAMING = new Set(
  'a an and the of our my your for with in at to by from all more list lists see view this these those here every each recent selected featured gallery galleries photos pictures cards grid section'.split(
    ' ',
  ),
)

/** A planned field's name without the type a form's dataset may give it: "Status:text" is "Status". */
const plainField = (spec: string) => {
  const at = spec.lastIndexOf(':')
  return (at > 0 ? spec.slice(0, at) : spec).trim()
}

/** A word as a split compares it: lowercase, a plural's "-s" dropped. */
const splitStem = (word: string) => {
  const lower = word.toLowerCase()
  return lower.length > 3 && lower.endsWith('s') && !lower.endsWith('ss') ? lower.slice(0, -1) : lower
}

/**
 * The value of a dataset's planned field each of a page's sections lists
 * (AGL-4065), where the page lists the dataset in two sections or more: the
 * words of each section's name that are not the dataset's own (its name, its
 * fields) nor framing — "Upcoming races" and "Past results" over "Race
 * events", whose fields include Result and Status, are "Upcoming" and
 * "Past". `null` where the dataset plans no field that files its records
 * (a Status, a Category, a Type…), or a section names no value of its own,
 * or two name the same. Pure.
 */
export function aiSiteDatasetSplitOf(
  dataset: { name: string; fields: readonly string[] },
  sections: readonly string[],
): AiDatasetSplit | null {
  if (sections.length < 2) return null
  const field = dataset.fields.map(plainField).find((name) => SPLIT_FIELD.test(name))
  if (!field) return null
  const own = new Set(
    [dataset.name, ...dataset.fields.map(plainField)].flatMap((text) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(splitStem)),
  )
  const values = sections.map((section) => {
    const words = section.split(/\s+/).filter(Boolean)
    const named = (word: string) => {
      const stem = splitStem(word.replace(/[^\p{L}\p{N}-]+/gu, ''))
      return Boolean(stem) && !own.has(stem) && !SPLIT_FRAMING.has(stem)
    }
    // The value is the run of the name's words between its framing at either end.
    let start = 0
    let end = words.length
    while (start < end && !named(words[start] as string)) start += 1
    while (end > start && !named(words[end - 1] as string)) end -= 1
    const kept = words.slice(start, end).join(' ').replace(/[^\p{L}\p{N}]+$/u, '')
    return kept && kept.split(' ').length <= 3 ? kept.charAt(0).toUpperCase() + kept.slice(1) : null
  })
  if (values.some((value) => !value)) return null
  const distinct = new Set(values.map((value) => (value as string).toLowerCase()))
  if (distinct.size !== values.length) return null
  return { field, sections: [...sections], values: values as string[] }
}

/**
 * A site start's plan with each page that lists one of its new datasets in
 * two sections or more, where nothing can tell those sections' records apart
 * ({@link aiSiteDatasetSplitOf}), listing it in one (AGL-4065): the first
 * section keeps its place and takes the others' names and the most items
 * any of them planned, and the others come off. Two lists of one dataset on
 * one page would otherwise show the same records twice: the platform's
 * repeat can filter by a field's value, and has no "the next five". A plan
 * that needs no fold comes back as it was. Pure.
 */
export function aiSettlePlanSplitListings<P extends Pick<AiBuildPlan, 'screens' | 'create'>>(plan: P): P {
  const datasets = plan.create.filter((entry) => entry.kind === 'dataset')
  if (!datasets.length) return plan
  let changed = false
  const screens = plan.screens.map((screen) => {
    let sections = screen.sections
    for (const dataset of datasets) {
      const listing = sections.flatMap((section, index) => (section.uses.some((ref) => namesDataset(ref, dataset.name)) ? [index] : []))
      if (listing.length < 2) continue
      const names = listing.map((index) => sections[index]?.name ?? '')
      if (aiSiteDatasetSplitOf({ name: dataset.name, fields: dataset.fields }, names)) continue
      const [first, ...rest] = listing as [number, ...number[]]
      const joined = names.reduce((all, name, at) => {
        // A name's first letter is lowered after the first, unless it opens an acronym ("ATV parts").
        const said = /^\p{Lu}\p{Ll}/u.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name
        return at === 0 ? name : `${all}${at === names.length - 1 ? ' and ' : ', '}${said}`
      }, '')
      const items = Math.max(...listing.map((index) => sections[index]?.items ?? 0))
      const uses = [...new Set(listing.flatMap((index) => sections[index]?.uses ?? []))]
      sections = sections.flatMap((section, index) =>
        index === first ? [{ ...section, name: joined, uses, items }] : rest.includes(index) ? [] : [section],
      )
      changed = true
    }
    return sections === screen.sections ? screen : { ...screen, sections }
  })
  return changed ? { ...plan, screens } : plan
}

/**
 * A designed dataset's split field held to the values its sections list
 * (AGL-4065): a record whose value is one of them in another case takes
 * the section's spelling, so the page's filter (`status == Upcoming`) lists
 * it. Pure.
 */
function aiDatasetWithSplitValues(dataset: AiDataset, split: AiDatasetSplit | undefined): AiDataset {
  const column = split ? dataset.fields.findIndex((field) => field.name.trim().toLowerCase() === split.field.trim().toLowerCase()) : -1
  if (!split || column < 1) return dataset
  const spelled = new Map(split.values.map((value) => [value.trim().toLowerCase(), value]))
  return {
    ...dataset,
    records: dataset.records.map((values) => {
      const value = (values[column] ?? '').trim()
      const own = spelled.get(value.toLowerCase())
      return own && own !== value ? values.map((entry, at) => (at === column ? own : entry)) : [...values]
    }),
  }
}

/** A value's words as a split compares them: "Family portraits" is "Family portrait". */
const splitWords = (value: string) => value.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(splitStem).join(' ')

/**
 * The values a page's sections list, each as its records spell it where one
 * is the same words in another form ("Family portraits" for a section's
 * "Family portrait"), so a section matches one value, never two. Pure.
 */
function splitSpellings(expected: readonly string[], recorded: readonly string[]): string[] {
  return expected.map((value) => recorded.find((own) => own && splitWords(own) === splitWords(value)) ?? value)
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
    ...splitOf(raw.split),
  }
}

/** A unit input's split as its job carries it; one that does not read is none. */
function splitOf(raw: unknown): { split?: AiDatasetSplit } {
  const split = (raw ?? {}) as Partial<AiDatasetSplit>
  const field = str(split.field)
  const sections = Array.isArray(split.sections) ? split.sections.map(str).filter(Boolean).slice(0, 8) : []
  const values = Array.isArray(split.values) ? split.values.map(str).filter(Boolean).slice(0, 8) : []
  return field && sections.length >= 2 && values.length === sections.length ? { split: { field, sections, values } } : {}
}

/** The most fields a form's dataset is designed with: the data plugin writer's own ceiling is higher. */
export const AI_SITE_FORM_DATASET_FIELDS_MAX = 12

/** The field types a planned `Name:type` may name, as the data plugin's writer takes them. */
const FORM_DATASET_FIELD_TYPES = ['text', 'number', 'integer', 'boolean', 'list'] as const

/** A planned field as a person reads it: `fullName` and `full_name` are "Full name", `fechaDeÚltimaVisita` "Fecha de última visita". */
export function aiSiteDatasetFieldName(planned: string): string {
  const words = planned
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
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

/**
 * The field a pictured dataset keeps what each record's photo shows in
 * (AGL-3856), which its card's and its page's Image take as their alt text:
 * a record's title is what it is called, never what its photo shows.
 */
export const AI_SITE_DATASET_IMAGE_ALT_FIELD = 'Image description'

/** A planned field that already names a record's photo. */
const IMAGE_FIELD_NAME =
  /^(?:main |cover |hero |featured? )?(?:image|photo|picture|photograph|thumbnail|headshot|portrait|cover)s?$/i

/** One record's photo: the address its Image shows, and the library asset placed, which no page shows again. */
export interface AiSiteDatasetRecordPhoto {
  /** The media library's CDN path, or a starter's site path; `null` for none. */
  src: string | null
  /** The `media:` reference of the stock photo placed, or `null` for a starter. */
  placed: string | null
  /** What the photo shows, in its own words (AGL-3856); `null` for none. */
  alt?: string | null
  /** The library photo's size, where it is one (AGL-3988): what a page the library fails reuses it at. */
  width?: number
  height?: number
  /**
   * The picks the library's image hosts refused for a record left on a
   * starter (AGL-3988), which the site start's late photo pass asks again.
   */
  refused?: AiStockRefusedPicks
  /** A starter on a site with no stock library (AGL-3988): it keeps it, and no late pass fills it. */
  noLibrary?: true
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
  job: Pick<AiJob, '$id' | 'hostId' | 'createdBy' | 'inputs' | 'brief' | 'plan'>
  /** The dataset, as the plan named it. */
  name: string
  /** Each record's name, by position. */
  names: readonly string[]
  /** What each record is filed under, by position ({@link aiSiteDatasetCategoryOf}, AGL-3856); absent for a list that files none. */
  categories?: ReadonlyArray<string | null>
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
    // A record's name is a search's words, never what its photo shows (AGL-3856).
    standIn: true,
    // A team's record shows an adult in their role, never a child (AGL-3856).
    ...(people ? { people: true } : {}),
    // A piece's record is OF what it names and what it is filed under (AGL-3856).
    ...(people ? {} : { record: input.categories?.[index]?.trim() ? { category: (input.categories[index] as string).trim() } : {} }),
  }))
  const seed = `${job.$id}:records`
  let found: ReadonlyArray<AiLayoutPicturePhoto | null> = []
  /** The picks the image hosts refused, by record (AGL-3988). */
  const report: AiLayoutPictureReport = { refused: new Map() }
  /** Whether the site has a stock library: its records then never take a starter that shows another business (AGL-3988). */
  let library = false
  try {
    const source = (input.stockPhotos ?? aiLayoutStockPhotoSource)(
      {
        hostId: job.hostId,
        uid: job.createdBy,
        seed,
        business: aiSiteWords(job.inputs).about || job.brief,
        ...aiStockPhotoWordsOf(job),
        sectionNames: [input.name],
        jobId: aiOriginJobId(job),
        // Each record may try its name, its object and the site's world.
        searches: slots.length * 3,
        ...(input.signal ? { signal: input.signal } : {}),
      },
      { budgetMs: AI_SITE_DATASET_PHOTOS_BUDGET_MS },
    )
    library = Boolean(source)
    if (source) found = await source(slots, report)
  } catch (error) {
    console.warn('ai site dataset: the stock photos failed; the job’s own photos or starters fill them', { error: String(error) })
  }
  const hostId = job.hostId
  const copied: Array<AiLayoutPicturePhoto | null> = slots.map((_slot, index) => (found[index]?.src ? (found[index] as AiLayoutPicturePhoto) : null))
  // A record left without a photo takes one this list already shows, on its
  // own subject (AGL-3988), before any starter.
  const photos =
    library && !people
      ? aiSiteDatasetRecordsFromOwn(
          input.names.map((name, index) => ({ name, category: input.categories?.[index] ?? null })),
          copied,
          seed,
        )
      : copied
  // Only a job with no photo of its own takes starters: with a library, the
  // neutral ones in turn, never a workbench or houseplants (AGL-3923); a
  // team's records, and a site with no library, the starters as before.
  const starters = library && !people ? aiLayoutNeutralStarterRun(slots.length, seed) : aiLayoutStarterPhotos(slots, seed)
  return slots.map((_slot, index) => {
    const photo = photos[index]
    const stock = aiSiteProductPhotoSrc(photo?.src, hostId)
    if (photo && stock) {
      const copied = found[index]?.src === photo.src
      return {
        src: stock,
        placed: copied ? photo.src : null,
        alt: photo.alt?.trim() || null,
        width: photo.width,
        height: photo.height,
      }
    }
    const refused = report.refused.get(slots[index] as AiLayoutPictureSlot)
    return {
      src: aiSiteProductPhotoSrc(starters[index]?.src, hostId),
      placed: null,
      alt: starters[index]?.alt?.trim() || null,
      ...(refused ? { refused } : {}),
      ...(library ? {} : { noLibrary: true as const }),
    }
  })
}

/**
 * The photos of a list's records, each record its library left without one
 * given one of those the list already shows (AGL-3988). The beta.270 Sugar
 * Hollow Photography covers, a wedding photographer's, filed five "Weddings
 * and elopements" galleries under a windowsill, a workbench, a desk and an
 * office team, every copy refused by Pixabay's rate limit, while three of
 * its records had copied a snowy mountain wedding, a couple at sunset and a
 * father and son in the mountains.
 *
 * A record takes, in order: a photo of a record filed under the same
 * category; a photo whose words name the people its own moment shows
 * (`aiStockRecordScene`: a couple for "Couple Portraits", never a family);
 * either again where only the record beside it shows them; and last any
 * photo the list shows. Never the photo of the record beside it while
 * another fits, the least shown first, the seed picking among equals. A
 * record no photo fits keeps none, and takes a starter. Pure.
 *
 * `besideLast` is the site start's late photo pass (AGL-3988): there the
 * other choice is a starter photo of another business, so a record every
 * photo sits beside takes the photo beside it rather than none.
 */
export function aiSiteDatasetRecordsFromOwn(
  records: ReadonlyArray<{ name: string; category?: string | null }>,
  photos: ReadonlyArray<AiLayoutPicturePhoto | null>,
  seed: string,
  /**
   * The photos the job copied for its pages (AGL-3988), which the site
   * start's late photo pass offers a list whose own photos were all refused:
   * filed under no category, so each is taken by the people it shows.
   */
  others: readonly AiLayoutPicturePhoto[] = [],
  options: { besideLast?: boolean } = {},
): Array<AiLayoutPicturePhoto | null> {
  const listed = photos.flatMap((photo, index) => (photo?.src ? [{ photo, index }] : []))
  const shownHere = new Set(listed.map((entry) => entry.photo.src))
  const own = [
    ...listed,
    ...others
      .filter((photo, at, all) => photo.src && !shownHere.has(photo.src) && all.findIndex((one) => one.src === photo.src) === at)
      .map((photo, at) => ({ photo, index: records.length + at })),
  ]
  if (!own.length) return [...photos]
  /** Every place a photo is ranked from: the list's records, then the job's other photos. */
  const span = records.length + own.length - listed.length
  const category = (index: number) => records[index]?.category?.replace(/\s+/g, ' ').trim().toLowerCase() ?? ''
  const turn = aiLayoutSeedNumber(seed)
  /** Whether a photo's words name the people a record's moment shows, and none it never shows. */
  const shows = (photo: AiLayoutPicturePhoto, record: { name: string; category?: string | null }) => {
    const scene = aiStockRecordScene(record.name, record.category ?? '')
    if (!scene) return false
    const stems = new Set(
      (photo.alt ?? '')
        .toLowerCase()
        .split(/[^a-z\u00c0-\u024f]+/)
        .filter(Boolean)
        .map(aiStockStem),
    )
    return scene.people.some((stem) => stems.has(stem)) && !scene.shun.some((stem) => stems.has(stem))
  }
  /** The list filled in one order; the record beside one filled before it is known, the one after not yet. */
  const fill = (order: readonly number[]) => {
    const filled = [...photos]
    for (const index of order) {
      const record = records[index]
      if (!record || filled[index]?.src) continue
      const beside = new Set([filled[index - 1]?.src, filled[index + 1]?.src].filter(Boolean))
      const apart = (entry: { photo: AiLayoutPicturePhoto }) => !beside.has(entry.photo.src)
      const same = own.filter((entry) => category(index) && category(entry.index) === category(index))
      const subject = own.filter((entry) => shows(entry.photo, record))
      const pool = [same.filter(apart), subject.filter(apart), same, subject, own.filter(apart), options.besideLast ? own : []].find(
        (list) => list.length,
      )
      if (!pool) continue
      const uses = (src: string) => filled.filter((photo) => photo?.src === src).length
      const rank = (at: number) => (((at - turn) % span) + span) % span
      const [pick] = [...pool].sort((a, b) => uses(a.photo.src) - uses(b.photo.src) || rank(a.index) - rank(b.index))
      if (pick) filled[index] = { ...pick.photo }
    }
    return filled
  }
  // Filled from either end, the one that shows a photo beside itself least:
  // a record beside a copied one is the most held, and is served first.
  const forward = fill(records.map((_record, index) => index))
  const backward = fill(records.map((_record, index) => records.length - 1 - index))
  const repeats = (list: ReadonlyArray<AiLayoutPicturePhoto | null>) =>
    list.filter((photo, index) => index > 0 && photo?.src && photo.src === list[index - 1]?.src).length
  return repeats(backward) < repeats(forward) ? backward : forward
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
  /** What each record's photo shows (AGL-3856), kept in {@link AI_SITE_DATASET_IMAGE_ALT_FIELD}; none adds no field. */
  alts: ReadonlyArray<string | null> = [],
): Record<string, unknown> {
  const fields = (Array.isArray(content['fields']) ? content['fields'] : []) as Array<{ name: string; type?: string }>
  const named = fields.find((field) => IMAGE_FIELD_NAME.test(str(field.name)))
  const fieldName = named ? named.name : AI_SITE_DATASET_IMAGE_FIELD
  const withImage = named
    ? fields.map((field) => (field === named ? { ...field, type: 'image' } : field))
    : [...fields, { name: AI_SITE_DATASET_IMAGE_FIELD, type: 'image' }]
  const described = alts.some((alt, index) => Boolean(alt && photos[index]))
  const altName = AI_SITE_DATASET_IMAGE_ALT_FIELD
  const nextFields =
    described && !withImage.some((field) => str(field.name).toLowerCase() === altName.toLowerCase())
      ? [...withImage, { name: altName, type: 'text' }]
      : withImage
  const records = (Array.isArray(content['records']) ? content['records'] : []) as Array<Record<string, unknown>>
  return {
    ...content,
    fields: nextFields,
    records: records.map((record, index) => {
      const next = { ...record }
      delete next[fieldName]
      const photo = photos[index]
      const alt = photo && described ? alts[index] : null
      return photo ? { ...next, [fieldName]: photo, ...(alt ? { [altName]: alt } : {}) } : next
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
  /**
   * The same photos with their size and words (AGL-3988): what a page's
   * picture the library fails takes before any starter.
   */
  placedPhotos?: AiLayoutPicturePhoto[]
  /**
   * The fields most of its first records leave empty, by id (AGL-3616): a
   * tour's venues not yet known. A card never binds one — it would print
   * nothing on most records — so its listing leaves them out.
   */
  sparseFields?: string[]
  /**
   * What its records are filed under (AGL-3921): the category-like field, by
   * id, and each record's value of it, by position as {@link recordNames}.
   * A section named for one value lists only its records. Where a page lists
   * it in sections each naming a value of one planned field (AGL-4065), that
   * field, with the values the sections list as `expected`, so each section
   * is filtered even before the owner adds its first row.
   */
  groups?: { field: string; values: string[]; expected?: string[] }
  /** It was designed with no records (AGL-4065): the brief gave none, and the pages say so. */
  emptyList?: true
}

/** A field whose name says it files its records: a category, a type, a kind. */
const CATEGORY_FIELD = /^(?:(?:gallery|session|service|event|course|class|product|menu|work|project) )?(?:category|categories|type|kind|collection|genre|group|section|subject|occasion|series)$/i

/**
 * What a designed dataset's records are filed under (AGL-3921): its first
 * field whose name says it files them ("Category", "Type", "Session type"),
 * with each record's value, where they hold at least two different values
 * and some record shares one — a list that files every record apart files
 * none. `null` otherwise. Pure.
 */
export function aiSiteDatasetCategoryOf(dataset: {
  fields: ReadonlyArray<{ name: string }>
  records: ReadonlyArray<ReadonlyArray<string | undefined>>
}): { column: number; name: string; values: Array<string | null> } | null {
  for (const [column, field] of dataset.fields.entries()) {
    if (column === 0 || !CATEGORY_FIELD.test(field.name.trim())) continue
    const values = dataset.records.map((values) => (values[column] ?? '').replace(/\s+/g, ' ').trim() || null)
    const distinct = new Set(values.filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase()))
    if (distinct.size >= 2 && distinct.size < values.filter(Boolean).length) return { column, name: field.name, values }
  }
  return null
}

/**
 * A dataset's groups as its proposal keeps them: the written field's id, and
 * the value of each record its {@link AiSiteDatasetProposal.recordNames} names.
 */
function aiSiteDatasetGroupsOf(
  category: ReturnType<typeof aiSiteDatasetCategoryOf>,
  written: readonly AiLayoutListingField[],
  designed: { fields: ReadonlyArray<{ name: string }>; records: ReadonlyArray<ReadonlyArray<string | undefined>> },
): Pick<AiSiteDatasetProposal, 'groups'> {
  if (!category) return {}
  const field =
    written.find((entry) => entry.name.trim().toLowerCase() === category.name.trim().toLowerCase())?.id ??
    (written.length === designed.fields.length ? written[category.column]?.id : undefined)
  if (!field) return {}
  const values = designed.records.flatMap((record, index) => record[0] ? [category.values[index] ?? ''] : []).slice(0, 12)
  return { groups: { field, values } }
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
    imageField: str(raw.imageField) || null,
    photos: Array.isArray(raw.photos) ? raw.photos.map(str).filter((src) => src.startsWith('media:')).slice(0, 24) : [],
    sparseFields: Array.isArray(raw.sparseFields) ? raw.sparseFields.map(str).filter(Boolean) : [],
    ...(raw.groups && typeof raw.groups === 'object' && str(raw.groups.field) && Array.isArray(raw.groups.values)
      ? {
          groups: {
            field: str(raw.groups.field),
            values: raw.groups.values.slice(0, 12).map(str),
            ...(Array.isArray(raw.groups.expected) ? { expected: raw.groups.expected.map(str).filter(Boolean).slice(0, 8) } : {}),
          },
        }
      : {}),
    ...(raw.emptyList === true ? { emptyList: true as const } : {}),
  }
}

/**
 * A dataset's groups for the page that lists it in sections each named for a
 * value of one planned field (AGL-4065): that field, by its written id, each
 * record's value of it, and the values the sections list. `null` where the
 * written dataset has no such field.
 */
function aiSiteDatasetSplitGroups(
  split: AiDatasetSplit | undefined,
  written: readonly AiLayoutListingField[],
  designed: AiDataset,
): AiSiteDatasetProposal['groups'] | null {
  if (!split) return null
  const name = split.field.trim().toLowerCase()
  const field = written.find((entry) => entry.name.trim().toLowerCase() === name)?.id
  const column = designed.fields.findIndex((entry) => entry.name.trim().toLowerCase() === name)
  if (!field || column < 1) return null
  const values = designed.records.flatMap((record) => (record[0] ? [(record[column] ?? '').trim()] : [])).slice(0, 12)
  return { field, values, expected: splitSpellings(split.values, values) }
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
      // The value of a field each of a page's lists of it shows (AGL-4065).
      ...(input.split ? { split: input.split } : {}),
      model,
      maxTokens: AI_SITE_DATASET_BUDGET.maxTokens(model),
      ...(signal ? { signal } : {}),
    })
    const spent = aiGenerationSpent(generation)
    if (generation.status === 'refused') return { ...spent, refused: true }
    // An answer that still numbers placeholders after its re-ask is kept with
    // the records that name real things — none, as often as not — and written
    // with its fields, for the owner to fill (AGL-4065). An instruction to the
    // owner in it is taken out first, so a sample keeps the rest of what it
    // says, and only a row nothing is left of goes (AGL-4092).
    const salvaged =
      generation.status === 'needs_input' && generation.violations.some((violation) => violation.code === AI_DATASET_PLACEHOLDER_CODE)
        ? aiDatasetWithoutPlaceholders(aiDatasetWithoutInstructions(generation.answer), {
            planned: creation.fields,
            merchantWords: job.brief,
            name: creation.name,
          })
        : null
    if (generation.status === 'needs_input' && !salvaged) return { ...spent, failure: generation.message }
    // No placeholder record is ever written, whatever let it through (AGL-4065);
    // a split field holds the values its sections list, and a dated list's
    // samples fall on a season's weekends from today, its past ones behind it.
    const language = (job.plan as AiJobPlan | null)?.language ?? null
    const value = aiDatasetSampleDates(
      aiDatasetWithSplitValues(
        aiDatasetRealRecords(generation.status === 'ok' ? generation.value : (salvaged as AiDataset), creation.name),
        input.split,
      ),
      {
        now: context.now,
        language,
        split: input.split ?? null,
        pastOnly: aiDatasetListedAsPast(input.shownIn.map((where) => where.split(' › ').slice(1).join(' › ') || where)),
      },
    )
    const designed = aiDatasetDraftContent(creation.name, value, {
      recordPages: input.recordPages,
      ...(language ? { language } : {}),
    })
    // What each record is filed under, which its photo and the sections that list it by its value read (AGL-3856).
    const category = aiSiteDatasetCategoryOf(value)
    // A list a visitor looks at keeps its records' photos (AGL-3616): searched
    // in code, never asked of the model, so they cost no credits.
    const photos = input.pictures
      ? await photosFor({
          job,
          name: creation.name,
          names: value.records.map((values) => values[0] ?? ''),
          ...(category ? { categories: category.values } : {}),
          pictures: input.pictures,
          ...(signal ? { signal } : {}),
        }).catch(() => [] as AiSiteDatasetRecordPhoto[])
      : []
    const content = input.pictures
      ? aiSiteDatasetContentWithPhotos(
          designed,
          value.records.map((_values, index) => photos[index]?.src ?? null),
          value.records.map((_values, index) => photos[index]?.alt ?? null),
        )
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
      // The allowance, the permission, the plan or the flag: the workspace's to change.
      return { ...spent, review: limitReview(result.error) }
    }
    const facts = result.facts as {
      fields?: AiLayoutListingField[]
      records?: number
      addressField?: string | null
      imageField?: string | null
    }
    const placed = photos.flatMap((photo) => (photo.placed ? [photo.placed] : []))
    const placedPhotos = photos.flatMap((photo) =>
      photo.placed && photo.width && photo.height
        ? [{ src: photo.placed, width: photo.width, height: photo.height, ...(photo.alt ? { alt: photo.alt } : {}) }]
        : [],
    )
    // A page's lists each named for a value of a planned field are filtered by it (AGL-4065), else by the category.
    const split = aiSiteDatasetSplitGroups(input.split, facts.fields ?? [], value)
    const proposal: AiSiteDatasetProposal = {
      fields: facts.fields ?? [],
      recordNames: value.records.map((values) => values[0] ?? '').filter(Boolean).slice(0, 12),
      addressField: facts.addressField ?? null,
      ...(facts.imageField ? { imageField: facts.imageField } : {}),
      ...(placed.length ? { photos: placed } : {}),
      ...(placedPhotos.length ? { placedPhotos } : {}),
      sparseFields: aiDatasetSparseFields(value, facts.fields ?? []),
      ...(split ? { groups: split } : aiSiteDatasetGroupsOf(category, facts.fields ?? [], value)),
      ...(value.records.length ? {} : { emptyList: true as const }),
    }
    // Its records left on a starter, which the site start's late photo pass fills (AGL-3988).
    const starters = aiSiteDatasetStarterList({
      dataset: result.id,
      hostId: job.hostId,
      imageField: facts.imageField ?? null,
      fields: facts.fields ?? [],
      people: input.pictures === 'people',
      names: value.records.map((values) => values[0] ?? ''),
      categories: category?.values ?? [],
      photos,
    })
    const count = facts.records ?? value.records.length
    const sampled = (value.samples ?? []).filter(Boolean).length
    const made = output(result.id, result.name, proposal, count)
    return {
      ...spent,
      outputs: [
        // A list the brief gave no rows for says its rows are samples, or where its rows go (AGL-4065).
        !value.records.length
          ? { ...made, note: aiSiteDatasetEmptyNote(creation.name) }
          : sampled
            ? { ...made, note: aiSiteDatasetSampleNote(value.records.length, sampled) }
            : made,
      ],
      ...(starters ? { sitePhotos: { pages: [], lists: [starters] } satisfies AiSitePhotos } : {}),
    }
  }
}

/**
 * A pictured list's records as the late photo pass reads them (AGL-3988),
 * where any of them holds a starter on a site with a stock library: each
 * record's name, category and photo
 * value in order, the library photo it shows as a media reference with its
 * size and words, and the picks the image hosts refused it. `null` where
 * every record shows a library photo, or the list keeps no photo field.
 */
export function aiSiteDatasetStarterList(input: {
  dataset: string
  hostId: string
  imageField: string | null
  fields: readonly AiLayoutListingField[]
  people: boolean
  names: readonly string[]
  categories: ReadonlyArray<string | null>
  photos: readonly AiSiteDatasetRecordPhoto[]
}): AiSiteStarterList | null {
  // A site with no stock library keeps its starters, as it always has.
  if (!input.imageField || !input.photos.some((photo) => aiSiteIsStarterSrc(photo.src) && !photo.noLibrary)) return null
  const altField = input.fields.find((field) => field.name.trim().toLowerCase() === AI_SITE_DATASET_IMAGE_ALT_FIELD.toLowerCase())?.id
  return {
    dataset: input.dataset,
    imageField: input.imageField,
    ...(altField ? { altField } : {}),
    ...(input.people ? { people: true } : {}),
    records: input.names.map((name, index) => {
      const photo = input.photos[index]
      const value = photo?.src ?? ''
      const src = aiSiteIsStarterSrc(value) ? null : photo?.placed || mediaRefFromCdnPath(value) || null
      const category = input.categories[index]?.trim()
      return {
        name,
        ...(category ? { category } : {}),
        value,
        ...(src && photo?.width && photo.height
          ? { photo: { src, width: photo.width, height: photo.height, ...(photo.alt ? { alt: photo.alt } : {}) } }
          : {}),
        ...(photo?.refused ? { refused: photo.refused } : {}),
      }
    }),
  }
}

export const runAiSiteDatasetUnit = createAiSiteDatasetRunner()

/**
 * Whether a dataset may be created for this member on this site, asked before
 * its first pass so a refusal spends nothing; `null` admits. The data plugin
 * must run here (on for the workspace and the site, past its release flag),
 * and its writer says whether this member may make one now: "Manage data",
 * the plan, the flag, the allowance.
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
  datasets: ReadonlyArray<{
    id: string
    name: string
    records?: string[]
    fields?: AiLayoutListingField[]
    imageField?: string | null
    /** The record's page-address field, where the writer added one (AGL-3727). */
    addressField?: string | null
    /** What its records are filed under, by position as `records` (AGL-3921): a section named for one value lists its records alone. */
    groups?: { field: string; values: readonly string[]; expected?: readonly string[] } | null
  }>,
  screens: readonly AiLayoutListingScreen[],
): AiLayoutListing[] {
  return datasets.flatMap((dataset) => {
    const placements = aiLayoutRecordsPlacements(dataset, screens)
    if (!placements.length) return []
    // Each card links its record's own page where the plan makes one (AGL-3727).
    const recordBase = aiLayoutRecordBaseOf(dataset, screens)
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
        // The address is read off the site's inventory where the build does not know it yet.
        ...(recordBase ? { recordBase, ...(dataset.addressField ? { addressField: dataset.addressField } : {}) } : {}),
        placements,
      },
    ]
  })
}

/**
 * A `records` listing for each dataset the workspace already keeps that a
 * site start's plan reuses and a section names (AGL-3771), as a build lists
 * the ones it reuses (AGL-3747). A second site in a workspace reuses the
 * first one's menu: its plan names the dataset by id, the start listed only
 * the datasets it made, and the page was asked to "place" a dataset no block
 * can draw — the home's "Del menú" section was refused for showing none of
 * its six items, and the Menú page published with no menu. A dataset one of
 * the plan's forms writes into holds the site's submissions, and is never
 * listed on a page.
 */
export function aiSiteReusedDatasetListings(input: {
  plan: Pick<AiJobPlan, 'reuse' | 'create' | 'labels'>
  screens: readonly AiLayoutListingScreen[]
  /** The listings the start already has, whose datasets are not listed twice. */
  listed: ReadonlyArray<Pick<AiLayoutListing, 'datasetId'>>
}): AiLayoutListing[] {
  const submissions = new Set(
    input.plan.create.flatMap((entry) => (entry.kind === 'form' && entry.writesTo && !isAiPlanNewRef(entry.writesTo) ? [entry.writesTo] : [])),
  )
  const listed = new Set(input.listed.map((listing) => listing.datasetId).filter(Boolean))
  const datasets = input.plan.reuse
    .filter((entry) => entry.kind === 'dataset' && !submissions.has(entry.id) && !listed.has(entry.id))
    .map((entry) => ({ id: entry.id, name: input.plan.labels?.[entry.id] || entry.id }))
  return aiDatasetListingsOf(datasets, input.screens)
}

/**
 * A SITE START NEVER SHOWS ANOTHER SITE'S RECORDS (AGL-3912).
 *
 * Datasets belong to the organization, and so do their records: neither
 * names the site it was written for, and a dataset outlives the site that
 * filled it (the data plugin keeps `visibleTo` and nothing else of a site). A
 * gym's start reused the workspace's "Session packages", "Coaches" and "Gym
 * FAQs", and published a deleted photographer's wedding packages and a
 * deleted studio's coach bio ("Leads coaching at Ironline Strength Studio")
 * with four broken photos; a photographer's start reused another
 * photographer's gallery and drew six broken covers.
 *
 * So a site start reuses a dataset only when its records are this site's to
 * show ({@link aiSiteDatasetIsThisSites}):
 *  - it holds no records at all — an empty list, such as the one a form
 *    writes its submissions to, is the same list on any site; or
 *  - its scope names this site alone (`siteOnly`), so it was made for it; or
 *  - this site already serves its records pages of their own (`recordBase`).
 * Anything else — records in a dataset shared with the workspace or with
 * other sites, and a dataset whose records could not be counted — was filled
 * for something else, and the plan is settled in code before the rules read
 * it ({@link aiSettleSiteForeignDatasets}): the reuse becomes a creation of
 * the same name and fields, designed from this site's brief with photos of
 * its own, and every section, record template and form that named it names
 * the creation. Where this job may create no dataset, the reuse comes off
 * instead and each section writes its items out. Never a refusal, and
 * nothing a member is asked.
 *
 * An Assist change to a site that exists keeps reusing what the site lists:
 * this is a site start's rule, and only its plan is settled by it.
 */
export function aiSiteDatasetIsThisSites(row: Pick<AiInventoryDataset, 'records' | 'siteOnly' | 'recordBase'>): boolean {
  return row.records === 0 || row.siteOnly === true || Boolean(row.recordBase)
}

/** A planned field that is a record's page address, which the writer adds itself. */
const ADDRESS_FIELD_NAME = /^(?:page )?(?:address|slug|url|link)$/i

/** The fields a dataset is made again with: its own, less the photo, its description and the page address the writer adds. */
function remadeFields(row: AiInventoryDataset): string[] {
  const ids = row.fieldIds ?? []
  return row.fields
    .filter((name, index) => {
      const id = ids[index]
      if (id && (id === row.imageField || id === row.addressField)) return false
      if (IMAGE_FIELD_NAME.test(name.trim()) || ADDRESS_FIELD_NAME.test(name.trim())) return false
      return name.trim().toLowerCase() !== AI_SITE_DATASET_IMAGE_ALT_FIELD.toLowerCase()
    })
    .slice(0, AI_BUILD_PLAN_LIMITS.fields)
}

/**
 * A site start's plan with every dataset it reuses that holds another
 * site's records made again for this one (AGL-3912): each the inventory marks
 * `foreign` ({@link aiSiteInventoryWithRecordCounts}, by
 * {@link aiSiteDatasetIsThisSites}). The creation keeps the dataset's name,
 * which rule 7 does not hold against it as a duplicate. Pure; a plan that
 * reuses none comes back as it was.
 */
export function aiSettleSiteForeignDatasets(
  plan: AiBuildPlan,
  inventory: Pick<AiSiteInventory, 'datasets'> | null,
  capabilities: AiPlanCapabilities | null = null,
): AiBuildPlan {
  const rows = new Map((inventory?.datasets ?? []).map((row) => [row.id, row]))
  const foreign = plan.reuse.filter((entry) => entry.kind === 'dataset' && rows.get(entry.id)?.foreign === true)
  if (!foreign.length) return plan
  const creatable = !capabilities || capabilities.create.dataset.allowed
  const taken = new Map<string, AiBuildPlanCreate | null>([
    ...plan.create.map((entry) => [entry.name.trim().toLowerCase(), entry] as const),
    ...(plan.items ?? []).map((item) => [item.name.trim().toLowerCase(), null] as const),
  ])
  // Each foreign dataset's id → the `new:` reference that replaces it, or `null` where it comes off.
  const replaced = new Map<string, string | null>()
  const added: AiBuildPlanCreate[] = []
  for (const entry of foreign) {
    const row = rows.get(entry.id) as AiInventoryDataset
    const base = row.name.trim() || 'Records'
    if (!creatable) {
      replaced.set(entry.id, null)
      continue
    }
    // The plan already makes one of that name: that one is this site's.
    const same = taken.get(base.toLowerCase())
    if (same?.kind === 'dataset') {
      replaced.set(entry.id, `${AI_PLAN_NEW_REF_PREFIX}${same.name}`)
      continue
    }
    let name = base
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${base} ${n}`
    const creation: AiBuildPlanCreate = {
      kind: 'dataset',
      name,
      why: entry.purpose || `Lists ${base} on this site.`,
      duplicateOf: null,
      fields: remadeFields(row),
    }
    added.push(creation)
    taken.set(name.toLowerCase(), creation)
    replaced.set(entry.id, `${AI_PLAN_NEW_REF_PREFIX}${name}`)
  }
  const swap = (ref: string): string | null => (replaced.has(ref) ? (replaced.get(ref) ?? null) : ref)
  return {
    ...plan,
    reuse: plan.reuse.filter((entry) => !(entry.kind === 'dataset' && replaced.has(entry.id))),
    create: [
      ...plan.create.map((entry) => {
        if (entry.kind !== 'form' || !entry.writesTo || !replaced.has(entry.writesTo)) return entry
        const writesTo = swap(entry.writesTo)
        if (writesTo) return { ...entry, writesTo }
        // A form whose dataset comes off sends its submissions to the Inbox only.
        const rest = { ...entry }
        delete rest.writesTo
        return rest
      }),
      ...added,
    ],
    screens: plan.screens.map((screen) => {
      // A record template of a dataset made again shows the new one; of one that comes off, it is a page of its own.
      const record =
        screen.record && replaced.has(screen.record.dataset) ? { record: swap(screen.record.dataset) } : null
      const sections = screen.sections.map((section) => {
        if (!section.uses.some((ref) => replaced.has(ref))) return section
        const uses = section.uses.flatMap((ref) => {
          const next = swap(ref)
          return next ? [next] : []
        })
        // A list that comes off is written out on the page, as fewer items than a dataset binds.
        const dropped = section.uses.some((ref) => replaced.has(ref) && !replaced.get(ref))
        return { ...section, uses, ...(dropped ? { items: Math.min(section.items, AI_TYPED_LIST_MIN_ITEMS - 1) } : {}) }
      })
      return {
        ...screen,
        ...(record && screen.record ? { record: record.record ? { ...screen.record, dataset: record.record } : null } : {}),
        sections,
      }
    }),
  }
}

/** How a dataset's records are counted: the data plugin's index, which answers `facts.records`. */
export type AiDatasetRecordCounter = (request: { orgId: string; id: string }) => Promise<number | null>

/** The production counter: the data plugin's `dataset` index, read one dataset at a time. */
export const aiDatasetRecordCount: AiDatasetRecordCounter = async ({ orgId, id }) => {
  const index = pluginRecordIndex('dataset')?.index
  if (!index) return null
  const found = await index.get({ orgId, id })
  const records = found?.facts['records']
  return typeof records === 'number' && Number.isFinite(records) ? records : null
}

/**
 * A site start's inventory with how many records each dataset holds
 * (AGL-3912), and each whose records are not this site's to show
 * ({@link aiSiteDatasetIsThisSites}) marked `foreign`. The count is asked
 * once per plan, of every dataset the site sees, all at once; a count that
 * fails leaves `records` out, which reads as another site's. Never throws.
 */
export async function aiSiteInventoryWithRecordCounts(
  inventory: AiSiteInventory | null,
  orgId: string,
  count: AiDatasetRecordCounter = aiDatasetRecordCount,
): Promise<AiSiteInventory | null> {
  if (!inventory?.datasets.length) return inventory
  const counts = await Promise.all(
    inventory.datasets.map((row) =>
      count({ orgId, id: row.id }).catch((error: unknown) => {
        console.warn('ai site plan: a dataset’s records could not be counted', { orgId, id: row.id, error: String(error) })
        return null
      }),
    ),
  )
  return {
    ...inventory,
    datasets: inventory.datasets.map((row, index) => {
      const records = counts[index]
      const counted = typeof records === 'number' ? { ...row, records } : row
      return aiSiteDatasetIsThisSites(counted) ? counted : { ...counted, foreign: true as const }
    }),
  }
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
        // photo is the card's picture, never its words; a field most records
        // leave empty is no card's either (AGL-3616).
        fields: proposal.fields.filter(
          (field, index) =>
            field.id !== proposal.addressField &&
            field.id !== proposal.imageField &&
            (index === 0 || !proposal.sparseFields?.includes(field.id)),
        ),
        imageField: proposal.imageField ?? null,
        addressField: proposal.addressField,
        groups: proposal.groups ?? null,
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

/** The same photos with their size and words (AGL-3988), which a page's picture the library fails takes before any starter. */
export function aiSiteDatasetPlacedPhotoDetails(outputs: readonly AiJobOutput[]): AiLayoutPicturePhoto[] {
  const seen = new Set<string>()
  return outputs
    .filter((output) => output.resource === 'draft' && output.draftResource === AI_SITE_DATASET_RESOURCE)
    .flatMap((output) => aiStockJobPhotosOf((output.proposal as { placedPhotos?: unknown } | null)?.placedPhotos))
    .filter((photo) => !seen.has(photo.src) && Boolean(seen.add(photo.src)))
}

/** What a page is told about the datasets built before it. */
export function aiSiteDatasetBriefLines(outputs: readonly AiJobOutput[]): string[] {
  const datasets = outputs.filter((output) => output.resource === 'draft' && output.draftResource === AI_SITE_DATASET_RESOURCE)
  return datasets.flatMap((output) => {
    const proposal = proposalOf(output)
    const names = proposal.recordNames
    if (names.length) {
      return [`This site's dataset “${output.label}” holds: ${names.map((name) => `“${name}”`).join(', ')}. Where a page names one, name it as written; never name one that is not in this list.`]
    }
    // A list written with no rows keeps its band (AGL-4065): its heading and
    // an honest line, over the live list the owner fills.
    return proposal.emptyList
      ? [
          `This site's dataset “${output.label}” has no records yet: the owner adds them in Data. Where a page lists it, write its heading and one line saying its entries are on the way, and never name, date or describe one.`,
        ]
      : []
  })
}
