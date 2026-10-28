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
 * THE `import` JOB: BRING MY SITE, IN REVIEWED WAVES (AGL-3976).
 *
 * One step, many passes, each one unit of work (`aiSiteImportNextWork`):
 *
 *   1. READ the proved site (no model): the crawler reads it as AglynBot,
 *      main pages first, up to the plan's page count; the inventory is cut
 *      into waves (`model/ai-site-import.ts`), every page gets a ledger row,
 *      and Trust & Safety gets its row. The job then WAITS (`needs_review`,
 *      reason `wave`): nothing is brought in until the person starts wave 1.
 *   2. START A WAVE (no model), on the person's say-so: the proof is still
 *      current, the day's limit has room, the plan still has room; the
 *      wave's pages are read again, fresh, and a page that became a sign-in
 *      page, went away or is now off limits to AglynBot is left out.
 *   3. THE HEADER AND FOOTER, in the first wave: the layout step's own pass,
 *      linking the wave's pages.
 *   4. EACH PAGE: its photos into the media library (no model, deduped by
 *      source key), then the page step's own passes in the layout language,
 *      told the page's text FENCED as untrusted data.
 *   5. CLOSE THE WAVE: the job waits again, with the wave's pages as drafts
 *      to review, until the person starts the next one. The last wave ends
 *      the job.
 *
 * Every page is an item of the job's ledger, so a page that fails on our
 * side gives back its own spend (the machine's `refundBuildCredits`) and the
 * wave goes on. Nothing here publishes: every page is a draft, and the site
 * stays unpublished until a member publishes it, which they can only reach
 * once the import, behind its ownership proof, has written something.
 *=========================================*/

import { resolveEffectivePlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { pluginMediaIngest, type PluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import {
  listDomainOwnershipClaims,
  normalizeOwnershipDomain,
} from '@aglyn/tenant-data-admin/server/domain-ownership'
import { getOrgForUser, memberHasOrgPermission } from '@aglyn/tenant-data-admin/server/organizations'
import { consumeRateLimit } from '@aglyn/tenant-data-admin/server/rate-limit-store'
import { isServerReleaseFlagOnForOrg } from '@aglyn/tenant-data-admin/server/release-flags'
import type { AiBuildPlanCreate, AiBuildPlanScreen } from '../model/ai-build-plan'
import type { AiJob, AiJobItemLedger, AiJobPlan, AiJobReview } from '../model/ai-jobs.types'
import {
  AI_SITE_IMPORT_DOMAIN_INPUT,
  AI_SITE_IMPORT_FRAME_SLOT,
  AI_SITE_IMPORT_LEFT_OUT_COPY,
  AI_SITE_IMPORT_MAX_PAGES,
  AI_SITE_IMPORT_MIN_WORDS,
  AI_SITE_IMPORT_WAVE_PAGES,
  aiSiteImportInventory,
  aiSiteImportItemOpen,
  aiSiteImportLedger,
  aiSiteImportNextWork,
  aiSiteImportPageSettled,
  aiSiteImportPagesRead,
  aiSiteImportPhotosIn,
  aiSiteImportWaveClosed,
  aiSiteImportWaveMessage,
  aiSiteImportWaveStarted,
  type AiSiteImportLeftOutReason,
  type AiSiteImportPage,
  type AiSiteImportPageRead,
  type AiSiteImportState,
  type AiSiteImportWave,
} from '../model/ai-site-import'
import { aiModelForStep } from '../providers/routing'
import { SITE_IMPORT_RELEASE_FLAG } from '../site-import/site-import-flag'
import { crawlSiteForImport, type SiteImportCrawlSeams, type SiteImportInventory } from '../site-import/site-import-crawl'
import { bringInSiteImportPhotos, type SiteImportPhotosDeps } from '../site-import/site-import-images'
import { siteImportLeftOutReason, siteImportListedPage, siteImportPageRead, siteImportPageWords } from '../site-import/site-import-page'
import { fileSiteImportReview } from '../site-import/site-import-review'
import { aiUnitErrorRetryable, aiUnitFailure, aiUnitSpend } from './ai-build-unit-outcome'
import { registerAiJobAdmission, type AiJobAdmission } from './ai-job-admission'
import { AI_JOB_STEP_OVERHEAD_MS } from './ai-job-budget'
import { readAiScreenRoom } from './ai-job-drafts'
import { aiUnspentOutcome } from './ai-job-generation'
import { AI_LAYOUT_PAGE_PHOTOS_INPUT } from './ai-layout-owner-photos'
import { AI_LAYOUT_SITE_PAGES_INPUT, AI_LAYOUT_SITE_PAGES_MAX, type AiLayoutSitePage } from './ai-job-layout-site-pages'
import { AI_JOB_PAGE_STEP_MINIMUM_MS } from './ai-job-page-budget'
import { AI_LAYOUT_IMPORTED_PAGE_INPUT, AI_LAYOUT_LANGUAGE_INPUT } from './ai-job-page-language'
import { aiSitePageWritten } from './ai-job-site-step'
import { AI_STOCK_PHOTO_PAGES_INPUT } from './ai-layout-stock-photos'
import { AI_JOB_BRIEF_MAX_CHARS, type AiJobItemOutcome, type AiJobStepContext, type AiJobStepOutcome, type AiJobStepRunner } from './ai-job-text-step'
import {
  aiApplyJobItemRecord,
  aiJobStepRunMinimumMs,
  aiJobStepRunnerFor,
  registerAiJobStep,
  registerAiJobStepPasses,
} from './ai-jobs'

/** Waves (the read included) one workspace may start in a day. */
export const SITE_IMPORT_WAVES_PER_ORG_PER_DAY = 12

const DAY_MS = 24 * 60 * 60 * 1000

/** The rate-limit key a workspace's imports share. */
export function siteImportRateKey(orgId: string): string {
  return `ai-import:${orgId}`
}

/** The crawl's clock when the import reads the whole site. */
export const AI_SITE_IMPORT_READ_MS = 150_000

/** The crawl's clock when a wave reads its own pages again. */
export const AI_SITE_IMPORT_WAVE_READ_MS = 90_000

/** The clock for one page's photos: each is fetched and stored through the library's door. */
export const AI_SITE_IMPORT_PHOTOS_MS = 90_000

/** What the step's own reads and writes around a pass take: the claims, the room, the row. */
const OWN_READS_MS = 10_000

/** The least time each pass that asks no model needs. */
export const AI_SITE_IMPORT_PASS_MINIMUM_MS = {
  read: AI_SITE_IMPORT_READ_MS + OWN_READS_MS + AI_JOB_STEP_OVERHEAD_MS,
  wave: AI_SITE_IMPORT_WAVE_READ_MS + OWN_READS_MS + AI_JOB_STEP_OVERHEAD_MS,
  photos: AI_SITE_IMPORT_PHOTOS_MS + OWN_READS_MS + AI_JOB_STEP_OVERHEAD_MS,
} as const

/**
 * The passes one import may take: a read, then for every page its photos,
 * its answer and its listing, every wave's start and the header and footer,
 * with room for re-asks.
 */
export const AI_SITE_IMPORT_MAX_PASSES = AI_SITE_IMPORT_MAX_PAGES * 4 + 60

/** Customer-safe sentences. */
export const AI_SITE_IMPORT_COPY = {
  noSite: 'Open the site to bring your website into.',
  badDomain: 'This website’s address cannot be brought in.',
  ownership: (domain: string) =>
    `Verify that you own ${domain} before bringing it in. A proof is good for 30 days; verify again, then start this wave again.`,
  limit: `This workspace has started as many site waves as it can today (${SITE_IMPORT_WAVES_PER_ORG_PER_DAY}). Start this wave again tomorrow.`,
  robots: (domain: string) =>
    `The robots.txt file of ${domain} could not be read just now, so nothing was read. Try again in a few minutes.`,
  nothing: (domain: string) => `No page of ${domain} could be read. Check that the site is up, then try again.`,
  blocked: (domain: string) =>
    `The bot protection or firewall of ${domain} turned AglynBot away, so no page could be read. Allow AglynBot in your site’s bot or firewall settings, then read the site again.`,
  unavailable: 'Bringing a site in is not available on this workspace right now.',
  frameUnavailable: 'The header and footer could not be built here; your pages use the site’s own layout.',
  pageUnavailable: 'Pages cannot be built here right now.',
  pageNotWritten: 'This page could not be written from its old page. Its spend is given back.',
  plan: 'Bringing an existing site in is included on every paid plan.',
  /** Names "Bring a site in" (`ai.import`, AGL-4047), never a role. */
  role: 'Your role does not include "Bring a site in" — ask an organization admin',
} as const

/*------------------------------------------
 * Seams
 *-----------------------------------------*/

export interface AiSiteImportOwnership {
  current: boolean
  method: string | null
  provenAt: number | null
  detail: string | null
}

export interface AiSiteImportStepDeps {
  crawl?: typeof crawlSiteForImport
  crawlSeams?: SiteImportCrawlSeams
  runnerFor?: typeof aiJobStepRunnerFor
  ownership?: (orgId: string, domain: string) => Promise<AiSiteImportOwnership | null>
  rateLimit?: (key: string, options: { limit: number; windowMs: number }) => Promise<{ allowed: boolean }>
  releaseFlagOn?: (orgId: string) => Promise<boolean>
  ingest?: () => PluginMediaIngest | null
  fetchImage?: SiteImportPhotosDeps['fetch']
  readRoom?: typeof readAiScreenRoom
  readSiteName?: (firestore: FirebaseFirestore.Firestore, hostId: string) => Promise<string>
  fileReview?: typeof fileSiteImportReview
  pageWritten?: typeof aiSitePageWritten
  mintId?: () => string
  clock?: () => number
}

async function readOwnership(orgId: string, domain: string): Promise<AiSiteImportOwnership | null> {
  const claims = await listDomainOwnershipClaims(orgId)
  const claim = claims.find((entry) => entry.domain === domain)
  if (!claim) return null
  return { current: claim.current, method: claim.provenMethod, provenAt: claim.provenAt, detail: claim.provenDetail }
}

async function readSiteName(firestore: FirebaseFirestore.Firestore, hostId: string): Promise<string> {
  const host = await firestore.collection('hosts').doc(hostId).get()
  const name = host.get('displayName')
  return typeof name === 'string' ? name.trim() : ''
}

/** The proved domain an import job is for, or `null`. */
export function aiSiteImportDomainOf(job: Pick<AiJob, 'inputs'>): string | null {
  return normalizeOwnershipDomain(String(job.inputs?.[AI_SITE_IMPORT_DOMAIN_INPUT] ?? '')).domain
}

/*------------------------------------------
 * The jobs a unit is handed to
 *-----------------------------------------*/

const pathOf = (slug: string) => (slug === '/' ? '/' : `/${slug}`)

/** A plan as a delegated unit reads it: confirmed, with what it builds and nothing else. */
function unitPlan(job: AiJob, input: { create?: AiBuildPlanCreate[]; screens?: AiBuildPlanScreen[] }): AiJobPlan {
  return {
    reuse: [],
    create: input.create ?? [],
    screens: input.screens ?? [],
    labels: {},
    status: 'confirmed',
    proposedAt: job.createdAt,
    confirmedAt: job.createdAt,
    confirmedBy: job.createdBy,
  }
}

const delivered = (items: readonly AiJobItemLedger[], slot: string) =>
  items.some((row) => row.slot === slot && (row.status === 'succeeded' || row.status === 'degraded'))

/**
 * The pages the header and a page may link: the ones of this wave and those
 * before it that are in or still coming, home first, at most the header's
 * seven. A page of a later wave is not linked: it may never be brought in.
 */
export function aiSiteImportLinkedPages(
  state: AiSiteImportState,
  items: readonly AiJobItemLedger[],
  wave: number,
): AiLayoutSitePage[] {
  const rows = new Map(items.map((row) => [row.slot, row]))
  const pages = state.pages
    .filter((page) => page.wave <= wave && !page.refused)
    .filter((page) => {
      const row = rows.get(page.slot)
      return !row || row.status === 'pending' || row.status === 'running' || row.status === 'succeeded' || row.status === 'degraded'
    })
    .map((page) => ({ id: page.draftId, label: page.title, slug: pathOf(page.slug) }))
  return [...pages.filter((page) => page.slug === '/'), ...pages.filter((page) => page.slug !== '/')].slice(0, AI_LAYOUT_SITE_PAGES_MAX)
}

/** The header and footer's job: a layout of the site's name, linking the wave's pages, in the layout language. */
export function aiSiteImportFrameJob(job: AiJob, state: AiSiteImportState, wave: AiSiteImportWave, items: readonly AiJobItemLedger[]): AiJob {
  const draftId = state.frame?.draftId ?? `${job.$id}-${AI_SITE_IMPORT_FRAME_SLOT}`
  const creation: AiBuildPlanCreate = {
    kind: 'layout',
    name: 'Header and footer',
    why: `The header and footer every page brought in from ${state.domain} renders inside.`,
    duplicateOf: null,
    fields: ['header', 'nav', 'main', 'footer'],
    id: draftId,
  }
  return {
    ...job,
    $id: draftId,
    kind: 'layout',
    steps: [],
    outputs: [],
    items: null,
    siteImport: null,
    plan: unitPlan(job, { create: [creation] }),
    inputs: {
      originJobId: job.$id,
      businessName: state.siteName,
      [AI_LAYOUT_LANGUAGE_INPUT]: true,
      [AI_LAYOUT_SITE_PAGES_INPUT]: aiSiteImportLinkedPages(state, items, wave.index),
    },
    brief: `Build the header and footer of “${state.siteName}”, a website brought in from ${state.domain}.`.slice(0, AI_JOB_BRIEF_MAX_CHARS),
  }
}

/** One page's job: a page job's plan of one screen, its sections from the old page's headings, its text fenced. */
export function aiSiteImportPageJob(
  job: AiJob,
  state: AiSiteImportState,
  page: AiSiteImportPage,
  items: readonly AiJobItemLedger[],
): AiJob {
  const sections = (page.read?.sections.length ? page.read.sections : ['Introduction']).map((name) => ({
    name,
    uses: [],
    items: 0,
  }))
  const screen: AiBuildPlanScreen = {
    title: page.title,
    slug: pathOf(page.slug),
    // Inside the header and footer this import built, once it is in.
    layout: state.frame && delivered(items, AI_SITE_IMPORT_FRAME_SLOT) ? state.frame.draftId : null,
    template: null,
    duplicateOf: null,
    nav: false,
    seoTitle: page.title,
    seoDescription: '',
    sections,
    record: null,
    id: page.draftId,
  }
  // The other pages already in, whose stock photos this page does not repeat.
  const others = state.pages.filter((entry) => entry.slot !== page.slot && delivered(items, entry.slot)).map((entry) => entry.draftId)
  return {
    ...job,
    $id: page.draftId,
    kind: 'page',
    steps: [],
    outputs: [],
    items: null,
    siteImport: null,
    plan: unitPlan(job, { screens: [screen] }),
    inputs: {
      originJobId: job.$id,
      businessName: state.siteName,
      [AI_LAYOUT_LANGUAGE_INPUT]: true,
      [AI_LAYOUT_SITE_PAGES_INPUT]: aiSiteImportLinkedPages(state, items, page.wave),
      [AI_LAYOUT_IMPORTED_PAGE_INPUT]: { url: page.url, text: page.read?.text ?? '' },
      [AI_LAYOUT_PAGE_PHOTOS_INPUT]: page.photos?.assets ?? [],
      ...(others.length ? { [AI_STOCK_PHOTO_PAGES_INPUT]: others } : {}),
    },
    brief: `Bring in the page “${page.title}” of ${state.domain} as a page of “${state.siteName}”.`.slice(0, AI_JOB_BRIEF_MAX_CHARS),
  }
}

/** The least time the import's next pass needs: a read's, a photo pass's, or the time of the step its unit is handed to. */
export function aiSiteImportRunMinimumMs(job: AiJob, runnerFor: typeof aiJobStepRunnerFor = aiJobStepRunnerFor): number {
  const state = job.siteImport ?? null
  const items = job.items ?? []
  const work = aiSiteImportNextWork(state, items)
  switch (work.kind) {
    case 'inventory':
      return AI_SITE_IMPORT_PASS_MINIMUM_MS.read
    case 'start-wave':
    case 'read':
      return AI_SITE_IMPORT_PASS_MINIMUM_MS.wave
    case 'images':
      return AI_SITE_IMPORT_PASS_MINIMUM_MS.photos
    case 'frame':
      return runnerFor('layout') && state ? aiJobStepRunMinimumMs(aiSiteImportFrameJob(job, state, work.wave, items)) : 0
    case 'page':
      return runnerFor('page') && state ? aiJobStepRunMinimumMs(aiSiteImportPageJob(job, state, work.page, items)) : 0
    default:
      return 0
  }
}

/*------------------------------------------
 * The step
 *-----------------------------------------*/

const waveReview = (message: string): AiJobReview => ({ reason: 'wave', message, findings: [] })

/** The rows a wave's read left out, settled as not brought in, with the reason. */
function withLeftOutRows(
  items: readonly AiJobItemLedger[],
  reads: ReadonlyMap<string, AiSiteImportPageRead | AiSiteImportLeftOutReason>,
): AiJobItemLedger[] {
  return items.map((row) => {
    const read = reads.get(row.slot)
    return typeof read === 'string' && (row.status === 'pending' || row.status === 'running')
      ? { ...row, status: 'skipped', note: AI_SITE_IMPORT_LEFT_OUT_COPY[read] }
      : row
  })
}

/** Whether every row of the wave is settled, its header and footer included. */
function waveSettled(state: AiSiteImportState, wave: AiSiteImportWave, items: readonly AiJobItemLedger[]): boolean {
  if (wave.frame && state.frame && aiSiteImportItemOpen(items, AI_SITE_IMPORT_FRAME_SLOT)) return false
  return wave.slots.every((slot) => !aiSiteImportItemOpen(items, slot))
}

export function createAiJobImportStep(deps: AiSiteImportStepDeps = {}): AiJobStepRunner {
  const crawl = deps.crawl ?? crawlSiteForImport
  const runnerFor = deps.runnerFor ?? aiJobStepRunnerFor
  const ownershipOf = deps.ownership ?? readOwnership
  const rateLimit = deps.rateLimit ?? consumeRateLimit
  const flagOn = deps.releaseFlagOn ?? ((orgId: string) => isServerReleaseFlagOnForOrg(SITE_IMPORT_RELEASE_FLAG, orgId))
  const ingestOf = deps.ingest ?? pluginMediaIngest
  const readRoom = deps.readRoom ?? readAiScreenRoom
  const siteNameOf = deps.readSiteName ?? readSiteName
  const fileReview = deps.fileReview ?? fileSiteImportReview
  const pageWritten = deps.pageWritten ?? aiSitePageWritten
  const mintId = deps.mintId ?? createResourceUid
  const clock = deps.clock ?? Date.now

  return async (context: AiJobStepContext): Promise<AiJobStepOutcome> => {
    const { job, firestore, now, signal } = context
    const model = aiModelForStep('job.page')
    const unspent = (rest: Partial<AiJobStepOutcome> = {}): AiJobStepOutcome => ({ ...aiUnspentOutcome(model), ...rest })
    const hostId = job.hostId
    if (!hostId) return unspent({ failure: AI_SITE_IMPORT_COPY.noSite })
    const domain = aiSiteImportDomainOf(job)
    if (!domain) return unspent({ failure: AI_SITE_IMPORT_COPY.badDomain })
    const state = job.siteImport ?? null
    const items = job.items ?? []
    const work = aiSiteImportNextWork(state, items)
    const nowIso = now.toISOString()
    const review = (event: 'read' | 'wave-started' | 'wave-finished', next: AiSiteImportState, ledger: readonly AiJobItemLedger[], wave?: number) =>
      fileReview(firestore, { orgId: job.orgId, hostId, jobId: job.$id, state: next, items: ledger, event, nowMs: now.getTime(), ...(wave !== undefined ? { wave } : {}) })

    /** Closes the wave when this pass settled its last row: the review, or the job's end after the last wave. */
    const closing = async (
      next: AiSiteImportState,
      ledger: readonly AiJobItemLedger[],
      wave: AiSiteImportWave,
      outcome: AiJobStepOutcome,
    ): Promise<AiJobStepOutcome> => {
      if (!waveSettled(next, wave, ledger)) return { ...outcome, siteImport: next, continue: true }
      const closed = aiSiteImportWaveClosed(next, wave.index, nowIso)
      await review('wave-finished', closed, ledger, wave.index)
      const waiting = closed.waves.find((entry) => entry.index === wave.index)?.status === 'review'
      return waiting
        ? { ...outcome, siteImport: closed, review: waveReview(aiSiteImportWaveMessage(closed, ledger)) }
        : { ...outcome, siteImport: closed }
    }

    /** The proof, the flag and the day's limit, asked before anything is read. */
    const gate = async (): Promise<{ ownership: AiSiteImportOwnership } | AiJobStepOutcome> => {
      if (!(await flagOn(job.orgId))) return unspent({ review: waveReview(AI_SITE_IMPORT_COPY.unavailable) })
      const ownership = await ownershipOf(job.orgId, domain)
      if (!ownership?.current) {
        return unspent({ review: { reason: 'ownership', message: AI_SITE_IMPORT_COPY.ownership(domain), findings: [] } })
      }
      const window = await rateLimit(siteImportRateKey(job.orgId), { limit: SITE_IMPORT_WAVES_PER_ORG_PER_DAY, windowMs: DAY_MS })
      if (!window.allowed) return unspent({ review: { reason: 'limit', message: AI_SITE_IMPORT_COPY.limit, findings: [] } })
      return { ownership }
    }

    // ── 1. Read the site ──
    if (work.kind === 'inventory') {
      const passed = await gate()
      if (!('ownership' in passed)) return passed
      const room = await readRoom(firestore, { hostId, org: (context.org ?? null) as never })
      const left = room.limit === null ? AI_SITE_IMPORT_MAX_PAGES : Math.max(0, room.limit - room.used)
      const crawled = await crawl(
        {
          domain,
          // A wave's worth past the room, so what the plan leaves out is said.
          maxPages: Math.min(AI_SITE_IMPORT_MAX_PAGES, left + AI_SITE_IMPORT_WAVE_PAGES),
          timeBudgetMs: AI_SITE_IMPORT_READ_MS,
          shallowFirst: true,
          ...(signal ? { signal } : {}),
        },
        deps.crawlSeams,
      )
      if (crawled.refused) return unspent({ failure: AI_SITE_IMPORT_COPY.badDomain })
      if (crawled.stoppedBy === 'robots-unreachable') return unspent({ review: waveReview(AI_SITE_IMPORT_COPY.robots(domain)) })
      const skipped = crawled.skipped.map((entry) => ({ url: entry.url, reason: siteImportLeftOutReason(entry.reason, entry.status) }))
      if (!crawled.pages.length) {
        // A site its bot protection keeps AglynBot off is up: say what lets AglynBot in, not to check that it is.
        const blocked = skipped.some((entry) => entry.reason === 'blocked')
        return unspent({ review: waveReview(AI_SITE_IMPORT_COPY[blocked ? 'blocked' : 'nothing'](domain)) })
      }
      const inventory = aiSiteImportInventory({
        domain,
        siteName: await siteNameOf(firestore, hostId),
        ownership: { method: passed.ownership.method, provenAt: passed.ownership.provenAt, detail: passed.ownership.detail },
        readAt: nowIso,
        pages: crawled.pages.map(siteImportListedPage),
        menu: siteImportMenu(crawled),
        skipped,
        skippedOverflow: crawled.skippedOverflow,
        stoppedBy: crawled.stoppedBy,
        pageLimit: room.limit,
        existingPages: room.used,
        mintId,
      })
      const ledger = aiSiteImportLedger(inventory)
      const reviewId = await review('read', inventory, ledger)
      const next = { ...inventory, reviewId }
      return unspent({ items: ledger, siteImport: next, review: waveReview(aiSiteImportWaveMessage(next, ledger)) })
    }

    if (!state) return unspent({ failure: AI_SITE_IMPORT_COPY.badDomain })
    if (work.kind === 'done') return unspent()

    // ── 2. Start a wave ──
    if (work.kind === 'start-wave') {
      const passed = await gate()
      if (!('ownership' in passed)) return passed
      const wave = work.wave
      const pages = wave.slots
        .map((slot) => state.pages.find((page) => page.slot === slot))
        .filter((page): page is AiSiteImportPage => !!page)
      const reads = new Map<string, AiSiteImportPageRead | AiSiteImportLeftOutReason>()
      // Never past the plan: the room is read again, since pages may have been added since the site was read.
      const room = await readRoom(firestore, { hostId, org: (context.org ?? null) as never })
      let left = room.limit === null ? Number.POSITIVE_INFINITY : Math.max(0, room.limit - room.used)
      const toRead: AiSiteImportPage[] = []
      for (const page of pages) {
        if (left > 0) {
          toRead.push(page)
          left -= 1
        } else {
          reads.set(page.slot, 'plan-limit')
        }
      }
      if (toRead.length) {
        const crawled = await crawl(
          {
            domain,
            maxPages: toRead.length,
            only: toRead.map((page) => page.url),
            timeBudgetMs: AI_SITE_IMPORT_WAVE_READ_MS,
            ...(signal ? { signal } : {}),
          },
          deps.crawlSeams,
        )
        if (crawled.stoppedBy === 'robots-unreachable') return unspent({ review: waveReview(AI_SITE_IMPORT_COPY.robots(domain)) })
        // A read the clock cut short leaves its other pages for the next pass, never "unreadable".
        for (const [slot, read] of siteImportWaveReads(toRead, crawled, nowIso, { cutShort: crawled.stoppedBy === 'time' })) {
          reads.set(slot, read)
        }
      }
      let ledger = withLeftOutRows(items, reads)
      // A wave none of whose pages could be read builds no header for them.
      const anyRead = [...reads.values()].some((read) => typeof read !== 'string')
      if (wave.frame && !anyRead && reads.size === pages.length) {
        ledger = ledger.map((row) =>
          row.slot === AI_SITE_IMPORT_FRAME_SLOT && (row.status === 'pending' || row.status === 'running')
            ? { ...row, status: 'skipped', note: 'Not built: no page of this wave could be read.' }
            : row,
        )
      }
      const started = aiSiteImportWaveStarted(state, wave.index, nowIso, reads)
      await review('wave-started', started, ledger, wave.index)
      const running = started.waves.find((entry) => entry.index === wave.index) as AiSiteImportWave
      return closing(started, ledger, running, unspent({ items: ledger }))
    }

    const wave = work.wave

    // ── 2b. The rest of a wave's read, where the clock cut it short ──
    if (work.kind === 'read') {
      const crawled = await crawl(
        {
          domain,
          maxPages: work.pages.length,
          only: work.pages.map((page) => page.url),
          timeBudgetMs: AI_SITE_IMPORT_WAVE_READ_MS,
          ...(signal ? { signal } : {}),
        },
        deps.crawlSeams,
      )
      if (crawled.stoppedBy === 'robots-unreachable') return unspent({ review: waveReview(AI_SITE_IMPORT_COPY.robots(domain)) })
      const reads = siteImportWaveReads(work.pages, crawled, nowIso, { cutShort: crawled.stoppedBy === 'time' })
      const ledger = withLeftOutRows(items, reads)
      return closing(aiSiteImportPagesRead(state, reads), ledger, wave, unspent({ items: ledger }))
    }

    // ── 3. The header and footer ──
    if (work.kind === 'frame') {
      const runner = runnerFor('layout')
      if (!runner) {
        const item: AiJobItemOutcome = { slot: AI_SITE_IMPORT_FRAME_SLOT, status: 'skipped', note: AI_SITE_IMPORT_COPY.frameUnavailable }
        return closing(state, aiApplyJobItemRecord(items, item, 0, now), wave, unspent({ item }))
      }
      const derived = aiSiteImportFrameJob(job, state, wave, items)
      return runUnit(AI_SITE_IMPORT_FRAME_SLOT, runner, derived, state, null)
    }

    // ── 4a. A page's photos ──
    if (work.kind === 'images') {
      const photos = signal?.aborted
        ? { brought: 0, reused: 0, skipped: work.page.read?.images.length ?? 0, assets: [] }
        : await bringInSiteImportPhotos(
            {
              hostId,
              uid: job.createdBy,
              domain,
              images: work.page.read?.images ?? [],
              deadlineAt: clock() + AI_SITE_IMPORT_PHOTOS_MS,
              ...(signal ? { signal } : {}),
            },
            { ingest: ingestOf(), ...(deps.fetchImage ? { fetch: deps.fetchImage } : {}) },
          )
      return unspent({
        item: { slot: work.page.slot, status: 'running' },
        siteImport: aiSiteImportPhotosIn(state, work.page.slot, photos),
        continue: true,
      })
    }

    // ── 4b. The page ──
    if (work.kind === 'page') {
      const runner = runnerFor('page')
      if (!runner) {
        const item: AiJobItemOutcome = {
          slot: work.page.slot,
          status: 'failed',
          failure: { ours: true, reason: 'unavailable', message: AI_SITE_IMPORT_COPY.pageUnavailable },
        }
        return closing(state, aiApplyJobItemRecord(items, item, 0, now), wave, unspent({ item }))
      }
      return runUnit(work.page.slot, runner, aiSiteImportPageJob(job, state, work.page, items), state, work.page)
    }

    // ── 5. Close the wave ──
    return closing(state, items, wave, unspent())

    /** One delegated pass: the unit's spend is the pass's, what it came to is its row. */
    async function runUnit(
      slot: string,
      runner: AiJobStepRunner,
      derived: AiJob,
      current: AiSiteImportState,
      page: AiSiteImportPage | null,
    ): Promise<AiJobStepOutcome> {
      let outcome: AiJobStepOutcome
      try {
        outcome = await runner({ ...context, job: derived })
      } catch (error) {
        // A provider that will answer later, a budget that ended, a cancel: the machine's.
        if (aiUnitErrorRetryable(error) || (signal?.aborted ?? false)) throw error
        console.error('ai site import unit threw', { orgId: job.orgId, jobId: job.$id, slot, error })
        const item: AiJobItemOutcome = {
          slot,
          status: 'failed',
          failure: { ours: true, reason: 'provider', message: AI_SITE_IMPORT_COPY.pageNotWritten },
        }
        return closing(current, aiApplyJobItemRecord(items, item, 0, now), wave, unspent({ item }))
      }
      const spent = aiUnitSpend(outcome)
      const stopped = aiUnitFailure(slot, outcome)
      if (stopped?.status === 'running') return { ...spent, outputs: [], item: stopped, siteImport: current, continue: true }
      let item: AiJobItemOutcome
      if (stopped) {
        item = stopped
      } else if (page && derived.plan) {
        // A page counts as in only when its sections are in it (AGL-3596).
        const screen = derived.plan.screens[0]
        const written = await pageWritten(firestore, {
          hostId: hostId as string,
          unitJobId: derived.$id,
          screen,
          draftId: page.draftId,
          layoutLanguage: true,
        })
        item = written
          ? { slot, status: 'succeeded', outputs: spent.outputs.map((output) => output.id) }
          : { slot, status: 'failed', failure: { ours: true, reason: 'step-failure', message: AI_SITE_IMPORT_COPY.pageNotWritten } }
      } else {
        item = { slot, status: 'succeeded', outputs: spent.outputs.map((output) => output.id) }
      }
      const settledState = page ? aiSiteImportPageSettled(current, slot) : current
      return closing(
        settledState,
        aiApplyJobItemRecord(items, item, 0, now),
        wave,
        { ...spent, outputs: item.status === 'succeeded' ? spent.outputs : [], item },
      )
    }
  }
}

/** The home page's menu, as same-site paths in its order. */
export function siteImportMenu(crawled: Pick<SiteImportInventory, 'pages' | 'origins'>): string[] {
  const home = crawled.pages.find((page) => page.foundBy === 'home') ?? crawled.pages[0]
  const paths: string[] = []
  for (const link of home?.navLinks ?? []) {
    try {
      const url = new URL(link.url)
      if (!crawled.origins.includes(url.origin)) continue
      const path = url.pathname.replace(/\/+$/, '') || '/'
      if (!paths.includes(path)) paths.push(path)
    } catch {
      // A menu entry that is not an address names no page.
    }
  }
  return paths
}

/**
 * What a wave's read came to for each page: the page read again, or why it
 * is left out now. Matched by address; a page the site sent to another of its
 * own addresses is matched in the order the wave asked for it.
 */
export function siteImportWaveReads(
  asked: readonly AiSiteImportPage[],
  crawled: Pick<SiteImportInventory, 'pages' | 'skipped'>,
  at: string,
  options: {
    /** The read's clock ran out: a page it did not reach is left for the next pass, not left out. */
    cutShort?: boolean
  } = {},
): Map<string, AiSiteImportPageRead | AiSiteImportLeftOutReason> {
  const reads = new Map<string, AiSiteImportPageRead | AiSiteImportLeftOutReason>()
  const pathKey = (url: string) => {
    try {
      const parsed = new URL(url)
      return `${parsed.pathname.replace(/\/+$/, '') || '/'}${parsed.search}`
    } catch {
      return url
    }
  }
  const pages = new Map(crawled.pages.map((page) => [pathKey(page.url), page]))
  const skipped = new Map(crawled.skipped.map((entry) => [pathKey(entry.url), entry]))
  const unmatched = [...crawled.pages]
  const take = (page: (typeof crawled.pages)[number]) => {
    const index = unmatched.indexOf(page)
    if (index !== -1) unmatched.splice(index, 1)
  }
  const pending: AiSiteImportPage[] = []
  for (const page of asked) {
    const found = pages.get(pathKey(page.url))
    if (found) {
      take(found)
      reads.set(page.slot, siteImportReadOrEmpty(found, at))
      continue
    }
    const left = skipped.get(pathKey(page.url))
    if (left) {
      reads.set(page.slot, siteImportLeftOutReason(left.reason, left.status))
      continue
    }
    pending.push(page)
  }
  for (const page of pending) {
    const found = unmatched.shift()
    if (found) reads.set(page.slot, siteImportReadOrEmpty(found, at))
    else if (!options.cutShort) reads.set(page.slot, 'unreadable')
  }
  return reads
}

function siteImportReadOrEmpty(page: SiteImportInventory['pages'][number], at: string): AiSiteImportPageRead | 'empty' {
  if (siteImportPageWords(page) < AI_SITE_IMPORT_MIN_WORDS && !page.images.length) return 'empty'
  return siteImportPageRead(page, at)
}

/*------------------------------------------
 * Admission, and registration
 *-----------------------------------------*/

export interface AiSiteImportAdmissionDeps {
  releaseFlagOn?: (orgId: string) => Promise<boolean>
  ownership?: (orgId: string, domain: string) => Promise<AiSiteImportOwnership | null>
  /** "Bring a site in" (`ai.import`, AGL-4047) for this member; specs hand in a double. */
  holdsSiteImport?: (uid: string, orgId: string) => Promise<boolean>
}

/**
 * What an import asks before it exists and before each wave (AGL-3976): the
 * release flag, a site to bring it into, a paid plan, the owner or an admin,
 * and a CURRENT proof that the workspace owns the domain. Nothing is spent on
 * a refusal, and the day's limit is the step's to count, once a wave runs.
 */
export function createAiSiteImportAdmission(deps: AiSiteImportAdmissionDeps = {}): AiJobAdmission {
  const flagOn = deps.releaseFlagOn ?? ((orgId: string) => isServerReleaseFlagOnForOrg(SITE_IMPORT_RELEASE_FLAG, orgId))
  const ownershipOf = deps.ownership ?? readOwnership
  const holdsSiteImport =
    deps.holdsSiteImport ??
    (async (uid: string, orgId: string) => {
      const member = (await getOrgForUser(uid, orgId))?.member ?? null
      return Boolean(member) && (await memberHasOrgPermission(orgId, member, 'ai.import'))
    })
  return async (context) => {
    if (!(await flagOn(context.orgId))) return { status: 404, error: 'Not found' }
    if (!context.hostId && !context.siteToCome) return { status: 400, error: AI_SITE_IMPORT_COPY.noSite }
    if (resolveEffectivePlan(context.org as never) === 'free') return { status: 403, error: AI_SITE_IMPORT_COPY.plan }
    // "Bring a site in" (`ai.import`, AGL-4047), whose default is the owner
    // and admin this asked for.
    if (!context.uid || !(await holdsSiteImport(context.uid, context.orgId))) {
      return { status: 403, error: AI_SITE_IMPORT_COPY.role }
    }
    const { domain, error } = normalizeOwnershipDomain(String(context.inputs[AI_SITE_IMPORT_DOMAIN_INPUT] ?? ''))
    if (!domain) return { status: 400, error: error ?? AI_SITE_IMPORT_COPY.badDomain }
    const ownership = await ownershipOf(context.orgId, domain)
    if (!ownership?.current) return { status: 403, error: AI_SITE_IMPORT_COPY.ownership(domain) }
    return null
  }
}

/**
 * The import kind's registrations (AGL-3976), by a call from `server.ts`,
 * never by an import: its runner with each pass's least time, its pass bound
 * and its admission.
 */
export function registerAiSiteImportJob(deps: AiSiteImportStepDeps = {}): void {
  const runnerFor = deps.runnerFor ?? aiJobStepRunnerFor
  registerAiJobStep('import', createAiJobImportStep(deps), {
    minimumMs: AI_JOB_PAGE_STEP_MINIMUM_MS,
    minimumMsFor: (job) => aiSiteImportRunMinimumMs(job, runnerFor),
  })
  registerAiJobStepPasses('import', AI_SITE_IMPORT_MAX_PASSES)
  registerAiJobAdmission('import', createAiSiteImportAdmission())
}
