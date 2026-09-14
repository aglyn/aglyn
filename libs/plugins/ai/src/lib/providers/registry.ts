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

import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from '@aglyn/aglyn'
import { AI_PLUGIN_ID } from '../constants'
import { anthropicProvider } from './anthropic'
import type { AiProvider } from './contract'
import { openAiCompatibleProvider } from './openai-compatible'

/**
 * The provider registry (AGL-2939), on the platform's typed service
 * registry (AGL-2940). This plugin declares the contract and registers its
 * own adapters; a marketplace plugin registers a provider against the same
 * token and never imports this plugin's internals — the dependency runs
 * from the adopter to the contract and nowhere else.
 */
export const AI_PROVIDER_CONTRACT = definePluginServiceContract<AiProvider>(
  'ai.provider',
  { multiple: true },
)

/** Registers a provider. Owner defaults to this plugin; an adopter names itself. */
export function registerAiProvider(
  provider: AiProvider,
  options?: { pluginId?: string; priority?: number },
): void {
  registerPluginService(AI_PROVIDER_CONTRACT, provider, {
    pluginId: options?.pluginId ?? AI_PLUGIN_ID,
    priority: options?.priority,
    key: provider.id,
  })
}

/**
 * The two first-party adapters, registered the first time anyone asks and
 * nothing is there. A door called before the plugin's entry ran — a spec
 * driving the handler directly, a job step on a fresh process — gets the
 * same providers the entry would have registered; an adopter's provider
 * registered earlier is not displaced.
 */
export function ensureFirstPartyAiProviders(): void {
  if (resolvePluginServices(AI_PROVIDER_CONTRACT).length) return
  registerAiProvider(anthropicProvider)
  registerAiProvider(openAiCompatibleProvider)
}

/** Every registered provider, highest priority first. */
export function listAiProviders(): AiProvider[] {
  ensureFirstPartyAiProviders()
  return resolvePluginServices(AI_PROVIDER_CONTRACT).map((entry) => entry.impl)
}

/** One provider by id, or `undefined` when nothing registered it. */
export function aiProviderById(id: string): AiProvider | undefined {
  return listAiProviders().find((provider) => provider.id === id)
}

/** The environment variable naming the platform's default provider. */
export const AI_PROVIDER_ENV = 'AI_PROVIDER'

/**
 * The platform default: `AI_PROVIDER` when set and registered, else the
 * first registered provider. A deployment with none registered has no AI.
 */
export function defaultAiProvider(): AiProvider | undefined {
  const wanted = process.env[AI_PROVIDER_ENV]?.trim()
  if (wanted) {
    const named = aiProviderById(wanted)
    if (named) return named
  }
  return listAiProviders()[0]
}
