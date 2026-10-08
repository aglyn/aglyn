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

import { aiSiteKind } from './ai-site-kinds'
import {
  AI_BUILD_PLAN_CREATION_NOUNS,
  aiPlanUndeclaredRefs,
  type AiBuildPlan,
  type AiBuildPlanCreateKind,
} from './ai-build-plan'
import { AI_JOB_CREATE_KINDS } from './ai-job-creations'
import { AI_PAGE_CREATE_KINDS } from './ai-page-job'

/**
 * What a site scaffold is (AGL-2911): the inputs a `site` job is admitted
 * with, the plans a scaffold can build, and what one is estimated to cost
 * before it starts.
 *
 * A scaffold is the one job kind that builds a whole site rather than one
 * record: a plan of four to eight screens, the layout they render inside,
 * the contact form they place, a palette suggestion, and — where the email
 * step is loaded — a welcome email. It builds each of those through the job
 * kind that already owns it, so this module describes what a scaffold may
 * ask for and refuses the rest at confirmation, before a credit is spent,
 * naming what to make first.
 *
 * ── The estimate is the guard rail ───────────────────────────────────────
 *
 * A scaffold is tens of model calls, where every other kind is a few, so the
 * member reads what it will cost before they confirm the plan that spends
 * it. The figure is the machine's own nominal credits per step multiplied by
 * the passes the plan implies — an estimate, and said to be one wherever it
 * is shown.
 *
 * This module imports nothing at runtime, so the doors, the step, the batch
 * card and the plan proposal read one vocabulary.
 */

/** How many pages a scaffold builds: enough to be a site, few enough to read. */
export const AI_SITE_PAGES = { min: 4, max: 8 } as const

/**
 * How many pages a Free workspace's scaffold builds (AGL-3594): its home page
 * and the one page the brief most needs. A product decision, not a figure the
 * wall derives — the wall's proof (`jobs/ai-job-free-site.spec.ts`) shows a
 * plan and a build of this many pages fit the Free taste with room for one
 * retried page.
 */
export const AI_SITE_FREE_PAGES = { min: 1, max: 2 } as const

/** The pages a scaffold builds for a workspace on the Free taste or on a paid plan. */
export function aiSitePagesBand(
  freeTaste: boolean | null | undefined,
): { readonly min: number; readonly max: number } {
  return freeTaste ? AI_SITE_FREE_PAGES : AI_SITE_PAGES
}

/**
 * The job input a guided site start sets so its plan is confirmed for it
 * (AGL-3594); `jobs/ai-job-auto-confirm.ts` says where it is honored.
 */
export const AI_JOB_AUTO_CONFIRM_INPUT = 'autoConfirm'

/** What a Free site start's page selector says under it (AGL-3594). */
export const AI_SITE_FREE_PAGES_NOTE = 'Paid plans can generate more pages.'

/**
 * The plan's answer ceiling for a scaffold (AGL-3594), Free and paid. A plan
 * is an outline — each page's title, address, search listing and sections by
 * name — and the build steps write everything else, so a scaffold plans with
 * no thinking and at a ceiling sized to the outline of its largest band with
 * room to spare: about 300 tokens a page. The 13,491-token plan a Free site
 * spent 227 of its 300 credits on was its thinking, at the routing table's
 * 8,000 a call.
 */
export const AI_SITE_PLAN_MAX_TOKENS = { free: 2_000, paid: 4_000 } as const

/** What each exchange of a Free site job comes to at its worst, in credits. */
export interface AiFreeSiteWorstCase {
  /** The site plan: its answer and its one re-ask, each at its ceiling. */
  plan: number
  /** The site's look (AGL-3660): its one answer at its ceiling, on the fast tier. */
  look: number
  /**
   * The layout a site with none has built first (AGL-3660): its header and
   * footer as ONE answer in the layout language, writing its cached prefix,
   * at the most a live frame answer wrote, and never under what the live
   * guided start's layout step metered.
   */
  layout: number
  /** The saved form a guided start makes (AGL-3596), at what the live guided start's form step metered. */
  form: number
  /**
   * A language page's answer before its sections (AGL-3660): its cached
   * prefix written, its turn, and the whole room its ceiling keeps for
   * thinking. A page is ONE answer, not a pass a section.
   */
  page: number
  /** Each planned section's words in that answer, at the most a section is written in. */
  section: number
  /**
   * Room for one page asked again: the answer once more, reading its cached
   * prefix, with its thinking room and a full page of sections.
   */
  retry: number
  /** A page's listing. */
  listing: number
}

/**
 * The Free site start's wall at its worst (AGL-3594, re-derived for the
 * layout language in AGL-3660): the plan and the look as
 * `jobs/ai-job-free-site.spec.ts` derives them from their requests at their
 * ceilings; the layout, form and pages from the language requests as they
 * stand, priced as each field says. The spec fails when a figure it derives
 * moves and this does not.
 */
export const AI_FREE_SITE_WORST_CASE_CREDITS: Readonly<AiFreeSiteWorstCase> = {
  plan: 35,
  look: 7,
  layout: 23,
  form: 29,
  page: 43,
  section: 4,
  retry: 64,
  listing: 3,
}

/**
 * The most sections a Free site plans across its pages (AGL-3660), whatever
 * the wall leaves: a full home of five and a page of two or three. A product
 * figure, so the spend a site EXPECTS stays near what it measured; the wall
 * proves it fits.
 */
export const AI_FREE_SITE_MAX_SECTIONS = 8

/** What a Free site start builds before its sections: the layouts it builds first, its forms and its pages. */
export interface AiFreeSiteCreations {
  layouts: number
  pages: number
  /** The saved forms it makes; a guided start makes one where it places a form. */
  forms: number
}

/** A Free site start's credits at its worst for this many sections, its room for one retried page included. */
export function aiFreeSiteWorstCaseCredits(
  creations: AiFreeSiteCreations,
  sections: number,
  credits: Readonly<AiFreeSiteWorstCase> = AI_FREE_SITE_WORST_CASE_CREDITS,
): number {
  const pages = Math.max(1, Math.floor(creations.pages))
  return (
    credits.plan +
    credits.look +
    creations.layouts * credits.layout +
    creations.forms * credits.form +
    pages * (credits.page + credits.listing) +
    sections * credits.section +
    credits.retry
  )
}

/**
 * The most sections a Free site's plan fits in the Free taste at its worst,
 * across all its pages (AGL-3660): the plan, the look, the layout and form it
 * builds first, each page's answer and listing, ROOM FOR ONE RETRIED PAGE,
 * and as many sections as the rest pays for — at most
 * `AI_FREE_SITE_MAX_SECTIONS`, and at most what the pages hold. None when the
 * rest is already past the wall.
 */
export function aiFreeSiteSectionsWithin(
  creations: AiFreeSiteCreations,
  taste: number,
  credits: Readonly<AiFreeSiteWorstCase> = AI_FREE_SITE_WORST_CASE_CREDITS,
): number {
  const pages = Math.max(1, Math.floor(creations.pages))
  const before = aiFreeSiteWorstCaseCredits(creations, 0, credits)
  if (before > taste) return 0
  const paid = credits.section > 0 ? Math.floor((taste - before) / credits.section) : Number.POSITIVE_INFINITY
  return Math.min(AI_FREE_SITE_MAX_SECTIONS, pages * AI_SITE_MAX_SECTIONS, paid)
}

/** Sections a Free site's page is assumed to hold before its plan names them. */
export const AI_FREE_SITE_NOMINAL_SECTIONS = 4

/**
 * About what a Free site start of this many pages costs at its worst, in
 * credits, for the dialog that asks for one: the plan, its look, the layout
 * and form a new site builds, each page's answer and listing, and its
 * sections at the nominal count, from the figures the wall is proven with
 * rather than the nominal credits a paid estimate counts. No retry room: the
 * dialog says what a start costs, not what the wall holds back.
 */
export function aiFreeSiteCreditEstimate(
  pages: number,
  credits: Readonly<AiFreeSiteWorstCase> = AI_FREE_SITE_WORST_CASE_CREDITS,
): number {
  const count = Math.max(1, Math.floor(pages))
  return (
    aiFreeSiteWorstCaseCredits({ layouts: 1, forms: 1, pages: count }, count * AI_FREE_SITE_NOMINAL_SECTIONS, credits) -
    credits.retry
  )
}

/**
 * What a Free workspace has left of its Free AI credits this month: the less
 * of its own band's balance and its owner's, since the owner's allowance is
 * shared by every Free workspace they hold (AGL-2925) and the reservation
 * refuses at whichever wall is reached first. `resetsOn` is the UTC day the
 * month — and with it both balances — rolls over, `YYYY-MM-DD`.
 */
export interface AiFreeCreditsLeft {
  left: number
  total: number
  resetsOn: string
}

/** The first UTC day of the month after `now`, `YYYY-MM-DD`: when the Free credits come back. */
export function aiFreeCreditsResetOn(now: Date): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return next.toISOString().slice(0, 10)
}

/** A reset day as a person reads it: "November 1". */
export function aiFreeCreditsResetLabel(resetsOn: string): string {
  const at = new Date(`${resetsOn}T00:00:00.000Z`)
  return Number.isFinite(at.getTime())
    ? at.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
    : 'the first of next month'
}

/**
 * The credits a Free site start needs and does not have (AGL-3660), or `null`
 * when what is left covers it — or when nothing is known about what is left,
 * since the reservation still refuses at the wall. The figure is the one the
 * dialog quotes (`aiFreeSiteCreditEstimate`), so the number a person is shown
 * is the number they are held to.
 */
export function aiFreeSiteShortfall(
  credits: Pick<AiFreeCreditsLeft, 'left'> | null | undefined,
  pages: number,
): { needed: number; left: number } | null {
  if (!credits || !Number.isFinite(credits.left)) return null
  const needed = aiFreeSiteCreditEstimate(pages)
  const left = Math.max(0, Math.floor(credits.left))
  return left < needed ? { needed, left } : null
}

/** Why a Free site start is refused before it spends: what is left, when it comes back, and the way on. */
export function aiFreeSiteShortfallText(
  shortfall: { needed: number; left: number },
  resetsOn: string,
): string {
  const left = shortfall.left === 1 ? '1 is' : `${shortfall.left.toLocaleString('en-US')} are`
  return (
    `Building this site can take up to about ${shortfall.needed.toLocaleString('en-US')} AI credits, ` +
    `and only ${left} left of your free AI credits this month. They are shared by all your Free ` +
    `workspaces and reset on ${aiFreeCreditsResetLabel(resetsOn)}. Upgrade this workspace to build ` +
    'your site now, or start from the starter site and try AI again after the reset.'
  )
}

/**
 * The most sections one scaffolded page may hold. The plan model allows more
 * for a page job, which builds one page; a scaffold builds eight, and each
 * section is a pass of its own.
 */
export const AI_SITE_MAX_SECTIONS = 8

/**
 * The fewest sections a site start's home page is planned with (AGL-3660).
 * A new site is a full website (Zach, 2026-10-04): its home reads as one — a
 * hero, then bands such as the offer, why us, social proof, and a closing
 * call to action. A plan is an outline and nothing asked for more than a
 * ceiling, so a live Free yoga start (2026-10-07) planned its home with two
 * sections. The plan step names this count in the plan's turn and re-asks a
 * first answer whose home is under it (`aiSiteThinHomeViolations`).
 */
export const AI_SITE_HOME_MIN_SECTIONS = 5

/**
 * The blog a paid guided start writes its first posts into (AGL-3676), and
 * the addresses it may answer at, in order of preference: the first one no
 * planned page takes.
 */
export const AI_SITE_BLOG_NAME = 'Blog'
export const AI_SITE_BLOG_SLUGS = ['blog', 'posts', 'journal', 'articles', 'writing', 'stories'] as const

/** A planned page's first path segment, lower-cased: `/journal/2026` → `journal`. */
const firstSegment = (slug: string) => slug.trim().replace(/^\/+/, '').split('/')[0].toLowerCase()

/** The address the blog answers at, beside these planned pages: the first of `AI_SITE_BLOG_SLUGS` none of them takes. */
export function aiSiteBlogSlug(screens: ReadonlyArray<{ slug: string }>): string {
  const taken = new Set(screens.map((screen) => firstSegment(screen.slug)).filter(Boolean))
  return AI_SITE_BLOG_SLUGS.find((slug) => !taken.has(slug)) ?? AI_SITE_BLOG_SLUGS[0]
}

/** The header's link to the blog (AGL-3660): a path, not a page, since the blog is the posts collection. */
export const AI_SITE_BLOG_NAV_ID = 'aiSiteBlog'

/** The nav entry a site whose start writes posts links its blog by. */
export function aiSiteBlogNavPage(screens: ReadonlyArray<{ slug: string }>): {
  id: string
  label: string
  slug: string
  href: string
} {
  const slug = aiSiteBlogSlug(screens)
  return { id: AI_SITE_BLOG_NAV_ID, label: AI_SITE_BLOG_NAME, slug: `/${slug}`, href: `/${slug}` }
}

/** The code a planned page that stands in for the written blog is re-asked under. */
export const AI_SITE_BLOG_PAGE_CODE = 'plan-blog-page-duplicate'

/** A page's name that says it lists the posts. */
const BLOG_PAGE_WORDS = /\b(blog|posts?|articles?|journal|writing|stories|news)\b/i

/**
 * A site plan's pages that stand in for the blog its start writes (AGL-3660):
 * the live Slow Roads start (2026-10-08) planned an "Articles" page of
 * featured cards beside the posts it wrote at /blog, and the header linked
 * Articles and never the blog. A page whose address is one of the blog's, or
 * whose name says it lists posts, duplicates it; the home page never does.
 */
export function aiSiteBlogStandInViolations(
  plan: Pick<AiBuildPlan, 'screens'>,
): Array<{ rule: null; code: string; message: string; paths: string[] }> {
  const blogSlugs = new Set<string>(AI_SITE_BLOG_SLUGS)
  const standIns = plan.screens.flatMap((screen, index) => {
    if (aiSitePlanIsHome(screen)) return []
    const segment = firstSegment(screen.slug)
    return blogSlugs.has(segment) || BLOG_PAGE_WORDS.test(screen.title) ? [{ screen, index }] : []
  })
  if (!standIns.length) return []
  const names = standIns.map(({ screen }) => `"${screen.title}" at ${screen.slug}`).join(', ')
  return [
    {
      rule: null,
      code: AI_SITE_BLOG_PAGE_CODE,
      message: `${names} ${standIns.length === 1 ? 'stands' : 'stand'} in for the blog this site already gets: its first posts are written at /blog, and the header links it. Take ${standIns.length === 1 ? 'that page' : 'those pages'} out, and plan another page the brief needs, or feature the posts in a section of the home page.`,
      paths: standIns.map(({ index }) => `screens[${index}]`),
    },
  ]
}

/** The code a site plan's work section planned without its pieces is re-asked under. */
export const AI_SITE_EMPTY_GALLERY_CODE = 'plan-empty-gallery'

/** The pieces a section that shows the work is planned with (AGL-3660). */
export const AI_SITE_GALLERY_MIN_ITEMS = 3
export const AI_SITE_GALLERY_MAX_ITEMS = 6

/**
 * A planned section that shows the work: a gallery, a portfolio, a
 * collection, selected or featured work. "Galleries" — an audience, as in
 * "Why galleries choose us" — and "how we work" are not.
 */
const GALLERY_SECTION =
  /\b(gallery|portfolio|collections?|lookbook|showcase|works|projects|(?:selected|featured|recent|our|past) (?:work|pieces|projects))\b/i

/** A section that only opens, introduces or closes a page, whatever page it is on: "Portfolio Hero". */
const FRAMING_SECTION = /\b(hero|intro(?:duction)?|banner|header|cta|call to action|contact|inquiry|enquiry|about)\b/i

/** Whether a planned section's name says it shows the work. */
export function aiSiteSectionShowsWork(name: string): boolean {
  return GALLERY_SECTION.test(name) && !FRAMING_SECTION.test(name)
}

/** The sentence a site plan's turn states about a section that shows the work. */
export const AI_SITE_GALLERY_SENTENCE = `A section that shows the work — a gallery, portfolio, collection or selected works — counts its pieces in its items: ${AI_SITE_GALLERY_MIN_ITEMS} to ${AI_SITE_GALLERY_MAX_ITEMS}.`

/**
 * A site plan's sections that show the work with fewer than three pieces
 * (AGL-3660). The live Juniper Clay start (2026-10-08) planned its Portfolio
 * page's "Works Gallery" with no items, and the page's works lost their place
 * to an inquiry form: a page about the work showed none.
 */
export function aiSiteEmptyGalleryViolations(
  plan: Pick<AiBuildPlan, 'screens'>,
): Array<{ rule: null; code: string; message: string; paths: string[] }> {
  const thin = plan.screens.flatMap((screen, screenIndex) =>
    screen.sections.flatMap((section, sectionIndex) =>
      aiSiteSectionShowsWork(section.name) && section.items < AI_SITE_GALLERY_MIN_ITEMS
        ? [{ name: `"${section.name}" on ${screen.title}`, path: `screens[${screenIndex}].sections[${sectionIndex}].items` }]
        : [],
    ),
  )
  if (!thin.length) return []
  const names = thin.map((entry) => entry.name).join(', ')
  return [
    {
      rule: null,
      code: AI_SITE_EMPTY_GALLERY_CODE,
      message: `${names} ${thin.length === 1 ? 'shows' : 'show'} the work with fewer than ${AI_SITE_GALLERY_MIN_ITEMS} pieces. Plan ${thin.length === 1 ? 'it' : 'each'} with ${AI_SITE_GALLERY_MIN_ITEMS} to ${AI_SITE_GALLERY_MAX_ITEMS} items, one for each piece it shows.`,
      paths: thin.map((entry) => entry.path),
    },
  ]
}

/** The violation a site plan whose home page is under its fewest sections is re-asked under. */
export const AI_SITE_THIN_HOME_CODE = 'plan-thin-home'

/** What a site plan's home is composed of, in the words the plan's turn and its re-ask both use. */
export const AI_SITE_HOME_BANDS =
  'a hero first, then bands such as services or the offer, about or why us, and testimonials or other social proof, and a closing call to action or contact band last'

/**
 * The fewest sections this site start's home is held to (AGL-3660): five, or
 * 0 — no minimum — where the Free wall cannot pay for a full home beside the
 * other pages. `across` is the sections the Free taste fits across `pages`
 * pages, each other page keeping at least one; `null` is a paid start, which
 * no wall shares out.
 *
 * ⛔ NEVER a lowered minimum. A Free guided start creates its site empty and
 * plans its layout, and the wall then fits 4 sections across two pages. Told
 * "a home of at least 3" beside that, the live yoga start of 2026-10-08
 * planned 4 + 3 and then 4 + 2, was refused for the wall twice, and stopped:
 * a home asked for in bands the wall cannot pay for is a start that fails.
 */
export function aiSiteHomeMinSections(input: { pages: number; across: number | null }): number {
  if (input.across === null) return AI_SITE_HOME_MIN_SECTIONS
  const others = Math.max(0, Math.floor(input.pages) - 1)
  return input.across - others >= AI_SITE_HOME_MIN_SECTIONS ? AI_SITE_HOME_MIN_SECTIONS : 0
}

/**
 * What a site start's plan is told to BUILD with (AGL-3660): the sections are
 * a budget to use, never a ceiling to stay under. Told only "at most 8", the
 * live prod start of 2026-10-08 planned a home of two sections, and Zach: "that
 * didn't mean do as little as possible." On the Free taste the sentence shares
 * the wall's sections out — a home of five or six, the other page two or
 * three, about seven or eight in all; a paid start's home is asked to be rich.
 * `min` is the home's fewest (`aiSiteHomeMinSections`), 0 where the plan
 * plans no home or the wall cannot pay for a full one.
 */
export function aiSiteFullPlanSentence(input: { pages: number; across: number | null; min: number }): string {
  const { across, min } = input
  if (across === null) {
    return min > 0
      ? `Plan a full website, never a minimal one: a rich home page of ${min + 1} or more sections where the brief gives them, and every page with the sections it needs.`
      : 'Plan a full website, never a minimal one: every page with the sections it needs.'
  }
  const lead = `The ${across} sections are the budget to use, not a ceiling to stay under: plan a full website, never a minimal one`
  const others = Math.max(0, Math.floor(input.pages) - 1)
  if (min <= 0 || across < min) return `${lead}.`
  const homeHi = Math.max(min, Math.min(min + 1, across - others))
  if (!others) return `${lead}: the home page at / with ${min} to ${homeHi} sections.`
  const otherHi = Math.max(1, Math.min(3, Math.floor((across - min) / others)))
  const otherLo = Math.max(1, Math.min(2, otherHi, Math.floor((across - homeHi) / others)))
  const totalLo = Math.max(min + others, across - 1)
  const range = (lo: number, hi: number) => (lo === hi ? `${lo}` : `${lo} to ${hi}`)
  const pagesWord = others === 1 ? 'the other page' : 'each other page'
  return `${lead}: the home page at / with ${range(min, homeHi)} sections, ${pagesWord} ${range(otherLo, otherHi)}, about ${range(totalLo, across)} in total.`
}

/** Whether a planned page is the site's home: the one at `/`. */
export function aiSitePlanIsHome(screen: { slug: string }): boolean {
  const slug = screen.slug.trim()
  return slug === '/' || slug === ''
}

/**
 * A site plan's home page under its fewest sections (AGL-3660), as the plan
 * step's re-ask names it. A plan with no page at `/` — the owner's own home
 * stays — has no home to hold. `across` is the Free wall's section count, so
 * the re-ask says where the sections come from rather than tripping the wall.
 */
export function aiSiteThinHomeViolations(
  plan: Pick<AiBuildPlan, 'screens'>,
  options: { min: number; across: number | null },
): Array<{ rule: null; code: string; message: string; paths: string[] }> {
  const index = plan.screens.findIndex(aiSitePlanIsHome)
  if (index < 0) return []
  const count = plan.screens[index].sections.length
  if (count >= options.min) return []
  const within =
    options.across === null
      ? ''
      : ` Keep the whole plan within ${options.across} sections: take them from the other page where you must.`
  return [
    {
      rule: null,
      code: AI_SITE_THIN_HOME_CODE,
      message: `The home page has ${count} ${count === 1 ? 'section' : 'sections'}, and a new site's home page reads as a full website with at least ${options.min}: ${AI_SITE_HOME_BANDS}.${within}`,
      paths: [`screens[${index}].sections`],
    },
  ]
}

/**
 * Sections a page is assumed to hold before a plan names them, for the
 * estimate a member reads when they ask for a scaffold. A declared
 * assumption, not a measurement: the plan's own section counts replace it
 * the moment the plan exists.
 */
export const AI_SITE_NOMINAL_SECTIONS = 5

/**
 * The credits one pass is held against: the machine's
 * `AI_JOB_STEP_RESERVE_CREDITS`, declared here so the estimate stays a pure
 * number the console computes without the Admin SDK. `ai-site-job.spec.ts`
 * holds the two equal.
 */
export const AI_SITE_PASS_CREDITS = 50

/** The longest a scaffold's scalar inputs may run; they are names, not copy. */
export const AI_SITE_INPUT_MAX_CHARS = 120

/** The sites one agency batch may generate for in one request. */
export const AI_SITE_BATCH_MAX = 25

/**
 * The sites a plan must hold before the org Sites page offers the batch at
 * all: the Agency and Advanced bands, which the plan's `hostLimit` is what
 * distinguishes.
 */
export const AI_SITE_BATCH_MIN_HOST_LIMIT = 25

export interface AiSiteJobInputs {
  /** What the business is, in a few words: the brief's subject. */
  businessType: string
  /**
   * Who the site is for, in a few words (AGL-2918); empty when nobody said.
   * The plan step puts it in front of the model on a line of its own, as it
   * does every other scalar here, so it narrows the pages a plan proposes
   * without a prompt of its own.
   */
  audience: string
  /**
   * The starter site whose shape the person liked (AGL-2918), by its
   * `STARTER_TEMPLATES` id; empty when they picked none.
   *
   * A hint carried as the id rather than the starter, because an id is what
   * the guided start's list, this door and the plan's line all agree on
   * without any of them loading a catalog of node maps. Unrecognized ids are
   * admitted for the same reason an unrecognized business type is: it is a
   * few words in a brief, not a lookup.
   */
  starter: string
  /**
   * The kind of site the person picked (AGL-3660), by its `AI_SITE_KINDS`
   * id; empty when nobody picked one, and the business type suggests it.
   * It sets the look the site is designed in and how its pages are arranged.
   */
  siteKind: string
  /** How many pages the member asked for. */
  pages: number
  /** The per-site variables an agency batch varies; empty when none was given. */
  businessName: string
  city: string
  brand: string
  /** Whether the scaffold also drafts a welcome email. */
  welcomeEmail: boolean
  /**
   * Where the contact form's submissions go (AGL-2918); `null` where nobody
   * said, which is every job created before the question existed and every
   * door that does not ask it.
   *
   * The one setting a new site owner actually needs made, and the one thing
   * about a contact form a model cannot know: whether a submission is a note
   * to read or a lead to chase is a decision about how the business runs. So
   * an answer BINDS the form step rather than hinting to it, and `null`
   * leaves the model's own proposal standing, exactly as it stood before.
   */
  submissions: AiSiteSubmissions | null
  /** The batch this job was created under (AGL-2911); `null` for a single site. */
  batchId: string | null
}

/**
 * Where a site's contact form sends what a visitor writes.
 *
 * Two, not three. The form step's own vocabulary has a third — a mailing
 * list — which it can only answer with a note, because the stored routing has
 * no place for a list; offering it as a question would be asking somebody to
 * pick an outcome the platform then explains it cannot store.
 */
export const AI_SITE_SUBMISSIONS = ['inbox', 'lead'] as const

export type AiSiteSubmissions = (typeof AI_SITE_SUBMISSIONS)[number]

/**
 * What each answer to "where do submissions go" is called, and what it means.
 *
 * Here rather than beside the guided start's own questions, because it is not
 * only the guided start that asks: the agency batch asks the same thing of a
 * whole run (AGL-2918), and two surfaces wording one decision two ways is two
 * decisions. `ai-site-job.spec.ts` holds the list to {@link AI_SITE_SUBMISSIONS}.
 */
export const AI_SITE_SUBMISSION_CHOICES: ReadonlyArray<{
  id: AiSiteSubmissions
  label: string
  blurb: string
}> = [
  {
    id: 'inbox',
    label: 'The Inbox',
    blurb: 'Every message is one to read and reply to.',
  },
  {
    id: 'lead',
    label: 'The Inbox, and CRM as a lead',
    blurb: 'Every message with an email address is also somebody to follow up.',
  },
]

/**
 * Which kind of email a scaffold's email unit is (AGL-2918), carried on the
 * derived job as `inputs.emailType`. The email step names the kind on the one
 * line it puts above the brief, and a scaffold was naming none.
 *
 * A key of the email step's own `AI_EMAIL_TYPES`, held here because neither
 * step may import the other: a scaffold delegates by job kind, and a
 * deployment that scaffolds is not necessarily one that has loaded the email
 * step. `ai-job-email-step.spec.ts` holds this key to that catalog.
 *
 * `reply` and not `welcome`. The five kinds a member picks are campaigns
 * somebody sends to an audience, and this is an answer to one person who
 * wrote in through the site; the nearest, `welcome`, is a label about signing
 * up, and a kind that misdescribes the email is worse than an absent one
 * because it is the first thing the model is told.
 */
export const AI_SITE_EMAIL_TYPE = 'reply'

/**
 * What a site job's plan and every unit it builds are told about the
 * business's name (AGL-3596): that it is the name, used as written. Said on
 * the job's own turn, never in a cached system block, because it is one
 * site's. A model handed only what the business does named it itself —
 * "Hillside Dog Grooming" was built as "Austin Paws Grooming".
 */
export function aiSiteNameSentence(name: string): string {
  return `The business is named “${name}”: the site names it exactly that way, in the header, the footer, the copy and the search listing, and never by any other name.`
}

/** Where a job's inputs say submissions go, or `null` where they do not say. */
export function aiSiteSubmissions(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): AiSiteSubmissions | null {
  const value = inputs?.['submissions']
  return (AI_SITE_SUBMISSIONS as readonly unknown[]).includes(value)
    ? (value as AiSiteSubmissions)
    : null
}

const ID_CHARS = /^[A-Za-z0-9_-]{1,64}$/

/** A scaffold's inputs, or the sentence the door refuses them with. */
export function parseAiSiteJobInputs(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): AiSiteJobInputs | string {
  const text = (key: string): string | null => {
    const value = inputs?.[key]
    if (value === undefined || value === null || value === '') return ''
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > AI_SITE_INPUT_MAX_CHARS ? null : trimmed
  }
  const businessType = text('businessType')
  if (businessType === null) {
    return `businessType must be text under ${AI_SITE_INPUT_MAX_CHARS} characters`
  }
  if (!businessType) return 'Say what kind of business the site is for'
  const businessName = text('businessName')
  const city = text('city')
  const brand = text('brand')
  const audience = text('audience')
  const starter = text('starter')
  // A kind this deployment does not know is nobody having picked one.
  const siteKind = aiSiteKind(inputs?.['siteKind'])?.id ?? ''
  for (const [key, value] of [
    ['businessName', businessName],
    ['city', city],
    ['brand', brand],
    ['audience', audience],
    ['starter', starter],
  ] as const) {
    if (value === null)
      return `${key} must be text under ${AI_SITE_INPUT_MAX_CHARS} characters`
  }
  const rawPages = inputs?.['pages']
  const pages =
    typeof rawPages === 'number' ? rawPages : Number(rawPages ?? NaN)
  // Read here across both bands; the door holds a workspace to its own
  // (`aiSitePagesRefusal`), since only it knows the workspace's plan.
  if (
    !Number.isInteger(pages) ||
    pages < AI_SITE_FREE_PAGES.min ||
    pages > AI_SITE_PAGES.max
  ) {
    return `pages must be a whole number from ${AI_SITE_FREE_PAGES.min} to ${AI_SITE_PAGES.max}`
  }
  // Where submissions go is admitted only as one of the two the form step
  // can actually bind; anything else is nobody having said, and the model
  // proposes as it always did rather than the door refusing the whole job.
  const submissions = aiSiteSubmissions(inputs)
  const rawBatch = inputs?.['batchId']
  const batchId =
    rawBatch === undefined || rawBatch === null || rawBatch === ''
      ? null
      : typeof rawBatch === 'string' && ID_CHARS.test(rawBatch)
        ? rawBatch
        : undefined
  if (batchId === undefined) return 'batchId is not a batch id'
  return {
    businessType,
    audience: audience as string,
    starter: starter as string,
    siteKind,
    pages,
    businessName: businessName as string,
    city: city as string,
    brand: brand as string,
    welcomeEmail: inputs?.['welcomeEmail'] !== false,
    submissions,
    batchId,
  }
}

/**
 * Why a workspace cannot ask for this many pages (AGL-3594), in a sentence a
 * member reads; `null` when it can. A Free workspace builds one or two, and a
 * paid one four to eight, as it always has. Refused rather than clamped: the
 * guided start offers only the band, so a request outside it was not made
 * there, and a job quietly building fewer pages than it was asked for is a
 * worse answer than a sentence saying why.
 */
export function aiSitePagesRefusal(pages: number, freeTaste: boolean | null | undefined): string | null {
  const band = aiSitePagesBand(freeTaste)
  if (pages >= band.min && pages <= band.max) return null
  return freeTaste
    ? `A Free workspace's AI site start builds ${AI_SITE_FREE_PAGES.min} or ${AI_SITE_FREE_PAGES.max} pages. ${AI_SITE_FREE_PAGES_NOTE}`
    : `A site is planned with ${band.min} to ${band.max} pages.`
}

/**
 * What the site itself is, as a step that is NOT the scaffold reads it off a
 * job's inputs (AGL-2918).
 *
 * A scaffold delegates unit by unit under a job derived from its own — a page
 * job, a form job — and the derived job carries the scaffold's inputs. So the
 * two answers that describe the site rather than one record of it are
 * readable by every delegated step, and a step that wants them does not have
 * to know it was delegated to.
 *
 * Lenient where {@link parseAiSiteJobInputs} is strict, because it reads the
 * inputs of jobs that are not scaffolds: a page job started from the Screens
 * page has no `businessType` and no `pages`, and that is not an error here —
 * it is a site nobody described, and the answer is two empty strings.
 */
export interface AiSiteWords {
  /** What kind of site it is; empty when the job's inputs do not say. */
  about: string
  /** Who it is for; empty when the job's inputs do not say. */
  audience: string
}

/** Whether either half of {@link AiSiteWords} says anything. */
export function aiSiteWordsSaidAnything(words: AiSiteWords): boolean {
  return Boolean(words.about || words.audience)
}

/** What a job's inputs say the site is, read defensively and trimmed to the input ceiling. */
export function aiSiteWords(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): AiSiteWords {
  const read = (key: string): string => {
    const value = inputs?.[key]
    if (typeof value !== 'string') return ''
    return value.replace(/\s+/g, ' ').trim().slice(0, AI_SITE_INPUT_MAX_CHARS).trim()
  }
  return { about: read('businessType'), audience: read('audience') }
}

/**
 * What a scaffold builds for itself: the layout its pages render inside, the
 * form they place, and the palette suggestion a member applies in the Theme
 * section. Anything else a plan asks to create is a job of its own.
 */
export const AI_SITE_CREATE_KINDS: readonly AiBuildPlanCreateKind[] = [
  'layout',
  'form',
  'theme-change',
]

/** The creations a scaffold cannot build, in the order the plan lists them, each named once. */
export function aiSitePlanPrerequisites(
  plan: AiBuildPlan,
): Array<{ kind: AiBuildPlanCreateKind; name: string }> {
  const seen = new Set<string>()
  const prerequisites: Array<{ kind: AiBuildPlanCreateKind; name: string }> = []
  const add = (kind: AiBuildPlanCreateKind, name: string) => {
    const key = `${kind}:${name.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    prerequisites.push({ kind, name })
  }
  for (const entry of plan.create) {
    if (!AI_SITE_CREATE_KINDS.includes(entry.kind)) add(entry.kind, entry.name)
  }
  // A reference the create list does not carry is refused by the plan rules
  // before a plan is kept: rule 2 for a screen's layout, rule 7 for anything
  // else (`plan-creation-undeclared`, AGL-3040). A plan confirmed before that
  // rule existed can still carry one. It is named as a component: the
  // reference carries no kind, and the refusal must say where one is made.
  for (const { name } of aiPlanUndeclaredRefs(plan)) add('component', name)
  return prerequisites
}

/**
 * Why a scaffold cannot build a plan of this SHAPE — the page band, a page's
 * sections, its addresses, its navigation — in a sentence a member reads;
 * `null` when the shape is one it builds. The plan step holds a plan to it
 * with a re-ask (AGL-3030), and the doors hold a confirmed plan to it again
 * through `aiSitePlanRefusal`.
 */
export function aiSitePlanShapeRefusal(
  plan: AiBuildPlan,
  options: { freeTaste?: boolean } = {},
): string | null {
  const { screens } = plan
  const band = aiSitePagesBand(options.freeTaste)
  if (screens.length < band.min || screens.length > band.max) {
    return `This plan builds ${screens.length} ${screens.length === 1 ? 'page' : 'pages'}, and ${
      options.freeTaste ? "a Free workspace's site scaffold" : 'a site scaffold'
    } builds ${band.min} to ${band.max}. Describe the site again.`
  }
  const slugs = new Set<string>()
  for (const screen of screens) {
    if (!screen.sections.length) {
      return `The page “${screen.title}” has no sections to build. Describe the site again.`
    }
    if (screen.sections.length > AI_SITE_MAX_SECTIONS) {
      return `The page “${screen.title}” has ${screen.sections.length} sections, and a scaffolded page holds ${AI_SITE_MAX_SECTIONS}. Describe the site again.`
    }
    const slug = screen.slug.trim().toLowerCase()
    if (slugs.has(slug)) {
      return `Two pages in this plan share the address ${screen.slug}. Describe the site again.`
    }
    slugs.add(slug)
  }
  if (!screens.some((screen) => screen.nav)) {
    return 'No page in this plan is in the site navigation. Describe the site again.'
  }
  return null
}

/**
 * Why a scaffold cannot build this plan, in a sentence a member reads when
 * confirming it; `null` when it can.
 */
export function aiSitePlanRefusal(
  plan: AiBuildPlan,
  options: { freeTaste?: boolean } = {},
): string | null {
  const shape = aiSitePlanShapeRefusal(plan, options)
  if (shape) return shape
  const prerequisites = aiSitePlanPrerequisites(plan)
  if (!prerequisites.length) return null
  const parts = prerequisites.map(
    ({ kind, name }) =>
      `the ${AI_BUILD_PLAN_CREATION_NOUNS[kind].noun} “${name}” ${AI_BUILD_PLAN_CREATION_NOUNS[kind].where}`,
  )
  const listed =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `This site needs what the workspace does not have yet. Create ${listed}, then describe the site again.`
}

/** What the estimate counts a plan in: whether a welcome email follows, and the creations the job builds. */
export interface AiPlanPassOptions {
  welcomeEmail?: boolean
  /** The creation kinds the job builds itself; a scaffold's when absent. */
  creates?: readonly AiBuildPlanCreateKind[]
}

/**
 * The passes a plan implies: one per section of every screen, one more per
 * screen for its search listing and its draft, and one for each thing the
 * plan creates that the job builds. What the estimate is counted in.
 */
export function aiPlanPasses(plan: AiBuildPlan, options: AiPlanPassOptions = {}): number {
  const screens = plan.screens.reduce(
    (total, screen) => total + screen.sections.length + 1,
    0,
  )
  const creates = options.creates ?? AI_SITE_CREATE_KINDS
  const creations = plan.create.filter((entry) => creates.includes(entry.kind)).length
  return screens + creations + (options.welcomeEmail ? 1 : 0)
}

/**
 * About what a plan costs to build, in credits. An ESTIMATE: the nominal
 * credits the machine holds per step, times the passes the plan implies.
 * What each pass actually costs is its model's tokens, recorded on the job
 * as it runs.
 */
export function aiPlanCreditEstimate(plan: AiBuildPlan, options: AiPlanPassOptions = {}): number {
  return aiPlanPasses(plan, options) * AI_SITE_PASS_CREDITS
}

/**
 * About what a job of this kind costs to build from its plan (AGL-3031): a
 * page job counts the layout, forms and components it builds before its
 * page; a template, layout, component, form or email job counts its own
 * record and every creation it builds before it (AGL-3143 §15); and a
 * scaffold counts what it builds. The figure the proposal shows beside
 * Confirm, and the hold a confirmation takes.
 */
export function aiJobPlanCreditEstimate(kind: string, plan: AiBuildPlan): number {
  const creates =
    kind === 'page' ? AI_PAGE_CREATE_KINDS : AI_JOB_CREATE_KINDS[kind as keyof typeof AI_JOB_CREATE_KINDS]
  return aiPlanCreditEstimate(plan, creates ? { creates } : {})
}

/**
 * About what a scaffold of this many pages costs, before a plan names its
 * sections: the same arithmetic on the nominal section count, plus the plan
 * step that proposes it. Shown where a member asks for a scaffold.
 */
export function aiSiteCreditEstimate(
  pages: number,
  options: { welcomeEmail?: boolean } = {},
): number {
  const screens = Math.max(0, Math.floor(pages))
  const passes =
    1 +
    screens * (AI_SITE_NOMINAL_SECTIONS + 1) +
    2 +
    (options.welcomeEmail ? 1 : 0)
  return passes * AI_SITE_PASS_CREDITS
}
