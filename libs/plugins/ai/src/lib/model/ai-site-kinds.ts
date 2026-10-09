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
 * layout language: sections, cards, images, a form. On a paid plan the site
 * job also writes a blog's first posts into a content collection and a
 * store's first products as unpriced drafts (AGL-3676,
 * `jobs/ai-job-site-content.ts`), and the pages are told their titles; on
 * the Free taste it writes neither. No event records are created, and no
 * guidance here promises posts, products or events, since the plan reads it
 * on every plan (the owner adds more from the Content, Commerce and Events
 * sections afterward).
 *
 * Pure data and two small readers, safe for the console to import: no
 * theme compiler, no network.
 */

/** A font pairing the look may choose: a heading family over a body family. */
export interface AiSiteFontPairing {
  id: string
  /** What the pairing reads like, as the model is told. */
  feel: string
  heading: { family: string; category: 'sans-serif' | 'serif'; weight: number; sub: number }
  body: { family: string; category: 'sans-serif' | 'serif'; weights: number[] }
  /** Letter spacing the headings carry, in em. */
  tracking?: number
  /** Headings set in capitals: a condensed display face. */
  caps?: boolean
}

/**
 * The pairings, every family from the Google Fonts catalog the fonts plugin
 * serves (`google-fonts.catalog.json`) and every weight one that family
 * has — `ai-site-look.spec.ts` holds both. The tenant loads them the way it
 * loads the starter theme's family, so nothing here adds a font host.
 */
export const AI_SITE_FONT_PAIRINGS: readonly AiSiteFontPairing[] = [
  { id: 'jakarta', feel: 'modern, friendly sans', heading: { family: 'Plus Jakarta Sans', category: 'sans-serif', weight: 800, sub: 700 }, body: { family: 'Plus Jakarta Sans', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.02 },
  { id: 'inter', feel: 'neutral, precise sans', heading: { family: 'Inter', category: 'sans-serif', weight: 700, sub: 600 }, body: { family: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.025 },
  { id: 'grotesk', feel: 'designer grotesk', heading: { family: 'Space Grotesk', category: 'sans-serif', weight: 600, sub: 600 }, body: { family: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.03 },
  { id: 'syne', feel: 'expressive, art-school display', heading: { family: 'Syne', category: 'sans-serif', weight: 700, sub: 600 }, body: { family: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.02 },
  { id: 'bricolage', feel: 'contemporary, characterful sans', heading: { family: 'Bricolage Grotesque', category: 'sans-serif', weight: 700, sub: 600 }, body: { family: 'DM Sans', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.025 },
  { id: 'editorial', feel: 'editorial serif over clean sans', heading: { family: 'Playfair Display', category: 'serif', weight: 700, sub: 600 }, body: { family: 'Source Sans 3', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.01 },
  { id: 'fraunces', feel: 'warm, soft serif', heading: { family: 'Fraunces', category: 'serif', weight: 600, sub: 600 }, body: { family: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.015 },
  { id: 'instrument', feel: 'elegant, light serif headlines', heading: { family: 'Instrument Serif', category: 'serif', weight: 400, sub: 400 }, body: { family: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.01 },
  { id: 'reading', feel: 'reading-first serif, serif body', heading: { family: 'Newsreader', category: 'serif', weight: 600, sub: 600 }, body: { family: 'Source Serif 4', category: 'serif', weights: [400, 600, 700] }, tracking: -0.01 },
  { id: 'garamond', feel: 'refined, classic serif', heading: { family: 'Cormorant Garamond', category: 'serif', weight: 600, sub: 600 }, body: { family: 'Montserrat', category: 'sans-serif', weights: [400, 500, 600, 700] } },
  { id: 'baskerville', feel: 'established, trustworthy serif', heading: { family: 'Libre Baskerville', category: 'serif', weight: 700, sub: 700 }, body: { family: 'Source Sans 3', category: 'sans-serif', weights: [400, 500, 600, 700] } },
  { id: 'merriweather', feel: 'sturdy, readable serif', heading: { family: 'Merriweather', category: 'serif', weight: 700, sub: 700 }, body: { family: 'Lato', category: 'sans-serif', weights: [400, 700] } },
  { id: 'lora', feel: 'gentle, calm serif', heading: { family: 'Lora', category: 'serif', weight: 600, sub: 600 }, body: { family: 'Open Sans', category: 'sans-serif', weights: [400, 500, 600, 700] } },
  { id: 'dmserif', feel: 'polished display serif', heading: { family: 'DM Serif Display', category: 'serif', weight: 400, sub: 400 }, body: { family: 'DM Sans', category: 'sans-serif', weights: [400, 500, 600, 700] } },
  { id: 'oswald', feel: 'bold, condensed, workmanlike', heading: { family: 'Oswald', category: 'sans-serif', weight: 600, sub: 500 }, body: { family: 'Roboto', category: 'sans-serif', weights: [400, 500, 700] }, caps: true, tracking: 0.01 },
  { id: 'archivo', feel: 'heavy, high-impact sans', heading: { family: 'Archivo Black', category: 'sans-serif', weight: 400, sub: 400 }, body: { family: 'Archivo', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.01 },
  { id: 'barlow', feel: 'athletic, condensed sans', heading: { family: 'Barlow Condensed', category: 'sans-serif', weight: 700, sub: 600 }, body: { family: 'Barlow', category: 'sans-serif', weights: [400, 500, 600, 700] }, caps: true, tracking: 0.01 },
  { id: 'anton', feel: 'loud poster display', heading: { family: 'Anton', category: 'sans-serif', weight: 400, sub: 400 }, body: { family: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700] }, caps: true, tracking: 0.01 },
  { id: 'nunito', feel: 'rounded, approachable sans', heading: { family: 'Nunito', category: 'sans-serif', weight: 800, sub: 700 }, body: { family: 'Nunito Sans', category: 'sans-serif', weights: [400, 600, 700] } },
  { id: 'quicksand', feel: 'soft, airy rounded sans', heading: { family: 'Quicksand', category: 'sans-serif', weight: 700, sub: 600 }, body: { family: 'Nunito Sans', category: 'sans-serif', weights: [400, 600, 700] } },
  { id: 'manrope', feel: 'crisp, confident sans', heading: { family: 'Manrope', category: 'sans-serif', weight: 800, sub: 700 }, body: { family: 'Manrope', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.02 },
  { id: 'outfit', feel: 'geometric, upbeat sans', heading: { family: 'Outfit', category: 'sans-serif', weight: 700, sub: 600 }, body: { family: 'Outfit', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.02 },
  { id: 'plex', feel: 'technical, engineered sans', heading: { family: 'IBM Plex Sans', category: 'sans-serif', weight: 600, sub: 600 }, body: { family: 'IBM Plex Sans', category: 'sans-serif', weights: [400, 500, 600, 700] }, tracking: -0.01 },
]

export type AiSiteFontPairingId = string

/**
 * The platform's built-in themes a site's look is layered on, by the short
 * name of the themes plugin's preset id (\`theme-presets.<name>\`), and
 * \`starter\`: the theme a new site is born with (AGL-3497).
 */
export const AI_SITE_BASES = [
  'starter',
  'material-ui',
  'bootstrap',
  'minimal',
  'material3',
  'ant-design',
  'fluent',
  'carbon',
  'cupertino',
] as const
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

export interface AiSiteKind {
  /** A persisted identifier: the guided start's answer and the job's `siteKind` input. */
  id: string
  /** The card's title, in customer copy. */
  label: string
  /** One line under it. */
  blurb: string
  /** A word from the icon set the card shows. */
  icon: string
  /** Words in "what kind of site" that suggest this kind, matched whole. */
  keywords: readonly string[]
  /** The starter whose shape this kind follows, where one fits (`STARTER_TEMPLATES`). */
  starter: string
  look: AiSiteLookFamily
  /** How its pages are arranged, as every page and the header and footer are told. */
  design: string
  /** The pages it usually has, as the plan is told. */
  pages: string
}

const ALL_HUES: ReadonlyArray<readonly [number, number]> = [[0, 360]]

/**
 * The kinds, in the order the guided start shows them. Drawn from the template
 * categories the large site builders offer, merged where two would build the
 * same site: designer and agency are one studio, law and accounting one
 * practice, health and therapy one wellness kind.
 */
export const AI_SITE_KINDS: readonly AiSiteKind[] = [
  {
    id: 'business',
    label: 'Business & services',
    blurb: 'Say what you do, why choose you, and how to reach you',
    icon: 'briefcase',
    keywords: ['cleaning', 'cleaner', 'janitorial', 'pet', 'groomer', 'grooming', 'dog', 'staffing', 'printing', 'courier'],
    starter: 'business',
    look: { bases: ['starter', 'material3', 'fluent', 'minimal', 'ant-design'], chroma: 'balanced', hues: ALL_HUES, grounds: ['white', 'cool', 'warm', 'tinted'], fonts: ['jakarta', 'manrope', 'outfit', 'inter', 'bricolage', 'fraunces'], corners: ['soft', 'round'], buttons: 'rounded', headingScale: 1, density: 'regular' },
    design: 'Lead with what the business does and for whom, then services as cards, the reasons to choose it, how it works as steps, and a clear call to get in touch. Mix plain and soft bands with one brand band.',
    pages: 'Home, Services, About and Contact are typical; a pricing or booking page where the brief asks for one.',
  },
  {
    id: 'trades',
    label: 'Home services & trades',
    blurb: 'Roofers, plumbers, towing, landscaping: bold, direct, built on trust',
    icon: 'wrench',
    keywords: ['roofer', 'roofing', 'plumber', 'plumbing', 'electrician', 'hvac', 'towing', 'tow', 'landscaping', 'landscaper', 'contractor', 'construction', 'handyman', 'painter', 'painting', 'mover', 'moving', 'pest', 'remodeling', 'repair', 'mechanic', 'auto', 'trades', 'trade', 'garage', 'locksmith', 'flooring', 'fencing', 'pool'],
    starter: 'business',
    look: { bases: ['bootstrap', 'carbon', 'material-ui', 'fluent', 'starter'], chroma: 'vivid', hues: [[4, 18], [20, 38], [42, 56], [128, 158], [195, 212], [214, 240]], grounds: ['white', 'cool'], fonts: ['oswald', 'archivo', 'barlow', 'manrope'], corners: ['sharp', 'soft'], buttons: 'square', headingScale: 1.05, density: 'compact' },
    design: 'Direct and high-contrast: a big promise and a call-to-action button in the first section, the services as a tight grid of cards, why customers can trust the business (licensed, insured, years, guarantees, but only what the brief gives), the area served, and a call or quote request repeated near the end. Use a dark band and a brand band.',
    pages: 'Home, Services, About or Why us, and a Quote or Contact page with the form.',
  },
  {
    id: 'professional',
    label: 'Law, finance & consulting',
    blurb: 'Law firms, accountants, advisers: calm, established, credible',
    icon: 'scale',
    keywords: ['law', 'lawyer', 'attorney', 'legal', 'firm', 'accountant', 'accounting', 'cpa', 'tax', 'bookkeeping', 'financial', 'advisor', 'adviser', 'consulting', 'insurance', 'notary', 'mediator'],
    starter: 'business',
    look: { bases: ['carbon', 'fluent', 'minimal', 'starter'], chroma: 'muted', hues: [[210, 250], [340, 360], [0, 15], [150, 175]], grounds: ['white', 'warm', 'cool'], fonts: ['baskerville', 'merriweather', 'editorial', 'plex', 'lora'], corners: ['sharp', 'soft'], buttons: 'rounded', headingScale: 0.95, density: 'airy' },
    design: 'Measured and credible: generous space, a calm opening statement, practice areas as cards with short plain explanations, the approach as steps, and an unhurried invitation to a consultation. Prefer plain and soft bands, at most one dark band.',
    pages: 'Home, Practice areas or Services, About or Our team, and Contact with a consultation form.',
  },
  {
    id: 'wellness',
    label: 'Health & wellness',
    blurb: 'Therapists, clinics, dentists, coaches: warm, reassuring, clear',
    icon: 'heart',
    keywords: ['therapist', 'therapy', 'counselor', 'counseling', 'counselling', 'psychologist', 'dentist', 'dental', 'clinic', 'doctor', 'chiropractor', 'massage', 'wellness', 'health', 'nutrition', 'nutritionist', 'acupuncture', 'physio', 'physiotherapy', 'coach', 'coaching', 'healing', 'mental', 'medical', 'vet', 'veterinary'],
    starter: 'business',
    look: { bases: ['material3', 'cupertino', 'starter', 'fluent'], chroma: 'muted', hues: [[150, 200], [250, 290], [20, 40], [90, 130]], grounds: ['warm', 'tinted', 'white'], fonts: ['lora', 'fraunces', 'quicksand', 'dmserif', 'nunito'], corners: ['round', 'pill'], buttons: 'pill', headingScale: 1, density: 'airy' },
    design: 'Reassuring and gentle: a warm opening that names who it helps, what a first visit or session is like as steps, services as soft cards, answers to common worries as an FAQ, and a low-pressure way to book or ask. Prefer soft bands, avoid dark ones.',
    pages: 'Home, Services or Approach, About, and Book or Contact with the form.',
  },
  {
    id: 'restaurant',
    label: 'Restaurant & café',
    blurb: 'Warm, photo-led pages for food, drink and a place to visit',
    icon: 'utensils',
    keywords: ['restaurant', 'cafe', 'café', 'coffee', 'bakery', 'bar', 'pub', 'bistro', 'diner', 'pizzeria', 'pizza', 'food', 'catering', 'brewery', 'winery', 'kitchen', 'truck', 'tea', 'deli'],
    starter: 'business',
    look: { bases: ['material3', 'starter', 'cupertino'], chroma: 'balanced', hues: [[0, 45], [80, 150], [330, 360]], grounds: ['warm', 'tinted'], fonts: ['fraunces', 'editorial', 'dmserif', 'garamond', 'bricolage'], corners: ['soft', 'round'], buttons: 'rounded', headingScale: 1.1, density: 'regular' },
    design: 'Photo-led and inviting: a large image beside the opening line, the menu highlights as cards with pictures, the story of the place, and a clear visit or reserve section. Use images generously and a warm brand band.',
    pages: 'Home, Menu, About or Our story, and Visit or Reserve with the form.',
  },
  {
    id: 'store',
    label: 'Online store',
    blurb: 'Product-first pages for things you sell',
    icon: 'bag',
    keywords: ['store', 'shop', 'boutique', 'ecommerce', 'e-commerce', 'products', 'sell', 'selling', 'merch', 'jewelry', 'clothing', 'apparel', 'candles', 'soap', 'brand'],
    starter: 'physical-shop',
    look: { bases: ['minimal', 'cupertino', 'material3'], chroma: 'balanced', hues: ALL_HUES, grounds: ['white', 'warm'], fonts: ['inter', 'outfit', 'manrope', 'dmserif', 'syne'], corners: ['soft', 'sharp', 'round'], buttons: 'pill', headingScale: 1, density: 'regular' },
    design: 'Product-grid first: a short opening with one strong image, then the product range as a grid of image cards, what makes the products different, and care, shipping or returns answers only as the brief gives them. Keep copy short and let images lead.',
    pages: 'Home, Shop presenting the range as image cards, About, and Contact. Products, a cart and checkout are added in Commerce, so plan no checkout page.',
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    blurb: 'Minimal, image-led pages that put the work first',
    icon: 'grid',
    keywords: ['portfolio', 'illustrator', 'artist', 'art', 'architect', 'architecture', 'developer', 'engineer', 'writer', 'copywriter', 'animator', 'freelance', 'freelancer', 'maker', 'ceramics', 'sculptor'],
    starter: 'portfolio',
    look: { bases: ['minimal', 'cupertino', 'carbon'], chroma: 'neutral', hues: ALL_HUES, grounds: ['white', 'warm'], fonts: ['inter', 'grotesk', 'syne', 'instrument'], corners: ['sharp', 'soft'], buttons: 'square', headingScale: 1.3, density: 'airy' },
    design: 'Minimal and image-led: a large, short statement as the title, then the work as a grid of image cards with one-line captions, a brief about, and a quiet way to get in touch. Mostly plain bands, lots of space, big type, one accent color.',
    pages: 'Home with selected work, Work or Projects, About, and Contact.',
  },
  {
    id: 'studio',
    label: 'Design studio & agency',
    blurb: 'Bold type and case studies for creative teams',
    icon: 'sparkle',
    keywords: ['design', 'designer', 'agency', 'creative', 'branding', 'marketing', 'advertising', 'web', 'digital', 'production', 'video', 'animation'],
    starter: 'portfolio',
    look: { bases: ['minimal', 'carbon', 'cupertino'], chroma: 'neutral', hues: ALL_HUES, grounds: ['white', 'cool'], fonts: ['syne', 'grotesk', 'bricolage', 'inter'], corners: ['sharp', 'soft'], buttons: 'pill', headingScale: 1.3, density: 'airy' },
    design: 'Confident and editorial: an oversized statement, selected case studies as large image cards with the outcome in a line, services as a short list, how the studio works as steps, and a bold dark band to start a project.',
    pages: 'Home, Work or Case studies, Services, About, and Contact or Start a project.',
  },
  {
    id: 'photography',
    label: 'Photography',
    blurb: 'Galleries first, words second',
    icon: 'camera',
    keywords: ['photographer', 'photography', 'photo', 'photos', 'videographer', 'wedding photographer', 'portraits'],
    starter: 'portfolio',
    look: { bases: ['minimal', 'cupertino', 'carbon'], chroma: 'neutral', hues: ALL_HUES, grounds: ['white', 'warm'], fonts: ['instrument', 'garamond', 'inter', 'grotesk'], corners: ['sharp'], buttons: 'square', headingScale: 1.2, density: 'airy' },
    design: 'Gallery-first: one full image to open, then galleries as image cards by subject, a short personal about, packages only as the brief gives them, and a booking inquiry. Few words, many images, mostly plain bands and one dark band.',
    pages: 'Home, Galleries or Portfolio, About, and Book or Contact with the form.',
  },
  {
    id: 'blog',
    label: 'Blog & writing',
    blurb: 'Reading-first pages with a calm serif voice',
    icon: 'book',
    keywords: ['blog', 'blogger', 'writing', 'journal', 'magazine', 'newsletter', 'podcast', 'stories', 'essays', 'author', 'publication'],
    starter: 'business',
    look: { bases: ['minimal', 'starter', 'cupertino'], chroma: 'muted', hues: ALL_HUES, grounds: ['white', 'warm'], fonts: ['reading', 'editorial', 'instrument', 'lora'], corners: ['sharp', 'soft'], buttons: 'rounded', headingScale: 1.05, density: 'airy' },
    design: 'Reading-first: a short introduction to the writer and the subject, featured writing as cards with a title and a one-line summary, the topics covered as a list, and a sign-up or contact section. Narrow, calm, mostly plain bands.',
    pages: 'Home, Articles presenting the writing as cards, About, and Subscribe or Contact. Posts themselves are added in Data as a collection, so plan the articles page as an introduction and a few featured cards.',
  },
  {
    id: 'events',
    label: 'Events & weddings',
    blurb: 'Dates, places and the details guests need',
    icon: 'calendar',
    keywords: ['event', 'events', 'wedding', 'conference', 'festival', 'party', 'gala', 'meetup', 'summit', 'concert', 'retreat', 'workshop', 'venue', 'planner'],
    starter: 'landing',
    look: { bases: ['material3', 'cupertino', 'starter'], chroma: 'balanced', hues: [[320, 360], [0, 30], [250, 290], [140, 170], [40, 55]], grounds: ['warm', 'tinted', 'white'], fonts: ['garamond', 'editorial', 'dmserif', 'anton', 'syne'], corners: ['soft', 'round'], buttons: 'pill', headingScale: 1.2, density: 'regular' },
    design: 'Celebratory and clear: the name and what it is in a big opening, when and where only as the brief gives them, the schedule as steps, details guests ask about as an FAQ, and an RSVP or registration section. One brand band.',
    pages: 'Home, Schedule or Details, Travel or Venue where the brief names one, and RSVP or Register with the form.',
  },
  {
    id: 'fitness',
    label: 'Fitness & sports',
    blurb: 'Gyms, trainers and studios with energy',
    icon: 'bolt',
    keywords: ['gym', 'fitness', 'trainer', 'training', 'personal trainer', 'crossfit', 'boxing', 'martial', 'karate', 'pilates', 'sports', 'running', 'climbing', 'dance', 'swim', 'team', 'club'],
    starter: 'business',
    look: { bases: ['bootstrap', 'material-ui', 'carbon', 'material3'], chroma: 'vivid', hues: [[0, 30], [90, 140], [180, 210], [270, 300]], grounds: ['white', 'cool'], fonts: ['barlow', 'anton', 'archivo', 'outfit'], corners: ['sharp', 'soft'], buttons: 'caps', headingScale: 1.15, density: 'compact' },
    design: 'High-energy: a punchy opening with a strong call to action, classes or programs as cards, how to start as steps, and a repeated join or book section. Use a dark band and a brand band.',
    pages: 'Home, Classes or Programs, About or Coaches, and Join or Contact with the form.',
  },
  {
    id: 'yoga',
    label: 'Yoga & mindfulness',
    blurb: 'Calm, spacious pages for classes and retreats',
    icon: 'leaf',
    keywords: ['yoga', 'meditation', 'mindfulness', 'breathwork', 'reiki', 'spa', 'retreat', 'sound'],
    starter: 'business',
    look: { bases: ['material3', 'cupertino', 'starter', 'fluent'], chroma: 'muted', hues: [[20, 50], [80, 150], [260, 300], [170, 200]], grounds: ['warm', 'tinted'], fonts: ['garamond', 'lora', 'quicksand', 'instrument', 'fraunces'], corners: ['round', 'pill'], buttons: 'pill', headingScale: 1.05, density: 'airy' },
    design: 'Calm and spacious: a quiet opening, classes as soft cards, what a first class is like as steps, a gentle about, and an easy way to book. Soft bands, no dark band, lots of space.',
    pages: 'Home, Classes or Schedule, About, and Book or Contact with the form.',
  },
  {
    id: 'beauty',
    label: 'Beauty & salon',
    blurb: 'Salons, barbers, spas and studios with style',
    icon: 'scissors',
    keywords: ['salon', 'hair', 'hairdresser', 'barber', 'barbershop', 'nails', 'nail', 'beauty', 'makeup', 'lashes', 'brows', 'esthetician', 'skincare', 'tattoo', 'stylist'],
    starter: 'business',
    look: { bases: ['material3', 'cupertino', 'minimal'], chroma: 'balanced', hues: [[320, 360], [0, 25], [270, 300], [20, 45]], grounds: ['warm', 'tinted', 'white'], fonts: ['garamond', 'dmserif', 'instrument', 'outfit', 'syne'], corners: ['round', 'pill', 'sharp'], buttons: 'pill', headingScale: 1.1, density: 'regular' },
    design: 'Stylish and image-led: a striking opening image, services as cards, the look and feel of the place in images, and booking made obvious. One brand band.',
    pages: 'Home, Services, About or The team, and Book or Contact with the form.',
  },
  {
    id: 'realestate',
    label: 'Real estate',
    blurb: 'Agents, brokers and property: polished and local',
    icon: 'home',
    keywords: ['real estate', 'realtor', 'realty', 'broker', 'property', 'properties', 'homes', 'rentals', 'rental', 'apartment', 'apartments', 'mortgage', 'airbnb', 'vacation'],
    starter: 'business',
    look: { bases: ['fluent', 'minimal', 'carbon'], chroma: 'muted', hues: [[200, 240], [150, 180], [20, 45], [0, 360]], grounds: ['white', 'warm', 'cool'], fonts: ['dmserif', 'manrope', 'editorial', 'outfit'], corners: ['soft', 'sharp'], buttons: 'rounded', headingScale: 1.05, density: 'regular' },
    design: 'Polished and local: an image-led opening, the areas served, how buying or selling works as steps, featured listings only as image cards the owner fills in, and a valuation or contact request. One dark band.',
    pages: 'Home, Buy or Listings, Sell, About, and Contact with the form.',
  },
  {
    id: 'education',
    label: 'Courses & education',
    blurb: 'Tutors, schools and courses, clear and encouraging',
    icon: 'school',
    keywords: ['course', 'courses', 'school', 'tutoring', 'tutor', 'teacher', 'lessons', 'academy', 'education', 'learning', 'training', 'daycare', 'preschool', 'music lessons', 'driving'],
    starter: 'business',
    look: { bases: ['material3', 'ant-design', 'material-ui'], chroma: 'balanced', hues: [[200, 240], [140, 170], [30, 50], [260, 290]], grounds: ['white', 'tinted', 'cool'], fonts: ['nunito', 'outfit', 'jakarta', 'lora', 'manrope'], corners: ['round', 'soft'], buttons: 'rounded', headingScale: 1, density: 'regular' },
    design: 'Clear and encouraging: who it is for and the result they get, courses or subjects as cards, how it works as steps, common questions as an FAQ, and a sign-up or inquiry section.',
    pages: 'Home, Courses or Lessons, About or Teachers, and Enroll or Contact with the form.',
  },
  {
    id: 'nonprofit',
    label: 'Nonprofit & community',
    blurb: 'A cause, its impact and how to help',
    icon: 'hands',
    keywords: ['nonprofit', 'non-profit', 'charity', 'foundation', 'church', 'community', 'volunteer', 'volunteers', 'association', 'ngo', 'mission', 'ministry', 'rescue', 'shelter', 'cause'],
    starter: 'business',
    look: { bases: ['material3', 'fluent', 'starter'], chroma: 'balanced', hues: [[130, 200], [20, 45], [200, 230], [340, 360]], grounds: ['white', 'warm'], fonts: ['merriweather', 'lora', 'jakarta', 'fraunces', 'nunito'], corners: ['soft', 'round'], buttons: 'rounded', headingScale: 1.05, density: 'regular' },
    design: 'Mission-led: the cause in one line, what the organization does as cards, how to help as steps (volunteer, give, spread the word), and a clear way to get involved. A brand band for the call to help.',
    pages: 'Home, Our work or Programs, About, and Get involved or Contact with the form.',
  },
  {
    id: 'music',
    label: 'Music & bands',
    blurb: 'Artists, bands and DJs, loud and visual',
    icon: 'music',
    keywords: ['band', 'musician', 'music', 'dj', 'singer', 'rapper', 'producer', 'orchestra', 'choir', 'composer', 'artist music'],
    starter: 'landing',
    look: { bases: ['carbon', 'minimal', 'material-ui'], chroma: 'vivid', hues: ALL_HUES, grounds: ['white', 'cool', 'tinted'], fonts: ['anton', 'syne', 'grotesk', 'archivo'], corners: ['sharp'], buttons: 'caps', headingScale: 1.3, density: 'regular' },
    design: 'Loud and visual: the name huge in the opening, an image band, releases or shows as image cards only as the brief gives them, a short bio, and a booking or contact section. Dark bands are welcome.',
    pages: 'Home, Music or Shows, About, and Booking or Contact with the form.',
  },
  {
    id: 'personal',
    label: 'Personal & resume',
    blurb: 'A simple page about you and your work',
    icon: 'person',
    // "Personal" only as a site about the person (AGL-3660): as a bare word it
    // is the adjective in "a personal travel blog", which it beat on length.
    keywords: ['personal site', 'personal website', 'personal page', 'about me', 'resume', 'cv', 'me', 'myself', 'profile', 'job', 'candidate', 'speaker'],
    starter: 'portfolio',
    look: { bases: ['minimal', 'cupertino', 'starter', 'fluent'], chroma: 'muted', hues: ALL_HUES, grounds: ['white', 'warm', 'cool'], fonts: ['inter', 'instrument', 'manrope', 'lora', 'grotesk'], corners: ['soft', 'round'], buttons: 'rounded', headingScale: 1.1, density: 'airy' },
    design: 'Simple and personal: who the person is in one line, what they do, experience or highlights as a list or steps, selected work as cards where the brief names some, and a way to get in touch. Mostly plain bands.',
    pages: 'Home, About or Experience, Work where the brief names some, and Contact.',
  },
  {
    id: 'landing',
    label: 'Landing page',
    blurb: 'One page that leads to one action',
    icon: 'rocket',
    keywords: ['landing', 'launch', 'app', 'startup', 'saas', 'software', 'product', 'waitlist', 'campaign', 'offer', 'ebook', 'webinar'],
    starter: 'landing',
    look: { bases: ['material3', 'minimal', 'ant-design'], chroma: 'vivid', hues: ALL_HUES, grounds: ['white', 'cool', 'tinted'], fonts: ['outfit', 'jakarta', 'manrope', 'bricolage', 'inter'], corners: ['round', 'soft'], buttons: 'pill', headingScale: 1.15, density: 'regular' },
    design: 'One action: a strong promise and the call to action first, the benefits as cards, how it works as steps, answers to objections as an FAQ, and the call to action again. A brand band to close.',
    pages: 'One long home page carries the story; a second page only for the form or details the brief asks for.',
  },
  {
    id: 'coming-soon',
    label: 'Coming soon',
    blurb: 'A placeholder that collects interest',
    icon: 'clock',
    keywords: ['coming soon', 'soon', 'prelaunch', 'pre-launch', 'under construction', 'placeholder'],
    starter: 'landing',
    look: { bases: ['minimal', 'material3', 'cupertino'], chroma: 'vivid', hues: ALL_HUES, grounds: ['white', 'tinted', 'cool'], fonts: ['syne', 'anton', 'outfit', 'instrument'], corners: ['round', 'pill'], buttons: 'pill', headingScale: 1.3, density: 'airy' },
    design: 'Short and striking: what is coming in one big line, two or three reasons to care, and a way to hear first through the form. Few sections, big type.',
    pages: 'A home page that says what is coming and invites people to sign up; nothing else unless the brief asks.',
  },
]

/** A kind by id, or `null`. */
export function aiSiteKind(id: unknown): AiSiteKind | null {
  if (typeof id !== 'string' || !id) return null
  return AI_SITE_KINDS.find((kind) => kind.id === id) ?? null
}

/** A pairing by id, or `null`. */
export function aiSiteFontPairing(id: unknown): AiSiteFontPairing | null {
  if (typeof id !== 'string' || !id) return null
  return AI_SITE_FONT_PAIRINGS.find((pairing) => pairing.id === id) ?? null
}

const words = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9é&'-]+/g, ' ')} `

/**
 * The kind a "what kind of site" answer suggests, or `business` when nothing
 * in it matches: the card the guided start selects until the person picks
 * another. A longer keyword wins over a shorter one ("wedding photographer"
 * is photography, not events), and of two as long the later one wins, since
 * English puts the noun last ("a food blog" is a blog).
 */
export function aiSiteKindFor(siteType: string): AiSiteKind {
  const text = words(siteType)
  let best: { kind: AiSiteKind; length: number; at: number } | null = null
  for (const kind of AI_SITE_KINDS) {
    for (const keyword of kind.keywords) {
      const at = text.lastIndexOf(words(keyword))
      if (at === -1) continue
      if (!best || keyword.length > best.length || (keyword.length === best.length && at > best.at)) {
        best = { kind, length: keyword.length, at }
      }
    }
  }
  return best?.kind ?? (AI_SITE_KINDS[0] as AiSiteKind)
}

/** The kind a job's inputs name, else the one its business type suggests; `null` for a job that names neither. */
export function aiSiteKindOfInputs(inputs: Readonly<Record<string, unknown>> | null | undefined): AiSiteKind | null {
  const named = aiSiteKind(inputs?.['siteKind'])
  if (named) return named
  const type = inputs?.['businessType']
  return typeof type === 'string' && type.trim() ? aiSiteKindFor(type) : null
}

/** What each band rhythm asks of a page's sections. */
const RHYTHM_WORDS: Record<AiSiteRhythm, string> = {
  calm: 'mostly plain bands with one soft band, and a brand or dark band only for the closing call to action',
  alternating: 'plain and soft bands by turns, with one brand band',
  bold: 'a dark or brand band to open or close, and strong contrast between neighboring sections',
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
