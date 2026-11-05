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

/**
 * The recorded pages brought in again, offline (AGL-4109), for the fidelity
 * spec and the fidelity report: each page of `site-layout/` read by the
 * reader, built by the import's compile and held to its page check as the
 * page step stores it, and each recorded home page's header and footer drawn
 * as the frame step draws them, with no model. Every page the source links
 * on its own site is a page the import plans, as on a whole-site import. No
 * live AI: a design answer here is a recorded one, in the shape the tool
 * answers.
 */

import { DEFAULT_SITE_THEME } from '@aglyn/aglyn/app-utils/default-site'
import { aiImportedPageCheck } from '../../jobs/ai-job-page-language'
import { aiReadImprovedPage, aiSiteImportImproveDestinations, aiSiteImportImproveLedger, aiSiteImportImproveScope, aiSiteImportImprovedPage, type AiSiteImportImprovedPage } from '../../jobs/ai-site-import-improve'
import { aiSiteImportFrameJob, aiSiteImportHomeOf } from '../../jobs/ai-job-import-step'
import { aiLayoutSiteBrandOf, aiLayoutSiteFrameOf, aiLayoutSourceFrameBuild } from '../../jobs/ai-job-layout-language'
import { aiLayoutChecks } from '../../jobs/ai-job-layout-step'
import { aiSiteImportSectionNames } from '../../jobs/ai-site-import-compile'
import { AI_LAYOUT_IMPORTED_SECTIONS_INPUT, aiSiteImportDocumentOf, type AiSiteImportDocument } from '../../jobs/ai-site-import-document'
import { aiSiteImportStyle } from '../../jobs/ai-site-import-look'
import { aiLayoutDesignChoices } from '../../layout-language/ai-layout-design'
import type { AiLayoutFrameSource } from '../../layout-language/ai-layout-frame-source'
import type { AiJob } from '../../model/ai-jobs.types'
import {
  aiSiteImportLedger,
  type AiSiteImportFinish,
  type AiSiteImportPage,
  type AiSiteImportState,
  type AiSiteImportWords,
  type SiteImportFooter,
  type SiteImportNavTree,
} from '../../model/ai-site-import'
import { siteImportFidelityThemeOf, type SiteImportFidelitySource, type SiteImportFidelityTheme, type SiteImportFidelityTree } from '../../model/ai-site-import-fidelity'
import { aiSiteTheme } from '../../model/ai-site-look'
import { emptyAiSiteInventory } from '../../model/ai-site-inventory'
import type { SiteImportInventory } from '../site-import-crawl'
import { extractSiteImportPage, type SiteImportBlock } from '../site-import-html'
import { siteImportLayout, siteImportLookOf } from '../site-import-layout'
import { siteImportFooterColumns, siteImportNavTree, type SiteImportFrameSource } from '../site-import-nav'
import { siteImportPageRead } from '../site-import-page'
import { SITE_BASIC_PAGES, SITE_LAYOUT_PAGES, siteBasicRecording, siteLayoutRecording, siteLayoutSameSite, type SiteBasicPageName, type SiteLayoutPageName } from './site-layout-recordings'

/** A page the replay reads: one of the recorded pages, or a basic site that does not exist (AGL-4152). */
export type SiteImportReplayName = SiteLayoutPageName | SiteBasicPageName

const isBasic = (name: SiteImportReplayName): name is SiteBasicPageName => name in SITE_BASIC_PAGES

/** A page's address, its markup and its stylesheet, and whether an address is its own site's. */
function recordingOf(name: SiteImportReplayName): { url: string; html: string; sheets: string[]; same: (url: URL) => boolean } {
  if (!isBasic(name)) return { url: SITE_LAYOUT_PAGES[name].url, html: siteLayoutRecording(name), sheets: [], same: siteLayoutSameSite(name) }
  const { url } = SITE_BASIC_PAGES[name]
  const { html, css } = siteBasicRecording(name)
  const origin = new URL(url).origin
  return { url, html, sheets: [css], same: (address) => address.origin === origin }
}

/** The page's same-site addresses, each a page the import plans: every page a link may go to. */
function plannedLinks(blocks: readonly SiteImportBlock[], origin: string): Array<{ path: string; id: string }> {
  const paths = new Set<string>()
  for (const block of blocks) {
    if (block.kind !== 'link') continue
    try {
      const url = new URL(block.href)
      const path = url.pathname.replace(/\/+$/, '') || '/'
      if (url.origin === origin && path !== '/') paths.add(path)
    } catch {
      // Not an address.
    }
  }
  return [...paths].map((path) => ({ path, id: `p${path.replace(/[^a-z0-9]+/gi, '-')}` }))
}

/** A recorded page as a wave's read keeps it and the import step hands it on: its blocks, its layout, its photos in the library. */
export function siteImportReplayDocument(name: SiteImportReplayName): AiSiteImportDocument {
  const { url, html, sheets, same } = recordingOf(name)
  const page = extractSiteImportPage(html, url, same, { structure: true })
  const layout = siteImportLayout(page as Parameters<typeof siteImportLayout>[0], sheets)
  const path = new URL(url).pathname
  const read = siteImportPageRead({ ...page, layout, url, path, foundBy: path === '/' ? 'home' : 'sitemap', bytes: 0 } as never, 'now')
  const blocks = read.blocks ?? []
  const origin = new URL(url).origin
  const pictures = [...new Set(blocks.flatMap((block) => (block.kind === 'image' ? [block.url] : [])))]
  return {
    build: 'arranged',
    title: read.title,
    url,
    blocks,
    photos: pictures.map((from, index) => ({ mediaId: `m${index}`, src: `media:host-import/m${index}`, from, width: 1600, height: 900 })),
    links: plannedLinks(blocks, origin),
    origins: [origin, origin.replace('://', '://www.')],
    ...(read.layout ? { layout: read.layout } : {}),
    ...(read.videos?.length ? { videos: read.videos } : {}),
  }
}

/** A recorded page built as the page step builds it: its source, its stored nodes, and what the page check said. */
export interface SiteImportReplayPage {
  doc: AiSiteImportDocument
  source: SiteImportFidelitySource
  tree: SiteImportFidelityTree
  violations: unknown[]
}

/** A recorded rewrite of one line of a page (AGL-4152, lane G), in the shape `submit_wording` answers: the line's index in the page's blocks, and its new words. */
export interface SiteImportReplayRewrite {
  line: number
  text: string
}

/** How a recorded page is built: its design answer, the site's forms, and how it is finished. */
export interface SiteImportReplayOptions {
  answer?: Record<string, unknown> | null
  forms?: Array<{ id: string; name: string }>
  layout?: boolean
  /** Keep my site or Improve it (AGL-4152), on the page's document as its wave stamps it; absent, the document names none. */
  finish?: AiSiteImportFinish
  /** Whether its words are kept or improved (AGL-4152), on its document. */
  words?: AiSiteImportWords
  /** Recorded rewrites of its lines (lane G): the page is built in them, and scored against the words as its source wrote them. */
  wording?: readonly SiteImportReplayRewrite[]
  /** The site's design seed; absent, one kept the same in every report. */
  seed?: number
}

/**
 * A recorded page built and checked as the page step stores it (AGL-4109):
 * with a recorded design `answer`, as a main page is arranged, or with none,
 * as a page is drawn from its layout alone; `forms` are the site's saved
 * forms. `layout: false` builds it as a read with no layout was built, one
 * section at each second-level heading, as the 10/29 import did.
 *
 * `finish` and `words` (AGL-4152) ride the page's document as a wave stamps
 * them, so the compile builds it as that finish asks wherever it reads them;
 * `wording` builds it in recorded rewrites of its lines, while its source
 * keeps the words as written.
 */
export function siteImportReplayPage(name: SiteImportReplayName, options: SiteImportReplayOptions = {}): SiteImportReplayPage {
  const read = siteImportReplayDocument(name)
  const { layout, ...rest } = read
  const rewrites = new Map((options.wording ?? []).map((rewrite) => [rewrite.line, rewrite.text]))
  const finished = { ...(options.finish ? { finish: options.finish } : {}), ...(options.words ? { wording: options.words } : {}) }
  const given = {
    ...(options.layout === false ? rest : read),
    ...finished,
    blocks: read.blocks.map((block, index) => (rewrites.has(index) && block.kind !== 'image' ? { ...block, text: rewrites.get(index) as string } : block)),
  }
  // As the page step reads it: through the job's input, so a fact the reader drops is dropped here too (AGL-4138).
  const parsed = aiSiteImportDocumentOf({ [AI_LAYOUT_IMPORTED_SECTIONS_INPUT]: JSON.parse(JSON.stringify(given)) }) as AiSiteImportDocument
  const doc: AiSiteImportDocument = { ...parsed, ...finished }
  const names = aiSiteImportSectionNames(doc)
  const sectionIds = names.map((_, index) => `sec-${index}`)
  const screen = { title: doc.title, slug: name === 'home' ? '/' : `/${name}`, sections: names.map((section) => ({ name: section, uses: [] as string[], items: 0 })) }
  const forms = options.forms ?? []
  const targets = { pageId: 'p0', pages: [], homeIds: [], forms, formPageId: null, components: [], facts: '' }
  const check = aiImportedPageCheck({
    screen: screen as never,
    sectionIds,
    targets: targets as never,
    context: { screenIds: doc.links.map((link) => link.id), formIds: forms.map((form) => form.id), componentIds: [], codeBuilt: true },
    design: { kind: 'business', seed: options.seed ?? 7, home: name === 'home' } as never,
    doc,
  })
  const result = check(options.answer ?? null)
  const nodes = (result.value?.nodes ?? {}) as unknown as SiteImportFidelityTree['nodes']
  return {
    doc,
    source: { layout: layout as NonNullable<typeof layout>, blocks: read.blocks, photos: read.photos },
    tree: { rootId: '_@_', nodes },
    violations: result.violations,
  }
}

/**
 * The theme a recorded page is drawn in (AGL-4152): no site stores one, so
 * it is computed as the look pass draws it, from the page's own look facts
 * with the import's seed and no inspiration site, over the platform's
 * default theme, and is marked as computed from the site style. `finish` is handed to the
 * look's style as the pass hands it, for the pass that reads it.
 */
export function siteImportReplayTheme(name: SiteImportReplayName, finish?: AiSiteImportFinish, options: { generative?: boolean } = {}): SiteImportFidelityTheme | null {
  const read = siteImportReplayDocument(name)
  const input = { seed: 7, description: read.title, facts: read.layout?.look ?? null, ...(finish ? { finish } : {}), ...(options.generative ? { generative: true } : {}) }
  const style = aiSiteImportStyle(null, input as Parameters<typeof aiSiteImportStyle>[1])
  return style ? siteImportFidelityThemeOf(aiSiteTheme(style, DEFAULT_SITE_THEME), 'style') : null
}

/**
 * A site's design seed whose bands run on one ground (AGL-4152), as the 11/5
 * Improve it test drew its pages: what today's build leaves of a page's rhythm
 * on such a site, whatever its answer asks.
 */
export function siteImportReplayOneGroundSeed(): number {
  for (let seed = 1; seed < 1_000; seed += 1) {
    if (aiLayoutDesignChoices({ kind: 'business', seed, home: true }).bandRhythm === 'plain') return seed
  }
  throw new Error('no seed draws one ground')
}

/** A basic site's page as a recorded `submit_improved_page` answer draws it (AGL-4152), with what the code that keeps it reads. */
export interface SiteImportReplayImproved extends SiteImportReplayPage {
  page: AiSiteImportImprovedPage
  /** Every line the facts may come from. */
  scope: string[]
  /** Every destination the source's links have here. */
  destinations: string[]
}

/** The forms the basic sites hold a saved form for. */
const BASIC_FORMS = [{ id: 'form-basic', name: 'Contact' }]

/**
 * A recorded redesign built as the page step builds it (AGL-4152): its answer
 * read, its `keep`s expanded, compiled, stored and checked; no model. `design`
 * is the site the page is drawn for; a basic site has one form.
 */
export function siteImportReplayImproved(name: SiteImportReplayName, answer: unknown, options: { seed?: number; theme?: SiteImportFidelityTheme | null } = {}): SiteImportReplayImproved {
  const read = siteImportReplayDocument(name)
  const forms = BASIC_FORMS
  const doc: AiSiteImportDocument = { ...read, finish: 'improve', wording: 'improved', generative: true }
  const ledger = aiSiteImportImproveLedger(doc)
  const given = aiReadImprovedPage(answer)
  if (!given) throw new Error(`the recorded answer for ${name} has no section`)
  const formAt = given.findIndex((section) => section.blocks.some((block) => block.kind === 'keep' && block.ref.startsWith('form:')))
  const destinations = aiSiteImportImproveDestinations(doc, ledger, { sections: given.length, formSection: formAt === -1 ? null : formAt })
  const design = { kind: 'business', seed: options.seed ?? 7, home: true } as never
  const page = aiSiteImportImprovedPage(given, { doc, ledger, design, destinations, formId: forms[0]?.id ?? null, theme: options.theme ?? null })
  const sectionIds = page.names.map((_, index) => `sec-${index}`)
  const screen = { title: doc.title, slug: '/', sections: page.names.map((section) => ({ name: section, uses: [] as string[], items: 0 })) }
  const targets = { pageId: 'p0', pages: [], homeIds: [], forms, formPageId: null, components: [], facts: '' }
  const result = aiImportedPageCheck({
    screen: screen as never,
    sectionIds,
    targets: targets as never,
    context: { screenIds: doc.links.map((link) => link.id), formIds: forms.map((form) => form.id), componentIds: [], codeBuilt: true },
    design,
    doc,
    given: page.given,
    rewritten: page.written,
  })(null)
  const nodes = (result.value?.nodes ?? {}) as unknown as SiteImportFidelityTree['nodes']
  return {
    doc,
    source: { layout: read.layout as NonNullable<typeof read.layout>, blocks: read.blocks, photos: read.photos },
    tree: { rootId: '_@_', nodes },
    violations: result.violations,
    page,
    scope: aiSiteImportImproveScope(doc, null),
    destinations: [...new Set(ledger.links.flatMap((link) => {
      const to = destinations.get(link.ref)
      return to ? [to] : []
    }))],
  }
}

/**
 * The design answer recorded for aglyn.com's Home, in the tool's shape: a
 * split hero, ruled cards, a dark band asked where the source drew its own
 * white, a style of pictures for a group that has none. The compile spec
 * holds the same one.
 */
export const SITE_IMPORT_REPLAY_HOME_ANSWER: Readonly<Record<string, unknown>> = {
  sections: [
    { hero: 'split', band: 'source', align: 'start', groups: [] },
    { hero: 'none', band: 'source', align: 'source', groups: [{ kind: 'source', style: 'ruled' }] },
    { hero: 'none', band: 'dark', align: 'source', groups: [] },
    { hero: 'none', band: 'source', align: 'source', groups: [{ kind: 'source', style: 'pictures' }] },
  ],
}

/**
 * The design answer the 11/5 live import took for aglyn.com's Home (AGL-4152):
 * the editorial hero at the start, on a page whose source centers its words
 * over a picture under them. Keep my site holds the source's own opening
 * whatever this says; Improve it draws what it asks.
 */
export const SITE_IMPORT_REPLAY_HOME_ANSWER_1105: Readonly<Record<string, unknown>> = {
  sections: [{ hero: 'editorial', band: 'source', align: 'start', groups: [] }],
}

/** The recorded home pages a header and footer is drawn from. */
export type SiteImportReplayHome = Extract<SiteLayoutPageName, 'home' | 'pottery'> | SiteBasicPageName

const NOW = new Date('2026-10-29T18:00:00.000Z')

/** A recorded home page as the crawl keeps it: its menu, footer and look read as the source builds them. */
function crawledHome(name: SiteImportReplayHome): SiteImportInventory['pages'][number] {
  const { url, html, sheets, same } = recordingOf(name)
  const extract = extractSiteImportPage(html, url, same, { structure: true })
  const source = extract as SiteImportFrameSource
  const { structure: _structure, loginForm: _loginForm, ...rest } = extract
  return { ...rest, url, path: '/', foundBy: 'home', bytes: 0, nav: siteImportNavTree(source, sheets), footer: siteImportFooterColumns(source, sheets), look: siteImportLookOf(source, sheets) }
}

/** A site planned for its first wave: Home, and two pages of its own. */
function replayState(name: SiteImportReplayHome): AiSiteImportState {
  const origin = new URL(recordingOf(name).url).origin
  const paths = name === 'home' ? ['/', '/product', '/pricing'] : isBasic(name) ? ['/'] : ['/', '/classes', '/gallery']
  const home = aiSiteImportHomeOf({ pages: [crawledHome(name)] })
  const pages: AiSiteImportPage[] = paths.map((path, index) => {
    const slug = path === '/' ? '/' : (path.split('/').filter(Boolean).pop() as string)
    return { slot: `p${index}`, url: `${origin}${path}`, path, title: slug, group: 'main', wave: 1, draftId: `draft${index}`, slug, words: 300, images: 0 }
  })
  return {
    domain: new URL(origin).hostname.replace(/^www\./, ''),
    siteName: 'import-check',
    ownership: { method: 'dns', provenAt: 1, detail: null },
    readAt: NOW.toISOString(),
    pageLimit: null,
    existingPages: 0,
    found: pages.length,
    stoppedBy: null,
    groups: [],
    pages,
    waves: [{ index: 1, label: 'Wave 1', group: 'main', slots: pages.map((page) => page.slot), frame: true, status: 'running', startedAt: NOW.toISOString(), finishedAt: null }],
    leftOut: [],
    leftOutCount: {},
    frame: { draftId: 'frameDraft' },
    home,
    look: {
      at: NOW.toISOString(),
      theme: 'applied',
      colors: [],
      logo: name === 'home' ? { mediaId: 'm1', src: 'media:host-import/m1', width: 632, height: 192 } : null,
      // The menus' pictures, in the library as the look pass brings them in (AGL-4139).
      pictures: siteImportMenuPictures(home).map((from, index) => ({ mediaId: `mp${index}`, src: `media:host-import/mp${index}`, from, width: 1200, height: 750 })),
      seo: true,
      seed: 7,
    },
  }
}

/** The pictures a home page's menus show, each once: what the look pass brings in. */
function siteImportMenuPictures(home: AiSiteImportState['home']): string[] {
  const urls = (home?.nav?.items ?? []).flatMap((group) => (group.columns ?? []).flatMap((column) => (column.image ? [column.image.url] : [])))
  return [...new Set(urls)]
}

/** A recorded home page's header and footer as the frame step draws them: the source's menu and footer, the stored nodes, the check's word. */
export interface SiteImportReplayFrame {
  nav: SiteImportNavTree | null
  footer: SiteImportFooter | null
  tree: SiteImportFidelityTree
  violations: unknown[]
}

/** A recorded home page's header and footer, drawn with no model as the layout step stores them (AGL-4108). */
export function siteImportReplayFrame(name: SiteImportReplayHome, options: { generative?: boolean } = {}): SiteImportReplayFrame {
  const base = replayState(name)
  const state = options.generative ? { ...base, waves: base.waves.map((wave) => ({ ...wave, generative: true as const })) } : base
  const job = {
    $id: 'importJob',
    orgId: 'org-replay',
    hostId: 'host-replay',
    kind: 'import',
    status: 'running',
    brief: `Bring in ${state.domain}`,
    inputs: { domain: state.domain },
    steps: [],
    outputs: [],
    createdBy: 'uid-replay',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
  } as unknown as AiJob
  const frameJob = aiSiteImportFrameJob(job, state, state.waves[0] as AiSiteImportState['waves'][number], aiSiteImportLedger(state))
  const home = state.pages[0] as AiSiteImportPage
  const built = aiLayoutSourceFrameBuild({
    siteName: String(frameJob.inputs?.['businessName']),
    homeId: home.draftId,
    pages: [{ id: home.draftId, label: 'Home', slug: '/' }],
    targets: { pageId: null, pages: [], homeIds: [home.draftId], forms: [], formPageId: null, components: [], facts: '' } as never,
    extend: aiLayoutChecks(emptyAiSiteInventory('host-replay'), frameJob.plan ?? null, [frameJob.brief, ...(state.home?.facts.lines ?? [])].join('\n')),
    brand: aiLayoutSiteBrandOf(frameJob.inputs),
    source: aiLayoutSiteFrameOf(frameJob.inputs) as AiLayoutFrameSource,
  })
  const nodes = (built.value?.nodes ?? {}) as unknown as SiteImportFidelityTree['nodes']
  return { nav: state.home?.nav ?? null, footer: state.home?.footer ?? null, tree: { rootId: '_@_', nodes }, violations: built.violations }
}
