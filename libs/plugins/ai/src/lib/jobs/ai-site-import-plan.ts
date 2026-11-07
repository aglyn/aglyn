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
 * IMPROVE IT, GENERATIVE: THE SITE PLANNED ONCE (AGL-4152).
 *
 * A page redesigned on its own cannot reorganize a site. So before anything of
 * it is built, one `submit_site_plan` answer reads what the first wave read and
 * says what the site is, how its menu and footer are organized, where the
 * header's main button goes, how the whole site is drawn, and at most one new
 * page. Every wave's pages are then drawn to it, by code:
 *
 *   - the header and footer from `plan.nav`, with no model
 *     (`aiSiteImportFrameSource`);
 *   - each page's hero, groups, rhythm and closing band from `plan.design`
 *     (`aiLayoutDesignChoices`), so the site reads as one design.
 *
 * The answer is held here: every page it names is a real page or the one it
 * proposes, its main button goes somewhere real, nothing the old menu reached
 * is left unreachable, and its words go through the honesty validator. An answer
 * that misses twice, or is refused, is no plan: the import's own frame and
 * design inputs stand, and its page says so.
 *
 * Nothing here runs with the flag off, or for Keep my site.
 *=========================================*/

import { fenceUntrustedText, UNTRUSTED_TEXT_RULE } from '@aglyn/shared-util-tools/untrusted-text'
import { aiLayoutGuardContacts } from '../layout-language/ai-layout-copy'
import { AI_SITE_IMPORT_PAGE_ROLES, AI_SITE_IMPORT_PROPOSED_PAGE, aiSiteImportPageIsLegal, type AiSiteImportPage, type AiSiteImportPageRole, type AiSiteImportPlan, type AiSiteImportPlanDesign, type AiSiteImportState } from '../model/ai-site-import'
import { AI_SITE_KINDS } from '../model/ai-site-kinds'
import type { AiSystemBlock, AiTool } from '../providers/contract'
import { AI_STEP_TIERS } from '../providers/catalog'
import type { AiGenerationCheck, AiValidatedGeneration } from '../runtime/ai-doctrine'
import { runValidatedGeneration } from '../runtime/ai-doctrine'
import type { AiDoctrineViolation } from '../runtime/ai-doctrine-validators'
import { aiGenerationMaxTokensWithin, aiJobStepBudget } from './ai-job-budget'
import { AI_LAYOUT_LANGUAGE_THINKING } from './ai-job-page-language'
import { AI_SITE_IMPORT_DROPPED_ITEM_CODE, AI_SITE_IMPORT_INVENTED_FACT_CODE, aiSiteImportHonestyFacts, aiSiteImportInventedIn } from './ai-site-import-honesty'
import { aiSiteImportRedesignWhy } from './ai-site-import-improve'

const clean = (text: unknown): string => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '')

/** The answer's kind of generation: the name its re-ask and its doctrine scope go by. */
export const AI_SITE_IMPORT_PLAN_KIND = 'site-import-plan'

/** The heroes a plan may choose: those a page brought in can draw from one picture. */
export const AI_SITE_IMPORT_PLAN_HEROES = ['cover', 'poster', 'split', 'bleed', 'editorial', 'column', 'panel'] as const satisfies ReadonlyArray<AiSiteImportPlanDesign['hero']>

/** The most top-level entries a planned menu holds: more reads as no plan at all. */
export const AI_SITE_IMPORT_PLAN_MAX_GROUPS = 6

/** The most characters a menu's label holds, a heading of the footer, or the main button's. */
export const AI_SITE_IMPORT_PLAN_LABEL_MAX_CHARS = 28

/** The most characters a proposed page's title holds: its search listing's ceiling. */
export const AI_SITE_IMPORT_PLAN_TITLE_MAX_CHARS = 60

const GROUP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'pages'],
  properties: { label: { type: 'string' }, pages: { type: 'array', items: { type: 'string' } } },
} as const

/** The plan's tool: strict, every field always written. */
export const AI_SITE_IMPORT_PLAN_TOOL: AiTool = {
  name: 'submit_site_plan',
  description: 'Submit the plan of the new site: what it is, its menu and footer, how it is drawn, and at most one new page.',
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['site', 'nav', 'design', 'proposed', 'roles'],
    properties: {
      site: {
        type: 'object',
        additionalProperties: false,
        required: ['what', 'audience', 'kind', 'voice'],
        properties: {
          what: { type: 'string' },
          audience: { type: 'string' },
          kind: { type: 'string', enum: AI_SITE_KINDS.map((kind) => kind.id) },
          voice: { type: 'string' },
        },
      },
      nav: {
        type: 'object',
        additionalProperties: false,
        required: ['groups', 'cta', 'footer'],
        properties: {
          groups: { type: 'array', items: GROUP_SCHEMA },
          cta: {
            type: 'object',
            additionalProperties: false,
            required: ['label', 'target'],
            properties: { label: { type: 'string' }, target: { type: 'string' } },
          },
          footer: { type: 'array', items: GROUP_SCHEMA },
        },
      },
      design: {
        type: 'object',
        additionalProperties: false,
        required: ['hero', 'group', 'rhythm', 'cta'],
        properties: {
          hero: { type: 'string', enum: [...AI_SITE_IMPORT_PLAN_HEROES] },
          group: { type: 'string', enum: ['cards', 'ruled', 'icons'] },
          rhythm: { type: 'string', enum: ['alternate', 'plain'] },
          cta: { type: 'string', enum: ['band', 'photo'] },
        },
      },
      proposed: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'slug', 'purpose'],
        properties: { title: { type: 'string' }, slug: { type: 'string' }, purpose: { type: 'string' } },
      },
      roles: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['page', 'role'],
          properties: { page: { type: 'string' }, role: { type: 'string', enum: [...AI_SITE_IMPORT_PAGE_ROLES] } },
        },
      },
    },
  },
}

/** What a plan is told, cached: every site shares these bytes. */
export const AI_SITE_IMPORT_PLAN_TEXT = [
  "You plan the new website of a small business from what its existing website says. You are its information architect and art director: a visitor should find what they came for in one or two clicks, and the whole site should read as one confident design. The site's old menu is often just its pages in the order they were made. Reorganize it around what a visitor of this kind of business looks for. Answer with submit_site_plan.",
  '',
  'site: what is one plain sentence saying what the business does; audience is one short phrase saying who it serves; kind is the kind of site this is; voice is a few plain words on how its writing sounds.',
  '',
  'nav: the menu, the header\'s main button and the footer.',
  `- groups are the menu, at most ${AI_SITE_IMPORT_PLAN_MAX_GROUPS} top-level entries, in the order a visitor needs them. An entry with one page is a link under that label; an entry with several is a menu of them under the label. Pages are named by id, as the page list gives them. Group like pages under a clear label rather than listing them all; never put the home page in the menu, since the logo goes home.`,
  '- Every page the page list marks "in the menu" must stay reachable: in the menu or the footer. A policy page belongs in the footer.',
  '- cta is the header\'s one filled button: the one thing a visitor of this business most wants to do. label is its words; target is a page by id, form for the page holding the site\'s form, or phone for the phone number the site gives. Only what the page list says exists.',
  '- The page the main button goes to is never also a menu entry of its own: the button is its link. Put it in the footer.',
  '- footer is its columns, each a short heading over the pages it links: two to four where there are pages enough, and one where the site has two or three pages, so the footer is never empty.',
  `- Every label is short, at most ${AI_SITE_IMPORT_PLAN_LABEL_MAX_CHARS} characters, plain and in sentence case, so a capital reads as a name.`,
  '',
  'design: how every page of the site is drawn, chosen once for the whole site from what it is and what it shows. hero: cover, a full-bleed photo with the words over it; poster, the same, taller and centered; split, the words beside a tall photo; bleed, half the band a photo; editorial, display type with a wide photo boxed under it; column, the words centered in a narrow column with a photo boxed under them; panel, the words on a card over a photo. Where the site opens on a wide photo of its work, its place or its people, lay the words over it (cover, poster, panel) or beside it (split, bleed); keep editorial and column for a site with no such photo. Choose a photo-led hero only where the site has photos worth it. group: how a set of services or reasons is drawn: cards, ruled columns, or icons. rhythm: alternate grounds between sections, or plain, one ground with space between. cta: the closing call to action on a strong band, or over a photo.',
  '',
  `roles: what each page of the list is for in the new site, by id, one of ${AI_SITE_IMPORT_PAGE_ROLES.join(', ')}: home for the home page; service for a page about what the business offers; contact for a page whose purpose is reaching it or booking; other where none fits. Every page redesigns to its role, so name each one.`,
  '',
  'proposed: at most one new page the site lacks and a visitor of this kind of business looks for, such as common questions or how it works, named new in the menu or footer wherever it belongs. Propose one only where the request says there is room, and only what you can write without inventing a fact. title is at most 60 characters; slug is its address in lowercase words and hyphens; purpose is one sentence on what it tells a visitor. No page to propose: write all three as "".',
  '',
  'Never write a name, number, price, date, testimonial, client, award, credential, address or guarantee the site does not give.',
].join('\n')

/** A plan's system blocks: the platform's text, cached across sites. The site's own words ride the user turn. */
export function aiSiteImportPlanInstructions(): readonly AiSystemBlock[] {
  return [{ text: UNTRUSTED_TEXT_RULE }, { text: AI_SITE_IMPORT_PLAN_TEXT, cacheBreakpoint: true }]
}

/*------------------------------------------
 * What the answer is told
 *-----------------------------------------*/

/** The most characters of a site's own words the answer is told, about the site and about its pages. */
const SITE_MAX_CHARS = 6_000
const PAGES_MAX_CHARS = 12_000
/** The headings a page's line names. */
const HEADINGS_PER_PAGE = 8

/** What one page tells the plan: its id, title, address, words and headings, and what it holds. */
function pageLine(page: AiSiteImportPage, required: ReadonlySet<string>): string {
  const blocks = page.read?.blocks ?? []
  const headings = blocks.flatMap((block) => (block.kind === 'heading' && block.text.trim() ? [clean(block.text)] : [])).slice(0, HEADINGS_PER_PAGE)
  const marks = [
    ...(required.has(page.draftId) ? ['in the menu'] : []),
    ...(page.read?.forms?.length ? ['holds a form'] : []),
    ...(aiSiteImportPageIsLegal(page) ? ['a policy'] : []),
    ...(page.group !== 'main' ? [`in ${page.group}`] : []),
  ]
  return `${page.draftId} | ${page.slug === '/' ? 'home' : `/${page.slug}`} | ${clean(page.title)} | ${(page.read?.words ?? page.words).toLocaleString('en-US')} words${marks.length ? ` | ${marks.join(', ')}` : ''}${headings.length ? ` | headings: ${headings.join('; ')}` : ''}`
}

/** The pages a plan may name: every page the import brings in and can link. */
export function aiSiteImportPlanPages(state: Pick<AiSiteImportState, 'pages'>): AiSiteImportPage[] {
  return state.pages.filter((page) => !page.refused)
}

/** A plan's user turn: what the site says of itself and its pages, fenced as the owner's data, and whether there is room for a new page. */
export function aiSiteImportPlanPrompt(input: { state: Pick<AiSiteImportState, 'pages' | 'home' | 'siteName' | 'domain'>; required: readonly string[]; roomForPage: boolean }): string {
  const { state } = input
  const home = state.home ?? null
  const required = new Set(input.required)
  const phones = home?.facts.phones ?? []
  const said = [
    `Name: ${clean(home?.siteName) || clean(state.siteName)}`,
    home?.title ? `Title: ${clean(home.title)}` : '',
    home?.description ? `Description: ${clean(home.description)}` : '',
    ...(home?.facts.lines ?? []),
    phones.length ? `Phone: ${phones[0]}` : '',
  ].filter(Boolean)
  return [
    fenceUntrustedText(`What ${state.domain} says of itself`, said.join('\n'), { maxChars: SITE_MAX_CHARS }),
    'The page list, one a line: id | address | title | words | what it holds | headings.',
    fenceUntrustedText('The pages', aiSiteImportPlanPages(state).map((page) => pageLine(page, required)).join('\n'), { maxChars: PAGES_MAX_CHARS }),
    input.roomForPage ? 'There is room for one new page.' : 'There is no room for a new page: write proposed as "".',
    phones.length ? 'The site gives a phone number.' : 'The site gives no phone number: target may not be phone.',
  ].join('\n')
}

/*------------------------------------------
 * The answer held
 *-----------------------------------------*/

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const invented = (message: string): AiDoctrineViolation => ({ rule: 14, code: AI_SITE_IMPORT_INVENTED_FACT_CODE, message })
const dropped = (message: string): AiDoctrineViolation => ({ rule: null, code: AI_SITE_IMPORT_DROPPED_ITEM_CODE, message })
const unusable = (message: string): AiDoctrineViolation => ({ rule: null, code: 'site-plan-unusable', message })

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})

/** A list of groups, as an answer gives them. */
function groupsOf(value: unknown): Array<{ label: string; pages: string[] }> {
  return (Array.isArray(value) ? value : []).map((entry) => {
    const group = record(entry)
    return { label: clean(group['label']), pages: (Array.isArray(group['pages']) ? group['pages'] : []).map(clean).filter(Boolean) }
  })
}

/*------------------------------------------
 * The answer mended, where the mend is mechanical (AGL-4152)
 *-----------------------------------------*/

type AiSiteImportPlanGroup = { label: string; pages: string[] }

const trimSlashes = (path: string): string => path.replace(/^\/+|\/+$/g, '')

/**
 * An entry as a page's id (AGL-4152): an id, or `new`, as written; else the
 * one page whose address or exact title it is. One that names no page, or
 * several, stays as written for the check to name.
 */
export function aiSiteImportPlanPageIdOf(pages: readonly AiSiteImportPage[]): (entry: string) => string {
  return (entry) => {
    if (entry === AI_SITE_IMPORT_PROPOSED_PAGE || pages.some((page) => page.draftId === entry)) return entry
    const address = trimSlashes(entry).toLowerCase()
    const title = entry.toLowerCase()
    const hits = pages.filter((page) => trimSlashes(page.slug).toLowerCase() === address || trimSlashes(page.path).toLowerCase() === address || clean(page.title).toLowerCase() === title)
    return hits.length === 1 && hits[0] ? hits[0].draftId : entry
  }
}

/** Whether a link of the old menu goes to this page: its host (www or not) and its path. */
function linksTo(href: string | null | undefined, page: AiSiteImportPage): boolean {
  if (!href) return false
  try {
    const own = new URL(page.url)
    const url = new URL(href, own)
    const host = (value: string) => value.toLowerCase().replace(/^www\./, '')
    return host(url.host) === host(own.host) && trimSlashes(decodeURIComponent(url.pathname)) === trimSlashes(page.path)
  } catch {
    return false
  }
}

/** The heading of the old menu's dropdown that held a page, in the site's own words, or `''`. */
function oldMenuHeadingOf(page: AiSiteImportPage, home: AiSiteImportState['home']): string {
  const group = (home?.nav?.items ?? []).find((item) => item.items.length > 0 && item.items.some((entry) => linksTo(entry.href, page)))
  return clean(group?.label)
}

/** How alike two pages are, for the footer column a page joins: both policies, the same section of the site, the same group of the import. */
function likeness(page: AiSiteImportPage, other: AiSiteImportPage | undefined): number {
  if (!other) return 0
  const section = (entry: AiSiteImportPage) => trimSlashes(entry.path).split('/')[0]?.toLowerCase() ?? ''
  return (
    (aiSiteImportPageIsLegal(page) && aiSiteImportPageIsLegal(other) ? 2 : 0) +
    (section(page) && section(page) === section(other) ? 2 : 0) +
    (page.group !== 'main' && page.group === other.group ? 1 : 0)
  )
}

/** What a plan's menu and footer are mended against. */
export interface AiSiteImportPlanMendScope {
  pages: readonly AiSiteImportPage[]
  /** The pages the old menu reached, which must stay reachable. */
  required: readonly string[]
  /** Whether the answer proposes a new page. */
  proposes: boolean
  home: AiSiteImportState['home']
  siteName: string
}

/**
 * A page the new menu left unreachable, put in the footer (AGL-4152): in the
 * column whose pages are most like it, else a new column under the heading the
 * old menu held it under, else the first column. A footer with no column takes
 * one headed by the site's name. Every heading is the site's own words; none
 * is made up, and one over the label's length is not taken.
 */
function placeInFooter(footer: AiSiteImportPlanGroup[], page: string, input: AiSiteImportPlanMendScope): void {
  const of = (id: string) => input.pages.find((entry) => entry.draftId === id)
  const self = of(page)
  const heading = self ? oldMenuHeadingOf(self, input.home) : ''
  let best = -1
  let bestScore = 0
  footer.forEach((column, index) => {
    const score = (heading && column.label.toLowerCase() === heading.toLowerCase() ? 3 : 0) + (self ? column.pages.reduce((sum, other) => sum + likeness(self, of(other)), 0) : 0)
    if (score > bestScore) {
      best = index
      bestScore = score
    }
  })
  const fits = (label: string) => !!label && label.length <= AI_SITE_IMPORT_PLAN_LABEL_MAX_CHARS
  if (best >= 0) footer[best]?.pages.push(page)
  else if (fits(heading)) footer.push({ label: heading, pages: [page] })
  else if (footer[0]) footer[0].pages.push(page)
  else {
    const name = clean(input.home?.siteName) || clean(input.siteName)
    if (fits(name)) footer.push({ label: name, pages: [page] })
  }
}

/**
 * A plan's menu and footer mended where the mend is mechanical and cannot
 * change what the answer meant (AGL-4152), before it is held, so an answer
 * that needs only these costs no re-ask:
 *
 *   - an entry written as a page's address or exact title reads as its id;
 *   - a page named twice in one entry is named once;
 *   - the home page leaves the menu (the logo goes home), and the new page
 *     leaves every entry where none is proposed;
 *   - an entry that then links no page is dropped;
 *   - a page of the old menu, or the new page, that the answer left
 *     unreachable joins the footer (`placeInFooter`).
 *
 * Nothing is mended in what the answer says: a label, a line, a button, or a
 * page that is none of the site's stands as written, for the check to name.
 */
export function aiSiteImportPlanMended(
  nav: { groups: readonly AiSiteImportPlanGroup[]; footer: readonly AiSiteImportPlanGroup[] },
  input: AiSiteImportPlanMendScope,
): { groups: AiSiteImportPlanGroup[]; footer: AiSiteImportPlanGroup[] } {
  const ids = new Set(input.pages.map((page) => page.draftId))
  const homeIds = new Set(input.pages.filter((page) => page.slug === '/').map((page) => page.draftId))
  const idOf = aiSiteImportPlanPageIdOf(input.pages)
  const tidy = (list: readonly AiSiteImportPlanGroup[], menu: boolean) =>
    list
      .map((group) => ({
        label: group.label,
        pages: [...new Set(group.pages.map(idOf))].filter((page) => (page !== AI_SITE_IMPORT_PROPOSED_PAGE || input.proposes) && !(menu && homeIds.has(page))),
      }))
      .filter((group) => group.pages.length > 0)
  const groups = tidy(nav.groups, true)
  const footer = tidy(nav.footer, false)
  const placed = new Set([...groups, ...footer].flatMap((group) => group.pages))
  const missing = [
    ...new Set(input.required.filter((page) => ids.has(page) && !homeIds.has(page) && !placed.has(page))),
    ...(input.proposes && !placed.has(AI_SITE_IMPORT_PROPOSED_PAGE) ? [AI_SITE_IMPORT_PROPOSED_PAGE] : []),
  ]
  for (const page of missing) placeInFooter(footer, page, input)
  return { groups, footer }
}

/**
 * Why a plan did not pass, line by line (AGL-4152): each miss's code and the
 * line it names, as a redesign's (`aiSiteImportRedesignWhy`), for the job's
 * record (`planMissedWhy`). The log names its codes alone.
 */
export function aiSiteImportPlanWhy(violations: readonly AiDoctrineViolation[]): string[] {
  return aiSiteImportRedesignWhy(violations)
}

/** What the job's record says of a plan the model declined: there are no lines to name. */
export const AI_SITE_IMPORT_PLAN_REFUSED_WHY = 'refused: the model declined to plan the site.'

/** What a plan is held to. */
export interface AiSiteImportPlanScope {
  state: Pick<AiSiteImportState, 'pages' | 'home' | 'siteName'>
  /** Every line the import read of the site: what its words may say. */
  scope: readonly string[]
  /** The pages the old menu reached, which must stay reachable. */
  required: readonly string[]
  roomForPage: boolean
}

/** Every line of a site's first wave a plan's words are held to, with the page's own titles. */
export function aiSiteImportPlanScopeLines(state: Pick<AiSiteImportState, 'pages'>, siteLines: readonly string[]): string[] {
  const read = state.pages.flatMap((page) => [page.title, ...(page.read?.blocks ?? []).flatMap((block) => (block.kind === 'image' ? [] : block.text.trim() ? [block.text] : []))])
  return [...siteLines, ...read].map(clean).filter(Boolean)
}

/**
 * A plan's answer read and held (AGL-4152): a plan to store, or what it broke,
 * each named for the one re-ask. Its words are the honesty validator's: no name
 * or fact the site does not give, in any label or line.
 */
export function aiSiteImportPlanRead(raw: unknown, input: AiSiteImportPlanScope): { plan: AiSiteImportPlan | null; violations: AiDoctrineViolation[] } {
  const answer = record(raw)
  const site = record(answer['site'])
  const nav = record(answer['nav'])
  const cta = record(nav['cta'])
  const design = record(answer['design'])
  const proposedRaw = record(answer['proposed'])
  const out: AiDoctrineViolation[] = []
  const pages = aiSiteImportPlanPages(input.state)
  const ids = new Set(pages.map((page) => page.draftId))
  const homeIds = new Set(pages.filter((page) => page.slug === '/').map((page) => page.draftId))

  const title = clean(proposedRaw['title'])
  const slug = clean(proposedRaw['slug'])
  const purpose = clean(proposedRaw['purpose'])
  const proposes = !!(title || slug || purpose)
  // Mended first, where the mend is mechanical: an answer that needs only that is no re-ask.
  const { groups, footer } = aiSiteImportPlanMended(
    { groups: groupsOf(nav['groups']), footer: groupsOf(nav['footer']) },
    { pages, required: input.required, proposes, home: input.state.home, siteName: input.state.siteName },
  )
  if (proposes) {
    if (!input.roomForPage) out.push(unusable('proposed: there is no room for a new page on this plan. Write title, slug and purpose as "".'))
    if (!title || !purpose) out.push(unusable('proposed: a new page needs its title and its purpose, or all three written as "".'))
    if (title.length > AI_SITE_IMPORT_PLAN_TITLE_MAX_CHARS) out.push(unusable(`proposed: its title is over ${AI_SITE_IMPORT_PLAN_TITLE_MAX_CHARS} characters.`))
    if (!SLUG.test(slug)) out.push(unusable('proposed: its slug is lowercase words and hyphens only.'))
    else if (pages.some((page) => page.slug === slug || page.path.replace(/^\/+|\/+$/g, '') === slug)) out.push(unusable(`proposed: /${slug} is already a page of this site. Choose another address, or propose no page.`))
    if (pages.some((page) => clean(page.title).toLowerCase() === title.toLowerCase())) out.push(unusable(`proposed: "${title.slice(0, 60)}" is already a page of this site.`))
  }

  const entry = (name: string, page: string) => {
    if (page === AI_SITE_IMPORT_PROPOSED_PAGE) {
      if (!proposes) out.push(unusable(`${name}: it names the new page, and proposed is empty.`))
    } else if (!ids.has(page)) out.push(unusable(`${name}: "${page.slice(0, 40)}" is not a page of this site. Name pages by the ids the page list gives.`))
  }
  if (!groups.length) out.push(unusable('nav.groups: a menu needs at least one entry.'))
  if (groups.length > AI_SITE_IMPORT_PLAN_MAX_GROUPS) out.push(unusable(`nav.groups: at most ${AI_SITE_IMPORT_PLAN_MAX_GROUPS} top-level entries.`))
  for (const [where, list] of [['nav.groups', groups], ['nav.footer', footer]] as const) {
    list.forEach((group, index) => {
      const name = `${where}[${index}]`
      if (!group.label) out.push(unusable(`${name}: it needs a label.`))
      if (group.label.length > AI_SITE_IMPORT_PLAN_LABEL_MAX_CHARS) out.push(unusable(`${name}: "${group.label.slice(0, 40)}" is over ${AI_SITE_IMPORT_PLAN_LABEL_MAX_CHARS} characters.`))
      if (!group.pages.length) out.push(unusable(`${name}: it links no page.`))
      for (const page of group.pages) entry(name, page)
    })
  }
  groups.forEach((group, index) => {
    if (group.pages.some((page) => homeIds.has(page))) out.push(unusable(`nav.groups[${index}]: the home page is not in the menu: the logo goes home.`))
  })
  const placed = new Set([...groups, ...footer].flatMap((group) => group.pages))
  for (const page of input.required) {
    if (!placed.has(page) && !homeIds.has(page)) {
      const named = pages.find((other) => other.draftId === page)?.title ?? page
      out.push(dropped(`"${named.slice(0, 60)}" is in the old menu and nowhere in the new one. Put it in the menu or the footer.`))
    }
  }
  if (proposes && !placed.has(AI_SITE_IMPORT_PROPOSED_PAGE)) out.push(dropped('The new page is linked from nowhere. Put new in the menu or the footer.'))

  // The header's one filled button goes somewhere real.
  const ctaLabel = clean(cta['label'])
  const written = clean(cta['target'])
  // A page written by its address or title is that page, as in the menu.
  const target = written === 'form' || written === 'phone' || !written ? written : aiSiteImportPlanPageIdOf(pages)(written)
  let ctaPage: string | undefined
  if (!ctaLabel || !target) out.push(unusable('nav.cta: the header needs its main button, with its words and where it goes.'))
  else {
    if (ctaLabel.length > AI_SITE_IMPORT_PLAN_LABEL_MAX_CHARS) out.push(unusable(`nav.cta: "${ctaLabel.slice(0, 40)}" is over ${AI_SITE_IMPORT_PLAN_LABEL_MAX_CHARS} characters.`))
    if (target === 'form') {
      ctaPage = pages.find((page) => page.read?.forms?.some((form) => form.fields.length))?.draftId
      if (!ctaPage) out.push(unusable('nav.cta: no page of this site holds a form. Send the button to a page, or to phone.'))
    } else if (target === 'phone') {
      if (!input.state.home?.facts.phones.length) out.push(unusable('nav.cta: the site gives no phone number. Send the button to a page.'))
    } else if (target !== AI_SITE_IMPORT_PROPOSED_PAGE || !proposes) entry('nav.cta', target)
  }

  const kind = clean(site['kind'])
  if (!AI_SITE_KINDS.some((entry) => entry.id === kind)) out.push(unusable('site.kind: one of the kinds the tool lists.'))
  const what = clean(site['what'])
  const audience = clean(site['audience'])
  if (!what || !audience) out.push(unusable('site: what and audience are each a line, never empty.'))
  const hero = AI_SITE_IMPORT_PLAN_HEROES.find((value) => value === design['hero'])
  const group = (['cards', 'ruled', 'icons'] as const).find((value) => value === design['group'])
  const rhythm = (['alternate', 'plain'] as const).find((value) => value === design['rhythm'])
  const closing = (['band', 'photo'] as const).find((value) => value === design['cta'])
  if (!hero || !group || !rhythm || !closing) out.push(unusable('design: hero, group, rhythm and cta are each one of the values the tool lists.'))

  // Every word held to what the site says.
  const held = aiSiteImportHonestyFacts(input.scope)
  const contacts = input.scope.join(' \n ')
  const lines = [
    ['site.what', what],
    ['site.audience', audience],
    ['site.voice', clean(site['voice'])],
    ['nav.cta', ctaLabel],
    ...groups.map((entry, index) => [`nav.groups[${index}]`, entry.label] as const),
    ...footer.map((entry, index) => [`nav.footer[${index}]`, entry.label] as const),
    ['proposed.title', title],
    ['proposed.purpose', purpose],
  ] as const
  for (const [where, text] of lines) {
    if (!text) continue
    const reason = aiSiteImportInventedIn(text, held)
    if (reason) out.push(invented(`${where}, "${text.slice(0, 80)}": ${reason}`))
    else if (aiLayoutGuardContacts(text, contacts) !== text) out.push(invented(`${where}, "${text.slice(0, 80)}": it gives a phone number or email the site does not.`))
  }
  if (out.length || !hero || !group || !rhythm || !closing) return { plan: null, violations: out }
  // What each page is for (AGL-4152): a role it does not know, or a page that is none of the site's, is left to the page.
  const roles: Record<string, AiSiteImportPageRole> = {}
  for (const entry of Array.isArray(answer['roles']) ? answer['roles'] : []) {
    const named = record(entry)
    const page = clean(named['page'])
    const role = AI_SITE_IMPORT_PAGE_ROLES.find((value) => value === named['role'])
    if (role && (ids.has(page) || (page === AI_SITE_IMPORT_PROPOSED_PAGE && proposes))) roles[page] = role
  }
  // A button that asks to be contacted goes to the page for that, whatever page the answer named (AGL-4152).
  const ctaTarget = aiSiteImportCtaTarget({ label: ctaLabel, target }, roles)
  return {
    plan: {
      site: { what, audience, kind, voice: clean(site['voice']) },
      nav: { groups, primaryCta: { label: ctaLabel, target: ctaTarget, ...(ctaPage ? { page: ctaPage } : {}) }, footer },
      design: { hero, group, rhythm, cta: closing },
      proposed: proposes ? { title, slug, purpose, on: true } : null,
      ...(Object.keys(roles).length ? { roles } : {}),
    },
    violations: [],
  }
}

/**
 * Words on a button that ask a visitor to reach the business (AGL-4152):
 * contact, get in touch, a quote or estimate, a booking or appointment, a
 * call, a talk, a consultation, an enquiry, a message.
 */
const CONTACT_WORDS =
  /\b(?:contact|get in touch|in touch|reach (?:us|out)|quotes?|estimates?|book(?:ing)?|schedule|appointments?|call|talk|consult(?:ation)?s?|enquir(?:e|y|ies)|inquir(?:e|y|ies)|message|write to us|email us)\b/i

/** Whether a button's words ask to be contacted. */
export function aiSiteImportAsksContact(label: string): boolean {
  return CONTACT_WORDS.test(label)
}

/**
 * Where the header's button goes (AGL-4152): where the answer sends it, except
 * that a button whose words ask to be contacted, sent to a page whose role is
 * not `contact` while a page of that role exists, goes to that page. A
 * "Contact us" to the About page took the visitor somewhere else than its
 * words said, and the menu, leaving a lone entry to the button's page, then
 * lost About altogether. The phone and the form are contact already.
 */
export function aiSiteImportCtaTarget(cta: { label: string; target: string }, roles: Readonly<Record<string, AiSiteImportPageRole>>): string {
  if (cta.target === 'phone' || cta.target === 'form' || !aiSiteImportAsksContact(cta.label)) return cta.target
  if (roles[cta.target] === 'contact') return cta.target
  const contact = Object.keys(roles).find((page) => roles[page] === 'contact')
  return contact ?? cta.target
}

/** A plan's check, answer by answer, for the one re-ask. */
export function aiSiteImportPlanCheck(input: AiSiteImportPlanScope): AiGenerationCheck<AiSiteImportPlan> {
  return (answer) => {
    const { plan, violations } = aiSiteImportPlanRead(answer, input)
    return plan ? { value: plan, violations: [] } : { value: null, violations }
  }
}

/*------------------------------------------
 * The answer asked
 *-----------------------------------------*/

/** The most tokens a plan's answer asks, with its thinking. */
export const AI_SITE_IMPORT_PLAN_MOST_TOKENS = 4_000

/** The least time a plan's pass needs: its answer and its one re-ask on the page step's tier. */
export const AI_SITE_IMPORT_PLAN_BUDGET = aiJobStepBudget({ tier: AI_STEP_TIERS['job.page'], maxTokens: AI_SITE_IMPORT_PLAN_MOST_TOKENS })

/** The ceiling a plan is asked at on this model. */
export function aiSiteImportPlanMaxTokens(model: string): number {
  return aiGenerationMaxTokensWithin({ model, budgetMs: AI_SITE_IMPORT_PLAN_BUDGET.minimumMs, cap: AI_SITE_IMPORT_PLAN_MOST_TOKENS, lookups: 0 })
}

/** The one plan a generative Improve it asks for, on the page step's tier. */
export async function aiRunSiteImportPlan(input: AiSiteImportPlanScope & { state: Pick<AiSiteImportState, 'pages' | 'home' | 'siteName' | 'domain'>; model: string; signal?: AbortSignal }): Promise<AiValidatedGeneration<AiSiteImportPlan>> {
  return runValidatedGeneration<AiSiteImportPlan>(AI_SITE_IMPORT_PLAN_KIND, {
    step: 'job.page',
    model: input.model,
    instructions: aiSiteImportPlanInstructions(),
    messages: [{ role: 'user', content: aiSiteImportPlanPrompt({ state: input.state, required: input.required, roomForPage: input.roomForPage }) }],
    tool: AI_SITE_IMPORT_PLAN_TOOL,
    maxTokens: aiSiteImportPlanMaxTokens(input.model),
    cutOff: { noun: 'plan', smaller: 'Write shorter lines.' },
    ...AI_LAYOUT_LANGUAGE_THINKING,
    check: aiSiteImportPlanCheck(input),
    ...(input.signal ? { signal: input.signal } : {}),
  })
}
