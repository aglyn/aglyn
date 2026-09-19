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

import { MEDIA_ALT_MAX_LENGTH } from '@aglyn/aglyn/app-utils/media-alt'
import {
  SEO_LISTING_FIELDS,
  type SeoListingFieldKey,
} from '@aglyn/aglyn/app-utils/seo-listing-fields'
import { HostEntityType } from '@aglyn/aglyn/foundation/definitions/platform.types'
import type {
  AiSeoFieldValues,
  AiSeoFindingCode,
  AiSeoKeywordCoverage,
  AiSeoSiteFormField,
} from '../model/ai-seo'
import type { AiTool } from '../providers/contract'
import { AI_TEXT_LIMITS } from '../runtime/ai-palette'
import type { AiDoctrineViolation } from '../runtime/ai-doctrine-validators'
import type { AiSeoPageFacts } from '../runtime/seo-page-facts'

/**
 * The strict tools SEO by AI answers through (AGL-2910), and the checks that
 * hold each answer to the editor it proposes for.
 *
 * - `propose_search_listing` — one page's or one product's listing. BUILT
 *   from the editor's own field list, the `seo-listing-fields` catalog the
 *   SEO card draws its inputs from, so a field and its length are said once:
 *   `ai-seo-tool.spec.ts` asserts the parity in both directions.
 * - `propose_seo_fixes` — one batch of a site audit's page fixes.
 * - `propose_site_listing` — the site's structured data and its guidance
 *   for AI agents, the two fields `/llms.txt` leads with.
 *
 * A strict schema forbids extra keys, requires every key and says "no value"
 * with `null`; it accepts no length keyword, so every length is stated in a
 * description and enforced here. A check returns a value only when nothing
 * in the answer is broken, and otherwise the violations and the parts at
 * fault, for the generation call's one re-ask.
 */

/* ------------------------------------------------------------------------ *
 * Keywords: coverage, and what stuffing looks like
 * ------------------------------------------------------------------------ */

/** Target keywords one listing may be asked to cover. */
export const AI_SEO_MAX_KEYWORDS = 5

/** The most times one keyword may appear, per field, before it reads as stuffing. */
export const AI_SEO_KEYWORD_LIMITS: Readonly<Partial<Record<SeoListingFieldKey, number>>> = {
  title: 1,
  description: 2,
  breadcrumb: 1,
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** How many times `keyword` appears in `text` as whole words, any case. */
export function aiSeoKeywordCount(text: string | null | undefined, keyword: string): number {
  const needle = keyword.trim().toLowerCase()
  if (!needle || !text) return 0
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(needle).replace(/\s+/g, '\\s+')}(?=$|[^\\p{L}\\p{N}])`,
    'giu',
  )
  return [...text.toLowerCase().matchAll(pattern)].length
}

/** Keywords as a person typed them: trimmed, deduplicated, capped. */
export function aiSeoKeywordList(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/[,\n]/)
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const keyword = part.replace(/\s+/g, ' ').trim().slice(0, 60)
    const key = keyword.toLowerCase()
    if (!keyword || seen.has(key)) continue
    seen.add(key)
    out.push(keyword)
    if (out.length >= AI_SEO_MAX_KEYWORDS) break
  }
  return out
}

/** Where a page already says each target keyword. */
export function aiSeoKeywordCoverage(
  keywords: readonly string[],
  sources: { title?: string | null; description?: string | null; h1?: string | null; body?: string | null },
): AiSeoKeywordCoverage[] {
  return keywords.map((keyword) => ({
    keyword,
    inTitle: aiSeoKeywordCount(sources.title, keyword) > 0,
    inDescription: aiSeoKeywordCount(sources.description, keyword) > 0,
    inH1: aiSeoKeywordCount(sources.h1, keyword) > 0,
    inBody: aiSeoKeywordCount(sources.body, keyword) > 0,
  }))
}

/** A word of four letters or more used three times in one short field reads as stuffing. */
function repeatedWord(text: string): string | null {
  const counts = new Map<string, number>()
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []) {
    const count = (counts.get(word) ?? 0) + 1
    if (count >= 3) return word
    counts.set(word, count)
  }
  return null
}

const collapse = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''

const text = (description: string) => ({ anyOf: [{ type: 'string' }, { type: 'null' }], description })

/* ------------------------------------------------------------------------ *
 * One listing, from the editor's field list
 * ------------------------------------------------------------------------ */

export const AI_SEO_FIELDS_TOOL_NAME = 'propose_search_listing'

/** The fields a listing proposal must fill; the image description may be left out. */
export const AI_SEO_REQUIRED_FIELDS: ReadonlySet<SeoListingFieldKey> = new Set([
  'title',
  'description',
  'breadcrumb',
])

/** Fields in the catalog's order, whatever order a caller named them in. */
export function orderedSeoListingFields(fields: readonly SeoListingFieldKey[]): SeoListingFieldKey[] {
  const wanted = new Set(fields)
  return (Object.keys(SEO_LISTING_FIELDS) as SeoListingFieldKey[]).filter((key) => wanted.has(key))
}

/** The strict tool for a listing with exactly these fields, each required and nullable. */
export function aiSeoFieldsTool(fields: readonly SeoListingFieldKey[]): AiTool {
  const keys = orderedSeoListingFields(fields)
  const properties: Record<string, unknown> = {}
  for (const key of keys) {
    const field = SEO_LISTING_FIELDS[key]
    properties[key] = text(
      `${field.label}. ${field.purpose} At most ${field.maxLength} characters.` +
        (AI_SEO_REQUIRED_FIELDS.has(key) ? '' : ' null when nothing you were given says what the picture shows.'),
    )
  }
  return {
    name: AI_SEO_FIELDS_TOOL_NAME,
    description:
      'Propose the search listing for one page or one product. Every field is required; ' +
      'null means no value can be written from what you were given.',
    strict: true,
    inputSchema: {
      type: 'object',
      properties,
      required: keys,
      additionalProperties: false,
    },
  }
}

export interface AiSeoFieldsCheckContext {
  fields: readonly SeoListingFieldKey[]
  /** Whether the listing has a social image; without one, an image description is dropped. */
  hasImage: boolean
  keywords?: readonly string[]
  /** Titles other pages of the site use, which this listing must not repeat. */
  otherTitles?: readonly string[]
}

const normalizeTitle = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * A listing answer held to the editor: every requested text field written,
 * each within its length, no keyword past its per-field count, no word
 * repeated to rank, no title another page uses.
 */
export function checkAiSeoFields(
  answer: Record<string, unknown>,
  context: AiSeoFieldsCheckContext,
): { value: AiSeoFieldValues | null; violations: AiDoctrineViolation[]; offending?: Record<string, unknown> } {
  const values: AiSeoFieldValues = {}
  const violations: AiDoctrineViolation[] = []
  const offending: Record<string, unknown> = {}
  const otherTitles = new Set((context.otherTitles ?? []).map(normalizeTitle))
  for (const key of orderedSeoListingFields(context.fields)) {
    const field = SEO_LISTING_FIELDS[key]
    const raw = answer[key]
    if (raw !== null && raw !== undefined && typeof raw !== 'string') {
      violations.push({ rule: null, code: 'type', message: `${field.label} must be text or null.` })
      offending[key] = raw
      continue
    }
    const value = collapse(raw)
    if (!value) {
      if (AI_SEO_REQUIRED_FIELDS.has(key)) {
        violations.push({ rule: null, code: 'missing', message: `${field.label} is required.` })
      }
      continue
    }
    // An image description with no image to describe is a sentence about
    // nothing; it is left out rather than asked for again.
    if (key === 'imageAlt' && !context.hasImage) continue
    if (value.length > field.maxLength) {
      violations.push({
        rule: null,
        code: 'too-long',
        message: `${field.label} is ${value.length} characters; the limit is ${field.maxLength}.`,
      })
      offending[key] = value
      continue
    }
    const limit = AI_SEO_KEYWORD_LIMITS[key]
    const stuffed = limit
      ? (context.keywords ?? []).find((keyword) => aiSeoKeywordCount(value, keyword) > limit)
      : undefined
    if (stuffed) {
      violations.push({
        rule: null,
        code: 'keyword-stuffing',
        message: `${field.label} repeats "${stuffed}"; use a keyword at most ${limit === 1 ? 'once' : `${limit} times`} there.`,
      })
      offending[key] = value
      continue
    }
    const repeated = key === 'imageAlt' ? null : repeatedWord(value)
    if (repeated) {
      violations.push({ rule: null, code: 'repetition', message: `${field.label} repeats "${repeated}" three times.` })
      offending[key] = value
      continue
    }
    if (key === 'title' && otherTitles.has(normalizeTitle(value))) {
      violations.push({
        rule: null,
        code: 'duplicate-title',
        message: `The title "${value}" is already another page's title.`,
      })
      offending[key] = value
      continue
    }
    values[key] = value
  }
  return violations.length ? { value: null, violations, offending } : { value: values, violations: [] }
}

/* ------------------------------------------------------------------------ *
 * A batch of a site audit's page fixes
 * ------------------------------------------------------------------------ */

export const AI_SEO_FIXES_TOOL_NAME = 'propose_seo_fixes'

/**
 * How long an image description a batch proposes may be. Shorter than the
 * `alt` ceiling: a description read aloud is better short, and it keeps the
 * largest batch answer inside its measured budget.
 */
export const AI_SEO_FIX_ALT_MAX_CHARS = Math.min(150, MEDIA_ALT_MAX_LENGTH)

/** Undescribed images one page of a batch gets descriptions for; the rest wait for the next audit. */
export const AI_SEO_FIX_IMAGES_PER_PAGE = 3

/** The undescribed images a batch asks about for a page, in page order. */
export function aiSeoFixImages(page: Pick<AiSeoBatchPage, 'facts'>): AiSeoPageFacts['imagesMissingAlt'] {
  return page.facts.imagesMissingAlt.slice(0, AI_SEO_FIX_IMAGES_PER_PAGE)
}

/** The strict tool for one batch: a title, description, heading and image descriptions per page. */
export function aiSeoFixesTool(screenIds: readonly string[]): AiTool {
  return {
    name: AI_SEO_FIXES_TOOL_NAME,
    description:
      'Propose fixes for the pages you were given. One entry per page; null means leave that value as it is.',
    strict: true,
    inputSchema: {
      type: 'object',
      properties: {
        pages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              screenId: { type: 'string', enum: [...screenIds] },
              title: text(`${SEO_LISTING_FIELDS.title.purpose} At most ${SEO_LISTING_FIELDS.title.maxLength} characters.`),
              description: text(
                `${SEO_LISTING_FIELDS.description.purpose} At most ${SEO_LISTING_FIELDS.description.maxLength} characters.`,
              ),
              h1: text(`The page’s one main heading. At most ${AI_TEXT_LIMITS.headline} characters.`),
              imageAlts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    nodeId: { type: 'string' },
                    alt: {
                      type: 'string',
                      description: `What the picture shows. At most ${AI_SEO_FIX_ALT_MAX_CHARS} characters.`,
                    },
                  },
                  required: ['nodeId', 'alt'],
                  additionalProperties: false,
                },
              },
            },
            required: ['screenId', 'title', 'description', 'h1', 'imageAlts'],
            additionalProperties: false,
          },
        },
      },
      required: ['pages'],
      additionalProperties: false,
    },
  }
}

/** A batch page as the fixes prompt and check read it. */
export interface AiSeoBatchPage {
  screenId: string
  path: string
  name: string
  codes: ReadonlySet<AiSeoFindingCode>
  keywords: readonly string[]
  seo: { title?: string; description?: string; breadcrumb?: string; image?: string; imageAlt?: string } | undefined
  facts: AiSeoPageFacts
}

/** The findings that let a batch answer propose each value. */
export const AI_SEO_FIX_CODES = {
  title: ['title-missing', 'title-too-long', 'title-duplicate', 'keyword-missing'],
  description: ['description-missing', 'description-too-long', 'description-duplicate', 'keyword-missing'],
  h1: ['h1-missing', 'h1-thin'],
} as const satisfies Record<string, readonly AiSeoFindingCode[]>

export interface AiSeoBatchAnswer {
  title: string | null
  description: string | null
  h1: string | null
  imageAlts: Array<{ nodeId: string; alt: string }>
}

/**
 * A batch answer held to the audit and the editor: values only where a
 * finding asked for them, each within its length, no keyword past its count,
 * no title another page uses, and image descriptions only for this page's
 * undescribed images.
 */
export function checkAiSeoFixes(
  answer: Record<string, unknown>,
  pages: readonly AiSeoBatchPage[],
  titlesElsewhere: readonly string[],
): { value: Record<string, AiSeoBatchAnswer> | null; violations: AiDoctrineViolation[]; offending?: Record<string, unknown> } {
  const byId = new Map(pages.map((page) => [page.screenId, page]))
  const violations: AiDoctrineViolation[] = []
  const offending: Array<Record<string, unknown>> = []
  const value: Record<string, AiSeoBatchAnswer> = {}
  const taken = new Set(titlesElsewhere.map(normalizeTitle))
  const entries = Array.isArray(answer['pages']) ? (answer['pages'] as unknown[]) : null
  if (!entries) {
    return { value: null, violations: [{ rule: null, code: 'shape', message: 'The answer must list the pages.' }] }
  }
  const asks = (page: AiSeoBatchPage, codes: readonly AiSeoFindingCode[]) =>
    codes.some((code) => page.codes.has(code))
  for (const raw of entries) {
    const entry = (raw ?? {}) as Record<string, unknown>
    const page = byId.get(String(entry['screenId'] ?? ''))
    if (!page || value[page.screenId]) continue
    const broken: string[] = []
    const fix: AiSeoBatchAnswer = { title: null, description: null, h1: null, imageAlts: [] }

    const title = collapse(entry['title'])
    if (title && asks(page, AI_SEO_FIX_CODES.title)) {
      if (title.length > SEO_LISTING_FIELDS.title.maxLength) {
        broken.push(`title is ${title.length} characters; the limit is ${SEO_LISTING_FIELDS.title.maxLength}`)
      } else if (page.keywords.some((keyword) => aiSeoKeywordCount(title, keyword) > (AI_SEO_KEYWORD_LIMITS.title ?? 1))) {
        broken.push('title repeats a keyword')
      } else if (taken.has(normalizeTitle(title))) {
        broken.push(`title "${title}" is another page's title`)
      } else {
        fix.title = title
        taken.add(normalizeTitle(title))
      }
    }
    const description = collapse(entry['description'])
    if (description && asks(page, AI_SEO_FIX_CODES.description)) {
      if (description.length > SEO_LISTING_FIELDS.description.maxLength) {
        broken.push(
          `description is ${description.length} characters; the limit is ${SEO_LISTING_FIELDS.description.maxLength}`,
        )
      } else if (
        page.keywords.some((keyword) => aiSeoKeywordCount(description, keyword) > (AI_SEO_KEYWORD_LIMITS.description ?? 2))
      ) {
        broken.push('description repeats a keyword')
      } else {
        fix.description = description
      }
    }
    const h1 = collapse(entry['h1'])
    if (h1 && asks(page, AI_SEO_FIX_CODES.h1)) {
      if (h1.length > AI_TEXT_LIMITS.headline) {
        broken.push(`h1 is ${h1.length} characters; the limit is ${AI_TEXT_LIMITS.headline}`)
      } else {
        fix.h1 = h1
      }
    }
    const undescribed = new Set(aiSeoFixImages(page).map((image) => image.nodeId))
    for (const rawAlt of Array.isArray(entry['imageAlts']) ? (entry['imageAlts'] as unknown[]) : []) {
      const altEntry = (rawAlt ?? {}) as Record<string, unknown>
      const nodeId = String(altEntry['nodeId'] ?? '')
      const alt = collapse(altEntry['alt'])
      if (!undescribed.has(nodeId) || !alt || fix.imageAlts.some((known) => known.nodeId === nodeId)) continue
      if (alt.length > AI_SEO_FIX_ALT_MAX_CHARS) {
        broken.push(`the description of image ${nodeId} is over ${AI_SEO_FIX_ALT_MAX_CHARS} characters`)
      } else {
        fix.imageAlts.push({ nodeId, alt })
      }
    }
    if (broken.length) {
      violations.push(...broken.map((message) => ({ rule: null, code: 'fix', message: `Page ${page.screenId}: ${message}.` })))
      offending.push(entry)
    } else {
      value[page.screenId] = fix
    }
  }
  return violations.length ? { value: null, violations, offending: { pages: offending } } : { value, violations: [] }
}

/* ------------------------------------------------------------------------ *
 * The site: structured data and guidance for AI agents
 * ------------------------------------------------------------------------ */

export const AI_SEO_SITE_TOOL_NAME = 'propose_site_listing'

/** The longest structured-data description the site SEO form accepts. */
export const AI_SEO_ENTITY_DESCRIPTION_MAX_CHARS = 300

/** The longest agent guidance the site SEO form accepts. */
export const AI_SEO_AGENT_GUIDANCE_MAX_CHARS = 1_000

/** The entity types the tool offers, and the value the site SEO form stores for each. */
export const AI_SEO_ENTITY_TYPE_VALUES: Readonly<Record<string, string>> = {
  Organization: `${HostEntityType.ORGANIZATION}`,
  Person: `${HostEntityType.PERSON}`,
}

/** The site-wide proposal's strict tool: structured data and agent guidance, each nullable. */
export function aiSeoSiteTool(): AiTool {
  const properties = {
    entityType: {
      anyOf: [{ type: 'string', enum: Object.keys(AI_SEO_ENTITY_TYPE_VALUES) }, { type: 'null' }],
      description: 'Whether a company or a person publishes the site.',
    },
    entityName: text('The publisher’s name as the site gives it.'),
    entityDescription: text(
      `What the publisher IS, in one sentence — not what a page is about. At most ${AI_SEO_ENTITY_DESCRIPTION_MAX_CHARS} characters.`,
    ),
    contactEmail: text('A contact email address, only when a page of the site shows it.'),
    contactTelephone: text('A contact telephone number, only when a page of the site shows it.'),
    contactType: text('What that contact answers, such as customer support or sales.'),
    whenToUse: text(
      `For AI agents: the questions this site is the best source for, specifically. At most ${AI_SEO_AGENT_GUIDANCE_MAX_CHARS} characters.`,
    ),
    howToUse: text(
      `For AI agents: which pages answer what, and what not to rely on. At most ${AI_SEO_AGENT_GUIDANCE_MAX_CHARS} characters.`,
    ),
  }
  return {
    name: AI_SEO_SITE_TOOL_NAME,
    description:
      'Propose the site’s structured data and its guidance for AI agents. Every field is required; null means leave it as it is.',
    strict: true,
    inputSchema: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  }
}

export interface AiSeoSiteCheckContext {
  /** The form fields that are blank on the site now; only these may be proposed. */
  blank: ReadonlySet<AiSeoSiteFormField>
  /** Every word the site's pages show, for the contact details to be found in. */
  siteText: string
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The site proposal held to the form and to the site: lengths, and a contact
 * detail only when a page shows it. A detail no page shows is left out with
 * a note rather than asked for again — asking again invites composing one.
 */
export function checkAiSeoSite(
  answer: Record<string, unknown>,
  context: AiSeoSiteCheckContext,
): {
  value: { values: Partial<Record<AiSeoSiteFormField, string>>; notes: string[] } | null
  violations: AiDoctrineViolation[]
  offending?: Record<string, unknown>
} {
  const values: Partial<Record<AiSeoSiteFormField, string>> = {}
  const notes: string[] = []
  const violations: AiDoctrineViolation[] = []
  const offending: Record<string, unknown> = {}
  const put = (field: AiSeoSiteFormField, value: string) => {
    if (value && context.blank.has(field)) values[field] = value
  }

  const type = collapse(answer['entityType'])
  if (type && AI_SEO_ENTITY_TYPE_VALUES[type]) put('seo.entity.type', AI_SEO_ENTITY_TYPE_VALUES[type])
  put('seo.entity.name', collapse(answer['entityName']).slice(0, 200))

  const description = collapse(answer['entityDescription'])
  if (description.length > AI_SEO_ENTITY_DESCRIPTION_MAX_CHARS) {
    violations.push({
      rule: null,
      code: 'too-long',
      message: `The entity description is ${description.length} characters; the limit is ${AI_SEO_ENTITY_DESCRIPTION_MAX_CHARS}.`,
    })
    offending['entityDescription'] = description
  } else {
    put('seo.entity.description', description)
  }

  const siteText = context.siteText.toLowerCase()
  const siteDigits = context.siteText.replace(/\D+/g, '')
  const email = collapse(answer['contactEmail'])
  if (email) {
    if (EMAIL.test(email) && siteText.includes(email.toLowerCase())) put('seo.entity.email', email)
    else notes.push('A contact email was left out: no page of the site shows it.')
  }
  const telephone = collapse(answer['contactTelephone'])
  if (telephone) {
    const digits = telephone.replace(/\D+/g, '')
    if (digits.length >= 7 && siteDigits.includes(digits)) put('seo.entity.telephone', telephone)
    else notes.push('A contact telephone number was left out: no page of the site shows it.')
  }
  if (values['seo.entity.email'] || values['seo.entity.telephone']) {
    put('seo.entity.contactType', collapse(answer['contactType']).slice(0, 100))
  }

  for (const [key, field] of [
    ['whenToUse', 'seo.agent.whenToUse'],
    ['howToUse', 'seo.agent.howToUse'],
  ] as const) {
    const guidance = collapse(answer[key])
    if (guidance.length > AI_SEO_AGENT_GUIDANCE_MAX_CHARS) {
      violations.push({
        rule: null,
        code: 'too-long',
        message: `${key} is ${guidance.length} characters; the limit is ${AI_SEO_AGENT_GUIDANCE_MAX_CHARS}.`,
      })
      offending[key] = guidance
    } else {
      put(field, guidance)
    }
  }
  return violations.length ? { value: null, violations, offending } : { value: { values, notes }, violations: [] }
}
