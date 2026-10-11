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

import { resolveMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import { hostRoleCanWrite } from '@aglyn/aglyn/app-utils/organizations'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import {
  publishContentEntries,
  writeContentCollection,
  writeContentEntryDraft,
} from '@aglyn/tenant-data-admin/server/content-entry-drafts'
import { aiProductsProposalOf } from '../model/ai-products'
import type { AiJob, AiJobOutput } from '../model/ai-jobs.types'
import { aiSiteKindOfInputs } from '../model/ai-site-kinds'
import { AI_SITE_BLOG_NAME, AI_SITE_BLOG_SLUGS, aiSiteWords } from '../model/ai-site-job'
import { AI_STEP_TIERS } from '../providers/catalog'
import { aiModelForStep } from '../providers/routing'
import {
  AI_BLOG_POST_MAX_TOKENS,
  AI_BLOG_POST_STEP,
  generateAiBlogPost,
} from '../runtime/ai-blog-post-generation'
import {
  aiLayoutStarterPhotos,
  type AiLayoutPicturePhoto,
  type AiLayoutPictureSlot,
} from '../layout-language/ai-layout-pictures'
import { aiOriginJobId } from './ai-job-draft-ids'
import { aiLayoutStockPhotoSource } from './ai-layout-stock-photos'
import {
  aiLayoutListingId,
  aiLayoutListingPlacements,
  type AiLayoutListing,
  type AiLayoutListingScreen,
} from '../layout-language/ai-layout-listings'
import { aiJobAdmissionFor, type AiJobAdmissionRefusal } from './ai-job-admission'
import { aiJobStepBudget } from './ai-job-budget'
import { aiGenerationSpent, aiUnspentOutcome } from './ai-job-generation'
import type { AiJobStepContext, AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'

/**
 * A GUIDED START'S FIRST POSTS AND FIRST PRODUCTS (AGL-3676).
 *
 * A site of the kind "Blog & writing" or "Online store" got the right look
 * and pages, and nothing real in them: the writing page's cards and the
 * shop's grid named posts and products nobody had written. On a paid plan,
 * the scaffold now builds one more part for those two kinds, before the
 * pages, each its own row with its own timer and credits:
 *
 *  - WRITING YOUR FIRST POSTS: a content collection "Blog" — the platform's
 *    own blog, served at `/{slug}` with an entry page per post — and
 *    `AI_SITE_POSTS` posts in it, one generation a pass. Each is written as a
 *    draft through the same rules the console's routes hold
 *    (`content-entry-drafts.ts`), bylined with the business's name the person
 *    gave, and given a cover: a stock photo of its own title where the
 *    deployment has a library, else a starter (AGL-3676), which the blog's
 *    cards show. They go live with the
 *    site: the guided start's publish publishes them with its pages
 *    (`aiPublishSitePosts`), as a person's Publish would.
 *  - ADDING YOUR FIRST PRODUCTS: the `products` step's catalog, asked for
 *    `AI_SITE_PRODUCTS` products, each written through the commerce plugin's
 *    `product` draft writer. The catalog proposes no price, so each takes
 *    the writer's default price (Zach, 2026-10-08: "default a price",
 *    AGL-3676) for the owner to change; the job's row says so. Since the
 *    2026-10-08 Ember & Wick start, whose store showed no product at all,
 *    each is LISTED at once (`comingSoon`: written `active`). Each gets a
 *    photo in its slot, a stock photo of its own words where the deployment
 *    has a library, else a starter, for the owner to replace with their
 *    own.
 *
 * The pages built after them are told their titles or names, and the
 * sections that show them list the real records (`aiSiteListings`,
 * `ai-layout-listings.ts`): the shop's Product grid, the blog's posts.
 *
 * ── Not on the Free taste ────────────────────────────────────────────────
 *
 * A guided start's Free site, built on an empty site with its layout and
 * form, leaves 18 credits once its eight sections and its retried page's
 * room are held (`aiFreeSiteSectionsWithin`, AGL-3660), under the 23 one post
 * costs at its worst; and a Free plan includes neither
 * the `commerce` feature nor a product (`productsPerHost` is 0).
 * `ai-job-free-site.spec.ts` shows the arithmetic. Free sites keep the pages
 * their kind already describes; the owner adds posts and products after.
 */

/** How many first posts a paid blog gets. */
export const AI_SITE_POSTS = 3

/** How many first products a paid store gets: asked for, and the most written. */
export const AI_SITE_PRODUCTS = { min: 3, max: 6 } as const

/** What a products row says when none of what we made could be written: our failure, refunded. */
export const AI_SITE_PRODUCTS_NOT_WRITTEN_COPY = 'Your first products could not be added this time.'

/** What each part's row reads. */
export const AI_SITE_POSTS_LABEL = 'Writing your first posts'
export const AI_SITE_PRODUCTS_LABEL = 'Adding your first products'

/** The blog the posts go in, and the addresses it may answer at (`model/ai-site-job.ts`). */
export { AI_SITE_BLOG_NAME, AI_SITE_BLOG_SLUGS } from '../model/ai-site-job'

/** The input a site unit's own job carries what the part needs in. */
export const AI_SITE_CONTENT_INPUT = 'siteContent'

/** Which part a site of these answers gets; `null` for the Free taste and every other kind. */
export function aiSiteContentPart(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
  freeTaste: boolean,
): 'posts' | 'products' | null {
  if (freeTaste) return null
  const kind = aiSiteKindOfInputs(inputs)?.id
  if (kind === 'blog') return 'posts'
  if (kind === 'store') return 'products'
  return null
}

/**
 * ASSUMED: what one post pass reads and writes beside its generation: the
 * host, the collection's slug claim and the entry's transaction.
 */
export const AI_SITE_POST_WRITES_MS = 1_500

/** One post's pass: its generation and re-ask at the `copy.blog` ceiling, and its writes. */
export const AI_SITE_POST_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS[AI_BLOG_POST_STEP],
  maxTokens: AI_BLOG_POST_MAX_TOKENS,
  lookups: 0,
  ownReadsMs: AI_SITE_POST_WRITES_MS,
})

/** What a posts unit's job is told: the posts already written and the addresses the blog must not take. */
export interface AiSitePostsInput {
  written: Array<{ id: string; title: string }>
  total: number
  /** Addresses the site's own pages answer at, which the blog must not shadow. */
  avoidSlugs: string[]
  /** Who the posts are by: the business's name as given, else empty. */
  byline: string
}

/** What a products unit's job is told. */
export interface AiSiteProductsInput {
  min: number
  max: number
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

function postsInputOf(job: Pick<AiJob, 'inputs'>): AiSitePostsInput {
  const raw = (job.inputs?.[AI_SITE_CONTENT_INPUT] ?? {}) as Partial<AiSitePostsInput>
  return {
    written: Array.isArray(raw.written) ? raw.written.filter((one) => one && typeof one.id === 'string') : [],
    total: typeof raw.total === 'number' && raw.total > 0 ? Math.floor(raw.total) : AI_SITE_POSTS,
    avoidSlugs: Array.isArray(raw.avoidSlugs) ? raw.avoidSlugs.map(str).filter(Boolean) : [],
    byline: str(raw.byline),
  }
}

/** The id of the `index`th post, of the blog its unit writes under `unitJobId`. */
export function aiSitePostId(unitJobId: string, index: number): string {
  return `${unitJobId}-${index}`
}

/** The id of the `index`th product a products unit writes. */
export function aiSiteProductId(unitJobId: string, index: number): string {
  return `${unitJobId}-${index}`
}

/** A site's subdomain and name, as its outputs and its posts' byline read them. */
async function readSite(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
): Promise<{ subdomain: string | null; name: string } | null> {
  const host = await firestore.collection('hosts').doc(hostId).get()
  if (!host.exists) return null
  const seo = (host.get('seo') ?? {}) as Record<string, unknown>
  const subdomain = str(host.get('subdomain')) || null
  return { subdomain, name: str(host.get('displayName')) || str(seo['title']) }
}

const limitReview = (message: string) => ({ reason: 'limit' as const, message, findings: [] })

export interface AiSitePostsRunnerDeps {
  generate?: typeof generateAiBlogPost
  writeCollection?: typeof writeContentCollection
  writeEntry?: typeof writeContentEntryDraft
  /** Where each post's cover comes from; the stock library, else the starters, otherwise. */
  cover?: typeof aiSitePostCover
}

/** A post's cover's shape: the blog's cards' (`COLLECTION_LIST_COVER_RATIO`, the posts listing's). */
const AI_SITE_POST_COVER_ASPECT = 3 / 2

/**
 * A post's cover (AGL-3676): a stock photo of the post's own title, copied
 * into the site's library, where the deployment has a stock library; else the
 * starter photo a post was always given, turned by the job so blogs differ.
 * The blog's cards and the post's page show it, for the owner to replace.
 * Never throws: a post whose search fails takes its starter.
 */
export async function aiSitePostCover(input: {
  job: Pick<AiJob, '$id' | 'hostId' | 'createdBy' | 'inputs' | 'brief'>
  title: string
  index: number
  total: number
  signal?: AbortSignal
  stockPhotos?: typeof aiLayoutStockPhotoSource
}): Promise<string | null> {
  const { job, index } = input
  if (job.hostId && input.title.trim()) {
    try {
      const source = (input.stockPhotos ?? aiLayoutStockPhotoSource)({
        hostId: job.hostId,
        uid: job.createdBy,
        seed: `${job.$id}:posts:${index}`,
        business: aiSiteWords(job.inputs).about || job.brief,
        sectionNames: ['Blog'],
        jobId: aiOriginJobId(job),
        ...(input.signal ? { signal: input.signal } : {}),
      })
      const [found] = source
        ? await source([
            {
              imageId: `cover${index}`,
              frameId: null,
              iconId: null,
              alt: input.title,
              aspect: AI_SITE_POST_COVER_ASPECT,
              sectionIndex: 0,
              role: 'gallery' as const,
            },
          ])
        : []
      if (found?.src) return found.src
    } catch (error) {
      console.warn('ai site posts: the stock photo failed; the starter covers it', { error: String(error) })
    }
  }
  const starters = aiLayoutStarterPhotos(
    Array.from({ length: Math.max(input.total, index + 1) }, (_, slot) => ({
      imageId: `cover${slot}`,
      frameId: null,
      iconId: null,
      alt: '',
      aspect: 16 / 9,
      sectionIndex: slot + 1,
      role: 'gallery' as const,
    })),
    job.$id,
  )
  return starters[index]?.src ?? null
}

/**
 * The posts unit's runner, on the job the scaffold derived for it: one post a
 * pass, continuing while posts remain. Its first pass makes the blog; every
 * pass finds it again under the unit's own id, and a post under its own id,
 * so a pass repeated after its write reports the post it already wrote.
 */
export function createAiSitePostsRunner(deps: AiSitePostsRunnerDeps = {}): AiJobStepRunner {
  const generate = deps.generate ?? generateAiBlogPost
  const writeCollection = deps.writeCollection ?? writeContentCollection
  const writeEntry = deps.writeEntry ?? writeContentEntryDraft
  const coverFor = deps.cover ?? aiSitePostCover
  return async (context): Promise<AiJobStepOutcome> => {
    const { job, firestore, signal } = context
    const model = context.modelFor?.(AI_BLOG_POST_STEP) ?? aiModelForStep(AI_BLOG_POST_STEP)
    if (!job.hostId) return { ...aiUnspentOutcome(model), failure: 'Open the site before writing its posts.' }
    const input = postsInputOf(job)
    const index = input.written.length
    if (index >= input.total) return aiUnspentOutcome(model)
    const site = await readSite(firestore, job.hostId)
    if (!site) return { ...aiUnspentOutcome(model), failure: 'This site no longer exists.' }
    const avoid = new Set(input.avoidSlugs.map((slug) => slug.toLowerCase()))
    const blog = await writeCollection(firestore, {
      hostId: job.hostId,
      uid: job.createdBy,
      id: job.$id,
      displayName: AI_SITE_BLOG_NAME,
      slugs: AI_SITE_BLOG_SLUGS.filter((slug) => !avoid.has(slug)),
      now: context.now,
    })
    if (blog.ok === false) return aiUnspentOutcome(model, { review: limitReview(blog.error) })

    const generation = await generate({
      brief: job.brief,
      merchantWords: job.brief,
      earlierTitles: input.written.map((post) => post.title),
      index: index + 1,
      total: input.total,
      model,
      maxTokens: AI_SITE_POST_BUDGET.maxTokens(model),
      ...(signal ? { signal } : {}),
    })
    const spent = aiGenerationSpent(generation)
    if (generation.status === 'refused') return { ...spent, refused: true }
    if (generation.status === 'needs_input') return { ...spent, failure: generation.message }
    const post = generation.value
    // A stock photo of its title as its cover, else a starter (AGL-3676).
    const cover = await coverFor({
      job,
      title: post.title,
      index,
      total: input.total,
      ...(signal ? { signal } : {}),
    }).catch(() => null)
    const byline = input.byline || site.name
    const written = await writeEntry(firestore, {
      hostId: job.hostId,
      collectionId: blog.id,
      uid: job.createdBy,
      id: aiSitePostId(job.$id, index),
      content: {
        title: post.title,
        excerpt: post.excerpt,
        body: post.body,
        seoDescription: post.seoDescription,
        ...(cover ? { coverImage: cover, coverImageAlt: post.title } : {}),
        ...(byline ? { authorName: byline } : {}),
      },
      now: context.now,
    })
    if (written.ok === false) return { ...spent, review: limitReview(written.error) }
    const output: AiJobOutput = {
      resource: 'entry',
      id: written.id,
      hostId: job.hostId,
      hostSubdomain: site.subdomain,
      label: written.title,
      note: `A post in ${blog.displayName}, at /${blog.slug}/${written.slug}. It goes live with the site.`,
      proposal: { collectionId: blog.id, collectionSlug: blog.slug, slug: written.slug },
    }
    return { ...spent, outputs: [output], ...(index + 1 < input.total ? { continue: true } : {}) }
  }
}

export const runAiSitePostsUnit = createAiSitePostsRunner()

export interface AiSiteProductsRunnerDeps {
  /** The catalog's runner: the `products` step's. */
  catalog: AiJobStepRunner
  writerFor?: typeof pluginResourceDraftWriter
  /** Where each product's photo comes from; the stock library, else the starters, otherwise. */
  photos?: typeof aiSiteProductPhotos
}

/**
 * A photo for each product (AGL-3676), in order: a stock photo of the
 * product's own words, copied into the site's library, where the deployment
 * has a stock library; else a starter photo, as a page's empty picture takes
 * one. It fills the photo slot every product card and product page has, for
 * the owner to replace with their own; the product's note says so. Never
 * throws: a product with no photo is still written.
 */
export async function aiSiteProductPhotos(input: {
  job: Pick<AiJob, '$id' | 'hostId' | 'createdBy' | 'inputs' | 'brief'>
  names: readonly string[]
  /** What each product's photo should show, as its catalog proposed it, by position (AGL-3676). */
  shows?: readonly string[]
  signal?: AbortSignal
  stockPhotos?: typeof aiLayoutStockPhotoSource
}): Promise<Array<string | null>> {
  if (!input.names.length || !input.job.hostId) return input.names.map(() => null)
  const slots: AiLayoutPictureSlot[] = input.names.map((name, index) => ({
    imageId: `product${index}`,
    frameId: null,
    iconId: null,
    alt: name,
    // The product card's own shape (`cardStyle: 'photo'`).
    aspect: 4 / 5,
    sectionIndex: 0,
    role: 'gallery' as const,
    // Searched for by its own name, then what its photo shows, with the shop's
    // category, and held to that category (AGL-3676).
    product: { subjects: [name, input.shows?.[index] ?? ''].filter((words) => words.trim()) },
  }))
  const seed = `${input.job.$id}:products`
  let found: ReadonlyArray<AiLayoutPicturePhoto | null> = []
  try {
    const source = (input.stockPhotos ?? aiLayoutStockPhotoSource)({
      hostId: input.job.hostId,
      uid: input.job.createdBy,
      seed,
      business: aiSiteWords(input.job.inputs).about || input.job.brief,
      sectionNames: ['Products'],
      jobId: aiOriginJobId(input.job),
      // Each product may try its name, its photo's subject, its category, a
      // gift's wrapper and the craft's broad searches (AGL-3660).
      searches: slots.length * 6,
      ...(input.signal ? { signal: input.signal } : {}),
    })
    if (source) found = await source(slots)
  } catch (error) {
    console.warn('ai site products: the stock photos failed; starter photos fill them', { error: String(error) })
  }
  const starters = aiLayoutStarterPhotos(slots, seed)
  const hostId = input.job.hostId
  // Every product has a photo (AGL-3676): a starter where no stock photo
  // named its category, never an empty tile.
  return slots.map(
    (_slot, index) =>
      aiSiteProductPhotoSrc(found[index]?.src, hostId) ?? aiSiteProductPhotoSrc(starters[index]?.src, hostId),
  )
}

/**
 * A photo as a product stores it: the form the console's picker writes when
 * an owner picks one from the library (`console-media-picker-provider`), the
 * asset's CDN path `/api/media/cdn/{scope}/{mediaId}`, or a starter's own
 * site path. A page's picture slot holds the library's `media:` reference
 * (`mediaNodeSrc`), which is what the stock source hands back, and the
 * product's rules take only an https address or a path on the site: the
 * candle store's guided start of 2026-10-09 (job FYNasg1h0S) wrote no
 * product at all because every photo was a `media:` reference. The path
 * names the asset, not its bytes, so a replace in the library still reaches
 * the product. Anything else is no photo, never a value the product refuses.
 */
export function aiSiteProductPhotoSrc(src: string | null | undefined, hostId: string): string | null {
  if (!src) return null
  const path = resolveMediaSrc(src, { hostId })
  if (!path || path.length > 2_000 || /[\s"'<>]/.test(path)) return null
  return path.startsWith('/') || path.startsWith('https://') ? path : null
}

/**
 * A proposed product's real choices (AGL-3676): each option with two or more
 * distinct values. An option of one value is no choice for a shopper to make
 * — the beta.237 Willow Wick gift set's "Scent" select offered nothing — so
 * it is left out, and its one value stays in the product's own words.
 */
export function aiSiteProductChoices(
  options: ReadonlyArray<{ name: string; values: readonly string[] }> | null | undefined,
): Array<{ name: string; values: string[] }> {
  return (options ?? []).flatMap((option) => {
    const seen = new Set<string>()
    const values = option.values
      .map((value) => value.trim())
      .filter((value) => value && !seen.has(value.toLowerCase()) && !!seen.add(value.toLowerCase()))
    return option.name.trim() && values.length >= 2 ? [{ name: option.name.trim(), values }] : []
  })
}

/** The sentence the products unit's brief ends with, which the catalog's rules read as how many. */
export function aiSiteProductsBriefLine(input: AiSiteProductsInput = AI_SITE_PRODUCTS): string {
  return `Propose between ${input.min} and ${input.max} products: the store's first ones.`
}

/**
 * The products unit's runner: the `products` step's catalog for the store's
 * brief, then each proposed product, up to the most a site starts with,
 * written by the plugin that keeps products at its default price, listed. A
 * product past the plan's allowance stops the writing there, and the row
 * says how many were added; none at all is the allowance's review. A photo
 * the product's rules refuse is dropped and the product written without it;
 * a product they refuse outright is skipped, and none written for that
 * reason is our failure, refunded, never the person's review (AGL-3676).
 */
export function createAiSiteProductsRunner(deps: AiSiteProductsRunnerDeps): AiJobStepRunner {
  const writerFor = deps.writerFor ?? pluginResourceDraftWriter
  return async (context): Promise<AiJobStepOutcome> => {
    const { job } = context
    const keeper = writerFor('product')
    const model = context.modelFor?.('job.products') ?? aiModelForStep('job.products')
    if (!keeper || !job.hostId) return { ...aiUnspentOutcome(model), failure: 'Products are not available on this site.' }
    const outcome = await deps.catalog({
      ...context,
      job: { ...job, kind: 'products', inputs: { ...job.inputs, target: 'catalog' } },
    })
    if (outcome.refused || outcome.failure || outcome.review) return outcome
    const catalog = outcome.outputs.map((output) => ({ output, proposal: aiProductsProposalOf(output) })).find(
      (entry) => entry.proposal?.kind === 'catalog',
    )
    if (!catalog || catalog.proposal?.kind !== 'catalog') return { ...outcome, outputs: [] }
    const proposed = catalog.proposal.products.slice(0, AI_SITE_PRODUCTS.max)
    const photos = await (deps.photos ?? aiSiteProductPhotos)({
      job,
      names: proposed.map((product) => product.name),
      shows: proposed.map((product) => product.photo ?? ''),
      ...(context.signal ? { signal: context.signal } : {}),
    }).catch(() => proposed.map(() => null))
    const outputs: AiJobOutput[] = []
    let stopped: string | null = null
    /** The product's rules refusing what we made: ours, never the workspace's (AGL-3676). */
    let rejected: string | null = null
    for (const [index, product] of proposed.entries()) {
      const content: Record<string, unknown> = {
        name: product.name,
        type: product.type,
        // Listed at once, so no "[gift card terms]" gap reaches a shopper:
        // a sentence that leaves a fact for the owner is left out.
        description: aiSiteProductDescriptionWithoutGaps(product.description),
        tags: product.tags,
        // A choice is two values or more (AGL-3676): a "Scent" of one value
        // drew a select with nothing to pick on the live Willow Wick page.
        options: aiSiteProductChoices(product.options),
        seoTitle: product.seoTitle,
        seoDescription: product.seoDescription,
        comingSoon: true,
      }
      // A photo we picked that the product's rules refuse is dropped, never
      // the product: its slot stays empty for the owner's own.
      const photo = photos[index] ?? null
      const withPhoto = photo ? { ...content, mediaUrls: [photo] } : content
      const photoRefused =
        photo !== null &&
        keeper.writer.check(withPhoto, { hostId: job.hostId }).ok === false &&
        keeper.writer.check(content, { hostId: job.hostId }).ok
      if (photoRefused) {
        console.warn('ai site products: the product refused its photo; written without it', {
          orgId: job.orgId,
          jobId: job.$id,
          photo,
        })
      }
      const written = await keeper.writer.write({
        orgId: job.orgId,
        hostId: job.hostId,
        uid: job.createdBy,
        org: (context.org ?? null) as Readonly<Record<string, unknown>> | null,
        now: context.now,
        id: aiSiteProductId(job.$id, index),
        name: product.name,
        // No price stated: the writer gives it the store's default price
        // for the owner to change (AGL-3676). Listed at once. Its photo
        // slot holds a stock or starter photo for the owner to replace.
        content: photoRefused ? content : withPhoto,
      })
      if (written.ok === false) {
        // A 400 is the product's rules refusing content we made: that one
        // product is skipped and the rest are still written. Anything else
        // (the allowance, the role, the site) stops the writing there.
        if (written.status === 400) {
          console.error('ai site products: the product writer refused a product we made', {
            orgId: job.orgId,
            jobId: job.$id,
            index,
            error: written.error,
          })
          rejected = written.error
          continue
        }
        stopped = written.error
        break
      }
      outputs.push({
        resource: 'product',
        id: written.id,
        hostId: job.hostId,
        hostSubdomain: catalog.output.hostSubdomain ?? null,
        label: written.name,
        note: AI_SITE_PRODUCT_NOTE,
      })
    }
    if (!outputs.length) {
      // Nothing written because the product's rules refused what we made:
      // the failure is ours, so the item's credits are refunded
      // (`aiUnitFailure` → `ours: true`). Only the workspace's allowance,
      // role or site is the person's to review.
      if (!stopped && rejected) return { ...outcome, outputs: [], failure: AI_SITE_PRODUCTS_NOT_WRITTEN_COPY }
      return { ...outcome, outputs: [], review: limitReview(stopped ?? 'No product could be added.') }
    }
    // The allowance that stopped the rest is said where the last one added is.
    const last = outputs[outputs.length - 1]
    if (stopped) {
      last.note = `${last.note} ${outputs.length} of ${proposed.length} added: ${stopped}.`
    } else if (outputs.length < proposed.length) {
      last.note = `${last.note} ${outputs.length} of ${proposed.length} added.`
    }
    return { ...outcome, outputs }
  }
}

/**
 * Whether a part may be built for this member on this site, asked before its
 * first pass so a refusal spends nothing; `null` admits. Products ask what a
 * `products` job asks (the plan's commerce feature, Commerce on and released
 * for the site) and the writer's own refusal (role, allowance); posts ask
 * that the member may write the site's content.
 */
export async function aiSiteContentRefusal(
  part: 'posts' | 'products',
  context: Pick<AiJobStepContext, 'firestore' | 'org' | 'now'> & { job: Pick<AiJob, 'orgId' | 'hostId' | 'createdBy' | 'inputs'> },
  deps: { writerFor?: typeof pluginResourceDraftWriter; admissionFor?: typeof aiJobAdmissionFor } = {},
): Promise<string | null> {
  const { job, firestore } = context
  if (!job.hostId) return 'Open the site first.'
  if (part === 'posts') {
    const host = await firestore.collection('hosts').doc(job.hostId).get()
    return hostRoleCanWrite((host.get('memberRoles') ?? {})[job.createdBy]) ? null : 'Editing requires the editor role'
  }
  const admission = (deps.admissionFor ?? aiJobAdmissionFor)('products')
  const refused: AiJobAdmissionRefusal | null = admission
    ? await admission({
        firestore,
        orgId: job.orgId,
        hostId: job.hostId,
        inputs: { target: 'catalog' },
        org: context.org ?? null,
        uid: job.createdBy,
      })
    : { status: 403, error: 'Products are not available on this site.' }
  if (refused) return refused.error
  const keeper = (deps.writerFor ?? pluginResourceDraftWriter)('product')
  if (!keeper) return 'Products are not available on this site.'
  const room = await keeper.writer.refusal({
    orgId: job.orgId,
    hostId: job.hostId,
    uid: job.createdBy,
    org: (context.org ?? null) as Readonly<Record<string, unknown>> | null,
    now: context.now,
  })
  return room?.error ?? null
}

/** The guided start's posts, published with its pages (AGL-3676). */
export interface AiSitePostsPublish {
  published: number
  kept: number
  /** The blog's own addresses, for the publish's cache drop. */
  paths: string[]
}

/**
 * Publishes the posts a guided start wrote, as the entry editor's Publish
 * does, once its pages are live. Never throws: a post that stays a draft is
 * the owner's to publish from Content.
 */
export async function aiPublishSitePosts(
  firestore: FirebaseFirestore.Firestore,
  input: { job: Pick<AiJob, '$id' | 'orgId' | 'hostId' | 'createdBy'>; outputs: readonly AiJobOutput[]; now: Date },
  publish: typeof publishContentEntries = publishContentEntries,
): Promise<AiSitePostsPublish | null> {
  const posts = input.outputs.filter((output) => output.resource === 'entry')
  const collectionId = str(posts[0]?.proposal?.['collectionId'])
  const collectionSlug = str(posts[0]?.proposal?.['collectionSlug'])
  if (!input.job.hostId || !posts.length || !collectionId) return null
  try {
    const result = await publish(firestore, {
      hostId: input.job.hostId,
      collectionId,
      uid: input.job.createdBy,
      ids: posts.map((post) => post.id),
      now: input.now,
    })
    if ('ok' in result) {
      console.warn('ai site posts not published', { jobId: input.job.$id, error: result.error })
      return { published: 0, kept: posts.length, paths: [] }
    }
    const slugs = posts
      .filter((post) => result.published.includes(post.id))
      .map((post) => str(post.proposal?.['slug']))
      .filter(Boolean)
    return {
      published: result.published.length,
      kept: result.kept.length,
      paths: collectionSlug ? [`/${collectionSlug}`, ...slugs.map((slug) => `/${collectionSlug}/${slug}`)] : [],
    }
  } catch (error) {
    console.error('ai site posts publish threw', { orgId: input.job.orgId, jobId: input.job.$id, error })
    return null
  }
}

/**
 * The site's listings a layout or a page unit is handed (AGL-3676,
 * `ai-layout-listings.ts`): the store's catalog once its products are written,
 * the blog once its posts are, each with the sections of the plan's pages
 * that list it. A layout is built before either, so it is told the store will
 * sell (`sells`, its ledger still owing the products part), which puts the
 * cart in its header.
 */
export function aiSiteListings(input: {
  outputs: readonly AiJobOutput[]
  screens: readonly AiLayoutListingScreen[]
  /** The ledger owes a store's first products: a layout built before them carries the cart. */
  sells?: boolean
  /**
   * The site is a store (`siteKind: 'store'`, AGL-3676): its Shop page and
   * its home list the catalog whatever its first products came to — the
   * live Hearth & Wick start's products step failed, and its Shop page was
   * six cards naming kinds of candle. An empty catalog says so in the grid.
   */
  store?: boolean
  /**
   * The site is a music site (`siteKind: 'music'`, AGL-3716): its Music page,
   * or its home, places an empty Music player for the artist's own tracks.
   * Nothing is sourced: the owner uploads the recordings.
   */
  music?: boolean
}): AiLayoutListing[] {
  const listings: AiLayoutListing[] = []
  const products = input.outputs.filter((output) => output.resource === 'product' && !output.proposal)
  if (products.length || input.sells || input.store) {
    const contact = aiSiteContactPath(input.screens)
    listings.push({
      id: aiLayoutListingId('products'),
      kind: 'products',
      name: 'the shop',
      records: products.map((product) => product.label),
      ...(contact ? { emptyAction: { label: 'Get in touch', href: contact } } : {}),
      // A store whose first products were skipped or failed lists its
      // (empty) catalog, but its header carries no cart until it sells.
      ...(products.length || input.sells ? {} : { cart: false }),
      placements: aiLayoutListingPlacements('products', input.screens),
    })
    // A store that sells shows its customers' reviews and takes newsletter
    // sign-ups where its pages name them (AGL-3676): both commerce elements,
    // so only where the store's commerce runs, never on a store that cannot
    // sell yet.
    if (products.length || input.sells) {
      for (const kind of ['reviews', 'signup'] as const) {
        const placements = aiLayoutListingPlacements(kind, input.screens)
        if (placements.length) listings.push({ id: aiLayoutListingId(kind), kind, name: kind === 'reviews' ? 'the store' : 'the newsletter', records: [], placements })
      }
    }
  }
  const posts = input.outputs.filter((output) => output.resource === 'entry')
  const slug = str(posts[0]?.proposal?.['collectionSlug'])
  if (posts.length && slug) {
    listings.push({
      id: aiLayoutListingId('posts'),
      kind: 'posts',
      name: 'the blog',
      records: posts.map((post) => post.label),
      href: `/${slug}`,
      collectionSlug: slug,
      placements: aiLayoutListingPlacements('posts', input.screens),
    })
  }
  if (input.music) {
    const placements = aiLayoutListingPlacements('tracks', input.screens)
    if (placements.length) {
      listings.push({ id: aiLayoutListingId('tracks'), kind: 'tracks', name: 'the music', records: [], placements })
    }
  }
  return listings
}

/** The page a visitor gets in touch on, by its path: one whose address or name says contact, else the one placing a form. */
function aiSiteContactPath(screens: readonly AiLayoutListingScreen[]): string | null {
  const path = (slug: string) => `/${slug.trim().replace(/^\/+|\/+$/g, '')}`
  const isPath = (slug: string) => /^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(path(slug))
  const named = screens.find((screen) => isPath(screen.slug) && /\b(contact|get in touch|enquir|inquir)/i.test(`${screen.slug} ${screen.title}`))
  if (named) return path(named.slug)
  const form = screens.find((screen) => isPath(screen.slug) && screen.sections.some((section) => (section.uses ?? []).some((use) => /form/i.test(use))))
  return form ? path(form.slug) : null
}

/**
 * A proposed product's description with each sentence that leaves a gap for
 * the owner ("Delivery details: [how and when the card is sent].") taken
 * out (AGL-3676): a start's products are listed as soon as they are written,
 * and a live run's gift card showed its gaps on the product page. A line
 * break is kept; nothing else is changed.
 */
export function aiSiteProductDescriptionWithoutGaps(description: string): string {
  return description
    .split('\n')
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !/\[[^\]]+\]/.test(sentence))
        .join(' '),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** What each product a start wrote says on the job's page (AGL-3676). */
export const AI_SITE_PRODUCT_NOTE =
  'On your store at a starting price. Set its real price — and your own photo — in Products.'

/** The note a store's products row carries once they are written (AGL-3676): the step left before it sells. */
export const AI_SITE_PRODUCTS_PRICE_NOTE =
  'Your products are on your store at a starting price. Set their real prices in Products.'

/** What a page of a blog or a store is told about the posts or products built before it. */
export function aiSiteContentBriefLines(outputs: readonly AiJobOutput[]): string[] {
  const posts = outputs.filter((output) => output.resource === 'entry')
  const products = outputs.filter((output) => output.resource === 'product' && !output.proposal)
  const lines: string[] = []
  if (posts.length) {
    const slug = str(posts[0].proposal?.['collectionSlug'])
    lines.push(
      `This site's blog${slug ? ` at /${slug}` : ''} has these posts: ${posts.map((post) => `“${post.label}”`).join(', ')}.`,
      'Where a page features writing, feature these posts by their titles; never name a post that is not in this list.',
    )
  }
  if (products.length) {
    lines.push(
      `This store's products are: ${products.map((product) => `“${product.label}”`).join(', ')}.`,
      'Where a page features products, feature these by their names; never name another product, and never state a price.',
      // The collection tiles a storefront home shows (AGL-3676): its own range, grouped.
      'Where a page shows the shop by collection, group these products into two to four collections by what they are (a kind, a use or an occasion), one item each, named for the group and never for one product.',
    )
  }
  return lines
}
