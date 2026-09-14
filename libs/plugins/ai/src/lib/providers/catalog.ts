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
 * The providers the catalog carries models for, with the name a settings
 * form shows. A form offers providers from here for the reason it offers
 * models from here: nothing outside this folder names a vendor.
 */
export const AI_CATALOG_PROVIDERS: readonly { id: string; label: string }[] = [
  { id: ANTHROPIC, label: 'Anthropic' },
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
  },
  {
    id: 'claude-sonnet-4-6',
    provider: ANTHROPIC,
    label: 'Claude Sonnet 4.6',
    capabilities: anthropicCapabilities,
    rates: aiRatesPerMTok(3, 15),
    tier: 'balanced',
  },
  {
    // Rejects an explicit `thinking` setting; the runtime omits it.
    id: 'claude-haiku-4-5',
    provider: ANTHROPIC,
    label: 'Claude Haiku 4.5',
    capabilities: { ...anthropicCapabilities, thinking: false },
    rates: aiRatesPerMTok(1, 5),
    tier: 'fast',
  },
  {
    id: 'claude-opus-5',
    provider: ANTHROPIC,
    label: 'Claude Opus 5',
    capabilities: anthropicCapabilities,
    rates: aiRatesPerMTok(5, 25),
    tier: 'deep',
  },
  {
    id: 'claude-opus-4-8',
    provider: ANTHROPIC,
    label: 'Claude Opus 4.8',
    capabilities: anthropicCapabilities,
    rates: aiRatesPerMTok(5, 25),
    tier: 'deep',
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
  },
  {
    id: 'gpt-5-mini',
    provider: OPENAI_COMPATIBLE,
    label: 'GPT-5 mini',
    capabilities: { streaming: true, tools: true, thinking: false, promptCache: true },
    rates: aiRatesPerMTok(0.25, 2),
    tier: 'fast',
  },
]

/** The dearest known tier, used when a model id is not in the catalog. */
export const AI_FALLBACK_RATES: AiTokenRates = aiRatesPerMTok(10, 50)

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
  | 'job.text'

/** The tier each step kind is served from when no setting overrides it. */
export const AI_STEP_TIERS: Record<AiStepKind, AiCatalogEntry['tier']> = {
  'assist.chat': 'balanced',
  'copy.element': 'fast',
  'copy.section': 'balanced',
  'copy.blog': 'balanced',
  'generate.section': 'balanced',
  'job.text': 'balanced',
}

/** The first catalog model of a tier on a provider, or the provider's first model. */
export function aiDefaultModelFor(providerId: string, tier: AiCatalogEntry['tier']): string | undefined {
  const onProvider = AI_MODEL_CATALOG.filter((entry) => entry.provider === providerId)
  return (onProvider.find((entry) => entry.tier === tier) ?? onProvider[0])?.id
}
