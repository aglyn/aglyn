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
 * The kinds of website a guided start offers (AGL-3660), and the style
 * direction each one sets.
 *
 * A kind is NOT a template. It is a direction in two halves:
 *
 *  - a LOOK FAMILY the code applies — how saturated the palette is, the hues
 *    that suit the kind, the page grounds, the font pairings, the corners,
 *    the button style, the heading scale and the density — inside which the
 *    model picks this business's own look and a per-job seed varies it
 *    (`ai-site-look.ts`), so two sites of one kind never share a theme;
 *  - GUIDANCE the model reads: how the kind's pages are usually arranged
 *    (band rhythm, image share, density) and which pages it usually has.
 *
 * Every page a kind suggests is one the site job builds itself out of the
 * layout language: sections, cards, images, a form. The site job also writes
 * a blog's first posts into a content collection (one on the Free taste,
 * AGL-3798) and, on a paid plan, a store's first products as unpriced drafts
 * (AGL-3676, `jobs/ai-job-site-content.ts`), and the pages are told their
 * titles. No event records are created, and no
 * guidance here promises posts, products or events, since the plan reads it
 * on every plan (the owner adds more from the Content, Commerce and Events
 * sections afterward).
 *
 * The kinds themselves (ids, labels, words and the classifier) and the font
 * pairings are the platform's since AGL-4049 (the core's `site-kinds.ts` and
 * `site-font-pairings.ts`), because a site starter is filed under the same
 * kinds; this module merges its look family and guidance over each kind by id
 * and keeps every name it always exported.
 *
 * Pure data and two small readers, safe for the console to import: no
 * theme compiler, no network.
 */

import { SITE_FONT_PAIRINGS, siteFontPairing, type SiteFontPairing } from '@aglyn/aglyn/app-utils/site-font-pairings'
import { SITE_KINDS, siteKindFor, type SiteKind } from '@aglyn/aglyn/app-utils/site-kinds'
import { SITE_THEME_BASES } from '@aglyn/aglyn/app-utils/site-starter'

/** A font pairing the look may choose: a heading family over a body family (`SiteFontPairing`). */
export type AiSiteFontPairing = SiteFontPairing

/** The pairings: the platform's list (AGL-4049), under the name the AI start always used. */
export const AI_SITE_FONT_PAIRINGS: readonly AiSiteFontPairing[] = SITE_FONT_PAIRINGS

export type AiSiteFontPairingId = string

/**
 * The platform's built-in themes a site's look is layered on, by the short
 * name of the themes plugin's preset id (\`theme-presets.<name>\`), and
 * \`starter\`: the theme a new site is born with (AGL-3497). The platform's
 * list since AGL-4049 (`SITE_THEME_BASES`), which a site starter names too.
 */
export const AI_SITE_BASES = SITE_THEME_BASES
export type AiSiteBase = (typeof AI_SITE_BASES)[number]

/** How saturated a kind's palette runs. `neutral` is an ink-and-paper ground with one accent. */
export type AiSiteChroma = 'neutral' | 'muted' | 'balanced' | 'vivid'
/** The page ground the light scheme sits on. */
export type AiSiteGround = 'white' | 'warm' | 'cool' | 'tinted'
export const AI_SITE_GROUNDS: readonly AiSiteGround[] = ['white', 'warm', 'cool', 'tinted']
/** Corner rounding, cards and fields. */
export type AiSiteCorners = 'sharp' | 'soft' | 'round' | 'pill'
export const AI_SITE_CORNERS: readonly AiSiteCorners[] = ['sharp', 'soft', 'round', 'pill']
/** How buttons are drawn: on the corner radius, as pills, square, in capitals, or with quiet buttons as underlined links. */
export type AiSiteButtons = 'rounded' | 'pill' | 'square' | 'caps' | 'link'
/**
 * How a site's pages alternate their bands: calm (mostly plain, one soft),
 * alternating (plain and soft by turns), or bold (brand and dark bands for
 * its key moments).
 */
export type AiSiteRhythm = 'calm' | 'alternating' | 'bold'
export const AI_SITE_RHYTHMS: readonly AiSiteRhythm[] = ['calm', 'alternating', 'bold']

/** Spacing: tighter, regular or airier than the platform's unit. */
export type AiSiteDensity = 'compact' | 'regular' | 'airy'

/** What the code applies for a kind: the bounds a look is chosen and varied in. */
export interface AiSiteLookFamily {
  /** The platform's base themes that suit the kind, best first (`AI_SITE_BASES`). */
  bases: readonly AiSiteBase[]
  chroma: AiSiteChroma
  /** How the header is arranged: the brand at the start with the links after it, or both centered. */
  headerAligns?: readonly ('start' | 'center')[]
  /** The band rhythm its pages lean to (`AI_SITE_RHYTHMS`). */
  rhythms?: readonly AiSiteRhythm[]
  /** Hue ranges in degrees that suit the kind, `[from, to]`, wrapping past 360. */
  hues: ReadonlyArray<readonly [number, number]>
  grounds: readonly AiSiteGround[]
  fonts: readonly AiSiteFontPairingId[]
  corners: readonly AiSiteCorners[]
  buttons: AiSiteButtons
  /** Display and heading sizes against the platform's, 1 = as shipped. */
  headingScale: number
  density: AiSiteDensity
}

/** A kind as the AI start reads it: the platform's kind with its look family and guidance. */
export interface AiSiteKind extends SiteKind {
  look: AiSiteLookFamily
  /** How its pages are arranged, as every page and the header and footer are told. */
  design: string
  /** The pages it usually has, as the plan is told. */
  pages: string
}

/** What the AI start adds to one kind. */
export type AiSiteKindLook = Pick<AiSiteKind, 'look' | 'design' | 'pages'>

const ALL_HUES: ReadonlyArray<readonly [number, number]> = [[0, 360]]

/**
 * What the AI start adds to each kind, by its id: the look family the code
 * applies and the guidance the model reads. Every kind in `SITE_KINDS` has
 * one, and nothing else does (`ai-site-kinds-core-parity.spec.ts`).
 */
export const AI_SITE_KIND_LOOKS: Readonly<Record<string, AiSiteKindLook>> = {
  business: {
    look: { bases: ['starter', 'material3', 'fluent', 'minimal', 'ant-design'], chroma: 'balanced', headerAligns: ['start', 'start', 'center'], hues: ALL_HUES, grounds: ['white', 'cool', 'warm', 'tinted'], fonts: ['jakarta', 'manrope', 'outfit', 'inter', 'bricolage', 'fraunces'], corners: ['soft', 'round'], buttons: 'rounded', headingScale: 1, density: 'regular' },
    design: 'Clear and confident: say plainly what the business does and for whom, draw what it offers as cards or a ruled list, and let a photo carry a section that describes the place or the work. Mix plain and soft bands with one brand band where the page most needs it. The first section opens beside a photo of the work or on a card over it: an eyebrow, a heading that says what the business does, one line and one or two buttons.',
    pages: 'Home, Services, About and Contact are typical; a pricing or booking page where the brief asks for one.',
  },
  trades: {
    look: { bases: ['bootstrap', 'carbon', 'material-ui', 'fluent', 'starter'], chroma: 'vivid', headerAligns: ['start'], hues: [[4, 18], [20, 38], [42, 56], [128, 158], [195, 212], [214, 240]], grounds: ['white', 'cool'], fonts: ['oswald', 'archivo', 'barlow', 'manrope'], corners: ['sharp', 'soft'], buttons: 'square', headingScale: 1.05, density: 'compact' },
    design: 'Direct and high-contrast: a big promise and a call-to-action button in the first section, services as a tight grid, trust only as the brief gives it (licensed, insured, years, guarantees), and short, practical copy. Use a dark band and a brand band. The first section opens over a full-bleed photo of the work, or beside one: a short promise as the heading, one practical line and the quote button first.',
    pages: 'Home, Services, About or Why us, and a Quote or Contact page with the form.',
  },
  professional: {
    look: { bases: ['carbon', 'fluent', 'minimal', 'starter'], chroma: 'muted', headerAligns: ['start', 'start', 'center'], hues: [[210, 250], [340, 360], [0, 15], [150, 175]], grounds: ['white', 'warm', 'cool'], fonts: ['baskerville', 'merriweather', 'editorial', 'plex', 'lora'], corners: ['sharp', 'soft'], buttons: 'rounded', headingScale: 0.95, density: 'airy' },
    design: 'Measured and credible: generous space, calm statements, practice areas with short plain explanations, and an unhurried tone with no hard sell. Prefer plain and soft bands, at most one dark band. The first section opens on a card over a photo of the office or the people, or as large type above a wide photo: a calm heading and one plain line.',
    pages: 'Home, Practice areas or Services, About or Our team, and Contact with a consultation form.',
  },
  wellness: {
    look: { bases: ['material3', 'cupertino', 'starter', 'fluent'], chroma: 'muted', headerAligns: ['center', 'start'], hues: [[150, 200], [250, 290], [20, 40], [90, 130]], grounds: ['warm', 'tinted', 'white'], fonts: ['lora', 'fraunces', 'quicksand', 'dmserif', 'nunito'], corners: ['round', 'pill'], buttons: 'pill', headingScale: 1, density: 'airy' },
    design: 'Reassuring and gentle: warm words that name who it helps, soft cards, answers in plain language, and a low-pressure tone in every call to action. Prefer soft bands, avoid dark ones. The first section opens with half the band a photo of a calm room, or as a centered heading above a wide photo: a gentle heading and one warm line.',
    pages: 'Home, Services or Approach, About, and Book or Contact with the form.',
  },
  restaurant: {
    look: { bases: ['material3', 'starter', 'cupertino'], chroma: 'balanced', headerAligns: ['center', 'center', 'start'], hues: [[0, 45], [80, 150], [330, 360]], grounds: ['warm', 'tinted'], fonts: ['fraunces', 'editorial', 'dmserif', 'garamond', 'bricolage'], corners: ['soft', 'round'], buttons: 'rounded', headingScale: 1.1, density: 'regular' },
    design: 'Photo-led and inviting: large images of the food and the room, the menu as lines rather than cards where it fits, and warm, sensory copy. Use images generously and a warm brand band. The first section opens with the name or the promise centered over a full-bleed photo of the room or the food, or beside one filling half the band: a few words, one line, the menu and visit buttons.',
    pages: 'Home, Menu, About or Our story, and Visit or Reserve with the form.',
  },
  store: {
    look: { bases: ['minimal', 'cupertino', 'material3'], chroma: 'balanced', headerAligns: ['start'], hues: ALL_HUES, grounds: ['white', 'warm'], fonts: ['inter', 'outfit', 'manrope', 'dmserif', 'syne'], corners: ['soft', 'sharp', 'round'], buttons: 'pill', headingScale: 1, density: 'regular' },
    design: 'A storefront, like a designer shop theme: a hero that sells, its picture the product itself and its first button Shop all; the bestsellers, which the platform lists with their photos, prices and add to cart; the range by collection as picture tiles; the brand story beside a photo; why buy here as three or four short items each with an icon (shipping, small batch, returns, only as the brief gives them); the store\'s customer reviews, which the platform shows once shoppers leave them; and a newsletter sign-up. Keep copy short and let images lead; never draw the products themselves as cards of your own, and never a band of text alone. The first section opens beside two pictures of the products, or one: what the shop sells in a short heading and its Shop all button first.',
    pages: 'Home as a storefront: a hero, then sections named "Bestsellers", "Shop by collection" (3 or 4 items), the story, why buy here (3 or 4 items) and "Customer reviews", in the order given above, with "Newsletter sign-up" last. Shop at /shop: a short title section, then "Product grid" second (the platform lists the real products there, with sort, filters, photos, prices and the cart). About, and Contact. Plan no checkout or cart page.',
  },
  portfolio: {
    look: { bases: ['minimal', 'cupertino', 'carbon'], chroma: 'neutral', headerAligns: ['start', 'center'], hues: ALL_HUES, grounds: ['white', 'warm'], fonts: ['inter', 'grotesk', 'syne', 'instrument'], corners: ['sharp', 'soft'], buttons: 'square', headingScale: 1.3, density: 'airy' },
    design: 'Minimal and image-led: a large, short statement as the title, the work as image cards with one-line captions, and very few words elsewhere. Mostly plain bands, lots of space, big type, one accent color. The first section opens as large type above a wide picture of the work, or beside two pieces: a short statement and a line about the work.',
    pages: 'Home with selected work, Work or Projects, About, and Contact.',
  },
  studio: {
    look: { bases: ['minimal', 'carbon', 'cupertino'], chroma: 'neutral', headerAligns: ['start'], hues: ALL_HUES, grounds: ['white', 'cool'], fonts: ['syne', 'grotesk', 'bricolage', 'inter'], corners: ['sharp', 'soft'], buttons: 'pill', headingScale: 1.3, density: 'airy' },
    design: 'Confident and editorial: oversized statements, case studies as large image cards with the outcome in a line, services as a short list, and a bold dark band where the page needs weight. The first section opens as an oversized statement above a wide picture of the work, or over a full-bleed one: a statement of a few words and a line about what the studio does.',
    pages: 'Home, Work or Case studies, Services, About, and Contact or Start a project.',
  },
  photography: {
    look: { bases: ['minimal', 'cupertino', 'carbon'], chroma: 'neutral', headerAligns: ['center', 'start'], hues: ALL_HUES, grounds: ['white', 'warm'], fonts: ['instrument', 'garamond', 'inter', 'grotesk'], corners: ['sharp'], buttons: 'square', headingScale: 1.2, density: 'airy' },
    design: 'Gallery-first: full images, galleries as image cards by subject, few words, packages only as the brief gives them. Many images, mostly plain bands and one dark band. The first section opens as large type above a wide photo, or with the words centered over a full-bleed one: a few words, and the booking button.',
    pages: 'Home, Galleries or Portfolio, About, and Book or Contact with the form.',
  },
  blog: {
    look: { bases: ['minimal', 'starter', 'cupertino'], chroma: 'muted', headerAligns: ['center', 'center', 'start'], hues: ALL_HUES, grounds: ['white', 'warm'], fonts: ['reading', 'editorial', 'instrument', 'lora'], corners: ['sharp', 'soft'], buttons: 'rounded', headingScale: 1.05, density: 'airy' },
    design: 'Reading-first: a narrow, calm measure, writing as cards with a title and a one-line summary, topics as a list, and a quiet, personal voice. Mostly plain bands. The first section opens as a centered masthead above the lead picture, or as large type above a wide one: the blog\'s name or promise and one line about what it covers.',
    pages: 'Home, Articles presenting the writing as cards, About, and Subscribe or Contact. Posts themselves are added in Data as a collection, so plan the articles page as an introduction and a few featured cards.',
  },
  events: {
    look: { bases: ['material3', 'cupertino', 'starter'], chroma: 'balanced', headerAligns: ['center', 'center', 'start'], hues: [[320, 360], [0, 30], [250, 290], [140, 170], [40, 55]], grounds: ['warm', 'tinted', 'white'], fonts: ['garamond', 'editorial', 'dmserif', 'anton', 'syne'], corners: ['soft', 'round'], buttons: 'pill', headingScale: 1.2, density: 'regular' },
    design: 'Celebratory and clear: the name and what it is in big type, when and where only as the brief gives them, the schedule as steps, and the details guests ask about as an FAQ. One brand band. The first section opens beside two pictures of the day, or with its name centered over a full-bleed photo: the name, what it is, and the main action.',
    pages: 'Home, Schedule or Details, Travel or Venue where the brief names one, and RSVP or Register with the form.',
  },
  fitness: {
    look: { bases: ['bootstrap', 'material-ui', 'carbon', 'material3'], chroma: 'vivid', headerAligns: ['start'], hues: [[0, 30], [90, 140], [180, 210], [270, 300]], grounds: ['white', 'cool'], fonts: ['barlow', 'anton', 'archivo', 'outfit'], corners: ['sharp', 'soft'], buttons: 'caps', headingScale: 1.15, density: 'compact' },
    design: 'High-energy: punchy headlines, strong buttons, classes or programs as cards and short, motivating copy. Use a dark band and a brand band. The first section opens with half the band a photo of training and a loud headline in the other, or over a full-bleed photo: a punchy heading, one line and the join button.',
    pages: 'Home, Classes or Programs, About or Coaches, and Join or Contact with the form.',
  },
  yoga: {
    look: { bases: ['material3', 'cupertino', 'starter', 'fluent'], chroma: 'muted', headerAligns: ['center', 'center', 'start'], hues: [[20, 50], [80, 150], [260, 300], [170, 200]], grounds: ['warm', 'tinted'], fonts: ['garamond', 'lora', 'quicksand', 'instrument', 'fraunces'], corners: ['round', 'pill'], buttons: 'pill', headingScale: 1.05, density: 'airy' },
    design: 'Calm and spacious: quiet headlines, classes as soft cards, gentle copy and lots of space. Soft bands, no dark band. The first section opens as a quiet centered heading above a wide photo of the space, or beside one: a calm heading and one gentle line.',
    pages: 'Home, Classes or Schedule, About, and Book or Contact with the form.',
  },
  beauty: {
    look: { bases: ['material3', 'cupertino', 'minimal'], chroma: 'balanced', headerAligns: ['center', 'start'], hues: [[320, 360], [0, 25], [270, 300], [20, 45]], grounds: ['warm', 'tinted', 'white'], fonts: ['garamond', 'dmserif', 'instrument', 'outfit', 'syne'], corners: ['round', 'pill', 'sharp'], buttons: 'pill', headingScale: 1.1, density: 'regular' },
    design: 'Stylish and image-led: striking images, services as a menu or cards, the look and feel of the place in pictures, and booking made obvious. One brand band. The first section opens beside two pictures of the work and the place, or with half the band one: a stylish heading, one line and the booking button.',
    pages: 'Home, Services, About or The team, and Book or Contact with the form.',
  },
  realestate: {
    look: { bases: ['fluent', 'minimal', 'carbon'], chroma: 'muted', headerAligns: ['start', 'start', 'center'], hues: [[200, 240], [150, 180], [20, 45], [0, 360]], grounds: ['white', 'warm', 'cool'], fonts: ['dmserif', 'manrope', 'editorial', 'outfit'], corners: ['soft', 'sharp'], buttons: 'rounded', headingScale: 1.05, density: 'regular' },
    design: 'Polished and local: image-led sections, the areas served by name only as the brief gives them, listings only as image cards the owner fills in, and confident, local copy. One dark band. The first section opens on a card over a full-bleed photo of a home, or under a scrim over one: a confident local heading, one line and the main action.',
    pages: 'Home, Buy or Listings, Sell, About, and Contact with the form.',
  },
  education: {
    look: { bases: ['material3', 'ant-design', 'material-ui'], chroma: 'balanced', headerAligns: ['start', 'start', 'center'], hues: [[200, 240], [140, 170], [30, 50], [260, 290]], grounds: ['white', 'tinted', 'cool'], fonts: ['nunito', 'outfit', 'jakarta', 'lora', 'manrope'], corners: ['round', 'soft'], buttons: 'rounded', headingScale: 1, density: 'regular' },
    design: 'Clear and encouraging: who it is for and the result they get in plain words, courses or subjects as cards, steps where something happens in order, and an FAQ where people have questions. The first section opens beside a photo of learning, or with a round photo of the teacher over the words: who it is for and the result, in a heading and one line.',
    pages: 'Home, Courses or Lessons, About or Teachers, and Enroll or Contact with the form.',
  },
  nonprofit: {
    look: { bases: ['material3', 'fluent', 'starter'], chroma: 'balanced', headerAligns: ['start', 'start', 'center'], hues: [[130, 200], [20, 45], [200, 230], [340, 360]], grounds: ['white', 'warm'], fonts: ['merriweather', 'lora', 'jakarta', 'fraunces', 'nunito'], corners: ['soft', 'round'], buttons: 'rounded', headingScale: 1.05, density: 'regular' },
    design: 'Mission-led: the cause in one strong line, what the organization does as cards, how to help as steps (volunteer, give, spread the word), and hopeful, concrete copy. A brand band for the call to help. The first section opens over a full-bleed photo of the people it serves, or beside two pictures: the cause in one strong line and the help button first.',
    pages: 'Home, Our work or Programs, About, and Get involved or Contact with the form.',
  },
  music: {
    look: { bases: ['carbon', 'minimal', 'material-ui'], chroma: 'vivid', headerAligns: ['center', 'start'], hues: ALL_HUES, grounds: ['white', 'cool', 'tinted'], fonts: ['anton', 'syne', 'grotesk', 'archivo'], corners: ['sharp'], buttons: 'caps', headingScale: 1.3, density: 'regular' },
    design: 'Loud and visual: the name huge, image bands, a listen section where the platform places a music player for the artist’s own tracks, releases or shows as image cards only as the brief gives them, and a short bio. Dark bands are welcome. Never name or link songs by other artists. The first section opens with the name huge over a full-bleed photo, set at the start or centered: the name, one line and the listen or shows button.',
    pages: 'Home, Music or Shows, About, and Booking or Contact with the form.',
  },
  personal: {
    look: { bases: ['minimal', 'cupertino', 'starter', 'fluent'], chroma: 'muted', headerAligns: ['center', 'start'], hues: ALL_HUES, grounds: ['white', 'warm', 'cool'], fonts: ['inter', 'instrument', 'manrope', 'lora', 'grotesk'], corners: ['soft', 'round'], buttons: 'rounded', headingScale: 1.1, density: 'airy' },
    design: 'Simple and personal: who the person is in one line, what they do in plain words, experience or highlights as a list or steps, selected work as cards where the brief names some. Mostly plain bands. The first section opens with a round portrait over the words, or as a centered heading above a wide photo: who the person is in one line and what they do.',
    pages: 'Home, About or Experience, Work where the brief names some, and Contact.',
  },
  landing: {
    look: { bases: ['material3', 'minimal', 'ant-design'], chroma: 'vivid', headerAligns: ['start', 'center'], hues: ALL_HUES, grounds: ['white', 'cool', 'tinted'], fonts: ['outfit', 'jakarta', 'manrope', 'bricolage', 'inter'], corners: ['round', 'soft'], buttons: 'pill', headingScale: 1.15, density: 'regular' },
    design: 'One action: a strong promise and the call to action in the first section, benefits as cards, how it works as steps, objections answered as an FAQ, and the call to action repeated. A brand band where the page asks. The first section opens with the promise centered above a wide picture of the offer, or over a full-bleed photo: a strong promise, one line and the call to action.',
    pages: 'One long home page carries the story; a second page only for the form or details the brief asks for.',
  },
  'coming-soon': {
    look: { bases: ['minimal', 'material3', 'cupertino'], chroma: 'vivid', headerAligns: ['center'], hues: ALL_HUES, grounds: ['white', 'tinted', 'cool'], fonts: ['syne', 'anton', 'outfit', 'instrument'], corners: ['round', 'pill'], buttons: 'pill', headingScale: 1.3, density: 'airy' },
    design: 'Short and striking: what is coming in one big line, two or three reasons to care, and a way to hear first through the form. Few sections, big type. The first section opens with one big line centered over a full-bleed photo, or on a card over one: what is coming and the sign-up button.',
    pages: 'A home page that says what is coming and invites people to sign up; nothing else unless the brief asks.',
  },
}

/**
 * The kinds, in the order the guided start shows them (`SITE_KINDS`, the
 * platform's since AGL-4049), each with its look family and guidance merged
 * over it.
 */
export const AI_SITE_KINDS: readonly AiSiteKind[] = SITE_KINDS.flatMap((kind) => {
  const look = AI_SITE_KIND_LOOKS[kind.id]
  return look ? [{ ...kind, ...look }] : []
})

/** A kind by id, or `null`. */
export function aiSiteKind(id: unknown): AiSiteKind | null {
  if (typeof id !== 'string' || !id) return null
  return AI_SITE_KINDS.find((kind) => kind.id === id) ?? null
}

/** A pairing by id, or `null`. */
export function aiSiteFontPairing(id: unknown): AiSiteFontPairing | null {
  return siteFontPairing(id)
}

/**
 * The kind a "what kind of site" answer suggests, read with "who it's for"
 * when there is one: the card the guided start selects until the person
 * picks another. The platform's classifier (`siteKindFor`, AGL-3660), which
 * moved to the core with the kinds (AGL-4049), answered with the AI start's
 * own row for the kind it picks.
 */
export function aiSiteKindFor(siteType: string, audience = ''): AiSiteKind {
  return aiSiteKind(siteKindFor(siteType, audience).id) ?? (AI_SITE_KINDS[0] as AiSiteKind)
}

/** The kind a job's inputs name, else the one its business type and audience suggest; `null` for a job that names neither. */
export function aiSiteKindOfInputs(inputs: Readonly<Record<string, unknown>> | null | undefined): AiSiteKind | null {
  const named = aiSiteKind(inputs?.['siteKind'])
  if (named) return named
  const type = inputs?.['businessType']
  const audience = inputs?.['audience']
  return typeof type === 'string' && type.trim() ? aiSiteKindFor(type, typeof audience === 'string' ? audience : '') : null
}

/** What each band rhythm asks of a page's sections. */
const RHYTHM_WORDS: Record<AiSiteRhythm, string> = {
  calm: 'mostly plain bands with one soft band, and at most one brand or dark band, on whichever section most needs the weight',
  alternating: 'plain and soft bands by turns, with one brand band wherever the page needs emphasis',
  bold: 'a dark or brand band for one or two key moments anywhere on the page, and strong contrast between neighboring sections',
}

/** The site's own look tokens a unit is handed (AGL-3660), read defensively. */
export function aiSiteStyleTokens(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): { headerAlign?: 'start' | 'center'; rhythm?: AiSiteRhythm } {
  const raw = inputs?.['siteStyle']
  if (!raw || typeof raw !== 'object') return {}
  const style = raw as Record<string, unknown>
  return {
    ...(style['headerAlign'] === 'start' || style['headerAlign'] === 'center' ? { headerAlign: style['headerAlign'] } : {}),
    ...(AI_SITE_RHYTHMS.includes(style['rhythm'] as AiSiteRhythm) ? { rhythm: style['rhythm'] as AiSiteRhythm } : {}),
  }
}

/** The style lines a page, the header and the footer are told for the job's kind and look; empty for none. */
export function aiSiteKindDesignLines(inputs: Readonly<Record<string, unknown>> | null | undefined): string[] {
  const kind = aiSiteKindOfInputs(inputs)
  const { rhythm } = aiSiteStyleTokens(inputs)
  return [
    ...(kind ? [`Style: a ${kind.label.toLowerCase()} site. ${kind.design}`] : []),
    ...(rhythm ? [`Band rhythm for this site: ${RHYTHM_WORDS[rhythm]}.`] : []),
  ]
}
