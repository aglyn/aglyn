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

import type { PluginSubprocessorDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'
import type { AiModelDescriptor, AiUsage } from './contract'

/**
 * The model catalog (AGL-2939): every model id the plugin will route to,
 * with its provider, its display name, its capabilities and its list rates.
 * The ONE place a model id is written outside a provider adapter — the
 * routing table maps a step kind to an id through here, the meter prices
 * usage by id through here, and a settings form offers ids from here.
 *
 * ## Two rates, because one figure was answering two questions
 *
 * Every row carries a PROVIDER rate and a BILLED rate (AGL-3015):
 *
 * - `providerRates` is what the vendor charges us. It is money leaving the
 *   company, so cost accounting, the margin surfaces and every staff spend
 *   meter price usage through this one and no other.
 * - `billedRates` is what a customer's credits are charged at. The credit
 *   meter, the band, the overage ladder and the model selector price usage
 *   through this one, because it is the figure a customer's balance moves by.
 *
 * They are equal on nearly every row, and a helper writes the pair from one
 * figure so an unmarked row cannot drift apart by a typo. A row may be
 * billed ABOVE its provider rate deliberately — the markup is carried in the
 * rate rather than in the credit conversion, which keeps a credit a fixed
 * quantity of billed spend on every model and leaves the band, the ladder
 * and the invoice on the one arithmetic they were sized with. A row billed
 * BELOW its provider rate would sell tokens at a loss, and
 * `billed-rate-is-not-provider-cost.spec.ts` refuses one.
 *
 * Both are keyed by model rather than fixed at one model's rates because the
 * default is an env override: a one-line incident swap to a dearer model
 * would otherwise keep reporting the cheaper money, and per-org cost would
 * read as roughly right — the failure mode this whole meter exists to
 * prevent. An unknown id falls back to the most EXPENSIVE known tier on
 * purpose, on both rates: an estimate that errs low is worse than one that
 * errs high, whether the figure is our bill or the customer's.
 */

export interface AiTokenRates {
  inputPerToken: number
  outputPerToken: number
  cacheReadPerToken: number
  cacheWritePerToken: number
}

/** List price per MTok → per-token rates, cache read at 0.1x, write 1.25x. */
export function aiRatesPerMTok(inputPerMTok: number, outputPerMTok: number): AiTokenRates {
  return {
    inputPerToken: inputPerMTok / 1_000_000,
    outputPerToken: outputPerMTok / 1_000_000,
    cacheReadPerToken: (inputPerMTok * 0.1) / 1_000_000,
    cacheWritePerToken: (inputPerMTok * 1.25) / 1_000_000,
  }
}

/**
 * The two rate tables a catalog row carries. Separate fields rather than one
 * table and a multiplier: a reader that wants our cost has to name it, and
 * a reader that wants the customer's has to name that, so neither can be
 * reached by accident.
 */
export interface AiCatalogRates {
  /** What the provider bills us for this model. */
  providerRates: AiTokenRates
  /** What a customer's credits are charged at for this model. */
  billedRates: AiTokenRates
}

/**
 * A row billed at exactly the provider's list rate — the usual case, written
 * once so the pair cannot drift.
 */
export function aiRatesAtList(
  inputPerMTok: number,
  outputPerMTok: number,
): AiCatalogRates {
  return {
    providerRates: aiRatesPerMTok(inputPerMTok, outputPerMTok),
    billedRates: aiRatesPerMTok(inputPerMTok, outputPerMTok),
  }
}

/** {@link aiRatesAtList} for a model whose cache read is not a tenth of its input price. */
export function aiRatesAtListWithCacheRead(
  inputPerMTok: number,
  outputPerMTok: number,
  cacheReadPerMTok: number,
): AiCatalogRates {
  const rates = { ...aiRatesPerMTok(inputPerMTok, outputPerMTok), cacheReadPerToken: cacheReadPerMTok / 1_000_000 }
  return { providerRates: rates, billedRates: { ...rates } }
}

export interface AiCatalogEntry extends AiModelDescriptor, AiCatalogRates {
  /**
   * The tier a routing decision reads: `fast` for short, constrained
   * answers; `balanced` for the assistant and briefs; `deep` for the
   * dearest, slowest class.
   */
  tier: 'fast' | 'balanced' | 'deep'
  /**
   * The shortest prefix this model's provider will cache (AGL-2937). A
   * request whose cached span falls under it is served with the markers
   * honored and NOTHING cached: no error, no warning, and a usage report
   * that reads as a permanent cache miss.
   *
   * It is a property of the model rather than of the tier or the vendor,
   * and it does not fall as a generation advances — so the number has to be
   * written beside the model, and a door that means to cache has to be held
   * to it (`aiCachedPrefixCaches` in the runtime, and the door table in
   * `runtime/ai-prompt-cache.spec.ts`). Without it, "this block carries a
   * breakpoint" is a claim nothing checks, and a prompt can be designed
   * around a cache it never had.
   */
  cacheMinTokens: number
}

/**
 * The sentinels a docs-only answer is metered under (AGL-2486): not
 * models, but ids the meter sees, priced at zero so a deflected turn lands
 * in the same rollup as a served one and a keyless deployment does not
 * read as the most efficient one on the platform.
 */
export const AI_METER_SENTINELS = {
  docsRetrieval: 'docs-retrieval',
  docsLinks: 'docs-links',
  answerCache: 'assist-cache',
} as const

const ANTHROPIC = 'anthropic'
const OPENAI_COMPATIBLE = 'openai-compatible'

/**
 * A provider's row on the published subprocessor list: every field but the
 * host, which the registered adapter reports as its `endpointHost`.
 * `{apiKeyEnv}` anywhere in the wording stands for the adapter's
 * `apiKeyEnv`, so a credential's name is written in its adapter alone and
 * never in this module, which the browser bundle carries.
 */
export type AiProviderSubprocessorWording = Omit<PluginSubprocessorDeclaration, 'host'>

/** A provider the catalog carries models for. */
export interface AiCatalogProvider {
  id: string
  /** The name a settings form shows. */
  label: string
  /**
   * The vendor's row on the published subprocessor list, written here and
   * nowhere else: `aiSubprocessors` derives the plugin's declarations from
   * it. Absent for a provider whose endpoint an operator names, which has
   * no fixed recipient to publish.
   */
  subprocessor?: AiProviderSubprocessorWording
}

/**
 * The Anthropic row's data cell up to its CRM sentence: every door but CRM
 * assistance, worded once for both of the CRM sentences below.
 */
const ANTHROPIC_DATA_RECEIVED_LEAD =
  "What the user submits — a question, instruction or brief, with the earlier messages of the same Assist conversation — and the content of the element, post, section or page being worked on, with the generated response. On Pro and above, the organization's name and the console route and host travel with an Assist question. For an edit the assistant proposes in the besigner, an outline of the open page, component or layout: element and component ids, layer names, shortened setting values and the selected element's styles. For a generation job, the site inventory: the names and addresses of its pages and collections, the names of its components, layouts, templates, forms and datasets with their prop and field names, and the theme's summary, colors and fonts. For a theme change, the site's current theme settings and brand colors as hex values, from the organization's brand settings, the site logo in the media library or a public page the brief links to. For features that review or write search information, the text and structure of the pages concerned. For product copy, the store's name, the product's name, type, description, tags, options and search listing, the store's category names, and the product's first media-library photo as a copy at most 768 px on its longer edge with its metadata stripped; never another media file, a price, stock, an order or a customer. For products, categories and discounts proposed from a brief, the store's name and its existing category names. For an automation drafted from a brief, which of CRM, webhooks and bookings the plan includes; for an explanation, the automation's outline (trigger, conditions, each step's text with the names of the lists, campaigns, workflows, webhooks and datasets it uses and whether each exists, and a workflow's function names and expressions) and, for a failed run, its time, steps and recorded errors, with email addresses removed and never the triggering event's data. For an insight, the figure reports available and aggregate tables: traffic with top page paths, referrers and campaign tags; form views and submissions; revenue, orders and best-selling product names; bookings by service; campaign subjects with delivery, open and click rates; A/B test and variant conversions; and, for a dataset the member can see, field names and types, record and fill counts, number ranges and totals grouped by a value at least three records share. Email addresses and phone numbers are removed, and no individual record is sent. "

/** What every CRM door adds after its record sentence: drafts and imports. */
const ANTHROPIC_DATA_RECEIVED_CRM_DRAFTS_AND_IMPORTS =
  "An email draft adds the request and the record's merge field names; an import sends the field names and types and each column's header and value kind, never a row."

/** How the data cell words CRM assistance: what a record sends, and what never leaves. */
export interface AnthropicCrmAssistanceWording {
  record: string
  never: string
}

/**
 * CRM assistance as `/legal/subprocessors` published it until October 5,
 * 2026: the disclosed fields of a record, with addresses and numbers in its
 * text replaced. It is still what production sends while
 * `release_crm_assist_whole_record` is off, which the published wording
 * covers: the row describes what the CRM can send, not who has it on.
 */
export const ANTHROPIC_CRM_ASSISTANCE_DISCLOSED: AnthropicCrmAssistanceWording = {
  record:
    "For CRM assistance, the opened contact, company, deal or lead as the CRM shows it: its name and, by kind, job title, company, lifecycle stage, tags, capture history and counts, domain, industry, headcount, pipeline stages, status, amount, dates, lost reason, parties and lead status, with its notes, newest timeline entries and open tasks and deals. Email addresses and phone numbers in that text are replaced, and no email, phone or postal field, marketing consent, custom field value, team member or record id is sent.",
  never: 'No account identifiers, email addresses or authentication tokens.',
}

/**
 * CRM assistance once the whole record is sent (AGL-3520): the open-ended
 * wording the Subprocessors row and Privacy Policy section 2 were
 * republished with on October 5, 2026 (legal v10), before
 * `release_crm_assist_whole_record` may be turned on. The catalog row below
 * carries it in `dataReceived`.
 */
export const ANTHROPIC_CRM_ASSISTANCE_WHOLE_RECORD: AnthropicCrmAssistanceWording = {
  record:
    'For CRM assistance, the opened record as the CRM shows it, with all of its standard and custom fields, including contact details, notes, timeline and related records.',
  never: 'No account identifiers or authentication tokens, and no email address outside an opened CRM record.',
}

/** The Anthropic row's data cell, with CRM assistance worded as `crm` words it. */
export function anthropicDataReceived(crm: AnthropicCrmAssistanceWording): string {
  return `${ANTHROPIC_DATA_RECEIVED_LEAD}${crm.record} ${ANTHROPIC_DATA_RECEIVED_CRM_DRAFTS_AND_IMPORTS} ${crm.never}`
}

/**
 * The providers the catalog carries models for, with the name a settings
 * form shows. A form offers providers from here for the reason it offers
 * models from here: nothing outside this folder names a vendor. For the
 * same reason a vendor's subprocessor row is written here too.
 */
export const AI_CATALOG_PROVIDERS: readonly AiCatalogProvider[] = [
  {
    id: ANTHROPIC,
    label: 'Anthropic',
    subprocessor: {
      entity: 'Anthropic, PBC',
      region: 'United States',
      purpose:
        "AI features of the Services, including the Aglyn Assist helper: creating, editing and reviewing content, drafts and settings for a customer’s site, store and CRM, and explaining and summarizing the customer’s own setup and data",
      publishedOn: '2026-10-07',
      reason:
        "Reached through the AI plugin's Anthropic adapter (`libs/plugins/ai/src/lib/providers/anthropic.ts`) by the doors that call the AI runtime. `libs/plugins/ai/src/lib/server/assist-chat.ts` is gated by `release_assist` AND the key, and a generation job's text step by `release_ai_generative`; `libs/plugins/ai/src/lib/server/ai-assist.ts` carries NO release flag, so setting `{apiKeyEnv}` in production is by itself what starts this flow. `assist-anthropic-subprocessor-gate.spec.ts` holds the per-door detail and is the deeper guard for this one vendor.",
      dataReceived: anthropicDataReceived(ANTHROPIC_CRM_ASSISTANCE_WHOLE_RECORD),
    },
  },
  { id: OPENAI_COMPATIBLE, label: 'OpenAI-compatible endpoint' },
]

/**
 * `vision` is written on every row rather than assumed (AGL-2916): each model
 * below reads a picture in a user turn, in the four formats
 * `AI_IMAGE_MEDIA_TYPES` names, as its vendor documents. A row added without
 * it reads as a model that does not, and is never sent one.
 */
const anthropicCapabilities = {
  streaming: true,
  tools: true,
  thinking: true,
  promptCache: true,
  vision: true,
}

export const AI_MODEL_CATALOG: readonly AiCatalogEntry[] = [
  {
    // THE BALANCED TIER'S DEFAULT (AGL-3660): the first balanced row is what
    // `aiDefaultModelFor` answers, so Free, "Auto" and every step routed to
    // balanced run here. Rejects `thinking: {type: "disabled"}` and forced
    // tool choice: the adapter sends thinking off as `between_tools` and
    // every tool call with `tool_choice: auto`.
    id: 'claude-sonnet-5-5',
    provider: ANTHROPIC,
    label: 'Claude Sonnet 5.5',
    capabilities: anthropicCapabilities,
    /*
     * THE ROWS BILLED ABOVE THEIR PROVIDER RATE (AGL-3015).
     *
     * The balanced tier prices most requests, so this markup is most of the
     * platform's AI margin. It is carried in the rate and not in the credit
     * conversion for the reason the module head gives: a credit stays a
     * fixed quantity of billed spend on every model, so the band, the
     * overage ladder and the invoice keep the arithmetic they were sized
     * with, and nothing below has to know which model served a request.
     *
     * Everything that reasons about what we PAY — the margin surfaces, the
     * staff spend meters, the discount guardrail's cost of goods — reads
     * `providerRates`, which is the vendor's published list. Sonnet 5.5's
     * list is Sonnet 5's, except a cache read: $0.10/MTok, a twentieth of
     * input. A customer is billed exactly what Sonnet 5 billed, so the
     * balanced tier's prices do not move when its default does.
     */
    providerRates: { ...aiRatesPerMTok(2, 10), cacheReadPerToken: 0.1 / 1_000_000 },
    billedRates: aiRatesPerMTok(3, 15),
    tier: 'balanced',
    cacheMinTokens: 512,
  },
  {
    // The balanced default until AGL-3660, kept so a workspace that chose it
    // and every recording that names it still resolve, at the same rates.
    id: 'claude-sonnet-5',
    provider: ANTHROPIC,
    label: 'Claude Sonnet 5',
    capabilities: anthropicCapabilities,
    providerRates: aiRatesPerMTok(2, 10),
    billedRates: aiRatesPerMTok(3, 15),
    tier: 'balanced',
    cacheMinTokens: 1_024,
  },
  {
    id: 'claude-sonnet-4-6',
    provider: ANTHROPIC,
    label: 'Claude Sonnet 4.6',
    capabilities: anthropicCapabilities,
    ...aiRatesAtList(3, 15),
    tier: 'balanced',
    cacheMinTokens: 1_024,
  },
  {
    // Rejects an explicit `thinking` setting; the runtime omits it.
    id: 'claude-haiku-4-5',
    provider: ANTHROPIC,
    label: 'Claude Haiku 4.5',
    capabilities: { ...anthropicCapabilities, thinking: false },
    ...aiRatesAtList(1, 5),
    tier: 'fast',
    // Four times the balanced tier's minimum: the cheapest model per token
    // is the hardest one to cache for, which is why a short prompt moved
    // here can cost more per request than it saved per token.
    cacheMinTokens: 4_096,
  },
  {
    id: 'claude-opus-5',
    provider: ANTHROPIC,
    label: 'Claude Opus 5',
    capabilities: anthropicCapabilities,
    ...aiRatesAtList(5, 25),
    tier: 'deep',
    cacheMinTokens: 512,
  },
  {
    // Listed for a side-by-side comparison (AGL-3660); the deep tier's
    // default stays claude-opus-5 above. Thinking cannot be disabled and its
    // effort defaults to medium, so the adapter omits thinking where a step
    // asks for it off and names effort high where a step names none — Opus
    // 5's own default. Forced tool choice is refused; the adapter sends auto.
    id: 'claude-opus-5-5',
    provider: ANTHROPIC,
    label: 'Claude Opus 5.5',
    capabilities: anthropicCapabilities,
    // At list, like its deep-tier siblings. A cache read is $0.20/MTok, a
    // twentieth of input rather than the usual tenth.
    ...aiRatesAtListWithCacheRead(4, 20, 0.2),
    tier: 'deep',
    cacheMinTokens: 512,
  },
  {
    id: 'claude-opus-4-8',
    provider: ANTHROPIC,
    label: 'Claude Opus 4.8',
    capabilities: anthropicCapabilities,
    ...aiRatesAtList(5, 25),
    tier: 'deep',
    cacheMinTokens: 1_024,
  },
  /**
   * The OpenAI-compatible adapter serves whatever the endpoint behind
   * `AI_OPENAI_COMPAT_BASE_URL` serves; these are the ids the routing table
   * may name on it. The figures are the vendor's public list, billed at
   * list: a deployment that reaches its own gateway at a negotiated price
   * is paying less than this says, so its margin reads low rather than
   * high — the direction a cost figure may be wrong in.
   */
  {
    id: 'gpt-5',
    provider: OPENAI_COMPATIBLE,
    label: 'GPT-5',
    capabilities: { streaming: true, tools: true, thinking: false, promptCache: true, vision: true },
    ...aiRatesAtList(1.25, 10),
    tier: 'balanced',
    cacheMinTokens: 1_024,
  },
  {
    id: 'gpt-5-mini',
    provider: OPENAI_COMPATIBLE,
    label: 'GPT-5 mini',
    capabilities: { streaming: true, tools: true, thinking: false, promptCache: true, vision: true },
    ...aiRatesAtList(0.25, 2),
    tier: 'fast',
    cacheMinTokens: 1_024,
  },
]

/**
 * The IMAGE models (AGL-3602): every model id the Media library's "Create
 * with AI" photo mode may route to — Google's Gemini image models on Vertex
 * AI — with a per-picture provider rate and a per-picture billed rate, and the
 * token rates the same request's prompt and thinking are billed at. Kept
 * apart from `AI_MODEL_CATALOG` because nothing that lists text models — the
 * model selector, the routing table, the allotments' allowlists — may ever
 * offer one of these for a conversation.
 *
 * ## The rates
 *
 * Google prices an output picture as image-output tokens: Gemini 3.1 Flash
 * Image writes a 1K picture as 1,120 tokens at $60 per million on the global
 * endpoint, so $0.0672 a picture. Its prompt is input tokens ($0.50 per
 * million) and its thinking is text output ($3.00 per million). Every figure
 * here is the global endpoint's list price, read from Google's Vertex AI
 * pricing page on 2026-10-06; a regional endpoint lists 10% higher, so a
 * deployment that moves off `global` reads its cost low by that much.
 *
 * Every billed figure is the provider figure at `AI_IMAGE_BILLED_MARKUP`:
 * the same ratio the balanced text tier is billed at over its provider rate
 * (Claude Sonnet 5, $3/$15 billed over $2/$10), so a credit buys the same
 * share of margin whether it is spent on words or on pictures. A picture is
 * NEVER billed at provider cost; `billed-rate-is-not-provider-cost.spec.ts`
 * refuses a row that is.
 *
 * A credit is $0.001 of billed spend (`ASSIST_CREDIT_COST_USD`), so the
 * default model's picture is 101 credits before its prompt and thinking.
 */
export interface AiImageCatalogEntry extends AiCatalogRates {
  id: string
  /** The image provider the model is served by. */
  provider: string
  label: string
  /** What the provider bills us for one generated picture. */
  providerUsdPerImage: number
  /** What one picture draws from a customer's credits. */
  billedUsdPerImage: number
}

/**
 * The billed rate over the provider rate: the balanced text tier's own markup
 * (`claude-sonnet-5`, 3 / 2), restated as a number so an image row cannot be
 * written at list by accident.
 */
export const AI_IMAGE_BILLED_MARKUP = 1.5

/**
 * An image row's four figures from Google's list prices — USD per output
 * picture, and USD per million input and text-output tokens — each billed at
 * `AI_IMAGE_BILLED_MARKUP`.
 */
export function aiImageRatesAtMarkup(
  providerUsdPerImage: number,
  inputPerMTok: number,
  outputPerMTok: number,
): Pick<
  AiImageCatalogEntry,
  'providerUsdPerImage' | 'billedUsdPerImage' | 'providerRates' | 'billedRates'
> {
  return {
    providerUsdPerImage,
    billedUsdPerImage: roundUsd(providerUsdPerImage * AI_IMAGE_BILLED_MARKUP),
    providerRates: aiRatesPerMTok(inputPerMTok, outputPerMTok),
    billedRates: aiRatesPerMTok(
      inputPerMTok * AI_IMAGE_BILLED_MARKUP,
      outputPerMTok * AI_IMAGE_BILLED_MARKUP,
    ),
  }
}

/** The image model a photo is made with when the operator names none. */
export const AI_IMAGE_DEFAULT_MODEL = 'gemini-3.1-flash-image'

/** The image provider's id: Google's models on Vertex AI. */
export const AI_IMAGE_VERTEX_PROVIDER_ID = 'google-vertex'

export const AI_IMAGE_MODEL_CATALOG: readonly AiImageCatalogEntry[] = [
  {
    // The default: Google's own replacement for Imagen 4, which Vertex AI
    // discontinued in 2026.
    id: 'gemini-3.1-flash-image',
    provider: AI_IMAGE_VERTEX_PROVIDER_ID,
    label: 'Gemini 3.1 Flash Image',
    ...aiImageRatesAtMarkup(0.0672, 0.5, 3),
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    provider: AI_IMAGE_VERTEX_PROVIDER_ID,
    label: 'Gemini 3.1 Flash-Lite Image',
    ...aiImageRatesAtMarkup(0.0336, 0.25, 1.5),
  },
  {
    id: 'gemini-3-pro-image',
    provider: AI_IMAGE_VERTEX_PROVIDER_ID,
    label: 'Gemini 3 Pro Image',
    ...aiImageRatesAtMarkup(0.1344, 2, 12),
  },
]

/**
 * The per-picture rates an unknown image model id is priced at: the dearest
 * row, on both rates, for the reason `AI_FALLBACK_RATES` gives — an estimate
 * that errs low is worse than one that errs high.
 */
export const AI_IMAGE_FALLBACK_RATES: Pick<
  AiImageCatalogEntry,
  'providerUsdPerImage' | 'billedUsdPerImage'
> = {
  providerUsdPerImage: Math.max(...AI_IMAGE_MODEL_CATALOG.map((row) => row.providerUsdPerImage)),
  billedUsdPerImage: Math.max(...AI_IMAGE_MODEL_CATALOG.map((row) => row.billedUsdPerImage)),
}

/** The image catalog row for a model id, or `undefined` for an unknown id. */
export function aiImageCatalogEntry(modelId: string): AiImageCatalogEntry | undefined {
  return AI_IMAGE_MODEL_CATALOG.find((entry) => entry.id === modelId)
}

/** What the provider charges us for one picture from `modelId`. */
export function aiImageProviderUsdPerImage(modelId: string): number {
  return (aiImageCatalogEntry(modelId) ?? AI_IMAGE_FALLBACK_RATES).providerUsdPerImage
}

/** What one picture from `modelId` draws from a customer's credits. */
export function aiImageBilledUsdPerImage(modelId: string): number {
  return (aiImageCatalogEntry(modelId) ?? AI_IMAGE_FALLBACK_RATES).billedUsdPerImage
}

/**
 * Usage as the meter prices it: a text exchange's tokens, and, for a door
 * that makes pictures, how many it delivered. `images` is absent on every
 * text exchange, which prices exactly as it always did.
 */
export type AiMeteredUsage = AiUsage & { images?: number }

/** Pictures on a usage record: whole, finite, non-negative, else 0. */
function aiImageCount(usage: AiMeteredUsage): number {
  const value = Number(usage.images ?? 0)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/** The dearest known tier, used when a model id is not in the catalog. */
export const AI_FALLBACK_RATES: AiTokenRates = aiRatesPerMTok(10, 50)

/**
 * The minimum an unknown model id is assumed to have: the largest one the
 * catalog knows. It errs the way the rate fallback errs — toward the answer
 * that costs more — so an unrecognized id reads as "this prompt does not
 * cache" rather than promising a saving nobody measured.
 */
export const AI_FALLBACK_CACHE_MIN_TOKENS = 4_096

/** The shortest prefix a model's provider will cache; the dearest assumption for an unknown id. */
export function aiModelCacheMinTokens(modelId: string): number {
  return aiCatalogEntry(modelId)?.cacheMinTokens ?? AI_FALLBACK_CACHE_MIN_TOKENS
}

const ZERO_RATES = aiRatesPerMTok(0, 0)

/** The catalog row for a model id, or `undefined` for an unknown id. */
export function aiCatalogEntry(modelId: string): AiCatalogEntry | undefined {
  return AI_MODEL_CATALOG.find((entry) => entry.id === modelId)
}

const isSentinel = (modelId: string): boolean =>
  (Object.values(AI_METER_SENTINELS) as string[]).includes(modelId)

/**
 * What the PROVIDER charges for a model id — our bill. A meter sentinel is
 * free; an image model's prompt and thinking are priced at its image row's
 * token rates (AGL-3602); an unknown id is priced at the dearest tier.
 *
 * The figure every cost and margin surface prices usage at. Answering the
 * customer's question from here would report a margin the platform does not
 * earn, and answering ours from `aiBilledRatesForModel` reports one it does
 * not pay; the two are separate functions so neither is reachable by
 * forgetting which one was meant.
 */
export function aiProviderRatesForModel(modelId: string): AiTokenRates {
  if (isSentinel(modelId)) return ZERO_RATES
  return (
    aiCatalogEntry(modelId)?.providerRates ??
    aiImageCatalogEntry(modelId)?.providerRates ??
    AI_FALLBACK_RATES
  )
}

/**
 * What a CUSTOMER'S CREDITS are charged at for a model id. A meter sentinel
 * is free; an unknown id is priced at the dearest tier.
 *
 * The figure the credit meter, the band and the model selector price usage
 * at. It is at or above `aiProviderRatesForModel` on every row.
 */
export function aiBilledRatesForModel(modelId: string): AiTokenRates {
  if (isSentinel(modelId)) return ZERO_RATES
  return (
    aiCatalogEntry(modelId)?.billedRates ??
    aiImageCatalogEntry(modelId)?.billedRates ??
    AI_FALLBACK_RATES
  )
}

function priceUsage(usage: AiUsage, rate: AiTokenRates): number {
  const raw =
    usage.inputTokens * rate.inputPerToken +
    usage.outputTokens * rate.outputPerToken +
    usage.cacheReadTokens * rate.cacheReadPerToken +
    usage.cacheWriteTokens * rate.cacheWritePerToken
  return Math.round(raw * 1_000_000) / 1_000_000
}

/**
 * What one exchange COST US, at the serving model's provider rates, rounded
 * to 6dp. Real money, and the only figure a margin may be taken against.
 */
export function estimateAiProviderCostUsd(usage: AiMeteredUsage, modelId: string): number {
  return roundUsd(
    priceUsage(usage, aiProviderRatesForModel(modelId)) +
      aiImageCount(usage) * aiImageProviderUsdPerImage(modelId),
  )
}

/**
 * What one exchange DRAWS FROM A CUSTOMER, at the serving model's billed
 * rates, rounded to 6dp — the figure `assistCreditsFromUsd` turns into
 * credits. At or above `estimateAiProviderCostUsd` for the same exchange.
 */
export function estimateAiBilledUsd(usage: AiMeteredUsage, modelId: string): number {
  return roundUsd(
    priceUsage(usage, aiBilledRatesForModel(modelId)) +
      aiImageCount(usage) * aiImageBilledUsdPerImage(modelId),
  )
}

/** Every catalog id a provider serves. */
export function aiModelIdsForProvider(providerId: string): string[] {
  return AI_MODEL_CATALOG.filter((entry) => entry.provider === providerId).map(
    (entry) => entry.id,
  )
}

/**
 * What a step asks for, and what the routing table answers with. Every
 * door names its kind here rather than a model, so a model swap — an
 * incident override, an org's own setting, a cheaper model for a cheap
 * step — is one row rather than a search through the doors (AGL-2937).
 */
export type AiStepKind =
  | 'assist.chat'
  | 'copy.element'
  | 'copy.section'
  | 'copy.blog'
  | 'generate.section'
  | 'job.component'
  | 'job.crm'
  | 'job.experiment'
  | 'job.form'
  | 'job.insight'
  | 'job.layout'
  | 'job.logic'
  | 'job.template'
  | 'job.page'
  | 'job.products'
  | 'job.seo'
  | 'job.text'
  | 'job.theme'
  | 'job.plan'
  | 'job.email'
  | 'job.campaign'
  | 'job.workflow'

/** The tier each step kind is served from when no setting overrides it. */
export const AI_STEP_TIERS: Record<AiStepKind, AiCatalogEntry['tier']> = {
  'assist.chat': 'balanced',
  'copy.element': 'fast',
  'copy.section': 'balanced',
  'copy.blog': 'balanced',
  'generate.section': 'balanced',
  // A reusable component is one structured tree with the typed props it
  // declares, and choosing what becomes a prop is the judgment the step sells.
  'job.component': 'balanced',
  // CRM by AI (AGL-2917): a record's summary and next step, a deal's stage, a
  // lead's standing, a one-to-one email draft and an import's column matches.
  // Short answers through a strict tool, held to the facts the CRM reports
  // about the record the member opened.
  'job.crm': 'fast',
  // A/B tests by AI (AGL-2914): variants of one piece of copy, and a
  // result put into words for a verdict code already reached. Short answers
  // through a strict tool, but the judgment a variant sells — which ONE idea
  // to vary so the result says something — is the balanced tier's.
  'job.experiment': 'balanced',
  // A form is one small tree held to the building rules and to the contract
  // its submissions are read by; a re-ask costs more than the tier saves.
  'job.form': 'balanced',
  // An insight (AGL-2915) chooses which figures answer a question and says
  // what they show; the trace holds every number, and the judgment of what is
  // worth saying is what the fast tier does worse.
  'job.insight': 'balanced',
  // A layout or a page template is one structured tree held to every
  // building rule; the fast tier re-asks more than it saves.
  'job.layout': 'balanced',
  // A site function or variable (AGL-3603): a small structured answer held
  // to the evaluator's grammar, the names it may read and a first run, whose
  // judgment is turning a description into conditions and arithmetic; the
  // fast tier re-asks more than it saves.
  'job.logic': 'balanced',
  'job.template': 'balanced',
  // A page section (AGL-2907) is held to the whole page's building rules on
  // every pass, for the same reason.
  'job.page': 'balanced',
  // A product's copy, a store's first products, or its categories and
  // discounts (AGL-2916): judgment about what a photo shows and what a shopper
  // needs, held to storefront claim rules a re-ask costs more to meet than the
  // tier saves.
  'job.products': 'balanced',
  // SEO fields, alt text and an audit's fixes (AGL-2910): short answers
  // through a strict tool, held to a length and to the page's own text.
  'job.seo': 'fast',
  'job.text': 'balanced',
  // A theme is one structured answer over a small, fixed control set; the
  // judgment is in the color choices, which the fast tier makes worse.
  'job.theme': 'balanced',
  'job.plan': 'balanced',
  // An email is one tree held to every building rule, with subject lines
  // whose judgment is the point of asking; the fast tier re-asks more than it
  // saves. A campaign is the same email, drafted into a campaign.
  'job.email': 'balanced',
  'job.campaign': 'balanced',
  // An automation is a small structured answer whose judgment is choosing the
  // trigger and steps a description means, and an explanation reads one
  // closely; the fast tier re-asks more than it saves on both (AGL-2919).
  'job.workflow': 'balanced',
}

/** The first catalog model of a tier on a provider, or the provider's first model. */
export function aiDefaultModelFor(providerId: string, tier: AiCatalogEntry['tier']): string | undefined {
  const onProvider = AI_MODEL_CATALOG.filter((entry) => entry.provider === providerId)
  return (onProvider.find((entry) => entry.tier === tier) ?? onProvider[0])?.id
}
