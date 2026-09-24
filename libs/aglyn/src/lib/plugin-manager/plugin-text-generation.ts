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
} from './plugin-services'

/**
 * Text one plugin has written for it by the workspace's generation service
 * (AGL-3324).
 *
 * A plugin that wants a paragraph drafted — a sequence's email for one
 * person, a summary, a subject line — must not reach a model itself: the
 * provider, the model choice, the credits, the allotments and the usage
 * ledger all belong to whichever plugin sells generation to the workspace,
 * and the package map forbids importing it. So that plugin registers ONE
 * generator here (a slot), and a caller asks for it by nothing more than
 * "the generator": the request names the member the text is for and what
 * the text is for, and the generator applies every rule it applies at its
 * own doors — the permission, the entitlement, the switches, the meter —
 * and answers the text, or why not, and never throws for a refusal.
 *
 * ## The registry carries no authorization of the CALLER
 *
 * A generator applies its rules to the member the request names, and knows
 * nothing about whether the caller may act for that member. A caller
 * establishes, in its own terms and before it asks: who is asking, and that
 * the org is the one they are a member of.
 *
 * ## What a request may carry
 *
 * `system` is the caller's standing instructions, byte-identical from one
 * call to the next so a provider that caches a prefix can; everything about
 * the particular person or record rides in `prompt`. Nothing here is
 * remembered by the generator beyond its usage ledger, which keeps the
 * purpose and the tokens and never the words.
 */

export interface PluginTextGenerationRequest {
  orgId: string
  /**
   * The site the text is for, when it is for one: a collaborator's
   * permission and a site's allotment are decided on it. `null` on an
   * org-level surface.
   */
  hostId: string | null
  /** The member the text is for: their permission, their allotment, their usage. */
  uid: string
  /** Whether the member's session carries a verified staff claim. */
  staff: boolean
  /**
   * The org document the caller already read, for the generator's
   * entitlement and meter reads; `null` and the generator reads it.
   */
  org: Readonly<Record<string, unknown>> | null
  /**
   * What the text is for, as the usage ledger buckets it: the plugin's id
   * and a word, joined by a hyphen (`outreach-curate`). Letters, digits and
   * hyphens only; a generator normalizes anything else.
   */
  purpose: string
  /** The caller's standing instructions — see the module note. */
  system: string
  /** The one turn: the brief, the record's facts, the skeleton to rewrite. */
  prompt: string
  /** The longest answer wanted, in tokens; the generator caps it at its own ceiling. */
  maxTokens?: number
  now?: Date
  signal?: AbortSignal
}

/** Why a generator did not answer with text. */
export type PluginTextGenerationRefusalReason =
  /** No plugin generates text for this workspace, or the door is not released to it. */
  | 'unavailable'
  /** The member's role lacks the generation permission. */
  | 'permission'
  /** The workspace's plan does not include generation. */
  | 'entitlement'
  /** Generation is switched off — for the platform, the workspace or the site. */
  | 'off'
  /** A limit refused the request: credits, a budget, an allotment. */
  | 'quota'
  /** The model declined to write it. */
  | 'refused'
  /** The provider could not be reached or failed; nothing was spent. */
  | 'failed'

export interface PluginTextGenerationRefusal {
  ok: false
  /** The HTTP status a door would answer with. */
  status: number
  reason: PluginTextGenerationRefusalReason
  /** Customer-safe: a caller shows it as it stands. */
  error: string
}

export interface PluginTextGenerationAnswer {
  ok: true
  text: string
  /** The model that wrote it, for the caller's own audit record. */
  model: string
  usage: { inputTokens: number; outputTokens: number }
}

export type PluginTextGenerationResult = PluginTextGenerationAnswer | PluginTextGenerationRefusal

export interface PluginTextGenerator {
  /** The text, or why not. A refusal is returned, never thrown. */
  generate(request: PluginTextGenerationRequest): Promise<PluginTextGenerationResult>
}

export const PLUGIN_TEXT_GENERATION = definePluginServiceContract<PluginTextGenerator>(
  'core.text-generation',
  { multiple: false },
)

/**
 * Registers the workspace's text generator. The owner is the loader's marker
 * when a register fn is running, else `options.pluginId`; with neither the
 * registration throws. A second plugin's generator throws naming both, and
 * the incumbent keeps serving; the same plugin registering again replaces
 * its own.
 */
export function registerPluginTextGenerator(
  generator: PluginTextGenerator,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_TEXT_GENERATION, generator, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

export interface ResolvedPluginTextGenerator {
  /** The plugin that generates. */
  pluginId: string
  generator: PluginTextGenerator
}

/** The generator with its owner, or `null` when no plugin generates text. */
export function pluginTextGenerator(): ResolvedPluginTextGenerator | null {
  const entry = resolvePluginServices(PLUGIN_TEXT_GENERATION)[0]
  return entry ? { pluginId: entry.pluginId, generator: entry.impl } : null
}

/** A purpose as the ledger keys it: lower-case letters, digits and hyphens. */
export function normalizePluginTextGenerationPurpose(purpose: string): string {
  return (
    String(purpose ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'plugin'
  )
}
