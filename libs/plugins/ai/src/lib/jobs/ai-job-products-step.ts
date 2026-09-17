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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { isHostPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import { filterEnabledPluginsByReleaseFlags } from '@aglyn/tenant-data-admin/server/release-flags'
import type { AiJob, AiJobOutput } from '../model/ai-jobs.types'
import {
  AI_PRODUCT_CATEGORY_LIST_MAX,
  AI_PRODUCT_OPTIONS_MAX,
  AI_PRODUCT_OPTION_VALUES_MAX,
  AI_PRODUCT_TEXT_MAX_CHARS,
  AI_PRODUCT_TYPES,
  AI_PRODUCTS_BULK_MAX,
  AI_PRODUCTS_OUTPUT_IDS,
  aiProductGaps,
  aiProductsProposalOf,
  parseAiProductsJobInputs,
  type AiCatalogProposal,
  type AiCategoriesProposal,
  type AiProductCategory,
  type AiProductCopy,
  type AiProductCopyProposal,
  type AiProductFacts,
  type AiProductPhotoRead,
  type AiProductType,
} from '../model/ai-products'
import { AI_STEP_TIERS } from '../providers/catalog'
import { aiModelForStep } from '../providers/routing'
import type { AiValidatedGeneration } from '../runtime/ai-doctrine'
import {
  AI_CATALOG_MAX_TOKENS,
  AI_PRODUCT_CATEGORIES_MAX_TOKENS,
  AI_PRODUCT_COPY_MAX_TOKENS,
  AI_PRODUCTS_STEP,
  generateAiCatalog,
  generateAiCategories,
  generateAiProductCopy,
} from '../runtime/ai-products-generation'
import { aiRouteReadsImages } from '../runtime/ai-runtime'
import { registerAiJobAdmission, type AiJobAdmission } from './ai-job-admission'
import { aiJobStepBudget } from './ai-job-budget'
import { aiGenerationSpent, aiUnspentOutcome } from './ai-job-generation'
import { AI_PRODUCT_IMAGE_READ_MS, readAiProductImage, type AiProductImageSeams } from './ai-product-image'
import type { AiJobStepContext, AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'
import { registerAiJobStep, registerAiJobStepPasses } from './ai-jobs'

/**
 * The `products` step (AGL-2916): commerce by AI, as proposals.
 *
 * `inputs.target` names the work (`model/ai-products.ts`): one product's copy
 * from what its editor holds, the copy of many saved products one a pass, a
 * store's first products from a brief, or its categories and a first set of
 * discounts from a brief.
 *
 * ## It writes nothing
 *
 * Like every runner, this reads, asks and returns. Every output is a
 * `product` proposal, and the commerce plugin's own surfaces write what a
 * person accepts: the product editor's Save, the products card's apply, and
 * the create paths the catalog and discount cards already use — each with the
 * allowance, role and seed checks those paths carry. A proposed product is
 * created as a draft with no price, and a proposed discount is created
 * switched off.
 *
 * ## A bulk job, a product at a time
 *
 * A bulk job's pass writes one product's copy and asks the machine to
 * continue while products remain, so each product is one reservation and one
 * provider exchange, and a job that runs out of credits resumes at the
 * product where it stopped. Which product is next is read from the job's own
 * outputs, one a product, so nothing is kept anywhere else. A product that is
 * gone, or whose copy cannot be held to the rules, is reported and passed
 * over rather than failing the products after it.
 *
 * ## What the model is shown
 *
 * The product's name, type, text, tags, options and current search listing,
 * the names of the site's categories, the store's name, and — for a model that
 * reads pictures — the product's first photo, read from the site's own media
 * library as `ai-product-image.ts` describes. A catalog or categories request
 * carries the brief and the store's name, and the second its existing category
 * names. No price, stock, order, customer or other product is read for any of
 * them.
 */

export const AI_PRODUCTS_NO_SITE_COPY = 'Open the store this job is for before starting it.'
export const AI_PRODUCTS_UNKNOWN_SITE_COPY = 'This AI job names a site this workspace does not have.'
export const AI_PRODUCTS_NOT_ENTITLED_COPY = 'Your plan does not include selling products. See Billing.'
export const AI_PRODUCTS_COMMERCE_OFF_COPY = 'Turn on Commerce for this site before starting the job.'
export const AI_PRODUCTS_GONE_COPY = 'This product is no longer in the catalog.'
export const AI_PRODUCTS_DECLINED_COPY = 'The model declined to write copy for this product.'

/** The notes a proposal carries about its product's photo. */
export const AI_PRODUCT_PHOTO_NOTES: Readonly<Partial<Record<AiProductPhotoRead, string>>> = {
  'not-in-library':
    'The photo was not read: it is not in this site’s media library. The copy is written from the product’s words.',
  unreadable: 'The photo could not be read, so the copy is written from the product’s words.',
  model: 'The photo was not read: the model this job ran on does not read pictures.',
}

/** The commerce plugin, as `plugins.config.json` names it. */
const COMMERCE_PLUGIN_ID = 'commerce'

/**
 * ASSUMED: how long a catalog or categories pass reads the site before it
 * asks: the host document and, for categories, the category names.
 */
export const AI_PRODUCTS_SITE_READ_MS = 1_000

const TIER = AI_STEP_TIERS[AI_PRODUCTS_STEP]

/**
 * One product's copy (AGL-3035): its generation and re-ask at the copy's own
 * ceiling on the tier `job.products` is served from, with the photo read. The
 * least any pass of the step needs, and so what the step registers.
 */
export const AI_JOB_PRODUCT_COPY_BUDGET = aiJobStepBudget({
  tier: TIER,
  maxTokens: AI_PRODUCT_COPY_MAX_TOKENS,
  lookups: 0,
  ownReadsMs: AI_PRODUCT_IMAGE_READ_MS,
})

/** A catalog: the largest answer the step asks for, at the routing table's ceiling. */
export const AI_JOB_CATALOG_BUDGET = aiJobStepBudget({
  tier: TIER,
  maxTokens: AI_CATALOG_MAX_TOKENS,
  lookups: 0,
  ownReadsMs: AI_PRODUCTS_SITE_READ_MS,
})

/** Categories and discounts. */
export const AI_JOB_CATEGORIES_BUDGET = aiJobStepBudget({
  tier: TIER,
  maxTokens: AI_PRODUCT_CATEGORIES_MAX_TOKENS,
  lookups: 0,
  ownReadsMs: AI_PRODUCTS_SITE_READ_MS,
})

/** What the `products` step registers: the least any of its passes needs. */
export const AI_JOB_PRODUCTS_STEP_BUDGET = AI_JOB_PRODUCT_COPY_BUDGET

/** The least time the next pass of a job needs, by what the job asks for. */
export function aiProductsRunMinimumMs(job: Pick<AiJob, 'inputs'>): number {
  const inputs = parseAiProductsJobInputs(job.inputs)
  if (typeof inputs === 'string') return AI_JOB_PRODUCT_COPY_BUDGET.minimumMs
  if (inputs.target === 'catalog') return AI_JOB_CATALOG_BUDGET.minimumMs
  if (inputs.target === 'categories') return AI_JOB_CATEGORIES_BUDGET.minimumMs
  return AI_JOB_PRODUCT_COPY_BUDGET.minimumMs
}

type Firestore = FirebaseFirestore.Firestore

interface StoreSite {
  hostId: string
  subdomain: string | null
  /** The store's name, as its visitors read it. */
  name: string
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Through JSON, so no `undefined` reaches the job document's write. */
const plain = <T>(value: T): Record<string, unknown> =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>

/** The site a job names, read and checked against the job's org. */
async function loadStore(firestore: Firestore, job: AiJob): Promise<StoreSite | { failure: string }> {
  if (!job.hostId) return { failure: AI_PRODUCTS_NO_SITE_COPY }
  const snapshot = await firestore.collection('hosts').doc(job.hostId).get()
  const host = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null
  // The door checks the caller's membership of the org the job is metered
  // against; a site of another org is refused here, before anything of it
  // reaches a prompt.
  if (!host || host['orgId'] !== job.orgId) return { failure: AI_PRODUCTS_UNKNOWN_SITE_COPY }
  const seo = (host['seo'] ?? {}) as Record<string, unknown>
  const subdomain = str(host['subdomain']) || null
  return {
    hostId: job.hostId,
    subdomain,
    name: str(seo['title']) || str(host['displayName']) || subdomain || '',
  }
}

/** The site's categories by name, as many as a request lists. */
async function readCategories(firestore: Firestore, hostId: string): Promise<AiProductCategory[]> {
  const snapshot = await firestore
    .collection('hosts')
    .doc(hostId)
    .collection('productCategories')
    .select('name')
    .limit(AI_PRODUCT_CATEGORY_LIST_MAX)
    .get()
  return snapshot.docs
    .map((doc) => ({ id: doc.id, name: str(doc.get('name')) }))
    .filter((category) => category.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** A saved product's facts, as a bulk pass reads them; `null` when it is gone. */
async function readProductFacts(firestore: Firestore, hostId: string, productId: string): Promise<AiProductFacts | null> {
  const snapshot = await firestore.collection('hosts').doc(hostId).collection('products').doc(productId).get()
  const data = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null
  if (!data || data['deletedAt']) return null
  const name = str(data['name'])
  if (!name) return null
  const type = data['type']
  const seo = (data['seo'] ?? {}) as Record<string, unknown>
  const mediaUrls = Array.isArray(data['mediaUrls']) ? data['mediaUrls'] : []
  return {
    id: productId,
    name,
    type: (AI_PRODUCT_TYPES as readonly unknown[]).includes(type) ? (type as AiProductType) : 'physical',
    text: str(data['description']).slice(0, AI_PRODUCT_TEXT_MAX_CHARS),
    tags: (Array.isArray(data['tags']) ? data['tags'] : []).map(str).filter(Boolean),
    categoryIds: (Array.isArray(data['categoryIds']) ? data['categoryIds'] : []).map(str).filter(Boolean),
    options: (Array.isArray(data['options']) ? data['options'] : [])
      .slice(0, AI_PRODUCT_OPTIONS_MAX)
      .map((option) => {
        const record = (option ?? {}) as Record<string, unknown>
        return {
          name: str(record['name']),
          values: (Array.isArray(record['values']) ? record['values'] : [])
            .map(str)
            .filter(Boolean)
            .slice(0, AI_PRODUCT_OPTION_VALUES_MAX),
        }
      })
      .filter((option) => option.name),
    imageUrl: str(mediaUrls[0]) || str(data['imageUrl']) || null,
    seoTitle: str(seo['title']),
    seoDescription: str(seo['description']),
  }
}

function modelOf(context: AiJobStepContext): string {
  return context.modelFor?.(AI_PRODUCTS_STEP) ?? aiModelForStep(AI_PRODUCTS_STEP)
}

/** An output addressed to the site, so its link opens the site's products. */
function output(site: StoreSite, id: string, label: string, proposal: object): AiJobOutput {
  return {
    resource: 'product',
    id,
    hostId: site.hostId,
    hostSubdomain: site.subdomain,
    label,
    proposal: plain(proposal),
  }
}

export interface AiJobProductsStepDeps {
  image?: AiProductImageSeams
  /** Whether a model reads pictures; the provider's own descriptor otherwise. */
  readsImages?: (model: string) => boolean
}

interface CopyRun {
  generation: AiValidatedGeneration<AiProductCopy>
  proposal: AiProductCopyProposal
}

/** Ask for one product's copy, and build its proposal from the answer. */
async function writeProductCopy(
  context: AiJobStepContext & { firestore: Firestore },
  model: string,
  site: StoreSite,
  product: AiProductFacts,
  deps: AiJobProductsStepDeps,
): Promise<CopyRun> {
  const { job, firestore, signal } = context
  const categories = await readCategories(firestore, site.hostId)
  let photo: AiProductPhotoRead = 'none'
  let image = null
  if (product.imageUrl) {
    if ((deps.readsImages ?? aiRouteReadsImages)(model)) {
      const read = await readAiProductImage(
        firestore,
        { value: product.imageUrl, hostId: site.hostId, orgId: job.orgId },
        deps.image,
      )
      photo = read.status
      image = read.status === 'read' ? read.image : null
    } else {
      photo = 'model'
    }
  }
  const generation = await generateAiProductCopy({
    store: site.name,
    product,
    categories,
    photo: Boolean(image),
    image,
    model,
    maxTokens: AI_JOB_PRODUCT_COPY_BUDGET.maxTokens(model),
    ...(signal ? { signal } : {}),
  })
  const values = generation.status === 'ok' ? generation.value : null
  const names = new Map(categories.map((category) => [category.id, category.name]))
  const note = AI_PRODUCT_PHOTO_NOTES[photo]
  return {
    generation,
    proposal: {
      kind: 'copy',
      product: { id: product.id, name: product.name },
      values,
      categories: (values?.categoryIds ?? []).map((id) => ({ id, name: names.get(id) ?? id })),
      optionNamesBefore: product.options.map((option) => option.name),
      gaps: values ? aiProductGaps(values.description) : [],
      photo,
      skipped: null,
      notes: note ? [note] : [],
    },
  }
}

/** The step, with its reads replaceable where a spec needs them. */
export function createAiJobProductsStep(deps: AiJobProductsStepDeps = {}): AiJobStepRunner {
  return async (context) => {
    const { job, firestore, signal } = context
    const model = modelOf(context)
    const inputs = parseAiProductsJobInputs(job.inputs)
    if (typeof inputs === 'string') return { ...aiUnspentOutcome(model), failure: inputs }
    const site = await loadStore(firestore, job)
    if ('failure' in site) return { ...aiUnspentOutcome(model), failure: site.failure }

    if (inputs.target === 'product') {
      const { generation, proposal } = await writeProductCopy(context, model, site, inputs.product, deps)
      const spent = aiGenerationSpent(generation)
      if (generation.status === 'refused') return { ...spent, refused: true }
      if (generation.status === 'needs_input') return { ...spent, failure: generation.message }
      return {
        ...spent,
        outputs: [output(site, AI_PRODUCTS_OUTPUT_IDS.copy(inputs.product.id), `Product copy · ${inputs.product.name}`, proposal)],
      }
    }

    if (inputs.target === 'bulk') {
      const done = (job.outputs ?? []).filter((entry) => aiProductsProposalOf(entry)?.kind === 'copy').length
      const productId = inputs.productIds[done]
      if (!productId) return aiUnspentOutcome(model)
      const more = done + 1 < inputs.productIds.length
      const product = await readProductFacts(firestore, site.hostId, productId)
      if (!product) {
        const skipped: AiProductCopyProposal = {
          kind: 'copy',
          product: { id: productId, name: productId },
          values: null,
          categories: [],
          optionNamesBefore: [],
          gaps: [],
          photo: 'none',
          skipped: AI_PRODUCTS_GONE_COPY,
          notes: [],
        }
        return {
          ...aiUnspentOutcome(model, {
            outputs: [output(site, AI_PRODUCTS_OUTPUT_IDS.copy(productId), `Product copy · ${productId}`, skipped)],
          }),
          continue: more,
        }
      }
      const { generation, proposal } = await writeProductCopy(context, model, site, product, deps)
      const spent = aiGenerationSpent(generation)
      // One product the rules could not hold, or the model declined, is
      // reported and passed over: its tokens are metered with the pass, and
      // the products after it still get their copy.
      const reported: AiProductCopyProposal =
        generation.status === 'ok'
          ? proposal
          : {
              ...proposal,
              skipped: generation.status === 'needs_input' ? generation.message : AI_PRODUCTS_DECLINED_COPY,
            }
      return {
        ...spent,
        outputs: [output(site, AI_PRODUCTS_OUTPUT_IDS.copy(productId), `Product copy · ${product.name}`, reported)],
        continue: more,
      }
    }

    if (inputs.target === 'catalog') {
      const generation = await generateAiCatalog({
        store: site.name,
        brief: job.brief,
        model,
        maxTokens: AI_JOB_CATALOG_BUDGET.maxTokens(model),
        ...(signal ? { signal } : {}),
      })
      const spent = aiGenerationSpent(generation)
      if (generation.status === 'refused') return { ...spent, refused: true }
      if (generation.status === 'needs_input') return { ...spent, failure: generation.message }
      const proposal: AiCatalogProposal = { kind: 'catalog', products: generation.value, notes: [] }
      return {
        ...spent,
        outputs: [
          output(
            site,
            AI_PRODUCTS_OUTPUT_IDS.catalog,
            `Proposed products · ${generation.value.length}`,
            proposal,
          ),
        ],
      }
    }

    const existing = await readCategories(firestore, site.hostId)
    const generation = await generateAiCategories({
      store: site.name,
      brief: job.brief,
      existingCategoryNames: existing.map((category) => category.name),
      model,
      maxTokens: AI_JOB_CATEGORIES_BUDGET.maxTokens(model),
      ...(signal ? { signal } : {}),
    })
    const spent = aiGenerationSpent(generation)
    if (generation.status === 'refused') return { ...spent, refused: true }
    if (generation.status === 'needs_input') return { ...spent, failure: generation.message }
    const proposal: AiCategoriesProposal = { kind: 'categories', ...generation.value, notes: [] }
    return {
      ...spent,
      outputs: [output(site, AI_PRODUCTS_OUTPUT_IDS.categories, 'Proposed categories and discounts', proposal)],
    }
  }
}

export const runAiJobProductsStep = createAiJobProductsStep()

/**
 * Whether a `products` job may start: inputs it can run, a site of the job's
 * own org, a plan that sells products, and Commerce on for the site and past
 * its release flag. Asked by the create door before the job exists, so a
 * refusal spends nothing.
 */
export const aiProductsJobAdmission: AiJobAdmission = async (context) => {
  const inputs = parseAiProductsJobInputs(context.inputs)
  if (typeof inputs === 'string') return { status: 400, error: inputs }
  if (!context.hostId) return { status: 400, error: AI_PRODUCTS_NO_SITE_COPY }
  const owner = await resolveOrgIdForHost(context.hostId)
  if (!owner || owner !== context.orgId) return { status: 404, error: AI_PRODUCTS_UNKNOWN_SITE_COPY }
  const org = context.org as (Partial<AglynOrgBilling> & { enabledPlugins?: string[] }) | null
  if (!checkEntitlement(org, 'commerce')) return { status: 403, error: AI_PRODUCTS_NOT_ENTITLED_COPY }
  const host = (await context.firestore.collection('hosts').doc(context.hostId).get()).data() ?? null
  const released = await filterEnabledPluginsByReleaseFlags([COMMERCE_PLUGIN_ID], {
    orgId: context.orgId,
    authorization: null,
  })
  if (!released.includes(COMMERCE_PLUGIN_ID) || !isHostPluginEnabled(org, host, COMMERCE_PLUGIN_ID)) {
    return { status: 403, error: AI_PRODUCTS_COMMERCE_OFF_COPY }
  }
  return null
}

/**
 * Registers the `products` step, the least time each of its passes needs, its
 * pass bound and its admission.
 */
export function registerAiProductsJob(): void {
  registerAiJobStep('products', runAiJobProductsStep, {
    minimumMs: AI_JOB_PRODUCTS_STEP_BUDGET.minimumMs,
    minimumMsFor: aiProductsRunMinimumMs,
  })
  registerAiJobStepPasses('products', AI_PRODUCTS_BULK_MAX)
  registerAiJobAdmission('products', aiProductsJobAdmission)
}
