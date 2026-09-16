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
 * ## Rates
 *
 * List-rate unit costs (USD per token) BY MODEL: telemetry estimates for
 * margin tuning, not billing. Keyed by model rather than fixed at one
 * model's rates because the default is an env override: a one-line incident
 * swap to a dearer model would otherwise keep reporting the cheaper money,
 * and per-org cost would read as roughly right — the failure mode this
 * whole meter exists to prevent. An unknown id falls back to the most
 * EXPENSIVE known tier on purpose: a cost estimate that errs low is worse
 * than one that errs high.
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

export interface AiCatalogEntry extends AiModelDescriptor {
  rates: AiTokenRates
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
        "AI-assisted features in the console and the site editor: the Aglyn Assist helper, including changes it proposes to a page, component, or layout open in the editor; editor assistance (rewriting element copy, drafting blog bodies, generating a section layout); and AI generation, which creates drafts and proposals for a customer's site from a brief, such as copy, layouts, templates, search titles and descriptions, and theme changes",
      publishedOn: '2026-09-15',
      reason:
        "Reached through the AI plugin's Anthropic adapter (`libs/plugins/ai/src/lib/providers/anthropic.ts`) by the doors that call the AI runtime. `libs/plugins/ai/src/lib/server/assist-chat.ts` is gated by `release_assist` AND the key, and a generation job's text step by `release_ai_generative`; `libs/plugins/ai/src/lib/server/ai-assist.ts` carries NO release flag, so setting `{apiKeyEnv}` in production is by itself what starts this flow. `assist-anthropic-subprocessor-gate.spec.ts` holds the per-door detail and is the deeper guard for this one vendor.",
      dataReceived:
        "What the user submits — a question, instruction or brief, with the earlier messages of the same Assist conversation — and the content of the element, post, section or page being worked on, with the generated response. On Pro and above, the organization's name and the console route and host travel with an Assist question. For an edit the assistant proposes in the besigner, an outline of the open page, component or layout: element and component ids, layer names, shortened setting values and the selected element's styles. For a generation job, the site inventory: the names and addresses of its screens and collections, the names of its components, layouts, templates, forms and datasets with their prop and field names, and the theme's summary, colors and fonts. For a theme change, the site's current theme settings and brand colors as hex values, from the organization's brand settings, the site logo in the media library or a public page the brief links to. For features that review or write search information, the text and structure of the pages concerned. No account identifiers, email addresses or authentication tokens.",
    },
  },
  { id: OPENAI_COMPATIBLE, label: 'OpenAI-compatible endpoint' },
]

const anthropicCapabilities = {
  streaming: true,
  tools: true,
  thinking: true,
  promptCache: true,
}

export const AI_MODEL_CATALOG: readonly AiCatalogEntry[] = [
  {
    id: 'claude-sonnet-5',
    provider: ANTHROPIC,
    label: 'Claude Sonnet 5',
    capabilities: anthropicCapabilities,
    rates: aiRatesPerMTok(3, 15),
    tier: 'balanced',
    cacheMinTokens: 1_024,
  },
  {
    id: 'claude-sonnet-4-6',
    provider: ANTHROPIC,
    label: 'Claude Sonnet 4.6',
    capabilities: anthropicCapabilities,
    rates: aiRatesPerMTok(3, 15),
    tier: 'balanced',
    cacheMinTokens: 1_024,
  },
  {
    // Rejects an explicit `thinking` setting; the runtime omits it.
    id: 'claude-haiku-4-5',
    provider: ANTHROPIC,
    label: 'Claude Haiku 4.5',
    capabilities: { ...anthropicCapabilities, thinking: false },
    rates: aiRatesPerMTok(1, 5),
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
    rates: aiRatesPerMTok(5, 25),
    tier: 'deep',
    cacheMinTokens: 512,
  },
  {
    id: 'claude-opus-4-8',
    provider: ANTHROPIC,
    label: 'Claude Opus 4.8',
    capabilities: anthropicCapabilities,
    rates: aiRatesPerMTok(5, 25),
    tier: 'deep',
    cacheMinTokens: 1_024,
  },
  /**
   * The OpenAI-compatible adapter serves whatever the endpoint behind
   * `AI_OPENAI_COMPAT_BASE_URL` serves; these are the ids the routing table
   * may name on it. A self-host points the base URL at its own gateway and
   * sets the rates it pays through `AI_OPENAI_COMPAT_RATES` (see
   * `aiCatalogEntry`); the figures here are a public list price.
   */
  {
    id: 'gpt-5',
    provider: OPENAI_COMPATIBLE,
    label: 'GPT-5',
    capabilities: { streaming: true, tools: true, thinking: false, promptCache: true },
    rates: aiRatesPerMTok(1.25, 10),
    tier: 'balanced',
    cacheMinTokens: 1_024,
  },
  {
    id: 'gpt-5-mini',
    provider: OPENAI_COMPATIBLE,
    label: 'GPT-5 mini',
    capabilities: { streaming: true, tools: true, thinking: false, promptCache: true },
    rates: aiRatesPerMTok(0.25, 2),
    tier: 'fast',
    cacheMinTokens: 1_024,
  },
]

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

/**
 * List rates for a model id. A meter sentinel is free; an unknown id is
 * priced at the dearest tier.
 */
export function aiRatesForModel(modelId: string): AiTokenRates {
  if ((Object.values(AI_METER_SENTINELS) as string[]).includes(modelId)) return ZERO_RATES
  return aiCatalogEntry(modelId)?.rates ?? AI_FALLBACK_RATES
}

/**
 * Estimated cost in USD for one exchange, at the SERVING model's list
 * rates, rounded to 6dp.
 */
export function estimateAiCostUsd(usage: AiUsage, modelId: string): number {
  const rate = aiRatesForModel(modelId)
  const raw =
    usage.inputTokens * rate.inputPerToken +
    usage.outputTokens * rate.outputPerToken +
    usage.cacheReadTokens * rate.cacheReadPerToken +
    usage.cacheWriteTokens * rate.cacheWritePerToken
  return Math.round(raw * 1_000_000) / 1_000_000
}

/** The rate table as one record: model id → rates, sentinels at zero. */
export function aiModelRatesTable(): Record<string, AiTokenRates> {
  const table: Record<string, AiTokenRates> = {}
  for (const sentinel of Object.values(AI_METER_SENTINELS)) table[sentinel] = ZERO_RATES
  for (const entry of AI_MODEL_CATALOG) table[entry.id] = entry.rates
  return table
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
  | 'job.form'
  | 'job.layout'
  | 'job.template'
  | 'job.page'
  | 'job.seo'
  | 'job.text'
  | 'job.theme'
  | 'job.plan'
  | 'job.email'
  | 'job.campaign'

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
  // A form is one small tree held to the building rules and to the contract
  // its submissions are read by; a re-ask costs more than the tier saves.
  'job.form': 'balanced',
  // A layout or a page template is one structured tree held to every
  // building rule; the fast tier re-asks more than it saves.
  'job.layout': 'balanced',
  'job.template': 'balanced',
  // A page section (AGL-2907) is held to the whole page's building rules on
  // every pass, for the same reason.
  'job.page': 'balanced',
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
}

/** The first catalog model of a tier on a provider, or the provider's first model. */
export function aiDefaultModelFor(providerId: string, tier: AiCatalogEntry['tier']): string | undefined {
  const onProvider = AI_MODEL_CATALOG.filter((entry) => entry.provider === providerId)
  return (onProvider.find((entry) => entry.tier === tier) ?? onProvider[0])?.id
}
