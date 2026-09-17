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

import { AI_SETTING_PLATFORM, AI_STEP_MODEL_SETTING } from '../plugin-config'
import {
  AI_STEP_TIERS,
  aiCatalogEntry,
  aiDefaultModelFor,
  type AiStepKind,
} from './catalog'
import type { AiEvalKind } from '../runtime/ai-eval'
import type { AiEffort, AiProvider, AiThinking } from './contract'
import { aiProviderById, defaultAiProvider } from './registry'

/**
 * The routing table (AGL-2937, AGL-2939): step kind → provider and model,
 * through the catalog and never a vendor literal.
 *
 * Precedence, dearest override first:
 *
 * 1. the org's `pluginSettings/ai` — a provider, and a model per step kind
 *    that must be one the provider serves;
 * 2. the deployment's environment — `AI_PROVIDER` for the provider,
 *    `AI_DEFAULT_MODEL` for every step, and `ASSIST_MODEL` for the
 *    assistant alone (the incident-response override the chat door has
 *    always honored);
 * 3. the catalog's tier for the step kind on the resolved provider.
 */

/** The environment override for every step kind. */
export const AI_DEFAULT_MODEL_ENV = 'AI_DEFAULT_MODEL'
/** The assistant's own override, honored before the general one. */
export const ASSIST_MODEL_ENV = 'ASSIST_MODEL'

/** The org's resolved `pluginSettings/ai` values, as `getPluginConfig` merges them. */
export type AiPluginSettings = Record<string, unknown>

export interface AiRoute {
  provider: AiProvider
  model: string
}

/** A settings value that names a real choice, or `undefined` for the platform default. */
function chosen(settings: AiPluginSettings | undefined, key: string): string | undefined {
  const value = settings?.[key]
  return typeof value === 'string' && value && value !== AI_SETTING_PLATFORM
    ? value
    : undefined
}

/** The provider a workspace runs on: its own choice when registered, else the platform's. */
export function resolveAiProvider(settings?: AiPluginSettings): AiProvider | undefined {
  const wanted = chosen(settings, 'provider')
  if (wanted) {
    const named = aiProviderById(wanted)
    if (named) return named
  }
  return defaultAiProvider()
}

/**
 * The model a step kind runs on for a workspace, on the resolved provider.
 * A chosen model on another provider is not served — the provider decides
 * what it can run — and falls back to the provider's default for the tier.
 */
export function resolveAiRoute(
  kind: AiStepKind,
  settings?: AiPluginSettings,
): AiRoute | undefined {
  const provider = resolveAiProvider(settings)
  if (!provider) return undefined
  const servedBy = (modelId: string | undefined): string | undefined =>
    modelId && aiCatalogEntry(modelId)?.provider === provider.id ? modelId : undefined
  const model =
    servedBy(chosen(settings, AI_STEP_MODEL_SETTING[kind])) ??
    (kind === 'assist.chat' ? servedBy(process.env[ASSIST_MODEL_ENV]?.trim()) : undefined) ??
    servedBy(process.env[AI_DEFAULT_MODEL_ENV]?.trim()) ??
    aiDefaultModelFor(provider.id, AI_STEP_TIERS[kind])
  return model ? { provider, model } : undefined
}

/**
 * What one step kind asks of its model, beside the tier it is served from
 * (`AI_STEP_TIERS` in the catalog): whether it thinks and how hard, its
 * answer ceiling, and the eval score that tier holds on the step's golden
 * briefs (AGL-2937).
 */
export interface AiRoutingRow {
  /** `null` sends no setting: the model's own default, and all a fast-tier model accepts. */
  thinking: AiThinking | null
  effort: AiEffort | null
  /** The answer ceiling, thinking included. */
  maxTokens: number
  /** What the ceiling is sized from. */
  maxTokensBasis: string
  eval: AiRoutingEval
}

export interface AiRoutingEval {
  /** The golden-brief kinds the step answers. */
  kinds: readonly AiEvalKind[]
  /** `answers` scores the step's answers; `plans` scores the plans those kinds' answers carry. */
  scores: 'answers' | 'plans'
  /** `authored` while the score is the hand-written references'; `recorded` once a live run records answers. */
  source: 'authored' | 'recorded'
  passRate: number
  /** The mean answer score; `null` for a plan score, which passes or fails. */
  meanScore: number | null
}

/**
 * THE ROUTING TABLE (AGL-2937): what each step kind asks of the model, in one
 * place, with the evidence beside it.
 *
 * A step runs on the smallest tier that holds its eval floor. A row moves to a
 * cheaper tier, or a lower effort, only when a recorded eval
 * (`npm run eval:ai-live`) holds the floor there; while a row's score is the
 * authored references', it says so, and the row stays where production has
 * run it. `runtime/ai-eval.spec.ts` recomputes every row's score from the
 * harness, so a row cannot claim a score its briefs do not hold.
 *
 * A ceiling is sized from the p95 output the staff signals page reports for
 * the kind once production has served it; until then `maxTokensBasis` names
 * what it is sized from. The same spec holds every reference answer under its
 * row's ceiling at three characters a token, a reading that errs high for a
 * tokenizer that splits finer than four.
 */
export const AI_ROUTING_TABLE: Readonly<Record<AiStepKind, AiRoutingRow>> = {
  'assist.chat': {
    // A scoped, latency-sensitive chat turn: no thinking, the low effort rung.
    thinking: 'off',
    effort: 'low',
    maxTokens: 1024,
    maxTokensBasis:
      'a docs-grounded answer of a few short paragraphs; the edit rung raises it for its tool call',
    eval: { kinds: ['chat'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 0.9688 },
  },
  'copy.element': {
    thinking: null,
    effort: null,
    maxTokens: 1024,
    maxTokensBasis: 'one element of copy, about the length of the text it replaces',
    eval: { kinds: ['element'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 0.9688 },
  },
  'copy.section': {
    thinking: null,
    effort: null,
    maxTokens: 3000,
    maxTokensBasis: 'a section of four to twelve nodes written as JSON',
    eval: { kinds: ['section'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 0.9688 },
  },
  'copy.blog': {
    thinking: null,
    effort: null,
    maxTokens: 2048,
    maxTokensBasis: 'one blog post body in markdown-lite',
    eval: { kinds: ['blog'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 0.9688 },
  },
  'generate.section': {
    thinking: null,
    effort: null,
    maxTokens: 3000,
    maxTokensBasis: 'a section of four to twelve nodes written as JSON',
    eval: { kinds: ['section'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 0.9688 },
  },
  'job.layout': {
    // The plan was reasoned out and confirmed before the step, so it writes without thinking.
    thinking: 'off',
    effort: null,
    maxTokens: 8000,
    maxTokensBasis:
      "tighter than the doctrine's default for a layout, so one step and its re-ask fit the job beat's budget; the tree is held to its rule 17 budget either way",
    eval: { kinds: ['layout'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 0.9833 },
  },
  'job.template': {
    thinking: 'off',
    effort: null,
    maxTokens: 8000,
    maxTokensBasis:
      "tighter than the doctrine's default for a template, so one step and its re-ask fit the job beat's budget; the tree is held to its rule 17 budget either way",
    eval: { kinds: ['template'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 0.9833 },
  },
  'job.component': {
    // A component's tree and the properties it declares, in one answer, from a
    // plan reasoned out and confirmed before the step (AGL-2908).
    thinking: 'off',
    effort: null,
    maxTokens: 8000,
    maxTokensBasis:
      "the ceiling the layout and template steps keep, so one step and its re-ask fit the job beat's budget; the tree is held to its rule 17 budget either way",
    eval: { kinds: ['component'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 0.9833 },
  },
  'job.crm': {
    // CRM by AI (AGL-2917): short answers through a strict tool, written from
    // the facts the CRM reports about the record the member opened, with no
    // thinking. The ceiling fits an inline door, so a member is answered in
    // the request that asked.
    thinking: null,
    effort: null,
    maxTokens: 700,
    maxTokensBasis:
      "the largest answer a CRM tool accepts: sixty columns matched to fields by number, or an email draft at its length limits, at three characters a token with room, as ai-job-crm-step.spec.ts measures it",
    eval: { kinds: ['crm'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 0.9938 },
  },
  'job.form': {
    // A form's two halves in one answer: the field declaration and the design
    // that renders it, as JSON, with no extended thinking (AGL-2913). The step
    // asks this ceiling, which is the doctrine's own for a form, and registers
    // the time it takes (AGL-3035).
    thinking: 'off',
    effort: null,
    maxTokens: 6000,
    maxTokensBasis:
      "the largest form the doctrine's output budget admits, a form's fields, its consent and routing declaration and the design that renders them written as JSON at the wordiest golden's characters a stored byte, under it with room; ai-job-form-step.spec.ts measures it",
    eval: { kinds: ['form'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 0.9833 },
  },
  'job.insight': {
    // Readers chosen, then their tables phrased (AGL-2915): short sentences
    // over figures code computed, each held to the rows it cites, so no
    // extended thinking. The read call before the answer asks for at most
    // `AI_INSIGHT_READ_MAX_TOKENS` of the same allowance.
    thinking: 'off',
    effort: null,
    maxTokens: 1500,
    maxTokensBasis:
      'five insights at their 280-character bound, each citing three tables of ten rows, and the gap sentence, written as JSON: about 2,700 characters, under 1,000 tokens at three characters a token, with room',
    eval: { kinds: ['insight'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 0.9688 },
  },
  'job.page': {
    // One section of a page, written against a plan a member already
    // confirmed, so it writes without thinking (AGL-2907). The ceiling here
    // is the MOST a pass may ask for; each pass sizes its own down from it to
    // what fits the time the job beat can give the step, which on the
    // balanced tier is about half of this.
    thinking: 'off',
    effort: null,
    maxTokens: 2000,
    maxTokensBasis:
      "a section of a page written as JSON, about forty elements at the step's measured 45 tokens an element; a pass lowers it to the worst case that fits AI_JOB_PAGE_STEP_MINIMUM_MS on the model it runs",
    eval: { kinds: ['page'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 0.9833 },
  },
  'job.products': {
    // A product's copy from its name, text and photo, or a store's first
    // products, categories and discounts from a brief (AGL-2916): answers held
    // to the storefront claim rules, written with no extended thinking.
    thinking: 'off',
    effort: null,
    maxTokens: 8000,
    maxTokensBasis:
      "the largest catalog the tool accepts, twelve proposed products at every bound written as JSON, which the balanced tier asks as much of as fits a beat; one product's copy asks 1,500 and categories with discounts 2,000, as ai-job-products-step.spec.ts measures them",
    eval: {
      kinds: ['product', 'catalog', 'categories'],
      scores: 'answers',
      source: 'authored',
      passRate: 1,
      meanScore: 0.9896,
    },
  },
  'job.email': {
    // One email design from the email palette, written against the brief with
    // no extended thinking (AGL-2912). A campaign job runs the same
    // generation, so it carries the same ceiling.
    thinking: 'off',
    effort: null,
    maxTokens: 6000,
    maxTokensBasis:
      "an email's node map written as JSON, with three subject lines and three preheaders beside it",
    eval: { kinds: ['email'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 0.9688 },
  },
  'job.campaign': {
    // The campaign job generates its email through the email step, so it is
    // routed identically; the draft campaign it also writes asks nothing of
    // the model (AGL-2912).
    thinking: 'off',
    effort: null,
    maxTokens: 6000,
    maxTokensBasis:
      "an email's node map written as JSON, with three subject lines and three preheaders beside it",
    eval: { kinds: ['email'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 0.9688 },
  },
  'job.workflow': {
    // An automation drafted from a description, or one explained (AGL-2919):
    // which trigger and which steps a description means is the judgment the
    // step sells, so it thinks before it answers.
    thinking: 'adaptive',
    effort: null,
    maxTokens: 4000,
    maxTokensBasis:
      'the largest automation the tool accepts, 6,000 characters written out as JSON, at three characters a token with as much again to think in, as ai-job-workflow-step.spec.ts measures it',
    eval: { kinds: ['workflow'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 0.9688 },
  },
  'job.seo': {
    thinking: null,
    effort: null,
    maxTokens: 1024,
    maxTokensBasis:
      "the largest listing the tool accepts, at three characters a token with a quarter again, as ai-job-seo-step.spec.ts measures it; an audit's site proposal and fix batches keep ceilings of their own, measured the same way",
    eval: { kinds: ['seo'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 1 },
  },
  'job.text': {
    thinking: 'adaptive',
    effort: null,
    maxTokens: 1024,
    maxTokensBasis: 'a few paragraphs of copy; a brief asking for more gets a draft to extend',
    eval: { kinds: ['text'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 1 },
  },
  'job.theme': {
    thinking: 'adaptive',
    effort: null,
    maxTokens: 8000,
    maxTokensBasis:
      'the largest answer the theme tool accepts, about 2,500 tokens of JSON as ai-job-theme-step.spec.ts measures it, with as much again to think in',
    eval: { kinds: ['theme'], scores: 'answers', source: 'authored', passRate: 1, meanScore: 0.9688 },
  },
  'job.plan': {
    thinking: 'adaptive',
    effort: null,
    maxTokens: 8000,
    maxTokensBasis: 'a plan of up to twelve screens with sixteen sections each, with room to think',
    eval: {
      kinds: ['page', 'template', 'component', 'layout', 'form'],
      scores: 'plans',
      source: 'authored',
      passRate: 1,
      meanScore: null,
    },
  },
}

/** The model id alone — what a door records on the meter and the job. */
export function aiModelForStep(kind: AiStepKind, settings?: AiPluginSettings): string {
  const route = resolveAiRoute(kind, settings)
  if (!route) {
    // Every door gates on the provider being configured before it asks
    // for a model, so this is a wiring fault rather than a customer path.
    throw new Error('no AI provider is registered')
  }
  return route.model
}
