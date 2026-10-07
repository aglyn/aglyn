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

import { SCREEN_SEO_TEXT_GUIDANCE } from '@aglyn/aglyn/app-utils/screen-seo-fields'
import type { AiJobOutput } from './ai-jobs.types'
import { aiSiteWords, type AiSiteWords } from './ai-site-job'

/**
 * The site's own search listing, from the answers (AGL-2918).
 *
 * A site has two SEO title-and-description pairs. A page's is the page's, and
 * the scaffold's page step writes one for each page it builds. The SITE's is
 * the fallback every page with none of its own publishes, and it is the one
 * nothing was filling: a newly created site carries whatever its creation
 * seeded, which is its subdomain or its display name, and a scaffolded site
 * would publish pages listed under that.
 *
 * ── Derived, not generated ───────────────────────────────────────────────
 *
 * The two values here are arithmetic on what the person typed, not a model's
 * writing, and that is deliberate on three counts. The answers are already
 * the sentence the fallback wants — "what kind of site" IS what the site is,
 * and "who it is for" IS who it is for. It costs nothing, on a job that is
 * already tens of model calls. And it is available on the scaffold's first
 * pass, so the proposal is waiting while the pages are still building rather
 * than arriving after them.
 *
 * ── A proposal, never a write ────────────────────────────────────────────
 *
 * Nothing here writes the site's settings. The values travel as a job output
 * and land in the site SEO form as unsaved edits through the `hostSeo` zone's
 * own `proposeDraft`; the form's Update is what stores them, and a person who
 * never opens that form is left with exactly what they had.
 *
 * Pure: strings in, strings out, no Firestore and no React.
 */

/**
 * The site SEO form's field names, which are what a proposal is keyed by.
 *
 * The same two strings the host settings SEO section names its Title and
 * Description inputs. They are stated here rather than imported because the
 * form is the console's and this is a plugin: the zone's `proposeDraft`
 * ignores a key the form does not edit, so a name that drifted would stage
 * nothing rather than stage something wrong.
 */
export const AI_SITE_SEO_FORM_FIELDS = {
  title: 'seo.title',
  description: 'seo.description',
} as const

export type AiSiteSeoFormField =
  (typeof AI_SITE_SEO_FORM_FIELDS)[keyof typeof AI_SITE_SEO_FORM_FIELDS]

/**
 * What each value is held to: the lengths the SEO editors guide a listing to,
 * which are the same two the host settings form counts down from.
 */
export const AI_SITE_SEO_LIMITS = SCREEN_SEO_TEXT_GUIDANCE

/** The kind an `seo` output carries when it is a guided start's site listing. */
export const AI_SITE_SEO_PROPOSAL_KIND = 'site-listing'

/** The id the scaffold reports its one site listing under. */
export const AI_SITE_SEO_OUTPUT_ID = 'site:listing'

export interface AiSiteSeoProposal {
  kind: typeof AI_SITE_SEO_PROPOSAL_KIND
  /** Values for the site SEO form, by field name. */
  values: Record<AiSiteSeoFormField, string>
  /** Customer-safe lines about where the words came from. */
  notes: string[]
}

/** What the proposal says about itself wherever it is shown. */
export const AI_SITE_SEO_NOTE =
  'Written from what you said the site is and who it is for, not from its pages — read it before you save it.'

/**
 * Words a phrase never ends on (AGL-3596): a title cut after "for" or "that"
 * reads as broken mid-sentence, which a search result shows to everybody.
 */
const DANGLING = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'so',
  'that', 'the', 'to', 'which', 'who', 'with', 'where', 'whose', 'while', 'your', 'our', '—', '-', '–', '&',
])

/** Without the words a phrase never ends on, or the punctuation before them. */
function withoutDangling(text: string): string {
  const words = text.split(' ')
  while (words.length > 1 && DANGLING.has(words[words.length - 1].toLowerCase())) words.pop()
  return words.join(' ').replace(/[\s,;:—–-]+$/, '').trim()
}

/** Held to a length, cut at a word rather than mid-word, and never on a dangling word. */
function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max + 1)
  const space = cut.lastIndexOf(' ')
  return withoutDangling((space > max / 2 ? cut.slice(0, space) : text.slice(0, max)).trim())
}

/**
 * Where the first clause of an answer ends: "a dog groomer in Austin THAT
 * takes bookings for…" is a subject and then a sentence about it. A title
 * keeps the subject.
 */
const CLAUSE_BOUNDARY =
  /\s+(?:that|which|who|whose|where|offering|providing|specializing|serving|helping|so|because|with|for|to|by|and|but)\b|[,;:(—–]|\s-\s/i

/**
 * A short search title (AGL-3596): the business's name, what it is and where,
 * held to the title cap and never cut mid-phrase. The answer to "what kind of
 * site" is often a whole sentence, and cutting that sentence at sixty
 * characters published "…that takes bookings for" as a site's title.
 *
 * The longest of these that fits wins: the whole answer; its first clause
 * (the subject before "that", "for", a comma…); that clause without its
 * place. The city the person gave is added where the words do not already
 * say it, and the name leads where there is one. Only when even the shortest
 * does not fit is it cut, at a word, never on a dangling one.
 */
export function aiSiteSeoTitle(input: { name?: string; subject: string; city?: string }): string {
  const max = AI_SITE_SEO_LIMITS.title
  const name = (input.name ?? '').replace(/\s+/g, ' ').trim()
  const subject = withoutDangling(input.subject.replace(/\s+/g, ' ').trim())
  const city = (input.city ?? '').replace(/\s+/g, ' ').trim()
  const placed = (what: string) =>
    city && !what.toLowerCase().includes(city.toLowerCase()) ? `${what} in ${city}` : what
  const boundary = subject.search(CLAUSE_BOUNDARY)
  const clause = withoutDangling(boundary > 0 ? subject.slice(0, boundary) : subject)
  const bare = withoutDangling(clause.replace(/\s+in\s+[^]*$/i, '')) || clause
  const whats = [...new Set([placed(subject), subject, placed(clause), clause, bare])]
  const candidates = name ? [...whats.map((what) => `${name} — ${what}`), name] : whats
  const fits = candidates.find((candidate) => candidate.length <= max)
  return fits ?? clip(candidates[candidates.length - 1], max)
}

/**
 * Where a phrase may be cut without leaving half a thought (AGL-3596): before
 * a relative clause, or before a "with" or "for" phrase, or at a semicolon or
 * dash. A bare comma is not one — "a calm, gentle groom" cut at its comma
 * ends on an adjective — and neither is "and", which joins a list.
 */
const PHRASE_BOUNDARY = /\s+(?:that|which|who|whose|where|while|because|with|for|offering|providing|serving)\b|[;(—–]|\s-\s/gi

/** A phrase and its shorter forms, longest first: itself, then cut before each boundary, back to front. */
function phraseForms(text: string): string[] {
  const forms = [text]
  const cuts = [...text.matchAll(PHRASE_BOUNDARY)].map((match) => match.index ?? -1).filter((at) => at > 0)
  for (const at of cuts.reverse()) {
    const form = withoutDangling(text.slice(0, at).trim())
    if (form && !forms.includes(form)) forms.push(form)
  }
  return forms
}

/**
 * The site's search description (AGL-3596): what the site is, then who it is
 * for, composed WITHIN the description cap at phrase boundaries rather than
 * cut at it. Cut at 155 characters, "…for dog owners in Hillside and nearby
 * towns who want a calm, gentle" went out as a site's description. So the
 * longest whole composition that fits wins: all of both; the audience without
 * its trailing clauses; what the site is alone; then what the site is, cut
 * back the same way. Only when not even the subject fits is it clipped at a
 * word, never on a dangling one.
 */
export function aiSiteSeoDescription(input: { name: string; subject: string; about: string; audience: string }): string {
  const max = AI_SITE_SEO_LIMITS.description
  const lead = (what: string) => (input.name ? `${input.name} is ${what}` : asSubject(what))
  const abouts = phraseForms(withoutDangling(input.about.replace(/[.!?]+$/, '')))
  const audiences = input.audience ? phraseForms(withoutDangling(input.audience.replace(/[.!?]+$/, ''))) : []
  for (const about of abouts) {
    for (const audience of audiences) {
      const text = sentence(`${lead(about)}, for ${audience}`)
      if (text.length <= max) return text
    }
    const text = sentence(lead(about))
    if (text.length <= max) return text
  }
  return clip(sentence(lead(abouts[abouts.length - 1] || input.subject)), max)
}

/**
 * The leading article dropped and the first letter raised: "a neighborhood
 * dog groomer" is how a person answers the question and is not how a title
 * starts. Anything the person already capitalized is left alone, so a name
 * typed as the site type survives.
 */
function asSubject(about: string): string {
  // `\b` rather than `\s+`, so an answer that is ONLY an article leaves
  // nothing behind and the caller proposes nothing: a one-letter title is a
  // worse thing to stage into a required field than no proposal at all.
  const text = about.replace(/\s+/g, ' ').trim().replace(/^(?:an?|the)\b\s*/i, '')
  if (!text) return ''
  return text[0].toUpperCase() + text.slice(1)
}

/** A sentence closed with one period, and never two. */
function sentence(text: string): string {
  const trimmed = text.trim()
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/**
 * What the listing is built from: either answer may be missing, because the
 * guided start requires only the first of them.
 */
export interface AiSiteSeoInput extends Partial<AiSiteWords> {
  /** The site's own name where the job carries one; empty for a site named on its pages. */
  siteName?: string
  /** The city the person gave, where they gave one. */
  city?: string
}

/**
 * The site's fallback listing from the answers, or `null` when the answers
 * describe no site at all — a job with no `businessType` has nothing to
 * propose, and an empty proposal is worse than none.
 */
export function aiSiteSeoProposal(input: AiSiteSeoInput): AiSiteSeoProposal | null {
  const subject = asSubject(input.about ?? '')
  if (!subject) return null
  const name = (input.siteName ?? '').replace(/\s+/g, ' ').trim()
  const audience = (input.audience ?? '').replace(/\s+/g, ' ').trim()
  const title = aiSiteSeoTitle({ name, subject, city: input.city })
  const about = (input.about ?? '').replace(/\s+/g, ' ').trim()
  const description = aiSiteSeoDescription({ name, subject, about, audience })
  return {
    kind: AI_SITE_SEO_PROPOSAL_KIND,
    values: {
      [AI_SITE_SEO_FORM_FIELDS.title]: title,
      [AI_SITE_SEO_FORM_FIELDS.description]: description,
    },
    notes: [AI_SITE_SEO_NOTE],
  }
}

/** The proposal a job's inputs imply, for the step that reports it. */
export function aiSiteSeoProposalForInputs(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): AiSiteSeoProposal | null {
  const words = aiSiteWords(inputs)
  const businessName = inputs?.['businessName']
  const city = inputs?.['city']
  return aiSiteSeoProposal({
    ...words,
    ...(typeof businessName === 'string' ? { siteName: businessName } : {}),
    ...(typeof city === 'string' ? { city } : {}),
  })
}

/** Whether a value is a record the reader may look inside. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The site listing a job's outputs carry, or `null` when they carry none.
 *
 * Read defensively: an output is whatever a past release wrote, so a proposal
 * whose values are not two strings is treated as no proposal rather than
 * staged into somebody's live SEO form.
 */
export function aiSiteSeoProposalOf(
  outputs: readonly Pick<AiJobOutput, 'resource' | 'proposal'>[] | null | undefined,
): AiSiteSeoProposal | null {
  for (const output of outputs ?? []) {
    if (output.resource !== 'seo') continue
    const proposal = output.proposal
    if (!isRecord(proposal) || proposal['kind'] !== AI_SITE_SEO_PROPOSAL_KIND) continue
    const values = isRecord(proposal['values']) ? proposal['values'] : {}
    const title = values[AI_SITE_SEO_FORM_FIELDS.title]
    const description = values[AI_SITE_SEO_FORM_FIELDS.description]
    if (typeof title !== 'string' || typeof description !== 'string') continue
    if (!title.trim() || !description.trim()) continue
    const notes = Array.isArray(proposal['notes'])
      ? proposal['notes'].filter((note): note is string => typeof note === 'string')
      : []
    return {
      kind: AI_SITE_SEO_PROPOSAL_KIND,
      values: {
        [AI_SITE_SEO_FORM_FIELDS.title]: title,
        [AI_SITE_SEO_FORM_FIELDS.description]: description,
      },
      notes,
    }
  }
  return null
}
