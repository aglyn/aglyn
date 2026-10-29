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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { isSiteStyleId, siteStyleOf } from '@aglyn/aglyn/app-utils/site-styles'
import type {
  SiteStarterFacets,
  SiteStarterMode,
} from '@aglyn/aglyn/app-utils/site-starter'
import type { SiteStarterSummary } from '@aglyn/aglyn/plugin-manager/plugin-site-starters'
import {
  SITE_STARTER_KNOWN_IDS,
  SITE_STARTER_SEARCH_MAX,
  siteStarterSearchLimit,
} from './site-starter-listing'

/**
 * The starter search as a request and an answer (AGL-4049): what "Choose
 * your starter" asks `GET /api/marketplace/starters`, how the route reads the
 * question back, and how a card words what it shows.
 *
 * Pure and dependency-light on purpose, so the native apps mirror it line for
 * line (phase 5's `StarterQuery`): the same parameters in the same order, the
 * same defensive read of the answer, the same "Free" and "$12".
 */

/** Where the console asks. */
export const STARTER_SEARCH_PATH = '/api/marketplace/starters'

/** The longest search a request carries; the rest is dropped, not refused. */
export const STARTER_SEARCH_WORD_MAX = 200

/** The facets a search may narrow to by query parameter, in the order they are written. */
export const STARTER_FILTER_KEYS = ['kind', 'base', 'fonts'] as const
export type StarterFilterKey = (typeof STARTER_FILTER_KEYS)[number]

/** The names the cards and the filters show for the ids a starter carries. */
export interface StarterSearchLabels {
  /** A built-in theme's short name (`material3`) to the name the theme picker shows. */
  base: Record<string, string>
  /** A font pairing id to its families, as a person reads them. */
  fonts: Record<string, string>
}

/** What the route answers: the starters as summaries, and the names for their ids. */
export interface StarterSearchAnswer {
  rows: SiteStarterSummary[]
  labels: StarterSearchLabels
}

/** One search, as the console and the native apps build it. */
export interface StarterQueryInput {
  /** The workspace the site will belong to. */
  orgId: string
  /** How the site will be filled: its pages as they are, or by the AI site start. */
  mode: SiteStarterMode
  /** The person's words, as typed. */
  word?: string
  /** The facets the person narrowed to; an absent one is any. */
  filter?: Partial<SiteStarterFacets>
  /** At most this many; the route caps it. */
  limit?: number
  /**
   * A listing the answer must carry whatever the search finds (AGL-4049):
   * the person's own pick, restored on the way back from buying it, which a
   * search for other words or another mode would not list.
   */
  include?: string | null
}

/** One search, as the route reads it back, every part checked. */
export interface StarterQuery {
  orgId: string
  mode: SiteStarterMode
  word: string
  /** `mode` is always among them, so the source asks for that mode only. */
  filter: Partial<SiteStarterFacets>
  limit: number
  /** The listing to carry whatever the search finds, or `null`. */
  include: string | null
}

const ORG_ID = /^[A-Za-z0-9_-]{1,128}$/
const LISTING_ID = /^[A-Za-z0-9_-]{1,128}$/
const FACET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

const trimmed = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

/**
 * The query string for one search, its parameters always in one order —
 * `orgId`, `mode`, `q`, `kind`, `base`, `fonts`, `limit`, `include` — so the
 * same search is the same URL, and a hook can key a request on it.
 */
export function starterQueryParams(input: StarterQueryInput): URLSearchParams {
  const params = new URLSearchParams()
  params.set('orgId', trimmed(input.orgId))
  params.set('mode', input.mode === 'ai' ? 'ai' : 'base')
  const word = trimmed(input.word).slice(0, STARTER_SEARCH_WORD_MAX)
  if (word) params.set('q', word)
  for (const key of STARTER_FILTER_KEYS) {
    const value = trimmed(input.filter?.[key])
    if (value) params.set(key, value)
  }
  params.set(
    'limit',
    String(siteStarterSearchLimit(input.limit ?? SITE_STARTER_SEARCH_MAX) || SITE_STARTER_SEARCH_MAX),
  )
  const include = trimmed(input.include)
  if (LISTING_ID.test(include)) params.set('include', include)
  return params
}

/**
 * The route's reading of a search, or the refusal it answers with a 400.
 *
 * A base theme or a font pairing is checked against the lists a starter may
 * name (`SITE_STARTER_KNOWN_IDS`), and a kind against the styles a person
 * chooses among (core's `SITE_STYLES`, which are the kinds of site), so a
 * mistyped one is named rather than answered with nothing.
 */
export function starterQueryFrom(
  params: URLSearchParams,
): StarterQuery | { error: string } {
  const orgId = trimmed(params.get('orgId'))
  if (!ORG_ID.test(orgId)) return { error: 'Missing orgId' }
  const askedMode = trimmed(params.get('mode'))
  if (askedMode && askedMode !== 'base' && askedMode !== 'ai') {
    return { error: 'Unknown mode' }
  }
  const mode: SiteStarterMode = askedMode === 'ai' ? 'ai' : 'base'
  const filter: Partial<SiteStarterFacets> = { mode }
  const kind = trimmed(params.get('kind'))
  if (kind) {
    if (!FACET_ID.test(kind) || !isSiteStyleId(kind)) return { error: 'Unknown kind of site' }
    filter.kind = kind
  }
  const base = trimmed(params.get('base'))
  if (base) {
    if (!SITE_STARTER_KNOWN_IDS.bases?.has(base)) return { error: 'Unknown base theme' }
    filter.base = base
  }
  const fonts = trimmed(params.get('fonts'))
  if (fonts) {
    if (!SITE_STARTER_KNOWN_IDS.fonts?.has(fonts)) return { error: 'Unknown font pairing' }
    filter.fonts = fonts
  }
  const include = trimmed(params.get('include'))
  if (include && !LISTING_ID.test(include)) return { error: 'Unknown starter' }
  return {
    orgId,
    mode,
    word: trimmed(params.get('q')).slice(0, STARTER_SEARCH_WORD_MAX),
    filter,
    limit: siteStarterSearchLimit(params.get('limit')) || SITE_STARTER_SEARCH_MAX,
    include: include || null,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const textOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback

const idOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

/**
 * One starter as a card shows it, read field by field, or `null` for a row
 * with no listing id.
 *
 * The route answers each row through this, as the console and the apps read
 * it, so what leaves the server is a summary and nothing else: a source that
 * handed back a paid AI starter's answers, or its pages, would have them
 * dropped here. Each field falls back the way a card needs it to: a missing
 * price is free, a missing picture is none, a page count is a whole number
 * from zero, a mode is `base` unless it says `ai`, and `owned` is kept only
 * where the answer gave it as a yes or a no.
 */
export function readStarterSummary(value: unknown): SiteStarterSummary | null {
  if (!isRecord(value)) return null
  const listingId = idOrNull(value['listingId'])
  if (!listingId) return null
  const price = Number(value['priceUsd'])
  const facets = isRecord(value['facets']) ? value['facets'] : {}
  const pages = Number(facets['pages'])
  const preview = value['previewImageUrl']
  return {
    listingId,
    displayName: textOr(value['displayName'], ''),
    description: textOr(value['description'], ''),
    authorName: textOr(value['authorName'], ''),
    official: value['official'] === true,
    priceUsd: Number.isFinite(price) && price > 0 ? price : 0,
    previewImageUrl: typeof preview === 'string' && preview ? preview : null,
    facets: {
      kind: idOrNull(facets['kind']),
      base: idOrNull(facets['base']),
      fonts: idOrNull(facets['fonts']),
      pages: Number.isFinite(pages) && pages > 0 ? Math.floor(pages) : 0,
      mode: facets['mode'] === 'ai' ? 'ai' : 'base',
    },
    category: idOrNull(value['category']),
    // Only where the answer says: absent is "the search does not know".
    ...(typeof value['owned'] === 'boolean' ? { owned: value['owned'] } : {}),
  }
}

/** A map of id to name, keeping only string names under non-empty ids. */
const namesOf = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {}
  const names: Record<string, string> = {}
  for (const [id, name] of Object.entries(value)) {
    if (id && typeof name === 'string' && name) names[id] = name
  }
  return names
}

/**
 * The route's answer, read defensively: rows that are not starters are
 * dropped, as is a duplicate of a listing already read, and missing labels
 * are empty. Never throws, whatever it is handed.
 */
export function parseStarterSearchAnswer(json: unknown): StarterSearchAnswer {
  const body = isRecord(json) ? json : {}
  const seen = new Set<string>()
  const rows: SiteStarterSummary[] = []
  for (const value of Array.isArray(body['rows']) ? body['rows'] : []) {
    const row = readStarterSummary(value)
    if (!row || seen.has(row.listingId)) continue
    seen.add(row.listingId)
    rows.push(row)
  }
  const labels = isRecord(body['labels']) ? body['labels'] : {}
  return { rows, labels: { base: namesOf(labels['base']), fonts: namesOf(labels['fonts']) } }
}

/**
 * A starter's price as a card shows it: "Free" at zero, whole dollars as
 * "$12", and cents only where there are some ("$12.50").
 */
export function starterPriceLabel(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return 'Free'
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`
}

/** How many pages a starter creates, as a card says it, or `null` when it does not say. */
export function starterPagesLabel(pages: number): string | null {
  if (!Number.isFinite(pages) || pages < 1) return null
  const whole = Math.floor(pages)
  return whole === 1 ? '1 page' : `${whole} pages`
}

/** One fact a starter's card shows as a chip, keyed so a surface can style each kind its own way. */
export interface StarterCardFact {
  key: 'price' | 'official' | 'ai' | 'kind' | 'pages'
  label: string
}

/**
 * The chips on a starter's card, in the order they are read: the price,
 * every card carrying one ("Free" included, so a missing chip never reads as
 * a forgotten price); the platform's name for its own; "AI" for a starter the
 * AI site start fills; the kind of site in words; and its page count.
 *
 * The kind is the style's own name for the listing's kind of site (core's
 * `SITE_STYLES`), the same words the kind filters show — never the listing's
 * marketplace category, which for a starter that names no kind is a shelf
 * of the marketplace (`design`), not a kind of site.
 */
export function starterCardFacts(row: SiteStarterSummary): StarterCardFact[] {
  const facts: StarterCardFact[] = [{ key: 'price', label: starterPriceLabel(row.priceUsd) }]
  if (row.official) facts.push({ key: 'official', label: PLATFORM_BRAND_NAME })
  if (row.facets.mode === 'ai') facts.push({ key: 'ai', label: 'AI' })
  const kind = siteStyleOf(row.facets.kind)?.name
  if (kind) facts.push({ key: 'kind', label: kind })
  const pages = starterPagesLabel(row.facets.pages)
  if (pages) facts.push({ key: 'pages', label: pages })
  return facts
}

/** Where a purchase is opened. */
export const STARTER_CHECKOUT_PATH = '/api/marketplace/checkout'

/**
 * The one place other than the marketplace a purchase may send its buyer
 * back to (AGL-4049): Create site, reopened on the starter they picked. A
 * name the checkout turns into an address itself, never an address the
 * browser hands it.
 */
export const STARTER_CHECKOUT_RETURN = 'create-site'
export type StarterCheckoutReturn = typeof STARTER_CHECKOUT_RETURN

/**
 * A checkout body's `return`, read: `create-site`, `null` when it names none
 * (the marketplace, as always), or the refusal a 400 answers with.
 */
export function readStarterCheckoutReturn(value: unknown): StarterCheckoutReturn | null | { error: string } {
  if (value === undefined || value === null || value === '') return null
  return value === STARTER_CHECKOUT_RETURN ? STARTER_CHECKOUT_RETURN : { error: 'Unknown return' }
}

/** The body "Buy and continue" sends: the starter, the workspace buying it, and the way back. */
export function starterCheckoutBody(input: {
  listingId: string
  orgId: string
  gaClientId?: string | null
}): Record<string, string> {
  return {
    listingId: input.listingId,
    orgId: input.orgId,
    return: STARTER_CHECKOUT_RETURN,
    ...(input.gaClientId ? { gaClientId: input.gaClientId } : {}),
  }
}
