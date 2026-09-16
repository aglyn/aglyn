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

import type { SeoListingFieldKey } from '@aglyn/aglyn/app-utils/seo-listing-fields'
import type { AiSeoFieldValues } from '../model/ai-seo'
import type { AiStepKind } from '../providers/catalog'
import type { AiProvider } from '../providers/contract'
import { AI_ROUTING_TABLE, type AiPluginSettings } from '../providers/routing'
import {
  AI_SEO_FIELDS_TOOL_NAME,
  aiSeoFieldsTool,
  checkAiSeoFields,
  orderedSeoListingFields,
} from '../tools/ai-seo-tool'
import { runValidatedGeneration, type AiValidatedGeneration } from './ai-doctrine'
import type { AiSystemBlock } from './ai-runtime'

/**
 * SEO fields by AI (AGL-2910): a search listing — title, description,
 * breadcrumb label, image description — written from what a page or a
 * product actually says, and held to the lengths its editor enforces.
 *
 * `generateSeoFields` is the one entry point. The "Write SEO" card on a
 * page's SEO panel and on a product's listing calls it through an `seo` job,
 * and a page generator calls it for the title and description of the page it
 * builds. It proposes; it never writes a listing anywhere.
 *
 * The tool the model answers through, and the check that holds the answer to
 * the editor, are `tools/ai-seo-tool.ts`: the tool is built from the editor's
 * own field list, so a field and its length are said once.
 *
 * ## The request
 *
 * The fast tier through the routing table (`job.seo`), never a model
 * literal, and the building doctrine's generation call
 * (`runValidatedGeneration`, AGL-3009): the doctrine's cached block, which
 * carries the acceptable-use rules, then these rules, cached after it. The
 * page's text, its current listing, the site's name and the target keywords
 * ride in the user turn, so no byte of a site sits inside the cached prefix,
 * and no site inventory is sent: a listing is written from its page.
 */

/* ------------------------------------------------------------------------ *
 * The request
 * ------------------------------------------------------------------------ */

/**
 * The output budget, from the routing table. The largest answer the tool
 * accepts — every field at its limit — is under 300 tokens of JSON
 * (`ai-job-seo-step.spec.ts` measures it); the rest is headroom, and the fast
 * tier thinks in none of it.
 */
export const AI_SEO_FIELDS_MAX_TOKENS = AI_ROUTING_TABLE['job.seo'].maxTokens

/** How many other pages' titles a prompt lists for the model to avoid. */
const OTHER_TITLES_LISTED = 40

/**
 * What one listing field's rule ADDS to the tool's own description of that
 * field (AGL-2937), stated only when the field is asked for.
 *
 * The schema the answer arrives through is built from the editor's field
 * catalog, and it already names each field, says what the value is for and
 * states its length. It rides in the same request, ahead of these blocks, so
 * a rule that restated it would be the same sentence billed twice on a door
 * whose prompt no model will cache. Each rule here is therefore only what
 * the schema does not say: how to write the field rather than what it is.
 * The image description has no rule at all, because its description already
 * carries both halves of one — what it describes, and when to answer null.
 *
 * `runtime/ai-prompt-cache.spec.ts` holds the pair together: whatever
 * `checkAiSeoFields` can refuse an answer for, the request has to state
 * somewhere, in a block or in the schema.
 */
const AI_SEO_FIELD_RULES: Readonly<Partial<Record<SeoListingFieldKey, string>>> = {
  title:
    'The title says what the page is, specifically and in plain words; add the site name only where it helps.',
  description:
    'The description is one or two sentences: no quotation marks, no emoji, no capitals for emphasis.',
  breadcrumb: 'The breadcrumb label is one to three words.',
}

/** What a listing request carries, and therefore which rules it is sent. */
export interface AiSeoFieldsInstructionShape {
  fields: readonly SeoListingFieldKey[]
  keywords: boolean
  otherTitles: boolean
}

/**
 * The rules for one listing request.
 *
 * Byte-identical for every request of the same SHAPE, and identical across
 * workspaces at every shape: no site's name, text or listing is in here, so
 * two tenants writing the same kind of listing send the same rules. That is
 * the invariant `runtime/ai-prompt-cache.spec.ts` holds, and it is weaker
 * than "one block for everything" on purpose — a rule about target keywords
 * is worth nothing to a request that carries none, and `job.seo` runs on a
 * model that caches no prompt this short, so an unread rule is simply paid
 * for at full input rate on every attempt and every re-ask.
 */
export function aiSeoFieldsInstructions(
  shape: AiSeoFieldsInstructionShape,
): AiSystemBlock[] {
  const fields = orderedSeoListingFields(shape.fields)
  const rules = [
    'Write only from the text you are given. Never invent a fact, a price, a name, a place, an offer or a claim the text does not state.',
    ...fields.map((key) => AI_SEO_FIELD_RULES[key]).filter((rule): rule is string => Boolean(rule)),
    // Every field a person reads is held to this, keywords or none, so it is
    // stated on every shape rather than inside the keyword rule it used to
    // ride in: `checkAiSeoFields` refuses a repeat in a listing that named
    // no keywords too.
    'Never repeat the same word three times in one field.',
    ...(shape.keywords
      ? [
          'A target keyword goes in only where the page is about it and it reads naturally: at most once in the title and once in the description. Never list keywords, and leave out a keyword the page is not about.',
        ]
      : []),
    ...(shape.otherTitles
      ? ['Do not reuse a title another page of the site already uses.']
      : []),
    'Write in the language of the page text.',
  ]
  return [
    {
      text:
        'You write the search listing for one page or one product of a website: what a search result shows.\n\n' +
        `Answer by calling ${AI_SEO_FIELDS_TOOL_NAME} exactly once. A reply in prose cannot be used.\n\n` +
        `Rules:\n${rules.map((rule) => `- ${rule}`).join('\n')}`,
      cacheBreakpoint: true,
    },
  ]
}

/** The rules for a listing of the default shape, for a door that names no other. */
export const AI_SEO_FIELDS_INSTRUCTIONS: AiSystemBlock[] = aiSeoFieldsInstructions({
  fields: ['title', 'description', 'breadcrumb'],
  keywords: false,
  otherTitles: false,
})

export interface AiSeoFieldsPromptInput {
  subject: { kind: 'screen' | 'product'; name: string; path?: string | null }
  /** The site's name, as its visitors see it. */
  brand: string
  /** What the page or the product says: a page's Markdown, a product's description. */
  text: string
  fields: readonly SeoListingFieldKey[]
  current?: AiSeoFieldValues
  /**
   * What is known about the share image, when the listing has one: the
   * description it carries, and the page text around the same picture where
   * the page shows it.
   */
  image?: { alt?: string | null; context?: string | null } | null
  keywords?: readonly string[]
  otherTitles?: readonly string[]
}

/** The user turn: the subject, what it says now, and the page's own text. */
export function aiSeoFieldsPrompt(input: AiSeoFieldsPromptInput): string {
  const fields = orderedSeoListingFields(input.fields)
  const lines = [
    `Site: ${input.brand || 'untitled site'}`,
    input.subject.kind === 'product'
      ? `Product: ${input.subject.name || 'untitled product'}`
      : `Page: ${input.subject.name || 'untitled page'}${input.subject.path ? ` (${input.subject.path})` : ''}`,
    `Fields to write: ${fields.join(', ')}`,
  ]
  const current = fields
    .map((key) => [key, input.current?.[key]?.trim()] as const)
    .filter(([, value]) => Boolean(value))
  if (current.length) {
    lines.push('Current listing:', ...current.map(([key, value]) => `- ${key}: ${value}`))
  }
  if (input.image) {
    const known = [
      input.image.alt && `its current description: ${input.image.alt}`,
      input.image.context && `the page text beside it: ${input.image.context}`,
    ]
      .filter(Boolean)
      .join('; ')
    lines.push(`Share image: ${known || 'set, and nothing is known about what it shows'}`)
  }
  if (input.keywords?.length) lines.push(`Target keywords: ${input.keywords.join(', ')}`)
  if (input.otherTitles?.length) {
    lines.push(
      'Titles other pages already use:',
      ...input.otherTitles.slice(0, OTHER_TITLES_LISTED).map((title) => `- ${title}`),
    )
  }
  lines.push(
    '',
    input.subject.kind === 'product' ? 'Product description:' : 'Page text:',
    input.text.trim() || '(no text)',
  )
  return lines.join('\n')
}

export interface GenerateSeoFieldsInput extends Omit<AiSeoFieldsPromptInput, 'fields'> {
  /** The fields to write; the title, description and breadcrumb label when omitted. */
  fields?: readonly SeoListingFieldKey[]
  /** The step kind the call is routed as; `job.seo` when omitted. */
  step?: AiStepKind
  settings?: AiPluginSettings
  model?: string
  /**
   * The answer's ceiling: `AI_SEO_FIELDS_MAX_TOKENS` when omitted. A job step
   * passes the most its registered time allows on the model it runs
   * (AGL-3035).
   */
  maxTokens?: number
  signal?: AbortSignal
  provider?: AiProvider
}

/** What a listing is written with when the caller names no fields. */
export const AI_SEO_DEFAULT_FIELDS: readonly SeoListingFieldKey[] = ['title', 'description', 'breadcrumb']

/**
 * Propose a search listing for a page or a product.
 *
 * STABLE: a page generator calls this for the title and description of a
 * page it builds (`fields: ['title', 'description']`), and the `seo` job
 * calls it for a page's or a product's whole listing. It asks the routing
 * table's `job.seo` model through the doctrine's generation call and resolves
 * to its result — `ok` with the values, `needs_input` when the answer could
 * not be held to the editor after one re-ask, `refused` when the model
 * declined. It writes nothing.
 */
export async function generateSeoFields(
  input: GenerateSeoFieldsInput,
): Promise<AiValidatedGeneration<AiSeoFieldValues>> {
  const hasImage = Boolean(input.image)
  const fields = orderedSeoListingFields(input.fields ?? AI_SEO_DEFAULT_FIELDS).filter(
    (key) => key !== 'imageAlt' || hasImage,
  )
  const keywords = input.keywords ?? []
  return runValidatedGeneration('seo-fields', {
    step: input.step ?? 'job.seo',
    ...(input.settings ? { settings: input.settings } : {}),
    ...(input.model ? { model: input.model } : {}),
    instructions: aiSeoFieldsInstructions({
      fields,
      keywords: keywords.length > 0,
      otherTitles: Boolean(input.otherTitles?.length),
    }),
    messages: [{ role: 'user', content: aiSeoFieldsPrompt({ ...input, fields, keywords }) }],
    tool: aiSeoFieldsTool(fields),
    maxTokens: input.maxTokens ?? AI_SEO_FIELDS_MAX_TOKENS,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    check: (answer) =>
      checkAiSeoFields(answer, {
        fields,
        hasImage,
        keywords,
        otherTitles: input.otherTitles,
      }),
  })
}
