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
 * The styles a new site can start in (AGL-4049), and the record of which one
 * a site was created with.
 *
 * Nothing in "Create site" is chosen for a person: a site is created only
 * once they have picked a style. A style is a kind of site's look — the same
 * 21 the AI start's Style step offers, each with an example home page as its
 * picture — so the starter site and the AI start speak one vocabulary.
 *
 * This module is the LIST: what a person may choose on any surface, the
 * native apps included (the derived-values generator emits it). The LOOK a
 * style gives a site is the AI plugin's, behind the `core.site-style-looks`
 * seam (`plugin-manager/plugin-site-style-looks.ts`); with no plugin
 * answering, a site still starts in the default theme and the choice is
 * still recorded. The AI plugin's own kinds are held to this list, id for id
 * and in order, by `ai-site-kinds.spec.ts`.
 *
 * Pure data and readers, safe for any surface to import.
 */

/** Where the console serves each style's picture: `<dir>/<id>.webp`. */
export const SITE_STYLE_PREVIEW_DIR = '/_static/starter/styles'

/** The width and height every style picture is drawn at. */
export const SITE_STYLE_PREVIEW_SIZE = { width: 800, height: 800 } as const

/** One style a site can start in. */
export interface SiteStyle {
  /** A persisted identifier: the AI start's kind id, stored on the site. */
  id: string
  /** The card's title. */
  name: string
  /** One line under it. */
  blurb: string
  /** The example home page's picture, as a path on the console's origin. */
  preview: string
  /** What the picture shows, for a reader who cannot see it. */
  alt: string
}

const style = (id: string, name: string, blurb: string, alt: string): SiteStyle => ({
  id,
  name,
  blurb,
  preview: `${SITE_STYLE_PREVIEW_DIR}/${id}.webp`,
  alt,
})

/** Every style, in the order a person is shown them. */
export const SITE_STYLES: readonly SiteStyle[] = [
  style('business', 'Business & services', 'Say what you do, why choose you, and how to reach you', "A cleaning company's home page: its heading beside a photo of gloved hands wiping a desk, then its services as cards"),
  style('trades', 'Home services & trades', 'Roofers, plumbers, towing, landscaping: bold, direct, built on trust', "A roofer's home page: a bold heading over a full-width photo of a roofer carrying shingles, then roofing services"),
  style('professional', 'Law, finance & consulting', 'Law firms, accountants, advisers: calm, established, credible', "A consulting firm's home page: its heading on a white card over a full-width photo of a team at a planning board"),
  style('wellness', 'Health & wellness', 'Therapists, clinics, dentists, coaches: warm, reassuring, clear', "A therapy practice's home page: half the page a photo of a calm, sunlit room, its heading in the other half, then its sessions"),
  style('restaurant', 'Restaurant & café', 'Warm, photo-led pages for food, drink and a place to visit', "A café's home page: its heading centered over a photo of the owner at the counter, then menu highlights"),
  style('store', 'Online store', 'Product-first pages for things you sell', "A handmade goods shop's home page: its heading beside two overlapping photos of wax seals, then featured products"),
  style('portfolio', 'Portfolio', 'Minimal, image-led pages that put the work first', "A prop stylist's home page: a large heading over a grid of three styled sets"),
  style('studio', 'Design studio & agency', 'Bold type and case studies for creative teams', "A design studio's home page: an oversized heading on black over a wide photo of the team at a brand board"),
  style('photography', 'Photography', 'Galleries first, words second', "A photographer's home page: its heading on black over a gallery of a wedding, a portrait and a maker"),
  style('blog', 'Blog & writing', 'Reading-first pages with a calm serif voice', "A food journal's home page: its heading centered in a narrow column over a wide photo of vegetables on a cutting board"),
  style('events', 'Events & weddings', 'Dates, places and the details guests need', "A festival's home page: two overlapping photos of a lantern-lit night market beside its dates, then the program"),
  style('fitness', 'Fitness & sports', 'Gyms, trainers and studios with energy', "A gym's home page: a bold heading on black beside a photo of rows of dumbbells, then this week's classes"),
  style('yoga', 'Yoga & mindfulness', 'Calm, spacious pages for classes and retreats', "A yoga studio's home page: a quiet centered heading over a wide photo of a class stretching on mats"),
  style('beauty', 'Beauty & salon', 'Salons, barbers, spas and studios with style', "A hair salon's home page: its heading beside two overlapping photos of a stylist at work and the salon's chairs"),
  style('realestate', 'Real estate', 'Agents, brokers and property: polished and local', "A real estate agent's home page: its heading on a white card over a photo of a white house, then new listings"),
  style('education', 'Courses & education', 'Tutors, schools and courses, clear and encouraging', "A tutoring center's home page: a photo of a tutor at the whiteboard beside its heading, then its courses"),
  style('nonprofit', 'Nonprofit & community', 'A cause, its impact and how to help', "A food bank's home page: its heading over a full-width photo of volunteers sorting donations, then the ways to help"),
  style('music', 'Music & bands', 'Artists, bands and DJs, loud and visual', "A band's home page: its name in large type over a photo of a band under stage lights, then its tour dates"),
  style('personal', 'Personal & resume', 'A simple page about you and your work', "A product manager's personal page: a round portrait over her centered introduction, then her experience"),
  style('landing', 'Landing page', 'One page that leads to one action', "A budgeting app's landing page: its pitch centered on a colored band over a photo of a couple planning on a phone"),
  style('coming-soon', 'Coming soon', 'A placeholder that collects interest', "A café's coming soon page: its heading and notify button centered over a photo of the café's coffee shelves"),
]

/**
 * "Pick for me": the AI start's style card that lets the answers decide. It
 * is a card a person CLICKS, never a default, and it exists only where
 * something can pick for them (the AI start); the starter site has no such
 * card, so a site created with the starter always names a real style.
 */
export const SITE_STYLE_AUTO = 'auto'

/** Whether a value names one of the {@link SITE_STYLES}. */
export function isSiteStyleId(value: unknown): value is string {
  return typeof value === 'string' && SITE_STYLES.some((entry) => entry.id === value)
}

/** The style an id names, or `null`. */
export function siteStyleOf(id: unknown): SiteStyle | null {
  return SITE_STYLES.find((entry) => entry.id === id) ?? null
}

// ── What a site was created with ────────────────────────────────────────────

/**
 * How a site was started: the starter site (`starter`), the AI start (`ai`),
 * a site brought in from somewhere else (`import`), or a program through the
 * public API (`api`), which keeps the default and chooses no style.
 */
export type HostStarterStart = 'starter' | 'ai' | 'import' | 'api'

export const HOST_STARTER_STARTS: readonly HostStarterStart[] = ['starter', 'ai', 'import', 'api']

/**
 * `hosts/{id}.starterChoice` (AGL-4049): what a site was created with, written
 * by the server in the create's own transaction and never by a client, so
 * which styles people choose can be counted, and a site created and then left
 * alone can be told apart from one that was built on.
 *
 * - `kind`: the style id; {@link SITE_STYLE_AUTO} when the AI start's "Pick
 *   for me" was chosen; `null` when none was (the API, a seed);
 * - `listingId` / `version`: the marketplace starter picked, or `null`;
 * - `mode`: `base` copies a starter's pages, `ai` writes them for the business.
 */
export interface HostStarterChoice {
  listingId: string | null
  version: string | null
  kind: string | null
  mode: 'base' | 'ai'
  start: HostStarterStart
}

/** A choice with its unset parts filled: no listing, no style, `base`. */
export function hostStarterChoice(input: Partial<HostStarterChoice> & { start: HostStarterStart }): HostStarterChoice {
  return {
    listingId: input.listingId ?? null,
    version: input.version == null ? null : String(input.version),
    kind: input.kind ?? null,
    mode: input.mode === 'ai' ? 'ai' : 'base',
    start: input.start,
  }
}

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

/** A stored or answered choice, read defensively; `null` when it is not one. */
export function readHostStarterChoice(value: unknown): HostStarterChoice | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const start = record['start']
  if (!(HOST_STARTER_STARTS as readonly unknown[]).includes(start)) return null
  return hostStarterChoice({
    listingId: textOrNull(record['listingId']),
    version: textOrNull(record['version']),
    kind: textOrNull(record['kind']),
    mode: record['mode'] === 'ai' ? 'ai' : 'base',
    start: start as HostStarterStart,
  })
}

/**
 * The `host_created` event's parameters for a site's choice: how it was
 * started (`unknown` when the create's answer did not say), its style
 * (`auto` for "Pick for me", `none` for no style) and the starter listing
 * (`none` for none). Ids only, never a name a person typed.
 */
export function hostCreatedEventParams(choice: HostStarterChoice | null): {
  start: string
  starter_kind: string
  starter_listing: string
} {
  return {
    start: choice?.start ?? 'unknown',
    starter_kind: choice?.kind ?? 'none',
    starter_listing: choice?.listingId ?? 'none',
  }
}
