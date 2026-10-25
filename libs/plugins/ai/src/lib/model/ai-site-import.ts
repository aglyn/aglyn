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
 * BRING MY SITE: THE WHOLE SITE, IN REVIEWED WAVES (AGL-3976, parent AGL-3973).
 *
 * The `import` job reads a website the workspace has PROVED it owns
 * (AGL-3974's claims) and brings it in as draft pages of a new site. This
 * module is the job's plan of record, pure, so the step, the doors, the
 * console and the specs read one set of rules:
 *
 * - **The inventory.** The crawl's pages, grouped: the MAIN pages (home, the
 *   pages its menu links, every top-level page, and any page that belongs to
 *   no collection), then each COLLECTION (an address prefix holding at least
 *   `AI_SITE_IMPORT_COLLECTION_MIN` pages: `/blog/…`, `/news/…`, a dated
 *   `/2024/05/…` archive).
 * - **Never past the plan.** Pages are kept in that order until the site's
 *   room under its plan's page count is used; the rest are LEFT OUT, said so
 *   with the reason, never dropped silently. So a plan's limit always leaves
 *   out a collection's tail before it leaves out a main page.
 * - **Waves.** The kept pages are cut into waves of at most
 *   `AI_SITE_IMPORT_WAVE_PAGES`. The first wave is the main pages, with the
 *   site's header and footer built first; each later wave is one
 *   collection's next slice, so a review is about one kind of page at a
 *   time ("Blog, 1 of 3"). A wave runs, then waits for the person: nothing
 *   starts the next one but them.
 * - **The price.** An imported page is an AI page (`AI_MEASURED_IMPORT_CREDITS`,
 *   about 27 credits); a wave is quoted before it starts as its pages and,
 *   for the first, its header and footer.
 *=========================================*/

import { aiCreditRangeOrdered, AI_MEASURED_IMPORT_CREDITS, type AiCreditRange } from './ai-credit-estimate'
import type { AiJobItemLedger } from './ai-jobs.types'

/** The job kind. */
export const AI_SITE_IMPORT_KIND = 'import' as const

/** The input naming the proved domain the job brings in. */
export const AI_SITE_IMPORT_DOMAIN_INPUT = 'domain'

/** The most pages one wave brings in. */
export const AI_SITE_IMPORT_WAVE_PAGES = 10

/**
 * The most pages one import reads, whatever the plan allows: an unlimited
 * plan is still one crawl's worth, and the crawl's own time budget may stop
 * sooner (the inventory then says so).
 */
export const AI_SITE_IMPORT_MAX_PAGES = 200

/** The fewest pages under one address prefix that make it a collection. */
export const AI_SITE_IMPORT_COLLECTION_MIN = 3

/** The most photos brought in from one page. */
export const AI_SITE_IMPORT_IMAGES_PER_PAGE = 8

/** The most characters of one page's text a wave keeps for its model answer. */
export const AI_SITE_IMPORT_PAGE_TEXT_MAX_CHARS = 6_000

/** The most sections one imported page is planned with. */
export const AI_SITE_IMPORT_MAX_SECTIONS = 6

/** The most characters a section's name, a page's title or a label keeps. */
export const AI_SITE_IMPORT_LABEL_MAX_CHARS = 60

/** A page with fewer words than this and no photo has nothing to bring in. */
export const AI_SITE_IMPORT_MIN_WORDS = 5

/** The item ledger slot of the site's header and footer. */
export const AI_SITE_IMPORT_FRAME_SLOT = 'frame'

/** The ceiling one imported page reserves: its answer pass and its listing pass, at 50 each. */
export const AI_SITE_IMPORT_PAGE_CEILING_CREDITS = 100

/** The ceiling the header and footer reserve: one answer at 50. */
export const AI_SITE_IMPORT_FRAME_CEILING_CREDITS = 50

/** The most left-out pages listed by address; the rest are counted. */
export const AI_SITE_IMPORT_LEFT_OUT_LISTED = 60

/** A page the crawl read, as the inventory keeps it: no text, only what plans it. */
export interface AiSiteImportListedPage {
  url: string
  path: string
  title: string
  foundBy: 'home' | 'sitemap' | 'link'
  words: number
  images: number
}

export type AiSiteImportGroupKind = 'main' | 'collection'

export interface AiSiteImportGroup {
  /** `main`, or `c:<prefix>` for a collection. */
  id: string
  label: string
  kind: AiSiteImportGroupKind
  /** Pages of the group the crawl read, kept or not. */
  pages: number
}

/** Why a page the site has is not brought in. */
export type AiSiteImportLeftOutReason =
  /** Past the site's room under its plan's page count. */
  | 'plan-limit'
  /** robots.txt keeps AglynBot off it. */
  | 'robots'
  /** A sign-in page: refused outright. */
  | 'login-form'
  /** No text and no photo: nothing to bring in. */
  | 'empty'
  /** It could not be read: an error, no answer, or not a web page. */
  | 'unreadable'
  /** The site's bot protection or firewall turned AglynBot away (401, 403 or 429). */
  | 'blocked'
  /** Over the size one page may be. */
  | 'too-large'
  /** It sends visitors to another website. */
  | 'off-site'

export const AI_SITE_IMPORT_LEFT_OUT_REASONS: readonly AiSiteImportLeftOutReason[] = [
  'plan-limit',
  'robots',
  'login-form',
  'empty',
  'unreadable',
  'blocked',
  'too-large',
  'off-site',
]

export interface AiSiteImportLeftOut {
  url: string
  path: string
  title: string
  reason: AiSiteImportLeftOutReason
}

/** A photo brought into the site's media library, as a page places it. */
export interface AiSiteImportPhoto {
  mediaId: string
  src: string
  width?: number
  height?: number
  alt?: string
}

/** What a wave's read found on one page, for its model answer. Never on the wire. */
export interface AiSiteImportPageRead {
  at: string
  title: string
  /** The page's text in order, cut to `AI_SITE_IMPORT_PAGE_TEXT_MAX_CHARS`; fenced only when a prompt reads it. */
  text: string
  /** The page's sections, from its headings. */
  sections: string[]
  /** Its photos' addresses, at most `AI_SITE_IMPORT_IMAGES_PER_PAGE`. */
  images: Array<{ url: string; alt: string }>
}

export interface AiSiteImportPage {
  /** The item ledger slot: `p0`, `p1`, … */
  slot: string
  url: string
  path: string
  title: string
  group: string
  wave: number
  /** The id the page's draft is written under, minted with the inventory. */
  draftId: string
  /** The page's address on the new site. */
  slug: string
  words: number
  images: number
  /** Filled by the wave's read; the text is cleared once the page is in. */
  read?: AiSiteImportPageRead | null
  /** Set when the wave's read found the page cannot be brought in after all. */
  refused?: AiSiteImportLeftOutReason | null
  /** Filled once the page's photos are in the library. */
  photos?: {
    brought: number
    /** Already in the library from an earlier page or import: the same file, never a second copy. */
    reused: number
    skipped: number
    assets: AiSiteImportPhoto[]
  } | null
}

export type AiSiteImportWaveStatus = 'waiting' | 'running' | 'review' | 'done'

export interface AiSiteImportWave {
  index: number
  label: string
  /** The group the wave brings in; the first wave's is `main`. */
  group: string
  slots: string[]
  /** Whether the wave builds the site's header and footer first. */
  frame: boolean
  status: AiSiteImportWaveStatus
  startedAt: string | null
  finishedAt: string | null
}

export interface AiSiteImportState {
  domain: string
  /** The site's name, as Create site was given it: the header's name. */
  siteName: string
  ownership: { method: string | null; provenAt: number | null; detail: string | null }
  readAt: string
  /** The plan's page count; `null` when it has none. */
  pageLimit: number | null
  /** Pages the site already had when its import read the old site. */
  existingPages: number
  /** Pages the crawl read. */
  found: number
  /** Why the crawl stopped short of the whole site, or `null` when it did not. */
  stoppedBy: string | null
  groups: AiSiteImportGroup[]
  pages: AiSiteImportPage[]
  waves: AiSiteImportWave[]
  /** At most `AI_SITE_IMPORT_LEFT_OUT_LISTED`, by address. */
  leftOut: AiSiteImportLeftOut[]
  /** Every page left out, by reason, listed or not. */
  leftOutCount: Partial<Record<AiSiteImportLeftOutReason, number>>
  /** The header and footer's draft id, built in the first wave; `null` when there are no main pages. */
  frame: { draftId: string } | null
  /** The Trust & Safety row this import is logged under. */
  reviewId: string | null
}

/*------------------------------------------
 * Grouping and waves
 *-----------------------------------------*/

const clipLabel = (text: string) => {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  return line.length > AI_SITE_IMPORT_LABEL_MAX_CHARS
    ? `${line.slice(0, AI_SITE_IMPORT_LABEL_MAX_CHARS - 1).trimEnd()}…`
    : line
}

const segmentsOf = (path: string) => String(path ?? '').split('/').filter(Boolean)

/** A collection's prefix for a page address: its first segment, a dated archive's `posts`; `null` for a top-level page. */
export function aiSiteImportPrefix(path: string): string | null {
  const segments = segmentsOf(path)
  if (segments.length < 2) return null
  const first = segments[0].toLowerCase()
  return /^\d{4}$/.test(first) ? 'posts' : first
}

/** "news-and-events" → "News and events". */
export function aiSiteImportPrefixLabel(prefix: string): string {
  const words = decodeURIComponent(prefix).replace(/[-_+]+/g, ' ').trim()
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : 'Pages'
}

/**
 * The inventory's groups, in the order they are brought in: the main pages,
 * then each collection — one the home page's menu links first, in menu order,
 * then the larger before the smaller.
 */
export function aiSiteImportGroups(
  pages: readonly AiSiteImportListedPage[],
  menu: readonly string[] = [],
): { groups: AiSiteImportGroup[]; groupOf: (page: AiSiteImportListedPage) => string } {
  const counts = new Map<string, number>()
  for (const page of pages) {
    const prefix = aiSiteImportPrefix(page.path)
    if (prefix) counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
  }
  const menuPaths = new Set(menu.map((path) => path.replace(/\/+$/, '') || '/'))
  const collections = new Set([...counts].filter(([, count]) => count >= AI_SITE_IMPORT_COLLECTION_MIN).map(([prefix]) => prefix))
  const groupOf = (page: AiSiteImportListedPage) => {
    const path = page.path.replace(/\/+$/, '') || '/'
    if (page.foundBy === 'home' || menuPaths.has(path)) return 'main'
    const prefix = aiSiteImportPrefix(page.path)
    return prefix && collections.has(prefix) ? `c:${prefix}` : 'main'
  }
  const menuRank = (prefix: string) => {
    const index = menu.findIndex((path) => {
      const first = segmentsOf(path)[0]?.toLowerCase()
      return first === prefix
    })
    return index === -1 ? Number.POSITIVE_INFINITY : index
  }
  const sized = new Map<string, number>()
  for (const page of pages) sized.set(groupOf(page), (sized.get(groupOf(page)) ?? 0) + 1)
  const ordered = [...collections]
    .filter((prefix) => (sized.get(`c:${prefix}`) ?? 0) > 0)
    .sort((a, b) => menuRank(a) - menuRank(b) || (sized.get(`c:${b}`) ?? 0) - (sized.get(`c:${a}`) ?? 0) || a.localeCompare(b))
  const groups: AiSiteImportGroup[] = []
  if ((sized.get('main') ?? 0) > 0) groups.push({ id: 'main', label: 'Main pages', kind: 'main', pages: sized.get('main') ?? 0 })
  for (const prefix of ordered) {
    groups.push({ id: `c:${prefix}`, label: aiSiteImportPrefixLabel(prefix), kind: 'collection', pages: sized.get(`c:${prefix}`) ?? 0 })
  }
  return { groups, groupOf }
}

/**
 * The main pages in the order a visitor meets them: home, then the menu's
 * order, then the rest as the crawl read them. A collection keeps the crawl's
 * order, which is its sitemap's.
 */
function orderedWithin(
  group: string,
  pages: readonly AiSiteImportListedPage[],
  menu: readonly string[],
): AiSiteImportListedPage[] {
  if (group !== 'main') return [...pages]
  const rank = (page: AiSiteImportListedPage) => {
    if (page.foundBy === 'home' || segmentsOf(page.path).length === 0) return -1
    const path = page.path.replace(/\/+$/, '') || '/'
    const index = menu.findIndex((entry) => (entry.replace(/\/+$/, '') || '/') === path)
    return index === -1 ? Number.POSITIVE_INFINITY : index
  }
  return pages
    .map((page, order) => ({ page, order }))
    .sort((a, b) => rank(a.page) - rank(b.page) || a.order - b.order)
    .map(({ page }) => page)
}

/**
 * The address a page takes on the new site: one segment, as every Aglyn page
 * has, from the last segment of its old address; home is the root. Two pages
 * that would take the same address are told apart by their collection, then
 * by a number. The draft writer still makes it unique on the site itself.
 */
export function aiSiteImportSlug(path: string, taken: Set<string>): string {
  const segments = segmentsOf(path)
  if (!segments.length) {
    if (!taken.has('/')) {
      taken.add('/')
      return '/'
    }
  }
  const clean = (value: string) =>
    decodeURIComponent(value)
      .toLowerCase()
      .replace(/\.(?:html?|php|aspx?)$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  const last = clean(segments[segments.length - 1] ?? '') || 'page'
  const prefixed = segments.length > 1 ? clean(`${segments[0]}-${segments[segments.length - 1]}`) : last
  for (const candidate of [last, prefixed]) {
    if (candidate && !taken.has(candidate)) {
      taken.add(candidate)
      return candidate
    }
  }
  let attempt = 2
  while (taken.has(`${last}-${attempt}`)) attempt += 1
  const slug = `${last}-${attempt}`
  taken.add(slug)
  return slug
}

export interface AiSiteImportInventoryInput {
  domain: string
  siteName: string
  ownership: AiSiteImportState['ownership']
  readAt: string
  pages: readonly AiSiteImportListedPage[]
  /** Addresses the home page's menu links, in its order. */
  menu: readonly string[]
  /** What the crawl could not read, by reason. */
  skipped: ReadonlyArray<{ url: string; reason: AiSiteImportLeftOutReason }>
  /** Skips the crawl only counted. */
  skippedOverflow?: number
  stoppedBy: string | null
  /** The plan's page count; `null` for none. */
  pageLimit: number | null
  existingPages: number
  /** Mints one draft id; the inventory names every page's draft before any is written. */
  mintId: () => string
  reviewId?: string | null
  wavePages?: number
}

/**
 * The site's inventory cut into waves, every page left out said with its
 * reason. Pure: the step reads the site, this decides what comes in.
 */
export function aiSiteImportInventory(input: AiSiteImportInventoryInput): AiSiteImportState {
  const wavePages = Math.max(1, Math.floor(input.wavePages ?? AI_SITE_IMPORT_WAVE_PAGES))
  const leftOut: AiSiteImportLeftOut[] = []
  const leftOutCount: Partial<Record<AiSiteImportLeftOutReason, number>> = {}
  const leave = (entry: AiSiteImportLeftOut) => {
    leftOutCount[entry.reason] = (leftOutCount[entry.reason] ?? 0) + 1
    if (leftOut.length < AI_SITE_IMPORT_LEFT_OUT_LISTED) leftOut.push(entry)
  }
  for (const skipped of input.skipped) {
    let path = '/'
    try {
      path = new URL(skipped.url).pathname
    } catch {
      // A malformed address keeps the root as its path.
    }
    leave({ url: skipped.url, path, title: '', reason: skipped.reason })
  }
  if (input.skippedOverflow) leftOutCount['unreadable'] = (leftOutCount['unreadable'] ?? 0) + input.skippedOverflow

  const readable = input.pages.filter((page) => {
    if (page.words >= AI_SITE_IMPORT_MIN_WORDS || page.images > 0) return true
    leave({ url: page.url, path: page.path, title: clipLabel(page.title), reason: 'empty' })
    return false
  })
  const { groups, groupOf } = aiSiteImportGroups(readable, input.menu)
  const limit = input.pageLimit === null || !Number.isFinite(input.pageLimit) ? null : Math.max(0, Math.floor(input.pageLimit))
  let room = limit === null ? Number.POSITIVE_INFINITY : Math.max(0, limit - Math.max(0, input.existingPages))
  const pages: AiSiteImportPage[] = []
  const waves: AiSiteImportWave[] = []
  const taken = new Set<string>()
  for (const group of groups) {
    const members = orderedWithin(group.id, readable.filter((page) => groupOf(page) === group.id), input.menu)
    const kept: AiSiteImportListedPage[] = []
    for (const page of members) {
      if (room > 0) {
        kept.push(page)
        room -= 1
      } else {
        leave({ url: page.url, path: page.path, title: clipLabel(page.title), reason: 'plan-limit' })
      }
    }
    const parts = Math.ceil(kept.length / wavePages)
    for (let part = 0; part < parts; part += 1) {
      const index = waves.length
      const slice = kept.slice(part * wavePages, (part + 1) * wavePages)
      const slots: string[] = []
      for (const page of slice) {
        const slot = `p${pages.length}`
        slots.push(slot)
        pages.push({
          slot,
          url: page.url,
          path: page.path,
          title: clipLabel(page.title) || aiSiteImportPrefixLabel(segmentsOf(page.path).pop() ?? 'Home'),
          group: group.id,
          wave: index,
          draftId: input.mintId(),
          slug: aiSiteImportSlug(page.path, taken),
          words: page.words,
          images: page.images,
        })
      }
      waves.push({
        index,
        label: parts > 1 ? `${group.label}, ${part + 1} of ${parts}` : group.label,
        group: group.id,
        slots,
        frame: index === 0 && group.kind === 'main',
        status: 'waiting',
        startedAt: null,
        finishedAt: null,
      })
    }
  }
  return {
    domain: input.domain,
    siteName: clipLabel(input.siteName) || input.domain,
    ownership: input.ownership,
    readAt: input.readAt,
    pageLimit: limit,
    existingPages: Math.max(0, input.existingPages),
    found: input.pages.length,
    stoppedBy: input.stoppedBy,
    groups,
    pages,
    waves,
    leftOut,
    leftOutCount,
    frame: waves[0]?.frame ? { draftId: input.mintId() } : null,
    reviewId: input.reviewId ?? null,
  }
}

/** The item ledger an inventory starts: the header and footer, then every page, all pending. */
export function aiSiteImportLedger(state: AiSiteImportState): AiJobItemLedger[] {
  const row = (slot: string, op: string, label: string): AiJobItemLedger => ({
    slot,
    op,
    label,
    status: 'pending',
    attempt: 1,
    creditsSpent: 0,
    creditsRefunded: 0,
    outputs: [],
  })
  return [
    ...(state.frame ? [row(AI_SITE_IMPORT_FRAME_SLOT, 'layout', 'Header and footer')] : []),
    ...state.pages.map((page) => row(page.slot, 'page', page.title)),
  ]
}

/*------------------------------------------
 * What runs next
 *-----------------------------------------*/

export type AiSiteImportWork =
  | { kind: 'inventory' }
  | { kind: 'start-wave'; wave: AiSiteImportWave }
  /** Pages of the running wave its read did not reach before its clock ran out. */
  | { kind: 'read'; wave: AiSiteImportWave; pages: AiSiteImportPage[] }
  | { kind: 'frame'; wave: AiSiteImportWave }
  | { kind: 'images'; wave: AiSiteImportWave; page: AiSiteImportPage }
  | { kind: 'page'; wave: AiSiteImportWave; page: AiSiteImportPage }
  | { kind: 'close-wave'; wave: AiSiteImportWave }
  | { kind: 'done' }

const OPEN = new Set(['pending', 'running'])

/** Whether an item is still to be built. */
export function aiSiteImportItemOpen(items: readonly AiJobItemLedger[] | null | undefined, slot: string): boolean {
  const row = (items ?? []).find((entry) => entry.slot === slot)
  return Boolean(row && OPEN.has(row.status))
}

/** The wave running now, else `null`. */
export function aiSiteImportRunningWave(state: AiSiteImportState | null | undefined): AiSiteImportWave | null {
  return state?.waves.find((wave) => wave.status === 'running') ?? null
}

/** The next wave a person may start, else `null`. */
export function aiSiteImportNextWave(state: AiSiteImportState | null | undefined): AiSiteImportWave | null {
  if (!state || aiSiteImportRunningWave(state)) return null
  return state.waves.find((wave) => wave.status === 'waiting') ?? null
}

/** The wave a person is reviewing, else `null`. */
export function aiSiteImportReviewWave(state: AiSiteImportState | null | undefined): AiSiteImportWave | null {
  return state?.waves.find((wave) => wave.status === 'review') ?? null
}

/** What the next pass of the step does. */
export function aiSiteImportNextWork(
  state: AiSiteImportState | null | undefined,
  items: readonly AiJobItemLedger[] | null | undefined,
): AiSiteImportWork {
  if (!state) return { kind: 'inventory' }
  const running = aiSiteImportRunningWave(state)
  if (!running) {
    const next = aiSiteImportNextWave(state)
    return next ? { kind: 'start-wave', wave: next } : { kind: 'done' }
  }
  // A page the wave's read has not reached yet is read before anything is built.
  const unread = running.slots
    .map((slot) => state.pages.find((page) => page.slot === slot))
    .filter((page): page is AiSiteImportPage => !!page && !page.read && !page.refused && aiSiteImportItemOpen(items, page.slot))
  if (unread.length) return { kind: 'read', wave: running, pages: unread }
  if (running.frame && state.frame && aiSiteImportItemOpen(items, AI_SITE_IMPORT_FRAME_SLOT)) {
    return { kind: 'frame', wave: running }
  }
  for (const slot of running.slots) {
    if (!aiSiteImportItemOpen(items, slot)) continue
    const page = state.pages.find((entry) => entry.slot === slot)
    if (!page) continue
    return page.photos ? { kind: 'page', wave: running, page } : { kind: 'images', wave: running, page }
  }
  return { kind: 'close-wave', wave: running }
}

/*------------------------------------------
 * The state, one pass at a time
 *-----------------------------------------*/

const withPage = (state: AiSiteImportState, slot: string, patch: Partial<AiSiteImportPage>): AiSiteImportState => ({
  ...state,
  pages: state.pages.map((page) => (page.slot === slot ? { ...page, ...patch } : page)),
})

const withWave = (state: AiSiteImportState, index: number, patch: Partial<AiSiteImportWave>): AiSiteImportState => ({
  ...state,
  waves: state.waves.map((wave) => (wave.index === index ? { ...wave, ...patch } : wave)),
})

/** A wave started: running, with what its read found on each page. */
export function aiSiteImportWaveStarted(
  state: AiSiteImportState,
  index: number,
  at: string,
  reads: ReadonlyMap<string, AiSiteImportPageRead | AiSiteImportLeftOutReason>,
): AiSiteImportState {
  // The wave reviewed before this one is done: starting the next is the person's say-so.
  const next = withWave(
    { ...state, waves: state.waves.map((wave) => (wave.status === 'review' ? { ...wave, status: 'done' as const } : wave)) },
    index,
    { status: 'running', startedAt: at, finishedAt: null },
  )
  return aiSiteImportPagesRead(next, reads)
}

/** More of a running wave's pages, read now. */
export function aiSiteImportPagesRead(
  state: AiSiteImportState,
  reads: ReadonlyMap<string, AiSiteImportPageRead | AiSiteImportLeftOutReason>,
): AiSiteImportState {
  let next = state
  for (const [slot, read] of reads) {
    next =
      typeof read === 'string'
        ? withPage(next, slot, { refused: read, read: null })
        : withPage(next, slot, { read, refused: null, title: clipLabel(read.title) || next.pages.find((page) => page.slot === slot)?.title || '' })
  }
  return next
}

/** A page's photos are in the library. */
export function aiSiteImportPhotosIn(
  state: AiSiteImportState,
  slot: string,
  photos: NonNullable<AiSiteImportPage['photos']>,
): AiSiteImportState {
  return withPage(state, slot, { photos })
}

/** A page is in: its text is no longer kept. */
export function aiSiteImportPageSettled(state: AiSiteImportState, slot: string): AiSiteImportState {
  const page = state.pages.find((entry) => entry.slot === slot)
  if (!page?.read) return state
  return withPage(state, slot, { read: { ...page.read, text: '' } })
}

/** A wave is in: waiting for its review, or done when no wave follows it. */
export function aiSiteImportWaveClosed(state: AiSiteImportState, index: number, at: string): AiSiteImportState {
  const later = state.waves.some((wave) => wave.index > index && wave.status === 'waiting')
  let next = withWave(state, index, { status: later ? 'review' : 'done', finishedAt: at })
  // What the wave read is no longer needed by any model answer.
  for (const slot of state.waves.find((wave) => wave.index === index)?.slots ?? []) next = aiSiteImportPageSettled(next, slot)
  return next
}

/** The state as the console reads it: every page's read text left off. */
export function aiSiteImportWire(state: AiSiteImportState | null | undefined): AiSiteImportState | null {
  if (!state) return null
  return {
    ...state,
    pages: state.pages.map((page) =>
      page.read ? { ...page, read: { ...page.read, text: '', images: [] } } : page,
    ),
  }
}

/*------------------------------------------
 * Credits
 *-----------------------------------------*/

/**
 * What bringing in this many pages costs, quoted before it starts (AGL-3976):
 * each page an AI page as measured, its ceiling its two passes, and the
 * site's header and footer once when the wave builds them.
 */
export function aiSiteImportCreditRange(pages: number, options: { frame?: boolean } = {}): AiCreditRange {
  const count = Math.max(0, Math.floor(Number.isFinite(pages) ? pages : 0))
  const { page, frame } = AI_MEASURED_IMPORT_CREDITS
  return aiCreditRangeOrdered({
    likely: count * page.median + (options.frame ? frame.median : 0),
    p90: count * page.p90 + (options.frame ? frame.p90 : 0),
    ceiling: count * AI_SITE_IMPORT_PAGE_CEILING_CREDITS + (options.frame ? AI_SITE_IMPORT_FRAME_CEILING_CREDITS : 0),
  })
}

/** A wave's quote: the pages it has still to bring in, and its header and footer while they are owed. */
export function aiSiteImportWaveCreditRange(
  state: AiSiteImportState,
  wave: AiSiteImportWave,
  items?: readonly AiJobItemLedger[] | null,
): AiCreditRange {
  const owed = (slot: string) => (items ? aiSiteImportItemOpen(items, slot) : true)
  const pages = wave.slots.filter((slot) => owed(slot) && !state.pages.find((page) => page.slot === slot)?.refused).length
  return aiSiteImportCreditRange(pages, { frame: wave.frame && !!state.frame && owed(AI_SITE_IMPORT_FRAME_SLOT) })
}

/*------------------------------------------
 * Words
 *-----------------------------------------*/

/** Why a page is not brought in, as a person reads it. */
export const AI_SITE_IMPORT_LEFT_OUT_COPY: Readonly<Record<AiSiteImportLeftOutReason, string>> = {
  'plan-limit': 'Past your plan’s page count. Upgrade for more pages, then bring the rest in.',
  robots: 'The site’s robots.txt asks AglynBot not to read it.',
  'login-form': 'A sign-in page. Pages that ask for a password are never brought in.',
  empty: 'Nothing to bring in: the page has no text or photos.',
  unreadable: 'It could not be read just now.',
  blocked:
    'The site’s bot protection or firewall turned AglynBot away. Allow AglynBot in your site’s bot or firewall settings, then bring the site in again.',
  'too-large': 'Larger than a page can be to bring in.',
  'off-site': 'It sends visitors to another website.',
}

/** "3 pages" / "1 page". */
export function aiSiteImportPagesText(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'page' : 'pages'}`
}

/** The review a finished wave parks on, or the first wave's go-ahead once the site is read. */
export function aiSiteImportWaveMessage(
  state: AiSiteImportState,
  items: readonly AiJobItemLedger[] | null | undefined,
): string {
  const next = aiSiteImportNextWave(state)
  const reviewing = aiSiteImportReviewWave(state)
  if (!reviewing) {
    const kept = state.pages.length
    return next
      ? `Your site is read: ${aiSiteImportPagesText(kept)} to bring in, in ${state.waves.length === 1 ? 'one wave' : `${state.waves.length} waves`}. Start the first wave when you are ready.`
      : 'Your site is read, and nothing on it can be brought in.'
  }
  const rows = (items ?? []).filter((row) => reviewing.slots.includes(row.slot))
  const done = rows.filter((row) => row.status === 'succeeded' || row.status === 'degraded').length
  const lead = `${reviewing.label} is in: ${aiSiteImportPagesText(done)} ready to review as drafts.`
  return next ? `${lead} Start ${next.label} when you are ready.` : lead
}
