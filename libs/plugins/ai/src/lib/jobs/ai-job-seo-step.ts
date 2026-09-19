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

import { hostCollectionKind } from '@aglyn/aglyn/app-utils/collection-kind'
import { hostPublicOrigin } from '@aglyn/aglyn/app-utils/host-naming'
import {
  buildLlmsTxt,
  type LlmsTxtCollection,
  type LlmsTxtPage,
} from '@aglyn/aglyn/app-utils/llms-txt'
import { nodesReferenceScreen } from '@aglyn/aglyn/app-utils/screen-link-value'
import { screenRoutePathToUrl } from '@aglyn/aglyn/app-utils/screen-route'
import {
  isScreenIndexable,
  isSearchDiscouraged,
  statusPageScreenIds,
} from '@aglyn/aglyn/app-utils/search-indexing'
import {
  SCREEN_SEO_LISTING_FIELDS,
  isSeoListingFieldKey,
  type SeoListingFieldKey,
} from '@aglyn/aglyn/app-utils/seo-listing-fields'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { getTemplateScreenIds } from '@aglyn/tenant-runtime/template-screens'
import type { AiJob, AiJobOutput } from '../model/ai-jobs.types'
import {
  AI_SEO_FINDING_LABELS,
  AI_SEO_OUTPUT_IDS,
  aiSeoAuditView,
  aiSeoJobTarget,
  type AiSeoAuditReport,
  type AiSeoContentFix,
  type AiSeoFieldsProposal,
  type AiSeoFieldValues,
  type AiSeoPageFix,
  type AiSeoSiteFormField,
  type AiSeoSiteProposal,
} from '../model/ai-seo'
import { aiModelForStep } from '../providers/routing'
import type { AiSystemBlock, AiUsage } from '../runtime/ai-runtime'
import {
  AI_SEO_AUDIT_MAX_PAGES,
  aiSeoAudit,
  aiSeoAuditBatches,
  aiSeoHeadingDemotions,
  aiSeoNormalizePath,
  parseAiSeoKeywordLines,
  type AiSeoAuditPage,
} from '../runtime/seo-audit'
import {
  runValidatedGeneration,
  type AiGenerationSpend,
  type AiValidatedGeneration,
} from '../runtime/ai-doctrine'
import { AI_SEO_FIELDS_MAX_TOKENS, generateSeoFields } from '../runtime/seo-fields'
import {
  AI_SEO_PAGE_TEXT_MAX_CHARS,
  aiSeoPageFacts,
  type AiSeoPageFacts,
} from '../runtime/seo-page-facts'
import {
  AI_SEO_FIXES_TOOL_NAME,
  AI_SEO_SITE_TOOL_NAME,
  aiSeoFixImages,
  aiSeoFixesTool,
  aiSeoKeywordCoverage,
  aiSeoKeywordList,
  aiSeoSiteTool,
  checkAiSeoFixes,
  checkAiSeoSite,
  type AiSeoBatchAnswer,
  type AiSeoBatchPage,
} from '../tools/ai-seo-tool'
import {
  AI_SEO_FIXES_MAX_TOKENS,
  AI_SEO_SITE_MAX_TOKENS,
  aiSeoGenerationMaxTokens,
} from './ai-job-seo-budget'
import type { AiJobStepContext, AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'

/**
 * The `seo` step (AGL-2910): search listings and a site audit, as proposals.
 *
 * `inputs.target` says what the job is about:
 *
 * - `screen` — one page's listing, written from the version the person is
 *   looking at (`screenId`, `versionId`), for the page's SEO card;
 * - `product` — one product's listing, from the name and description the
 *   product editor handed over (`name`, `text`), for the product editor;
 * - `site` — the audit of every published page the sitemap lists, with a
 *   proposed fix per finding, structured data for the site's entity, and the
 *   agent guidance `/llms.txt` leads with.
 *
 * ## It writes nothing
 *
 * Like every runner, this reads, asks and returns. A listing is served
 * straight from the screen document, the structured data and `/llms.txt`
 * from the host document, and a page's content from its published version,
 * so the values ride on the job's outputs and nothing else: a person puts
 * them in the page's SEO card or the site SEO form and saves them there, and
 * content fixes become a new version only through the apply door.
 *
 * ## An audit, a unit at a time
 *
 * The first pass reads the site — every published page's version and the
 * shared layouts, for the links between them — scores it without a model,
 * records the report, and runs the first unit of generated work. Each later
 * pass runs one more unit: the site-wide proposal, then the page fixes in
 * batches. Every pass is one reservation and one provider exchange, and it
 * asks the machine to continue until nothing is left, so a large site is a
 * few beats of work rather than one request that cannot finish.
 */

export const AI_SEO_NO_SITE_COPY = 'This SEO job names a site this workspace does not have.'
export const AI_SEO_NO_PAGE_COPY = 'This page is no longer on the site.'
export const AI_SEO_NO_TARGET_COPY = 'This SEO job does not say what to write about.'
export const AI_SEO_NO_PRODUCT_COPY = 'Give the product a name before writing its listing.'

/** Shared layouts an audit reads for the links in a site's navigation. */
export const AI_SEO_LAYOUT_SCAN_LIMIT = 20

/** How much of each page a batch of fixes carries. */
export const AI_SEO_BATCH_PAGE_TEXT_CHARS = 700

/**
 * Output budgets, declared with the step's time (`ai-job-seo-budget.ts`,
 * AGL-3035). A batch's largest answer — every page with a title, description,
 * heading and image descriptions at their limits — and the site proposal's are
 * measured in `ai-job-seo-step.spec.ts`.
 */
export { AI_SEO_FIXES_MAX_TOKENS, AI_SEO_SITE_MAX_TOKENS }

/** Documents read at once. */
const READ_CHUNK = 10

/** Pages the site prompt and the llms.txt preview list. */
const SITE_PAGES_LISTED = 25

/** The fields a product's listing holds. */
const PRODUCT_LISTING_FIELDS: readonly SeoListingFieldKey[] = ['title', 'description']

const ZERO_USAGE: AiUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

type Firestore = FirebaseFirestore.Firestore
type DocumentReference = FirebaseFirestore.DocumentReference
type Spent = Pick<AiJobStepOutcome, 'usage' | 'estCostUsd' | 'model' | 'stopReason'>

/** The host document fields this step reads. */
export interface SeoHostDocument {
  orgId?: string
  displayName?: string
  subdomain?: string | null
  cname?: string | null
  screens?: Record<string, string>
  errorScreens?: Record<string, string>
  notFoundScreenId?: string | null
  seo?: {
    title?: string
    description?: string
    discourageSearchEngines?: boolean
    entity?: {
      type?: unknown
      name?: string
      description?: string
      email?: string
      telephone?: string
      contactType?: string
    }
    agent?: { whenToUse?: string; howToUse?: string }
  }
}

/** The screen document fields this step reads. */
interface SeoScreenDocument {
  displayName?: string
  description?: string
  versionId?: string
  visibility?: unknown
  deletedAt?: unknown
  seo?: {
    title?: string
    description?: string
    breadcrumb?: string
    image?: string
    imageAlt?: string
  }
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000

function modelOf(context: AiJobStepContext): string {
  return context.modelFor?.('job.seo') ?? aiModelForStep('job.seo')
}

function spentNothing(model: string): Spent {
  return { usage: ZERO_USAGE, estCostUsd: 0, model, stopReason: null }
}

function spentBy(generation: AiGenerationSpend): Spent {
  return {
    usage: generation.usage,
    estCostUsd: generation.estCostUsd,
    model: generation.model,
    stopReason: generation.stopReason,
  }
}

function addSpent(a: Spent, b: Spent): Spent {
  return {
    usage: {
      inputTokens: a.usage.inputTokens + b.usage.inputTokens,
      outputTokens: a.usage.outputTokens + b.usage.outputTokens,
      cacheReadTokens: a.usage.cacheReadTokens + b.usage.cacheReadTokens,
      cacheWriteTokens: a.usage.cacheWriteTokens + b.usage.cacheWriteTokens,
    },
    estCostUsd: round6(a.estCostUsd + b.estCostUsd),
    model: b.model || a.model,
    stopReason: b.stopReason ?? a.stopReason,
  }
}

/** Through JSON, so no `undefined` reaches the job document's write. */
const plain = <T>(value: T): Record<string, unknown> =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>

/**
 * The fields a listing job writes: the ones the editor named (`inputs.fields`,
 * comma-separated) that the target's editor holds, or all of those.
 */
export function aiSeoRequestedFields(
  raw: unknown,
  allowed: readonly SeoListingFieldKey[],
): SeoListingFieldKey[] {
  const named = String(raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(isSeoListingFieldKey)
  const wanted = new Set<SeoListingFieldKey>(named.length ? named : allowed)
  return allowed.filter((key) => wanted.has(key))
}

/** The site's name, as its visitors read it. */
function brandOf(host: SeoHostDocument): string {
  return str(host.seo?.title) || str(host.displayName) || str(host.subdomain)
}

/** The site a job names, read and checked against the job's org. */
async function loadSite(
  firestore: Firestore,
  job: AiJob,
): Promise<{ host: SeoHostDocument } | { failure: string }> {
  if (!job.hostId) return { failure: AI_SEO_NO_SITE_COPY }
  const snapshot = await firestore.collection('hosts').doc(job.hostId).get()
  const host = snapshot.exists ? (snapshot.data() as SeoHostDocument) : null
  // The route checks the caller's membership of the org the job is metered
  // against, not that the site belongs to it. A site of another org is
  // refused here, before anything about it reaches a prompt.
  if (!host || host.orgId !== job.orgId) return { failure: AI_SEO_NO_SITE_COPY }
  return { host }
}

/** A version's node map and root, or `null` when it cannot be read. */
async function readVersionNodes(
  hostRef: DocumentReference,
  screenId: string,
  versionId: string,
): Promise<{ nodes: Record<string, unknown>; rootId?: string } | null> {
  if (!versionId) return null
  const snapshot = await hostRef
    .collection('screens')
    .doc(screenId)
    .collection('versions')
    .doc(versionId)
    .get()
  if (!snapshot.exists) return null
  const nodes = decodeStoredNodes<Record<string, unknown>>(snapshot.get('nodes'))
  if (!nodes) return null
  const rootId = snapshot.get('rootId')
  return { nodes, ...(typeof rootId === 'string' ? { rootId } : {}) }
}

/** Every other page's search title, for a proposal not to repeat. */
async function siteTitles(hostRef: DocumentReference, except: ReadonlySet<string>): Promise<string[]> {
  const snapshot = await hostRef.collection('screens').select('seo', 'deletedAt').limit(1000).get()
  return snapshot.docs
    .filter((doc) => !except.has(doc.id) && !doc.get('deletedAt'))
    .map((doc) => str((doc.get('seo') as SeoScreenDocument['seo'])?.title))
    .filter(Boolean)
}

/* ------------------------------------------------------------------------ *
 * One listing: a page or a product
 * ------------------------------------------------------------------------ */

function listingOutcome(
  generation: AiValidatedGeneration<AiSeoFieldValues>,
  job: AiJob,
  subject: AiSeoFieldsProposal['subject'],
  context: {
    keywords: readonly string[]
    facts: AiSeoPageFacts | null
    fields: readonly SeoListingFieldKey[]
    hasImage: boolean
  },
): AiJobStepOutcome {
  const spent = spentBy(generation)
  if (generation.status === 'refused') return { outputs: [], ...spent, refused: true }
  if (generation.status === 'needs_input') return { outputs: [], ...spent, failure: generation.message }
  const values = generation.value
  const notes: string[] = []
  if (context.fields.includes('imageAlt') && context.hasImage && !values.imageAlt) {
    notes.push('No image description was proposed: nothing on the page says what the picture shows.')
  }
  const proposal: AiSeoFieldsProposal = {
    kind: 'fields',
    subject,
    values,
    keywords: aiSeoKeywordCoverage(context.keywords, {
      title: values.title,
      description: values.description,
      h1: context.facts?.h1s[0]?.text,
      body: context.facts?.text,
    }),
    notes,
  }
  const output: AiJobOutput = {
    resource: 'seo',
    id: AI_SEO_OUTPUT_IDS.fields(subject.kind, subject.id),
    hostId: job.hostId ?? null,
    label: `SEO proposal · ${subject.name}`,
    proposal: plain(proposal),
  }
  return { outputs: [output], ...spent }
}

async function runScreenListing(
  context: AiJobStepContext & { firestore: Firestore },
  host: SeoHostDocument,
): Promise<AiJobStepOutcome> {
  const { job, firestore, signal } = context
  const model = modelOf(context)
  const hostRef = firestore.collection('hosts').doc(job.hostId as string)
  const screenId = str(job.inputs?.['screenId'])
  const snapshot = screenId ? await hostRef.collection('screens').doc(screenId).get() : null
  const screen = snapshot?.exists ? (snapshot.data() as SeoScreenDocument) : null
  if (!screen || screen.deletedAt) {
    return { outputs: [], ...spentNothing(model), failure: AI_SEO_NO_PAGE_COPY }
  }

  const versionId = str(job.inputs?.['versionId']) || str(screen.versionId)
  const version = await readVersionNodes(hostRef, screenId, versionId)
  const facts = aiSeoPageFacts(version?.nodes as never, { rootId: version?.rootId })
  const fields = aiSeoRequestedFields(job.inputs?.['fields'], SCREEN_SEO_LISTING_FIELDS)
  const seo = screen.seo ?? {}
  const hasImage = Boolean(str(seo.image))
  // The share image is often a picture the page shows too: its description
  // and the text beside it there are what is known about it.
  const onPage = hasImage ? facts.images.find((image) => image.src === str(seo.image)) : undefined
  const route = host.screens?.[screenId]
  const path = typeof route === 'string' ? screenRoutePathToUrl(route) : null
  const name = str(screen.displayName) || path || 'Untitled page'
  const keywords = aiSeoKeywordList(job.inputs?.['keywords'])
  const generation = await generateSeoFields({
    subject: { kind: 'screen', name, path },
    brand: brandOf(host),
    text: facts.text || str(screen.description),
    fields,
    current: {
      title: str(seo.title),
      description: str(seo.description),
      breadcrumb: str(seo.breadcrumb),
      imageAlt: str(seo.imageAlt),
    },
    image: hasImage ? { alt: str(seo.imageAlt) || onPage?.alt || null, context: onPage?.context || null } : null,
    keywords,
    otherTitles: await siteTitles(hostRef, new Set([screenId])),
    model,
    maxTokens: aiSeoGenerationMaxTokens(model, AI_SEO_FIELDS_MAX_TOKENS),
    ...(signal ? { signal } : {}),
  })
  return listingOutcome(generation, job, { kind: 'screen', id: screenId, name, path }, {
    keywords,
    facts,
    fields,
    hasImage,
  })
}

async function runProductListing(
  context: AiJobStepContext & { firestore: Firestore },
  host: SeoHostDocument,
): Promise<AiJobStepOutcome> {
  const { job, signal } = context
  const model = modelOf(context)
  const name = str(job.inputs?.['name']).slice(0, 200)
  if (!name) return { outputs: [], ...spentNothing(model), failure: AI_SEO_NO_PRODUCT_COPY }
  const fields = aiSeoRequestedFields(job.inputs?.['fields'], PRODUCT_LISTING_FIELDS)
  const keywords = aiSeoKeywordList(job.inputs?.['keywords'])
  const productId = str(job.inputs?.['productId']) || null
  const generation = await generateSeoFields({
    subject: { kind: 'product', name },
    brand: brandOf(host),
    // The product's own words, as its editor handed them over: the product
    // document is the commerce plugin's, and this step never reads it.
    text: str(job.inputs?.['text']).slice(0, AI_SEO_PAGE_TEXT_MAX_CHARS),
    fields,
    current: {
      title: str(job.inputs?.['currentTitle']),
      description: str(job.inputs?.['currentDescription']),
    },
    image: null,
    keywords,
    model,
    maxTokens: aiSeoGenerationMaxTokens(model, AI_SEO_FIELDS_MAX_TOKENS),
    ...(signal ? { signal } : {}),
  })
  return listingOutcome(generation, job, { kind: 'product', id: productId, name }, {
    keywords,
    facts: null,
    fields,
    hasImage: false,
  })
}

/* ------------------------------------------------------------------------ *
 * The site audit
 * ------------------------------------------------------------------------ */

export interface AiSeoScannedPage extends AiSeoAuditPage {
  /** The page's node map as audited. */
  nodes: Record<string, unknown> | null
}

export interface AiSeoSiteScan {
  pages: AiSeoScannedPage[]
  skipped: number
  notes: string[]
}

/**
 * Read the site the way its sitemap lists it: every screen the routing map
 * publishes, less the template screens, the status pages and every screen
 * that is not public — through the same shared predicates the tenant's
 * `sitemap.xml` and `/llms.txt` apply, so the audit covers exactly the pages
 * a crawler is handed. Then each page's published version, and the shared
 * layouts, for the links that decide which pages nothing points to.
 */
export async function scanAiSeoSite(
  firestore: Firestore,
  hostId: string,
  host: SeoHostDocument,
  rawKeywords: unknown,
): Promise<AiSeoSiteScan> {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const routing = host.screens ?? {}
  const [screenDocs, templateScreenIds, layoutDocs] = await Promise.all([
    hostRef
      .collection('screens')
      .select('visibility', 'seo', 'description', 'displayName', 'versionId', 'deletedAt')
      .limit(1000)
      .get(),
    getTemplateScreenIds({ hostId }),
    hostRef.collection('layouts').select('versionId').limit(AI_SEO_LAYOUT_SCAN_LIMIT).get(),
  ])
  const screens = new Map(screenDocs.docs.map((doc) => [doc.id, doc.data() as SeoScreenDocument]))
  const excluded = new Set<string>([...statusPageScreenIds(host as never), ...templateScreenIds])
  const published = Object.entries(routing)
    .filter(([screenId]) => !excluded.has(screenId))
    .filter(([screenId]) => {
      const screen = screens.get(screenId)
      return Boolean(screen) && !screen?.deletedAt && isScreenIndexable(screen as never)
    })
    .map(([screenId, route]) => ({ screenId, path: screenRoutePathToUrl(String(route)) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const audited = published.slice(0, AI_SEO_AUDIT_MAX_PAGES)

  const versions = new Map<string, { nodes: Record<string, unknown>; rootId?: string } | null>()
  for (let start = 0; start < audited.length; start += READ_CHUNK) {
    await Promise.all(
      audited.slice(start, start + READ_CHUNK).map(async ({ screenId }) => {
        versions.set(
          screenId,
          await readVersionNodes(hostRef, screenId, str(screens.get(screenId)?.versionId)),
        )
      }),
    )
  }
  const layoutNodes: Record<string, unknown>[] = []
  const layouts = layoutDocs.docs.filter((doc) => str(doc.get('versionId')))
  for (let start = 0; start < layouts.length; start += READ_CHUNK) {
    await Promise.all(
      layouts.slice(start, start + READ_CHUNK).map(async (doc) => {
        const snapshot = await doc.ref.collection('versions').doc(str(doc.get('versionId'))).get()
        const nodes = snapshot.exists
          ? decodeStoredNodes<Record<string, unknown>>(snapshot.get('nodes'))
          : null
        if (nodes) layoutNodes.push(nodes)
      }),
    )
  }

  const keywordsByPath = parseAiSeoKeywordLines(rawKeywords)
  const auditedPaths = new Set(audited.map((page) => aiSeoNormalizePath(page.path)))
  const notes = Object.keys(keywordsByPath)
    .filter((path) => !auditedPaths.has(path))
    .map((path) => `Keywords for ${path} were not used: no audited page is published at that address.`)

  const pages: AiSeoScannedPage[] = audited.map(({ screenId, path }) => {
    const screen = screens.get(screenId) ?? {}
    const version = versions.get(screenId) ?? null
    const linkedFrom =
      layoutNodes.some((nodes) => nodesReferenceScreen(nodes, screenId)) ||
      audited.some(
        (other) =>
          other.screenId !== screenId &&
          nodesReferenceScreen(versions.get(other.screenId)?.nodes ?? null, screenId),
      )
    return {
      screenId,
      path,
      name: str(screen.displayName) || path,
      versionId: str(screen.versionId) || null,
      seo: screen.seo ?? {},
      description: str(screen.description),
      facts: aiSeoPageFacts(version?.nodes as never, { rootId: version?.rootId }),
      linkedFrom,
      keywords: keywordsByPath[aiSeoNormalizePath(path)] ?? [],
      nodes: version?.nodes ?? null,
    }
  })
  return { pages, skipped: Math.max(0, published.length - audited.length), notes }
}

/** One unit of generated work an audit still owes. */
export type AiSeoAuditUnit =
  | { kind: 'site' }
  | { kind: 'batch'; batch: number; of: number; screenIds: string[] }

/** The units an audit owes after the outputs recorded so far, in the order they run. */
export function aiSeoPendingUnits(
  report: AiSeoAuditReport,
  outputs: readonly Pick<AiJobOutput, 'id'>[],
): AiSeoAuditUnit[] {
  const done = new Set(outputs.map((output) => output.id))
  const units: AiSeoAuditUnit[] = []
  if (report.siteProposal && !done.has(AI_SEO_OUTPUT_IDS.site)) units.push({ kind: 'site' })
  const batches = aiSeoAuditBatches(report)
  batches.forEach((screenIds, index) => {
    if (!done.has(AI_SEO_OUTPUT_IDS.fixes(index + 1))) {
      units.push({ kind: 'batch', batch: index + 1, of: batches.length, screenIds })
    }
  })
  return units
}

interface UnitResult {
  output: AiJobOutput
  spent: Spent
}

/* ---- The site-wide proposal ---------------------------------------------- */

export const AI_SEO_SITE_INSTRUCTIONS: AiSystemBlock[] = [
  {
    text:
      'You propose two things for a website: the structured data that says who publishes it, and ' +
      'the guidance an AI agent reads first in its /llms.txt.\n\n' +
      `Answer by calling ${AI_SEO_SITE_TOOL_NAME} exactly once. A reply in prose cannot be used.\n\n` +
      'Rules:\n' +
      '- Fill only the fields you are told are empty; answer null for every other one.\n' +
      '- Use only what the pages you are given state. A contact email or telephone number goes in ' +
      'only when a page shows it exactly; never compose one.\n' +
      '- The entity description says what the publisher is, in one plain sentence, not what one page ' +
      'offers.\n' +
      '- The agent guidance is checkable and specific: the questions this site answers and which ' +
      'pages answer them. No marketing language: an agent discounts a claim it cannot check.\n' +
      '- Keep every length the tool states, and write in the language of the pages.',
    cacheBreakpoint: true,
  },
]

/** The site SEO form fields blank on the site now. */
export function aiSeoBlankSiteFields(host: SeoHostDocument): Set<AiSeoSiteFormField> {
  const entity = host.seo?.entity ?? {}
  const agent = host.seo?.agent ?? {}
  const blank = new Set<AiSeoSiteFormField>()
  if (entity.type === undefined || entity.type === null || entity.type === '') blank.add('seo.entity.type')
  if (!str(entity.name)) blank.add('seo.entity.name')
  if (!str(entity.description)) blank.add('seo.entity.description')
  if (!str(entity.email)) blank.add('seo.entity.email')
  if (!str(entity.telephone)) blank.add('seo.entity.telephone')
  if (!str(entity.contactType)) blank.add('seo.entity.contactType')
  if (!str(agent.whenToUse)) blank.add('seo.agent.whenToUse')
  if (!str(agent.howToUse)) blank.add('seo.agent.howToUse')
  return blank
}

/** The site's content collections, for the llms.txt preview. */
async function readContentCollections(hostRef: DocumentReference): Promise<LlmsTxtCollection[]> {
  try {
    const snapshot = await hostRef.collection('collections').select('slug', 'displayName', 'kind').limit(50).get()
    return snapshot.docs
      .filter((doc) => hostCollectionKind(doc.data()) === 'content' && str(doc.get('slug')))
      .map((doc) => ({ slug: str(doc.get('slug')), name: str(doc.get('displayName')) || undefined }))
  } catch {
    // A preview without the feeds is still a preview of the guidance.
    return []
  }
}

/** `/llms.txt` as it reads with `values` saved over what the site stores now. */
export function aiSeoLlmsPreview(
  host: SeoHostDocument,
  values: Partial<Record<AiSeoSiteFormField, string>>,
  pages: readonly LlmsTxtPage[],
  collections: readonly LlmsTxtCollection[],
): string {
  return buildLlmsTxt({
    siteName: str(host.seo?.title) || str(host.displayName) || 'Site',
    origin: hostPublicOrigin(host) ?? '',
    description: str(host.seo?.description) || undefined,
    agent: {
      whenToUse: values['seo.agent.whenToUse'] ?? host.seo?.agent?.whenToUse,
      howToUse: values['seo.agent.howToUse'] ?? host.seo?.agent?.howToUse,
    },
    pages,
    collections,
    hasSearch: true,
    contactEmail: values['seo.entity.email'] ?? (str(host.seo?.entity?.email) || undefined),
  })
}

async function proposeSite(
  context: AiJobStepContext & { firestore: Firestore },
  host: SeoHostDocument,
  scan: AiSeoSiteScan,
): Promise<UnitResult> {
  const { job, firestore, signal } = context
  const model = modelOf(context)
  const hostRef = firestore.collection('hosts').doc(job.hostId as string)
  const blank = aiSeoBlankSiteFields(host)
  const collections = await readContentCollections(hostRef)
  const topLevel: LlmsTxtPage[] = scan.pages
    .filter((page) => !page.path.replace(/^\//, '').includes('/'))
    .slice(0, SITE_PAGES_LISTED)
    .map((page) => ({ path: page.path, ...(page.name ? { title: page.name } : {}) }))
  // The pages that say who publishes a site: the home page, and whatever is
  // about the company or how to reach it.
  const telling = scan.pages
    .filter((page) => page.path === '/' || /about|contact|company|team|who/i.test(page.path))
    .slice(0, 4)
  const prompt = [
    `Site: ${brandOf(host) || 'untitled site'}`,
    host.seo?.description ? `Site description: ${str(host.seo.description)}` : '',
    `Empty fields you may fill: ${[...blank].join(', ') || 'none'}`,
    'Pages:',
    ...scan.pages
      .slice(0, SITE_PAGES_LISTED)
      .map((page) => `- ${page.path} — ${page.name}${str(page.seo.title) ? ` — ${str(page.seo.title)}` : ''}`),
    collections.length
      ? `Content collections: ${collections.map((entry) => entry.name || entry.slug).join(', ')}`
      : '',
    ...telling.flatMap((page) => ['', `Text of ${page.path}:`, page.facts.text.slice(0, 1_200) || '(no text)']),
  ]
    .filter((line) => line !== '')
    .join('\n')
  const siteText = scan.pages.map((page) => page.facts.text).join('\n')
  const generation = await runValidatedGeneration('seo-site', {
    step: 'job.seo',
    model,
    instructions: AI_SEO_SITE_INSTRUCTIONS,
    messages: [{ role: 'user', content: prompt }],
    tool: aiSeoSiteTool(),
    maxTokens: aiSeoGenerationMaxTokens(model, AI_SEO_SITE_MAX_TOKENS),
    ...(signal ? { signal } : {}),
    check: (answer) => checkAiSeoSite(answer, { blank, siteText }),
  })
  const proposed = generation.status === 'ok' ? generation.value : { values: {}, notes: [] }
  const notes =
    generation.status === 'ok'
      ? proposed.notes
      : [
          generation.status === 'refused'
            ? 'The AI declined to propose structured data for this site.'
            : generation.message,
        ]
  const site: AiSeoSiteProposal = {
    values: proposed.values,
    llmsPreview: aiSeoLlmsPreview(host, proposed.values, topLevel, collections),
    notes,
  }
  return {
    output: {
      resource: 'seo',
      id: AI_SEO_OUTPUT_IDS.site,
      hostId: job.hostId ?? null,
      label: 'SEO audit · structured data and agent guidance',
      proposal: plain({ kind: 'site', site }),
    },
    spent: spentBy(generation),
  }
}

/* ---- A batch of page fixes ------------------------------------------------ */

export const AI_SEO_FIXES_INSTRUCTIONS: AiSystemBlock[] = [
  {
    text:
      'You fix the search listings and headings of a website’s pages. For each page you are given ' +
      'what an audit found, what the page shows now, and its text.\n\n' +
      `Answer by calling ${AI_SEO_FIXES_TOOL_NAME} exactly once, with one entry per page. A reply in ` +
      'prose cannot be used.\n\n' +
      'Rules:\n' +
      '- Fix only what the audit found. Answer null for a value it did not find a problem with.\n' +
      '- Write only from the page’s own text. Never invent a fact, a price, a name, a place or a claim.\n' +
      '- A title says what the page is, specifically. No two pages share a title, and none repeats a ' +
      'title you are told another page uses.\n' +
      '- A description is one or two sentences telling a searcher what they will find.\n' +
      '- The main heading names what the page is about in a few plain words.\n' +
      '- An image description says what the picture most likely shows, from the text beside it. ' +
      'Leave an image out when the text gives no idea.\n' +
      '- A target keyword goes in only where the page is about it and it reads naturally: at most ' +
      'once in a title and once in a description. Never list keywords or repeat a word to rank.\n' +
      '- Keep every length the tool states, and write in the language of each page.',
    cacheBreakpoint: true,
  },
]

/** The fixes one page gets: the model's values, its content fixes, and the guidance no fix can give. */
export function aiSeoPageFixFor(page: AiSeoBatchPage, answer: AiSeoBatchAnswer | null): AiSeoPageFix {
  const values: AiSeoFieldValues = {}
  if (answer?.title) values.title = answer.title
  if (answer?.description) values.description = answer.description
  const content: AiSeoContentFix[] = []
  for (const alt of answer?.imageAlts ?? []) content.push({ kind: 'image-alt', nodeId: alt.nodeId, alt: alt.alt })
  if (answer?.h1) {
    const first = page.facts.h1s[0]
    const promotable = page.facts.headings.find((heading) => heading.editable && heading.nodeId)
    if (page.codes.has('h1-thin') && first?.editable && first.nodeId) {
      content.push({ kind: 'h1-set', nodeId: first.nodeId, text: answer.h1 })
    } else if (page.codes.has('h1-missing') && promotable?.nodeId) {
      content.push({ kind: 'h1-set', nodeId: promotable.nodeId, text: answer.h1 })
    } else if (page.codes.has('h1-missing')) {
      content.push({ kind: 'h1-insert', text: answer.h1 })
    }
  }
  if (page.codes.has('h1-multiple')) content.push(...aiSeoHeadingDemotions(page.facts))
  const guidance: string[] = []
  if (page.codes.has('orphan')) {
    guidance.push('Link to this page from your navigation or a related page. Where it belongs is yours to choose.')
  }
  return { screenId: page.screenId, values, content, guidance }
}

/** The user turn for one batch: each page's findings, what it shows now, and its text. */
export function aiSeoFixesPrompt(pages: readonly AiSeoBatchPage[], titlesElsewhere: readonly string[]): string {
  const titles = titlesElsewhere.length
    ? `Titles other pages use:\n${titlesElsewhere.slice(0, 40).map((title) => `- ${title}`).join('\n')}\n\n`
    : ''
  const blocks = pages.map((page) => {
    const lines = [
      `### Page ${page.screenId}: ${page.name} (${page.path})`,
      `Found: ${[...page.codes].map((code) => AI_SEO_FINDING_LABELS[code]).join('; ')}`,
      `Title now: ${str(page.seo?.title) || '(none)'}`,
      `Description now: ${str(page.seo?.description) || '(none)'}`,
      `Main heading now: ${page.facts.h1s[0]?.text || '(none)'}`,
    ]
    if (page.keywords.length) lines.push(`Target keywords: ${page.keywords.join(', ')}`)
    const images = aiSeoFixImages(page)
    if (images.length) {
      lines.push(
        'Images without a description:',
        ...images.map((image) => `- ${image.nodeId}: beside "${image.context || 'no text'}"`),
      )
    }
    lines.push('Text:', page.facts.text.slice(0, AI_SEO_BATCH_PAGE_TEXT_CHARS) || '(no text)')
    return lines.join('\n')
  })
  return `${titles}${blocks.join('\n\n')}`
}

async function proposeFixes(
  context: AiJobStepContext & { firestore: Firestore },
  report: AiSeoAuditReport,
  unit: Extract<AiSeoAuditUnit, { kind: 'batch' }>,
): Promise<UnitResult> {
  const { job, firestore, signal } = context
  const model = modelOf(context)
  const hostRef = firestore.collection('hosts').doc(job.hostId as string)
  const reports = new Map(report.pages.map((page) => [page.screenId, page]))
  // Read now, not as audited: a page edited since keeps its edits, and one
  // deleted since is skipped.
  const loaded = await Promise.all(
    unit.screenIds.map(async (screenId): Promise<AiSeoBatchPage | null> => {
      const pageReport = reports.get(screenId)
      const snapshot = await hostRef.collection('screens').doc(screenId).get()
      const screen = snapshot.exists ? (snapshot.data() as SeoScreenDocument) : null
      if (!pageReport || !screen || screen.deletedAt) return null
      const version = await readVersionNodes(hostRef, screenId, str(screen.versionId))
      return {
        screenId,
        path: pageReport.path,
        name: pageReport.name,
        codes: new Set(pageReport.findings.map((entry) => entry.code)),
        keywords: pageReport.keywords.map((entry) => entry.keyword),
        seo: screen.seo ?? {},
        facts: aiSeoPageFacts(version?.nodes as never, { rootId: version?.rootId }),
      }
    }),
  )
  const pages = loaded.filter((page): page is AiSeoBatchPage => page !== null)
  const titlesElsewhere = await siteTitles(hostRef, new Set(pages.map((page) => page.screenId)))

  let spent = spentNothing(model)
  let answers: Record<string, AiSeoBatchAnswer> = {}
  const notes: string[] = []
  if (pages.length) {
    const generation = await runValidatedGeneration('seo-fixes', {
      step: 'job.seo',
      model,
      instructions: AI_SEO_FIXES_INSTRUCTIONS,
      messages: [{ role: 'user', content: aiSeoFixesPrompt(pages, titlesElsewhere) }],
      tool: aiSeoFixesTool(pages.map((page) => page.screenId)),
      // Lowered on a tier too slow to answer a whole batch and ask again
      // inside the least time the step registers.
      maxTokens: aiSeoGenerationMaxTokens(model, AI_SEO_FIXES_MAX_TOKENS),
      ...(signal ? { signal } : {}),
      check: (answer) => checkAiSeoFixes(answer, pages, titlesElsewhere),
    })
    spent = spentBy(generation)
    if (generation.status === 'ok') {
      answers = generation.value
    } else {
      notes.push(
        generation.status === 'refused'
          ? 'The AI declined to propose fixes for these pages.'
          : generation.message,
      )
    }
  }
  const fixes = pages.map((page) => aiSeoPageFixFor(page, answers[page.screenId] ?? null))
  const skipped = unit.screenIds.length - pages.length
  if (skipped > 0) {
    notes.push(`${skipped} ${skipped === 1 ? 'page was' : 'pages were'} deleted since the audit and left out.`)
  }
  return {
    output: {
      resource: 'seo',
      id: AI_SEO_OUTPUT_IDS.fixes(unit.batch),
      hostId: job.hostId ?? null,
      label: `SEO audit · fixes ${unit.batch} of ${unit.of}`,
      proposal: plain({ kind: 'fixes', batch: unit.batch, fixes, notes }),
    },
    spent,
  }
}

async function runSiteAuditPass(
  context: AiJobStepContext & { firestore: Firestore },
  host: SeoHostDocument,
): Promise<AiJobStepOutcome> {
  const { job, firestore } = context
  const model = modelOf(context)
  const recorded = aiSeoAuditView(job.outputs ?? [])
  const outputs: AiJobOutput[] = []
  let spent = spentNothing(model)
  let report: AiSeoAuditReport
  let scan: AiSeoSiteScan | null = null
  if (recorded) {
    report = recorded.report
  } else {
    scan = await scanAiSeoSite(firestore, job.hostId as string, host, job.inputs?.['keywords'])
    report = aiSeoAudit(
      scan.pages,
      {
        discouraged: isSearchDiscouraged(host as never),
        entity: host.seo?.entity ?? {},
        agent: host.seo?.agent ?? {},
      },
      { skipped: scan.skipped },
    )
    report.notes.push(...scan.notes)
    const findings = report.pages.reduce((sum, page) => sum + page.findings.length, report.site.length)
    outputs.push({
      resource: 'seo',
      id: AI_SEO_OUTPUT_IDS.report,
      hostId: job.hostId ?? null,
      label: `SEO audit · ${report.pages.length} ${report.pages.length === 1 ? 'page' : 'pages'} · ${findings} ${findings === 1 ? 'finding' : 'findings'}`,
      proposal: plain(report),
    })
  }
  const units = aiSeoPendingUnits(report, [...(job.outputs ?? []), ...outputs])
  if (!units.length) return { outputs, ...spent }
  const [unit] = units
  const result =
    unit.kind === 'site'
      ? await proposeSite(
          context,
          host,
          scan ?? (await scanAiSeoSite(firestore, job.hostId as string, host, job.inputs?.['keywords'])),
        )
      : await proposeFixes(context, report, unit)
  outputs.push(result.output)
  spent = addSpent(spent, result.spent)
  return { outputs, ...spent, ...(units.length > 1 ? { continue: true } : {}) }
}

export const runAiJobSeoStep: AiJobStepRunner = async (context) => {
  const { job, firestore } = context
  if (!firestore) {
    // The machine always hands one in; a runner called without it is a
    // wiring fault, not a customer path.
    throw new Error('the SEO step reads the site it writes about and was given no Firestore')
  }
  const target = aiSeoJobTarget(job.inputs)
  if (!target) return { outputs: [], ...spentNothing(modelOf(context)), failure: AI_SEO_NO_TARGET_COPY }
  const site = await loadSite(firestore, job)
  if ('failure' in site) return { outputs: [], ...spentNothing(modelOf(context)), failure: site.failure }
  const withFirestore = { ...context, firestore }
  switch (target) {
    case 'screen':
      return runScreenListing(withFirestore, site.host)
    case 'product':
      return runProductListing(withFirestore, site.host)
    case 'site':
      return runSiteAuditPass(withFirestore, site.host)
  }
}
