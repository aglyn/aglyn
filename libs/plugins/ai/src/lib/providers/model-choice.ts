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

import { assistCreditsFromUsd } from '@aglyn/aglyn/app-utils/assist-credits'
import type { OrgPlan } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import {
  AI_MODEL_CATALOG,
  AI_STEP_TIERS,
  aiCatalogEntry,
  aiBilledRatesForModel,
  estimateAiBilledUsd,
  type AiCatalogEntry,
  type AiStepKind,
} from './catalog'
import type { AiUsage } from './contract'
import { resolveAiRoute, type AiPluginSettings } from './routing'

/**
 * THE MODEL SWITCH (AGL-2942): what a person may pick, what "Auto" means,
 * and what a pick costs.
 *
 * ## Auto is the routing table
 *
 * A request that names no model — or names one it may not have — runs on
 * `resolveAiRoute(kind)`, the table that maps a step kind to a catalog model
 * (AGL-2937). Picking a model is an override of that one row for one request,
 * never a second table.
 *
 * ## Three bounds, one intersection
 *
 * A manual pick must be served by the active provider, in a tier the org's
 * plan offers (`AI_PLAN_MODEL_TIERS`), on the org's own restriction when it
 * set one, and on the allotment allowlists that apply to the request. The
 * two allowlists bound Auto too: when the routing table's answer is not on
 * them, Auto runs on the allowed model of the same tier, else the cheapest
 * allowed one. The plan bounds only a pick — Auto is the platform's choice,
 * made for the step, and a plan never makes it worse.
 *
 * An allowlist that leaves nothing this deployment serves is not a way to
 * switch AI off by mistake: the choice falls back to the routing table, and
 * the permission keys are how AI is switched off on purpose.
 *
 * ## The price beside each option
 *
 * Credits per typical request at each model's list rates, over the step's
 * measured median exchange when the workspace has enough of them, and over
 * `AI_STEP_NOMINAL_USAGE` until it does — with the multiple of what Auto
 * would cost for the same request. Every figure is credits, never dollars.
 */

/** The value a request sends for "let the platform route it". */
export const AI_MODEL_AUTO = 'auto'

/**
 * The catalog tiers a MANUAL pick may name, per plan. Free runs on Auto only:
 * its taste is a wall, and a pick there would spend the account's credits at
 * a rate nobody chose on purpose. The dearest tier opens from Scale up, where
 * the band is large enough that a slower, deeper model is a real choice
 * rather than a fast way to end the month.
 */
export const AI_PLAN_MODEL_TIERS: Record<OrgPlan, readonly AiCatalogEntry['tier'][]> = {
  free: [],
  starter: ['fast', 'balanced'],
  pro: ['fast', 'balanced'],
  business: ['fast', 'balanced'],
  scale: ['fast', 'balanced', 'deep'],
  advanced: ['fast', 'balanced', 'deep'],
  agency: ['fast', 'balanced', 'deep'],
  enterprise: ['fast', 'balanced', 'deep'],
}

/** The plans whose admins may restrict the model set org-wide. */
export const AI_MODEL_RESTRICTION_PLANS: readonly OrgPlan[] = ['agency', 'enterprise']

/**
 * A typical exchange per step kind, before a workspace has measured one: the
 * doors' own prompt sizes and output ceilings, read conservatively. Replaced
 * by the workspace's measured median as soon as `aiMedianUsage` has enough
 * samples, and only ever used for the price beside an option.
 */
export const AI_STEP_NOMINAL_USAGE: Record<AiStepKind, AiUsage> = {
  'assist.chat': { inputTokens: 900, outputTokens: 450, cacheReadTokens: 1_050, cacheWriteTokens: 0 },
  'copy.element': { inputTokens: 350, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 },
  'copy.section': { inputTokens: 700, outputTokens: 1_400, cacheReadTokens: 0, cacheWriteTokens: 0 },
  'copy.blog': { inputTokens: 600, outputTokens: 1_100, cacheReadTokens: 0, cacheWriteTokens: 0 },
  'generate.section': { inputTokens: 700, outputTokens: 1_400, cacheReadTokens: 0, cacheWriteTokens: 0 },
  // The text step's rules are about 500 characters — far under the balanced
  // tier's cacheable minimum, so they are billed as input every time rather
  // than read from a cache (`runtime/ai-prompt-cache.spec.ts` measures it).
  'job.text': { inputTokens: 450, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
  // The theme step: the tool's schema and both system blocks (about 7,500
  // characters) are the cached prefix, the site's inventory and the brief ride
  // uncached, and a full-palette answer is about 1,300 characters of JSON with
  // as much again to think in.
  'job.theme': { inputTokens: 500, outputTokens: 850, cacheReadTokens: 2_500, cacheWriteTokens: 0 },
  // The plan step: the tool's schema, the doctrine and the plan instructions
  // (about 10,000 characters) are the cached prefix, the site inventory and the
  // brief ride uncached, and a plan answer is about 600 characters of JSON with
  // as much again to think in.
  'job.plan': { inputTokens: 500, outputTokens: 400, cacheReadTokens: 3_600, cacheWriteTokens: 0 },
  // The component step: the doctrine, the component instructions, the
  // component surface's catalog and the tool are the cached prefix, the site
  // inventory, the brief and the confirmed plan ride uncached, and a card-sized
  // answer — its tree and declared props as JSON — is about 1,700 characters.
  // The component step's spec measures the prefix and the answer against this.
  'job.component': { inputTokens: 700, outputTokens: 600, cacheReadTokens: 5_800, cacheWriteTokens: 0 },
  'job.layout': { inputTokens: 700, outputTokens: 1_000, cacheReadTokens: 5_600, cacheWriteTokens: 0 },
  'job.template': { inputTokens: 1_200, outputTokens: 700, cacheReadTokens: 6_400, cacheWriteTokens: 0 },
  // One page section's exchange (AGL-2907), from the modules' own text: the
  // doctrine (6,281 characters), the page instructions (1,524), the screen
  // palette catalog (8,353) and the section tool (484) are the cached prefix;
  // the site inventory (711 on the median golden site), the brief, the plan
  // and the section line ride uncached; and a golden section answer is 901
  // characters at the median, asked for with no thinking.
  'job.page': { inputTokens: 600, outputTokens: 300, cacheReadTokens: 4_400, cacheWriteTokens: 0 },
  // The SEO step's listing exchange, which a page's or a product's listing is
  // exactly one of. NOTHING is cached here, whatever the breakpoints say: the
  // step runs on the fast tier, whose cacheable minimum is four times what
  // this prompt reaches, so every static byte is billed as input on every
  // attempt — the doctrine's block in its field scope, the listing rules and
  // the tool's schema, about 760 tokens together. The page text, capped at
  // 2,000 characters, rides with the current listing and a dozen other titles
  // for about another 750. The largest answer the tool accepts is about 600
  // characters of JSON, and the request asks for no thinking. An audit pass
  // is heavier: eight pages' findings and text, about 9,000 characters, with
  // up to about 8,000 back.
  'job.seo': { inputTokens: 1_500, outputTokens: 250, cacheReadTokens: 0, cacheWriteTokens: 0 },
  // The form step: the doctrine, the form instructions, the form surface's
  // catalog (about 150 tokens) and the tool's schema are the cached prefix, the
  // site inventory and the brief ride uncached, and a form's answer is 200 to
  // 400 tokens of JSON with no extended thinking.
  'job.form': { inputTokens: 700, outputTokens: 450, cacheReadTokens: 3_900, cacheWriteTokens: 0 },
  // The email step, and the campaign step that shares its generation: the
  // doctrine, the email instructions, the email palette catalog and the
  // tool's schema (about 10,300 characters) are the cached prefix, the site
  // inventory and the brief ride uncached, and the answer is one email's
  // node map with three subject lines and three preheaders.
  'job.email': { inputTokens: 600, outputTokens: 1_500, cacheReadTokens: 3_600, cacheWriteTokens: 0 },
  'job.campaign': { inputTokens: 600, outputTokens: 1_500, cacheReadTokens: 3_600, cacheWriteTokens: 0 },
  // The workflow step's draft (AGL-2919): the doctrine, the automation
  // vocabulary and the tool's schema are the cached prefix (4,564 tokens, as
  // `runtime/ai-prompt-cache.spec.ts` measures it); what the workspace can
  // run, the site's forms and datasets and the description ride uncached; and
  // an automation of a few steps is about 1,300 characters of JSON with as
  // much again to think in. An explanation caches half as much.
  'job.workflow': { inputTokens: 500, outputTokens: 1_000, cacheReadTokens: 4_500, cacheWriteTokens: 0 },
}

/** The fewest measured exchanges a median is taken over. */
export const AI_MEASURED_MEDIAN_MIN_SAMPLES = 3

export interface AiModelBounds {
  plan: OrgPlan
  /** The allotment allowlists that apply, intersected; `null` for none. */
  allotmentModels?: readonly string[] | null
  /** The org-wide restriction; `null` for none. */
  orgModels?: readonly string[] | null
}

function onLists(entry: AiCatalogEntry, bounds: AiModelBounds): boolean {
  if (bounds.orgModels?.length && !bounds.orgModels.includes(entry.id)) return false
  if (bounds.allotmentModels && !bounds.allotmentModels.includes(entry.id)) return false
  return true
}

/** The catalog models a manual pick may name on a provider under these bounds. */
export function aiModelsSelectable(
  providerId: string,
  bounds: AiModelBounds,
): AiCatalogEntry[] {
  const tiers = AI_PLAN_MODEL_TIERS[bounds.plan] ?? []
  return AI_MODEL_CATALOG.filter(
    (entry) =>
      entry.provider === providerId && tiers.includes(entry.tier) && onLists(entry, bounds),
  )
}

/**
 * A model's blended BILLED rate, for "the cheapest allowed" and nothing
 * else.
 *
 * Billed and not provider (AGL-3015): the substitution below happens when a
 * workspace asked for a model its bounds do not allow, and the party it
 * falls back for is the one whose credits are drawn. "Cheapest" has to mean
 * the same thing here as in the selector this substitution stands in for,
 * which sorts on `creditsPerRequest`.
 */
const blendedRate = (id: string): number => {
  const rates = aiBilledRatesForModel(id)
  return rates.inputPerToken + rates.outputPerToken
}

export interface AiModelChoice {
  /** The catalog id the request runs, and is metered, on. */
  model: string
  /** True when the routing table decided: Auto, or a pick that was declined. */
  auto: boolean
  /** A pick that was asked for and is not allowed, for the envelope. */
  declined: string | null
}

/**
 * The model one request runs on, or `null` when no provider is registered —
 * which every door has refused before it asks.
 */
export function resolveAiModelChoice(
  kind: AiStepKind,
  requested: unknown,
  bounds: AiModelBounds,
  settings?: AiPluginSettings,
): AiModelChoice | null {
  const route = resolveAiRoute(kind, settings)
  if (!route) return null
  const wanted =
    typeof requested === 'string' && requested.trim() && requested.trim() !== AI_MODEL_AUTO
      ? requested.trim()
      : null
  if (wanted && aiModelsSelectable(route.provider.id, bounds).some((entry) => entry.id === wanted)) {
    return { model: wanted, auto: false, declined: null }
  }
  const restricted = Boolean(bounds.orgModels?.length) || Boolean(bounds.allotmentModels)
  let model = route.model
  if (restricted) {
    const allowed = AI_MODEL_CATALOG.filter(
      (entry) => entry.provider === route.provider.id && onLists(entry, bounds),
    )
    if (allowed.length && !allowed.some((entry) => entry.id === model)) {
      const tier = aiCatalogEntry(model)?.tier ?? AI_STEP_TIERS[kind]
      const sameTier = allowed.find((entry) => entry.tier === tier)
      const cheapest = [...allowed].sort((a, b) => blendedRate(a.id) - blendedRate(b.id))[0]
      model = (sameTier ?? cheapest).id
    }
  }
  return { model, auto: true, declined: wanted }
}

/** The median exchange over measured samples, or `null` below the minimum. */
export function aiMedianUsage(samples: readonly AiUsage[]): AiUsage | null {
  if (samples.length < AI_MEASURED_MEDIAN_MIN_SAMPLES) return null
  const median = (field: keyof AiUsage): number => {
    const values = samples
      .map((sample) => Number(sample[field] ?? 0))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b)
    if (!values.length) return 0
    const middle = Math.floor(values.length / 2)
    return values.length % 2
      ? values[middle]
      : Math.round((values[middle - 1] + values[middle]) / 2)
  }
  return {
    inputTokens: median('inputTokens'),
    outputTokens: median('outputTokens'),
    cacheReadTokens: median('cacheReadTokens'),
    cacheWriteTokens: median('cacheWriteTokens'),
  }
}

export interface AiModelOption {
  /** A catalog id, or `AI_MODEL_AUTO`. */
  id: string
  label: string
  tier: AiCatalogEntry['tier']
  /** Credits a typical request of this kind costs on the option. */
  creditsPerRequest: number
  /** That cost as a multiple of Auto's, to one decimal. */
  multiplier: number
}

export interface AiModelOptions {
  /** Auto, labeled with the model it routes this kind to under these bounds. */
  auto: AiModelOption & { model: string }
  /** The manual picks, cheapest first; empty where the plan offers none. */
  options: AiModelOption[]
  /** Whether the price came from the workspace's own measured exchanges. */
  measured: boolean
}

/** What the selector lists for one step kind, or `null` without a provider. */
export function aiModelOptions(
  kind: AiStepKind,
  bounds: AiModelBounds,
  measured: AiUsage | null,
  settings?: AiPluginSettings,
): AiModelOptions | null {
  const route = resolveAiRoute(kind, settings)
  const auto = resolveAiModelChoice(kind, null, bounds, settings)
  if (!route || !auto) return null
  const typical = measured ?? AI_STEP_NOMINAL_USAGE[kind]
  // Billed rates throughout (AGL-3015): every figure below is what the
  // workspace will be charged for picking this model — credits per request
  // and the multiple of Auto those credits come to. Our own cost for the
  // same request is not this selector's subject and would misstate both.
  const autoCost = estimateAiBilledUsd(typical, auto.model)
  const priced = (entry: AiCatalogEntry): AiModelOption => {
    const cost = estimateAiBilledUsd(typical, entry.id)
    return {
      id: entry.id,
      label: entry.label,
      tier: entry.tier,
      creditsPerRequest: assistCreditsFromUsd(cost),
      multiplier: autoCost > 0 ? Math.round((cost / autoCost) * 10) / 10 : 1,
    }
  }
  const autoEntry = aiCatalogEntry(auto.model)
  return {
    auto: {
      id: AI_MODEL_AUTO,
      label: autoEntry ? `Auto (${autoEntry.label})` : 'Auto',
      tier: autoEntry?.tier ?? AI_STEP_TIERS[kind],
      creditsPerRequest: assistCreditsFromUsd(autoCost),
      multiplier: 1,
      model: auto.model,
    },
    options: aiModelsSelectable(route.provider.id, bounds)
      .map(priced)
      .sort((a, b) => a.creditsPerRequest - b.creditsPerRequest || a.label.localeCompare(b.label)),
    measured: measured !== null,
  }
}
