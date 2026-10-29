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
 *   3. THE LOOK, in the first wave (no model, AGL-4084): the theme drawn
 *      from the owner's own home page, its logo into the library, the site's
 *      listing from the home page's own words (`ai-site-import-look.ts`).
 *   4. THE HEADER AND FOOTER, in the first wave: the source's own menu, its
 *      menus, its buttons and its footer as its home page builds them
 *      (AGL-4108, `aiSiteImportFrameSource`), drawn by the layout step with
 *      no model; for a source whose menu could not be read, the layout
 *      step's own pass, with the source's brand as its header draws it, its
 *      own header and footer words as the footer's facts, and the site's
 *      menu order.
 *   5. EACH PAGE: its photos into the media library (no model, deduped by
 *      source key), then the page step's own passes, NEVER REWRITTEN
 *      (AGL-4084, `ai-site-import-document.ts`): a collection's page or a
 *      long page is copied as it is, every word in order, with no model; a
 *      main page is arranged, the model placing the source's numbered lines
 *      and code writing every word as the source has it.
 *   6. CLOSE THE WAVE: its pages go live in the site's preview (AGL-4084,
 *      `ai-site-import-publish.ts`), where only its team sees them, and the
 *      job waits again until the person starts the next wave, or, where the
 *      person chose "Start every remaining wave", starts it. The last wave
 *      ends the job.
 *
 * Every page is an item of the job's ledger, so a page that fails on our
 * side gives back its own spend (the machine's `refundBuildCredits`) and the
 * wave goes on. Nothing is ever public by this job: a wave lands only in a
 * site that is in preview, and a site that is not keeps its pages as drafts.
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
  AI_SITE_IMPORT_LABEL_MAX_CHARS,
  AI_SITE_IMPORT_LEFT_OUT_COPY,
  AI_SITE_IMPORT_MAX_PAGES,
  AI_SITE_IMPORT_MIN_WORDS,
  AI_SITE_IMPORT_WAVE_PAGES,
  aiSiteImportFrameIsRead,
  aiSiteImportInventory,
  aiSiteImportItemOpen,
  aiSiteImportLedger,
  aiSiteImportNextWork,
  aiSiteImportPageBuild,
  aiSiteImportPageSettled,
  aiSiteImportPagesRead,
  aiSiteImportPhotosIn,
  aiSiteImportReadStops,
  aiSiteImportReadVerdict,
  aiSiteImportReadVerdictMessage,
  aiSiteImportReadVerdictReason,
  aiSiteImportWaveClosed,
  aiSiteImportWaveMessage,
  aiSiteImportWaveStarted,
  type AiSiteImportBuild,
  type AiSiteImportHome,
  type AiSiteImportLeftOutReason,
  type AiSiteImportPage,
  type AiSiteImportPageRead,
  type AiSiteImportState,
  type AiSiteImportWave,
} from '../model/ai-site-import'
import { aiModelForStep } from '../providers/routing'
import { SITE_IMPORT_RELEASE_FLAG } from '../site-import/site-import-flag'
import { crawlSiteForImport, siteImportOrigins, type SiteImportCrawlSeams, type SiteImportInventory } from '../site-import/site-import-crawl'
import { bringInSiteImportPhotos, type SiteImportPhotosDeps } from '../site-import/site-import-images'
import {
  siteImportHeaderBrand,
  siteImportLabel,
  siteImportLeftOutReason,
  siteImportListedPage,
  siteImportPageRead,
  siteImportPageWords,
  siteImportSiteFacts,
  siteImportSiteName,
} from '../site-import/site-import-page'
import { aiSiteKindFor } from '../model/ai-site-kinds'
import { AI_LAYOUT_SITE_BRAND_INPUT, AI_LAYOUT_SITE_FACTS_INPUT, AI_LAYOUT_SITE_FRAME_INPUT } from './ai-job-layout-language'
import { aiLayoutTelHref, type AiLayoutFrameSource, type AiLayoutFrameSourceGround, type AiLayoutFrameSourceTo } from '../layout-language/ai-layout-frame-source'
import { aiHexOklch } from '../model/ai-site-look'
import { AI_LAYOUT_IMPORTED_SECTIONS_INPUT, type AiSiteImportDocument } from './ai-site-import-document'
import { aiSiteImportSectionNames } from './ai-site-import-compile'
import { aiRunSiteImportLook, type AiSiteImportLookDeps } from './ai-site-import-look'
import { aiPublishImportedWave } from './ai-site-import-publish'
import { fileSiteImportReview } from '../site-import/site-import-review'
import { aiUnitErrorRetryable, aiUnitFailure, aiUnitSpend } from './ai-build-unit-outcome'
import { registerAiJobAdmission, type AiJobAdmission } from './ai-job-admission'
import { AI_JOB_STEP_OVERHEAD_MS } from './ai-job-budget'
import { readAiDraftNodes, readAiScreenRoom } from './ai-job-drafts'
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
  /** The first wave's look pass (AGL-4084), and what it reads and writes through. */
  look?: typeof aiRunSiteImportLook
  lookDeps?: AiSiteImportLookDeps
  /** A closed wave's pages into the site's preview (AGL-4084). */
  publishWave?: typeof aiPublishImportedWave
  /** The words a page that came in shows, read off its draft (AGL-4084). */
  draftWords?: (firestore: FirebaseFirestore.Firestore, hostId: string, draftId: string) => Promise<number | null>
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

/**
 * How a page is built (AGL-4084): a collection's page, or a long page, is
 * copied as it is; a main page is arranged. The home page is always
 * arranged, however long: it is the site's front door, never a document.
 */
export function aiSiteImportBuildOf(page: Pick<AiSiteImportPage, 'group' | 'words' | 'slug'>): AiSiteImportBuild {
  return page.group === 'main' && page.slug === '/' ? 'arranged' : aiSiteImportPageBuild(page)
}

/**
 * The name the header and footer carry (AGL-4084): the site's own name where
 * it is the name the person gave Create site but for its case or its
 * punctuation, else the person's.
 */
export function aiSiteImportBrandName(given: string, own: string): string {
  const key = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  return own && key(own) && key(own) === key(given) ? own : given
}

/** The design inputs every unit of an import is drawn with: the kind of site its own words say, and its look (AGL-4084). */
function aiSiteImportDesignInputs(state: AiSiteImportState): Record<string, unknown> {
  const home = state.home
  const kind = home ? aiSiteKindFor(`${home.siteName} ${home.description}`) : null
  const look = state.look
  return {
    ...(kind ? { siteKind: kind.id } : {}),
    ...(look && look.seed !== null
      ? {
          siteStyle: {
            seed: look.seed,
            ...(look.style?.headerAlign ? { headerAlign: look.style.headerAlign } : {}),
            ...(look.style?.rhythm ? { rhythm: look.style.rhythm } : {}),
            ...(look.style?.motion ? { motion: look.style.motion } : {}),
          },
        }
      : {}),
  }
}

/**
 * Where a link of the source's header or footer goes on the new site
 * (AGL-4108): a page the import brings in by its id, once its wave is the
 * header's or before it; a page of a later wave by its address on the new
 * site, which the page takes when its wave lands, since a link by id to a
 * page not yet live is taken out when a wave goes live; and anywhere else by
 * the source's own address, so a button that leaves the source leaves the
 * new site too. `null` for an address no link may carry.
 */
export function aiSiteImportFrameLinkTo(state: Pick<AiSiteImportState, 'domain' | 'pages'>, wave: number): (href: string | null | undefined) => AiLayoutFrameSourceTo | null {
  const origins = new Set(siteImportOrigins(state.domain))
  const key = (path: string) => path.replace(/\/+$/, '') || '/'
  const pages = new Map(state.pages.filter((page) => !page.refused).map((page) => [key(page.path), page]))
  return (href) => {
    const raw = String(href ?? '').trim()
    if (!raw) return null
    if (/^tel:/i.test(raw)) return aiLayoutTelHref(raw.slice(4))
    if (/^mailto:/i.test(raw)) return /^mailto:[^\s@<>?#"]+@[^\s@<>?#"]+\.[^\s@<>?#".]{2,}$/i.test(raw) ? raw : null
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return null
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (origins.has(`https://${url.host}`)) {
      const page = pages.get(key(decodeURIComponent(url.pathname)))
      if (page) return page.slug === '/' || page.wave <= wave ? `page:${page.draftId}` : `/${page.slug}`
    }
    // Anywhere else stays where the source sends it, over https.
    url.protocol = 'https:'
    return url.toString()
  }
}

/** The ground a source's header bar sits on (AGL-4108): dark, the brand's color, the page's own, or paper. */
export function aiSiteImportHeaderGround(background: string | null, look: AiSiteImportHome['look']): AiLayoutFrameSourceGround {
  const hex = /^#[0-9a-f]{6}$/i.test(background ?? '') ? (background as string) : null
  if (!hex) return 'paper'
  const own = aiHexOklch(hex)
  if (own.L < 0.4) return 'dark'
  const near = (other: string | null | undefined, within: number) => {
    if (!other || !/^#[0-9a-f]{6}$/i.test(other)) return false
    const them = aiHexOklch(other)
    const a = own.C * Math.cos((own.h * Math.PI) / 180) - them.C * Math.cos((them.h * Math.PI) / 180)
    const b = own.C * Math.sin((own.h * Math.PI) / 180) - them.C * Math.sin((them.h * Math.PI) / 180)
    return Math.hypot(own.L - them.L, a, b) <= within
  }
  if (near(look?.buttonFill, 0.05)) return 'brand'
  // The page's own ground, unless that ground is white, which paper is.
  if (near(look?.background, 0.02) && own.L < 0.99) return 'page'
  return 'paper'
}

/**
 * The site's header and footer as the source builds them (AGL-4108): its
 * menu with its menus and their entries, its buttons with their own
 * addresses and how they are drawn, and its footer, every link resolved
 * (`aiSiteImportFrameLinkTo`). Every label is the source's, as written.
 * `null` where the reader found no menu on the home page.
 */
export function aiSiteImportFrameSource(state: AiSiteImportState, wave: Pick<AiSiteImportWave, 'index'>): AiLayoutFrameSource | null {
  const home = state.home
  const nav = home?.nav
  if (!home || !nav || !aiSiteImportFrameIsRead(state)) return null
  const to = aiSiteImportFrameLinkTo(state, wave.index)
  const link = (label: string, href: string | null | undefined) => {
    const target = to(href)
    return label && target ? { label, to: target } : null
  }
  const present = <T,>(value: T | null): value is T => value !== null
  const footer = home.footer ?? null
  return {
    nav: nav.items
      .map((group) => ({
        label: group.label,
        to: to(group.href),
        items: group.items
          .map((entry) => {
            const target = link(entry.label, entry.href)
            if (!target) return null
            return {
              ...target,
              ...(entry.text ? { text: entry.text } : {}),
              // The icon element draws on a 24-unit square: an icon drawn on another is left out.
              ...(entry.iconPath && (entry.viewBox ?? '0 0 24 24') === '0 0 24 24' ? { iconPath: entry.iconPath } : {}),
              ...(entry.column ? { column: entry.column } : {}),
            }
          })
          .filter(present),
      }))
      .filter((group) => group.items.length || group.to),
    ctas: nav.ctas.map((cta) => {
      const target = link(cta.label, cta.href)
      return target ? { ...target, style: cta.style } : null
    }).filter(present),
    header: aiSiteImportHeaderGround(nav.background, home.look ?? null),
    footer: footer
      ? {
          columns: footer.columns
            .map((column) => ({ heading: column.heading, links: column.links.map((entry) => link(entry.label, entry.href)).filter(present) }))
            .filter((column) => column.links.length),
          links: footer.links.map((entry) => link(entry.label, entry.href)).filter(present),
          text: footer.text,
          social: footer.social.map((entry) => (/^https:\/\//i.test(entry.href) ? { label: entry.label, to: entry.href, network: entry.network } : null)).filter(present),
          address: footer.address,
          phone: footer.phone,
          email: footer.email,
          // The © line as the source writes it; where it writes none, the source's own name.
          copyright: footer.copyright ?? (home.siteName ? `© ${home.siteName}` : null),
        }
      : null,
  }
}

/** The header and footer's job: a layout of the site's brand, linking the wave's pages, in the layout language. */
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
  const home = state.home ?? null
  const logo = state.look?.logo ?? null
  // The brand as the source's header draws it; with no logo in the library, its name.
  // The logo is named as the source names it, never by the host's name (AGL-4108).
  const withLogo = !!logo && !!home && home.brand.kind !== 'name-only'
  const alt = home ? (home.brand.logo?.alt || home.siteName || home.brand.text).replace(/\s+/g, ' ').trim().slice(0, 120) : ''
  const aspect = logo?.width && logo.height ? Math.round((logo.width / logo.height) * 1000) / 1000 : null
  const brand = home
    ? {
        ...(withLogo ? { logo: { src: (logo as NonNullable<typeof logo>).src }, ...(alt ? { alt } : {}), ...(aspect ? { aspect } : {}) } : {}),
        name: !logo || home.brand.kind !== 'logo-only',
      }
    : null
  // The source's own menu, buttons and footer, drawn with no model (AGL-4108).
  const source = aiSiteImportFrameSource(state, wave)
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
      businessName: aiSiteImportBrandName(state.siteName, home?.siteName ?? ''),
      [AI_LAYOUT_LANGUAGE_INPUT]: true,
      [AI_LAYOUT_SITE_PAGES_INPUT]: aiSiteImportLinkedPages(state, items, wave.index),
      ...aiSiteImportDesignInputs(state),
      ...(brand ? { [AI_LAYOUT_SITE_BRAND_INPUT]: brand } : {}),
      ...(source ? { [AI_LAYOUT_SITE_FRAME_INPUT]: source } : {}),
      // The source's own header and footer words, fenced where the prompt shows them (AGL-4084).
      ...(home ? { [AI_LAYOUT_SITE_FACTS_INPUT]: { url: home.url, description: home.description, lines: home.facts.lines } } : {}),
    },
    // Never words a footer could print as the site's own (AGL-4084): the prompt shows the source's.
    brief: `The header and footer of the site “${state.siteName}”.`.slice(0, AI_JOB_BRIEF_MAX_CHARS),
  }
}

/** The page brought in, as its page job carries it: its lines, its photos, and the pages its links may go to (AGL-4084). */
export function aiSiteImportDocumentFor(state: AiSiteImportState, page: AiSiteImportPage): AiSiteImportDocument | null {
  const blocks = page.read?.blocks
  if (!blocks?.length) return null
  return {
    build: page.build ?? aiSiteImportBuildOf(page),
    title: page.title,
    url: page.url,
    blocks,
    photos: page.photos?.assets ?? [],
    // Every page the import plans, in any wave (AGL-4107): a link to one still
    // to come shows its words until it is live. Home's own links are words: a
    // link home says home, which the source's words may not.
    links: state.pages.filter((entry) => entry.slug !== '/' && !entry.refused).map((entry) => ({ path: entry.path.replace(/\/+$/, '') || '/', id: entry.draftId })),
    origins: [`https://${state.domain}`, `https://www.${state.domain.replace(/^www\./, '')}`],
    // How the source lays it out (AGL-4106), which the site compiler builds it from (AGL-4107).
    ...(page.read?.layout ? { layout: page.read.layout } : {}),
  }
}

/** One page's job: a page job's plan of one screen, its sections the old page's own, its words carried as they are. */
export function aiSiteImportPageJob(
  job: AiJob,
  state: AiSiteImportState,
  page: AiSiteImportPage,
  items: readonly AiJobItemLedger[],
): AiJob {
  const doc = aiSiteImportDocumentFor(state, page)
  // The page's sections are the source's own (AGL-4107): as its layout names
  // them, else its opening and one at each second-level heading.
  const names = doc ? aiSiteImportSectionNames(doc) : page.read?.sections ?? []
  const sections = (names.length ? names : ['Introduction']).map((name) => ({
    name: name.slice(0, AI_SITE_IMPORT_LABEL_MAX_CHARS),
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
    // The source's own title and description, word for word (AGL-4107).
    seoTitle: page.read?.meta?.title || page.title,
    seoDescription: page.read?.meta?.description ?? '',
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
      businessName: aiSiteImportBrandName(state.siteName, state.home?.siteName ?? ''),
      [AI_LAYOUT_LANGUAGE_INPUT]: true,
      [AI_LAYOUT_SITE_PAGES_INPUT]: aiSiteImportLinkedPages(state, items, page.wave),
      ...aiSiteImportDesignInputs(state),
      // Every word as the source has it (AGL-4084); a read from before it was kept is the text the old page step had.
      ...(doc
        ? { [AI_LAYOUT_IMPORTED_SECTIONS_INPUT]: doc }
        : { [AI_LAYOUT_IMPORTED_PAGE_INPUT]: { url: page.url, text: page.read?.text ?? '' } }),
      [AI_LAYOUT_PAGE_PHOTOS_INPUT]: page.photos?.assets ?? [],
      ...(others.length ? { [AI_STOCK_PHOTO_PAGES_INPUT]: others } : {}),
    },
    brief: `Bring in the page “${page.title}” of ${state.domain} as a page of “${state.siteName}”.`.slice(0, AI_JOB_BRIEF_MAX_CHARS),
  }
}

/** What the home page says of the site as a whole (AGL-4084), kept for the look, the header and footer and the listing. */
export function aiSiteImportHomeOf(crawled: Pick<SiteImportInventory, 'pages'>): AiSiteImportHome | null {
  const page = crawled.pages.find((entry) => entry.foundBy === 'home') ?? crawled.pages.find((entry) => (entry.path.replace(/\/+$/, '') || '/') === '/')
  if (!page) return null
  const brand = siteImportHeaderBrand(page)
  const facts = siteImportSiteFacts(page)
  const lines: string[] = []
  let chars = 0
  for (const block of [...facts.header, ...facts.footer]) {
    if (block.kind === 'image' || (block.kind === 'link' && block.inline)) continue
    const text = block.text.replace(/\s+/g, ' ').trim()
    const line = block.kind === 'link' && /^(?:mailto|tel):/i.test(block.href) ? text : block.kind === 'link' && facts.social.includes(block.href) ? `${text}: ${block.href}` : text
    if (!line || lines.includes(line) || chars + line.length > 3_000 || lines.length >= 60) continue
    lines.push(line)
    chars += line.length
  }
  // And what the site states of itself in its structured data, as written: its address, phone and email.
  const organization = facts.organization
  for (const line of [organization?.address, organization?.telephone, organization?.email]) {
    const text = (line ?? '').replace(/\s+/g, ' ').trim()
    if (text && !lines.some((entry) => entry.includes(text))) lines.push(text)
  }
  return {
    url: page.url,
    title: siteImportLabel(page.title ?? '', 160),
    description: siteImportLabel(page.description ?? '', 320),
    ogImage: page.ogImage ?? null,
    siteName: siteImportSiteName(page),
    brand: {
      kind: brand.kind,
      text: brand.text,
      logo: brand.logo ? { url: brand.logo.url, alt: brand.logo.alt, type: brand.logo.type } : null,
    },
    facts: {
      lines,
      emails: facts.emails,
      phones: facts.phones,
      social: facts.social,
      address: facts.organization?.address ?? '',
    },
    // The source's menu, footer and look as its home page builds them (AGL-4108).
    ...(page.nav ? { nav: page.nav } : {}),
    ...(page.footer ? { footer: page.footer } : {}),
    ...(page.look ? { look: page.look } : {}),
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

/**
 * The state with how each page is built (AGL-4084): from its main region's
 * words as the inventory listed them, and again from a wave's fresh read,
 * which is what the page is built from.
 */
export function aiSiteImportWithBuilds(state: AiSiteImportState, mainWords?: ReadonlyMap<string, number>): AiSiteImportState {
  return {
    ...state,
    pages: state.pages.map((page) => {
      const words = page.read?.words ?? mainWords?.get(page.url) ?? page.words
      const build = aiSiteImportBuildOf({ ...page, words })
      return page.build === build ? page : { ...page, build }
    }),
  }
}

/** The words a stored page shows (AGL-4084): its text, its list lines and its buttons. */
export function aiSiteImportShownWords(nodes: Readonly<Record<string, unknown>>): number {
  let words = 0
  for (const node of Object.values(nodes)) {
    const props = (node as { props?: Record<string, unknown> } | null)?.props ?? {}
    for (const key of ['children', 'primary', 'secondary']) {
      const value = props[key]
      if (typeof value === 'string') words += (value.match(/[\p{L}\p{N}]+/gu) ?? []).length
    }
  }
  return words
}

async function readDraftWords(firestore: FirebaseFirestore.Firestore, hostId: string, draftId: string): Promise<number | null> {
  const stored = await readAiDraftNodes(firestore, { kind: 'screen', hostId, id: draftId })
  return stored ? aiSiteImportShownWords(stored.nodes as unknown as Record<string, unknown>) : null
}

/**
 * The review a wave that went live in the site's preview parks on (AGL-4084):
 * where its pages are now, who sees them, and the next wave's start.
 */
export function aiSiteImportPreviewMessage(state: AiSiteImportState, wave: Pick<AiSiteImportWave, 'label'>, published: number): string {
  const pages = `${published.toLocaleString('en-US')} ${published === 1 ? 'page is' : 'pages are'}`
  const lead = `${wave.label} is in your site’s preview: ${pages} on your site, where only you and your team can see ${published === 1 ? 'it' : 'them'}.`
  const next = state.waves.find((entry) => entry.status === 'waiting')
  return next ? `${lead} Start ${next.label} when you are ready.` : lead
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
  const runLook = deps.look ?? aiRunSiteImportLook
  const publishWave = deps.publishWave ?? aiPublishImportedWave
  const draftWordsOf = deps.draftWords ?? readDraftWords

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
      // The wave's pages go live in the site's preview, where only its team sees them (AGL-4084).
      let sitePublish = null as Awaited<ReturnType<typeof publishWave>>
      try {
        sitePublish = await publishWave(firestore, {
          job,
          state: closed,
          wave,
          items: ledger,
          outputs: [...(job.outputs ?? []), ...(outcome.outputs ?? [])],
          now,
        })
      } catch (error) {
        // A publish that failed leaves the pages drafts; the wave is still in.
        console.error('ai site import: a wave could not be published into the preview', { orgId: job.orgId, jobId: job.$id, wave: wave.index, error })
      }
      const published = sitePublish ? { sitePublish } : {}
      await review('wave-finished', closed, ledger, wave.index)
      const waiting = closed.waves.find((entry) => entry.index === wave.index)?.status === 'review'
      if (waiting) {
        const message = sitePublish?.published.length ? aiSiteImportPreviewMessage(closed, wave, sitePublish.published.length) : aiSiteImportWaveMessage(closed, ledger)
        return { ...outcome, ...published, siteImport: closed, review: waveReview(message) }
      }
      // "Start every remaining wave" (AGL-4083): the next wave starts with no review between them.
      const more = closed.autoContinue === true && closed.waves.some((entry) => entry.status === 'waiting')
      return { ...outcome, ...published, siteImport: closed, ...(more ? { continue: true } : {}) }
    }

    /** The proof, the flag and the day's limit, asked before anything is read. */
    const gate = async (counted = true): Promise<{ ownership: AiSiteImportOwnership } | AiJobStepOutcome> => {
      if (!(await flagOn(job.orgId))) return unspent({ review: waveReview(AI_SITE_IMPORT_COPY.unavailable) })
      const ownership = await ownershipOf(job.orgId, domain)
      if (!ownership?.current) {
        return unspent({ review: { reason: 'ownership', message: AI_SITE_IMPORT_COPY.ownership(domain), findings: [] } })
      }
      if (counted) {
        const window = await rateLimit(siteImportRateKey(job.orgId), { limit: SITE_IMPORT_WAVES_PER_ORG_PER_DAY, windowMs: DAY_MS })
        if (!window.allowed) return unspent({ review: { reason: 'limit', message: AI_SITE_IMPORT_COPY.limit, findings: [] } })
      }
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
      // Home first (AGL-4083): a site read without its home page plans nothing, quotes nothing and spends nothing.
      const verdict = aiSiteImportReadVerdict(crawled)
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
        verdict,
        mintId,
      })
      if (aiSiteImportReadStops(inventory.verdict)) {
        // Check again is the read again: the job waits, with why and what to do, and no ledger.
        return unspent({
          items: [],
          siteImport: inventory,
          review: {
            reason: aiSiteImportReadVerdictReason(inventory.verdict) ?? 'unreadable',
            message: aiSiteImportReadVerdictMessage(inventory.verdict, domain) ?? AI_SITE_IMPORT_COPY.nothing(domain),
            findings: [],
          },
        })
      }
      // How each page is built, from its main region's own words (AGL-4084), and what the home page says of the site.
      const mainWords = new Map(
        crawled.pages.map((page) => [page.url, siteImportPageWords({ title: '', blocks: page.blocks.filter((block) => block.region === 'main') })]),
      )
      const planned = { ...aiSiteImportWithBuilds(inventory, mainWords), home: aiSiteImportHomeOf(crawled) }
      const ledger = aiSiteImportLedger(planned)
      const reviewId = await review('read', planned, ledger)
      const next = { ...planned, reviewId }
      return unspent({ items: ledger, siteImport: next, review: waveReview(aiSiteImportWaveMessage(next, ledger)) })
    }

    if (!state) return unspent({ failure: AI_SITE_IMPORT_COPY.badDomain })
    if (work.kind === 'done') return unspent()

    // ── 2. Start a wave ──
    if (work.kind === 'start-wave') {
      // A wave "Start every remaining wave" started after the one the person did is that same start.
      const counted = !(state.autoContinue && typeof state.autoContinueFrom === 'number' && work.wave.index > state.autoContinueFrom)
      const passed = await gate(counted)
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
      const started = aiSiteImportWithBuilds(aiSiteImportWaveStarted(state, wave.index, nowIso, reads))
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
      return closing(aiSiteImportWithBuilds(aiSiteImportPagesRead(state, reads)), ledger, wave, unspent({ items: ledger }))
    }

    // ── 3. The look, before anything of the first wave is built (AGL-4084): no model ──
    const firstWave = state.waves[0]?.index === wave.index
    if (firstWave && !state.look && state.home && (work.kind === 'frame' || work.kind === 'images' || work.kind === 'page')) {
      const look = await runLook(
        {
          firestore,
          hostId,
          orgId: job.orgId,
          uid: job.createdBy,
          jobId: job.$id,
          domain,
          home: state.home,
          at: nowIso,
          ...(signal ? { signal } : {}),
        },
        {
          ingest: ingestOf(),
          ...(deps.crawlSeams?.fetch ? { fetch: deps.crawlSeams.fetch } : {}),
          ...(deps.crawlSeams?.headersFor ? { headersFor: deps.crawlSeams.headersFor } : {}),
          ...deps.lookDeps,
        },
      )
      return unspent({ siteImport: { ...state, look }, continue: true })
    }

    // ── 4. The header and footer ──
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
      // What came through, for the row that says it beside what the old page had (AGL-4084).
      let withBrought = current
      if (page && item.status === 'succeeded') {
        const words = await draftWordsOf(firestore, hostId as string, page.draftId).catch(() => null)
        if (words !== null) withBrought = { ...current, pages: current.pages.map((entry) => (entry.slot === slot ? { ...entry, brought: { words } } : entry)) }
      }
      const settledState = page ? aiSiteImportPageSettled(withBrought, slot) : withBrought
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

/**
 * "Start every remaining wave" (AGL-4083, wired by AGL-4084), as the resume
 * door writes it onto an import waiting to start its next wave: every
 * remaining wave starts after the one before it closes, with no review
 * between them, and the person's one start is the one the day's limit
 * counts. `null` when the job is not an import waiting for a wave.
 */
export function aiSiteImportStartAllUpdate(
  job: Pick<AiJob, 'kind' | 'status' | 'review' | 'siteImport'>,
): { 'siteImport.autoContinue': true; 'siteImport.autoContinueFrom': number } | null {
  if (job.kind !== 'import' || job.status !== 'needs_review' || job.review?.reason !== 'wave') return null
  const next = job.siteImport?.waves.find((wave) => wave.status === 'waiting')
  if (!next) return null
  return { 'siteImport.autoContinue': true, 'siteImport.autoContinueFrom': next.index }
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
