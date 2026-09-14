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
import type { AiProvider } from './contract'
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
