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
import { AI_ROUTING_TABLE, aiModelForStep, type AiPluginSettings } from '../providers/routing'
import {
  AI_SEO_FIELDS_TOOL_NAME,
  aiSeoFieldsTool,
  checkAiSeoFields,
  orderedSeoListingFields,
} from '../tools/ai-seo-tool'
import {
  AI_ACCEPTABLE_USE_BLOCK,
  runAiRequest,
  type AiCompletion,
  type AiEffort,
  type AiMessage,
  type AiSystemBlock,
  type AiThinking,
  type AiTool,
  type AiUsage,
} from './ai-runtime'

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
 * literal. The rules are one static block, cached; the page's text, its
 * current listing, the site's name and the target keywords ride in the user
 * turn, so no byte of a site sits inside the cached prefix.
 */

/* ------------------------------------------------------------------------ *
 * The generation call, in the building doctrine's shape (AGL-2935)
 * ------------------------------------------------------------------------ */

/** A building doctrine rule number (AGL-2935). */
export type AiDoctrineRuleNumber =
  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17

/** What rule 17 weighs a generated document by. */
type AiBudgetMetric =
  | 'nodes' | 'bytes' | 'imageBytes' | 'embeds' | 'fontFamilies' | 'emailHtmlBytes'

/** One broken rule or refused value, as the doctrine names it. */
export interface AiDoctrineViolation {
  rule: AiDoctrineRuleNumber | null
  code: string
  /** One customer-safe sentence: what was refused and what to do instead. */
  message: string
  detail?: string
  nodeIds?: string[]
  paths?: string[]
  /**
   * Rule 17 only: a document's measured weight against its budget. A length
   * a listing's check refuses is said in `message`, never here.
   */
  figure?: { metric: AiBudgetMetric; value: number; budget: number }
}

/**
 * Stands for the doctrine's `AiSiteInventory` (AGL-2935). An SEO generation
 * reads the page it writes about and passes `null`.
 */
type AiSiteInventory = Readonly<Record<string, unknown>>

export interface AiGenerationInputBase {
  /** The routing table's step kind, never a model literal. */
  step: AiStepKind
  settings?: AiPluginSettings
  /** An already-resolved route (specs); else `aiModelForStep(step, settings)`. */
  model?: string
  /** The door's static text, cached after the shared block. */
  instructions: readonly AiSystemBlock[]
  inventory: AiSiteInventory | null
  messages: readonly AiMessage[]
  /** Strict. */
  tool: AiTool
  maxTokens?: number
  thinking?: AiThinking
  effort?: AiEffort
  signal?: AbortSignal
  provider?: AiProvider
}

export interface AiCustomGenerationInput<T> extends AiGenerationInputBase {
  check: (answer: Record<string, unknown>) => {
    value: T | null
    violations: AiDoctrineViolation[]
    offending?: Record<string, unknown>
  }
}

export interface AiGenerationSpend {
  attempts: number
  /** Summed over every call. */
  usage: AiUsage
  estCostUsd: number
  model: string
  stopReason: string | null
}

export type AiValidatedGeneration<T> =
  | (AiGenerationSpend & { status: 'ok'; value: T })
  | (AiGenerationSpend & {
      status: 'needs_input'
      violations: AiDoctrineViolation[]
      /** Customer-safe. */
      message: string
    })
  | (AiGenerationSpend & { status: 'refused' })

const ZERO_USAGE: AiUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  }
}

/** A custom kind's output budget when the door names none, as the doctrine sets it. */
const AI_CUSTOM_GENERATION_MAX_TOKENS = 8_000

/** How much of the offending part of an answer a re-ask quotes. */
const REASK_OFFENDING_MAX_CHARS = 2_000

/** The sentence a generation that could not be held to its checks ends with. */
export const AI_SEO_NEEDS_INPUT_COPY =
  'The AI could not propose values that fit. Try again, or write them yourself.'

/** The answer a completion carries: its call to the tool, else a JSON text answer. */
export function aiGenerationAnswer(
  result: Pick<AiCompletion, 'text' | 'toolUse'>,
  toolName: string,
): Record<string, unknown> | null {
  const call = result.toolUse.find((use) => use.name === toolName)
  if (call) return call.input
  const text = result.text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  if (!text.startsWith('{')) return null
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * STAND-IN: becomes `runValidatedGeneration(kind, …)` — the third, custom
 * overload the building doctrine (AGL-2935) posted — once that lands. The
 * input and the result are that function's, so the swap is an import and
 * the removal of this function and the types above it; every check stays in
 * its caller's `check`, and the acceptable-use block below becomes the
 * doctrine's block, which already carries it.
 *
 * Until then it behaves as the doctrine does: one call through the strict
 * tool, the answer read off the tool call or, failing that, a JSON text
 * answer; one re-ask naming only what was wrong and quoting only the parts
 * at fault; then `needs_input` with a customer-safe sentence. Usage from
 * every call is summed, because every call was spent. Rule 13 is held on the
 * answer: a generation proposes and never publishes. It throws only what
 * `runAiRequest` throws, so a job step's retry and failure paths stay the
 * machine's.
 */
export async function runValidatedGenerationStandIn<T>(
  _kind: string,
  input: AiCustomGenerationInput<T>,
): Promise<AiValidatedGeneration<T>> {
  const model = input.model ?? aiModelForStep(input.step, input.settings)
  const system: AiSystemBlock[] = [{ text: AI_ACCEPTABLE_USE_BLOCK }, ...input.instructions]
  let spend: AiGenerationSpend = {
    attempts: 0,
    usage: ZERO_USAGE,
    estCostUsd: 0,
    model,
    stopReason: null,
  }
  let violations: AiDoctrineViolation[] = []
  let reask: string | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const last = input.messages.length - 1
    const messages = input.messages.map((message, index) =>
      reask && index === last ? { ...message, content: `${message.content}\n\n${reask}` } : message,
    )
    const result = await runAiRequest({
      model,
      system,
      messages,
      tools: [input.tool],
      maxTokens: input.maxTokens ?? AI_CUSTOM_GENERATION_MAX_TOKENS,
      ...(input.thinking ? { thinking: input.thinking } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
      ...(input.settings ? { settings: input.settings } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      stream: false,
      ...(input.signal ? { signal: input.signal } : {}),
    })
    spend = {
      attempts: attempt + 1,
      usage: addUsage(spend.usage, result.usage),
      estCostUsd: Math.round((spend.estCostUsd + result.estCostUsd) * 1_000_000) / 1_000_000,
      model,
      stopReason: result.stopReason,
    }
    if (result.kind === 'refusal') return { ...spend, status: 'refused' }
    const answer = aiGenerationAnswer(result, input.tool.name)
    if (!answer) {
      violations = [
        { rule: null, code: 'no-answer', message: `The last reply did not call ${input.tool.name}.` },
      ]
      reask = `Your last reply did not call ${input.tool.name}. Answer by calling it.`
      continue
    }
    if (Object.prototype.hasOwnProperty.call(answer, 'publish')) {
      violations = [
        { rule: 13, code: 'publish', message: 'A proposal is a draft; it never asks to publish anything.' },
      ]
      reask = `${violations[0].message} Call ${input.tool.name} again with the proposal alone.`
      continue
    }
    const checked = input.check(answer)
    if (checked.value !== null) return { ...spend, status: 'ok', value: checked.value }
    violations = checked.violations.length
      ? checked.violations
      : [{ rule: null, code: 'unusable', message: 'Nothing in the last answer could be used.' }]
    const offending = checked.offending
      ? JSON.stringify(checked.offending).slice(0, REASK_OFFENDING_MAX_CHARS)
      : ''
    reask = [
      `Your last call to ${input.tool.name} broke these rules:`,
      ...violations.map((violation) => `- ${violation.message}`),
      ...(offending ? ['The parts at fault:', offending] : []),
      `Call ${input.tool.name} again with values that keep every rule.`,
    ].join('\n')
  }
  return { ...spend, status: 'needs_input', violations, message: AI_SEO_NEEDS_INPUT_COPY }
}

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

/** The rules, byte-identical on every request so they cache. */
export const AI_SEO_FIELDS_INSTRUCTIONS: AiSystemBlock[] = [
  {
    text:
      'You write the search listing for one page or one product of a website: the title and ' +
      'the summary a search result shows, the short name a breadcrumb trail uses, and a ' +
      'description of the share image.\n\n' +
      `Answer by calling ${AI_SEO_FIELDS_TOOL_NAME} exactly once. A reply in prose cannot be used.\n\n` +
      'Rules:\n' +
      '- Write only from the text you are given. Never invent a fact, a price, a name, a place, ' +
      'an offer or a claim the text does not state.\n' +
      '- The title says what this page is, specifically and in plain words. It is published ' +
      'exactly as written, so add the site name only where it fits and helps. Keep every length ' +
      'the tool states.\n' +
      '- The description is one or two sentences telling a searcher what they will find. No ' +
      'quotation marks, no emoji, no capitals for emphasis.\n' +
      '- The breadcrumb label is the page’s short name, one to three words.\n' +
      '- The image description says what the picture shows, never what the page is about. ' +
      'Answer null when nothing you were given says what the picture shows.\n' +
      '- A target keyword goes in only where the page is about it and it reads naturally: at ' +
      'most once in the title and once in the description. Never list keywords, never repeat a ' +
      'word to rank, and leave out a keyword the page is not about.\n' +
      '- Do not reuse a title another page of the site already uses.\n' +
      '- Write in the language of the page text.',
    cacheBreakpoint: true,
  },
]

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
  return runValidatedGenerationStandIn('seo-fields', {
    step: input.step ?? 'job.seo',
    ...(input.settings ? { settings: input.settings } : {}),
    ...(input.model ? { model: input.model } : {}),
    instructions: AI_SEO_FIELDS_INSTRUCTIONS,
    inventory: null,
    messages: [{ role: 'user', content: aiSeoFieldsPrompt({ ...input, fields, keywords }) }],
    tool: aiSeoFieldsTool(fields),
    maxTokens: AI_SEO_FIELDS_MAX_TOKENS,
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
