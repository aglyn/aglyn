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

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * What an AI build can make, contributed by the plugin that owns each thing
 * (AGL-3616).
 *
 * A build turns one request — "a few pages, a contact form and a way to book
 * me" — into a plan of ITEMS, each an operation (`op`) with arguments, and
 * runs them in dependency order. The AI plugin plans and meters the build;
 * it does not know what a plugin's resource is, and the package map forbids
 * it importing that plugin. So every operation is a CAPABILITY the owner
 * registers from its server entry, and the build asks for one by `op`:
 *
 *  - the planner offers the model only the operations registered here, in
 *    the owner's own words (`noun`, `intents`, `argsSchema`);
 *  - admission removes an item whose capability this site, plan or member
 *    cannot use (`feature`, `permission`, `quota`, `freeAllowed`), with a
 *    sentence, so the rest of the plan still runs;
 *  - the item is executed one of two ways: `runnerKind` hands it to an
 *    existing AI job runner (the AI plugin's own operations), and
 *    `draftResource` hands its content to the owner's writer on
 *    `plugin-resource-drafts`, which checks it, meets the allowance and
 *    writes a draft that nothing publishes.
 *
 * An operation lights up the moment its owner registers it; nothing in the
 * AI plugin names it. Register by CALLING `registerPluginAiCapability` from a
 * function the server entry runs — a top-level side effect is dropped by a
 * bundler that sees no import of its result.
 *
 * Server-only: import this file by its own path, never from the barrel that
 * every published page loads.
 *
 * ## One capability per operation
 *
 * An operation has one owner. A second plugin registering an `op` another
 * plugin already owns is refused, naming both, and the incumbent keeps
 * serving; the same plugin registering again replaces its own.
 */

/** A value an item's arguments may hold: scalars and lists of strings only. */
export type PluginAiCapabilityArgValue = string | number | boolean | readonly string[]

/** An item's arguments, in the shape its capability's `argsSchema` declares. */
export type PluginAiCapabilityArgs = Readonly<Record<string, PluginAiCapabilityArgValue>>

/**
 * One argument, as a JSON Schema property the model fills in directly. The
 * subset is deliberately small: a flat object of scalars and string lists is
 * what a planner can be held to, and what `pluginAiCapabilityArgsProblems`
 * checks without a schema library.
 */
export interface PluginAiCapabilityArgProperty {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array'
  /** Read by the model: what the value means and how to choose it. */
  description: string
  /** For `string`: the allowed values. */
  enum?: readonly string[]
  /** For `integer`/`number`. */
  minimum?: number
  maximum?: number
  /** For `string`, and each item of an `array`. */
  maxLength?: number
  /** For `array`: always a list of strings. */
  items?: { type: 'string'; enum?: readonly string[]; maxLength?: number }
  maxItems?: number
}

/** A flat JSON Schema object: no nesting, no extra keys. */
export interface PluginAiCapabilityArgsSchema {
  type: 'object'
  properties: Readonly<Record<string, PluginAiCapabilityArgProperty>>
  required?: readonly string[]
  additionalProperties: false
}

/** How the items that depend on a failed item of this capability behave. */
export type PluginAiCapabilityDegrade =
  /** Dependents are built without it (a page loses the block that used it). */
  | 'omit'
  /** Dependents use something that already exists in its place (a site's own layout). */
  | 'fallback'

/** One planned item, as a capability sees it. */
export interface PluginAiCapabilityItem {
  /** The item's name in the plan, unique within it; other items cite it as `new:<name>`. */
  name: string
  args: PluginAiCapabilityArgs
}

/** What a capability's `draftContent` is told beside the item. */
export interface PluginAiCapabilityDraftContext {
  hostId: string
  /**
   * The drafts written for the items this one depends on, keyed by the
   * reference the plan used (`new:<name>`), each with its operation and the
   * id its own writer or runner gave it. A dependency that did not succeed is
   * absent.
   */
  dependencies: Readonly<Record<string, { op: string; id: string }>>
}

export interface PluginAiCapability {
  /** The operation's name in a plan, stable across releases: `page`, `note`. */
  op: string
  /** What one is called in a sentence a person reads: "contact form". */
  noun: string
  /** Where a person finds the draft afterwards: "Notes → Drafts". */
  where: string
  /**
   * What a person might ask for that this makes, as short phrases the chat's
   * instructions list. True of the shipped product: never a promise the
   * writer cannot keep.
   */
  intents: readonly string[]
  /** The item's arguments, which the planner fills in. */
  argsSchema: PluginAiCapabilityArgsSchema
  /** How many items of this operation one plan may hold. */
  maxPerPlan: number
  /** Whether a workspace on the free plan may have one made. */
  freeAllowed: boolean
  /** The entitlement a workspace needs, checked with the platform's entitlement read. */
  feature?: string
  /** The site permission the member needs. */
  permission?: string
  /** The allowance one counts against, which the owner's writer meets. */
  quota?: string
  /**
   * The resource whose writer on `plugin-resource-drafts` makes the draft.
   * Exactly one of this and `runnerKind` is set.
   */
  draftResource?: string
  /**
   * The AI job kind whose runner makes it — the AI plugin's own operations.
   * Exactly one of this and `draftResource` is set.
   */
  runnerKind?: string
  /** The most this item can cost, in AI credits; a draft written without a model costs 0. */
  estimateCredits(args: PluginAiCapabilityArgs): number
  /** Operations an item of this one may depend on. */
  dependsOnOps?: readonly string[]
  degrade: PluginAiCapabilityDegrade
  /**
   * Blocks a page places when it uses an item of this operation (the block
   * names the page palette knows). When the item fails, a dependent page is
   * built without them, and says so.
   */
  pageBlocks?: readonly string[]
  /**
   * The writer's content for an item, from its arguments and its built
   * dependencies. Pure. Absent means the arguments ARE the content.
   */
  draftContent?(
    item: PluginAiCapabilityItem,
    context: PluginAiCapabilityDraftContext,
  ): Readonly<Record<string, unknown>>
}

export const PLUGIN_AI_CAPABILITIES = definePluginServiceContract<PluginAiCapability>(
  'core.ai-capabilities',
  { multiple: true },
)

const OP_PATTERN = /^[a-z][a-z0-9-]{0,39}$/

/** Why a capability cannot be registered, or `null`. */
export function pluginAiCapabilityProblem(capability: PluginAiCapability): string | null {
  if (!OP_PATTERN.test(capability.op)) {
    return `ai capability op "${capability.op}" must be lowercase letters, digits and dashes`
  }
  const executors = [capability.draftResource, capability.runnerKind].filter(
    (one) => typeof one === 'string' && one.trim(),
  )
  if (executors.length !== 1) {
    return `ai capability "${capability.op}" needs exactly one of draftResource and runnerKind`
  }
  if (!Number.isInteger(capability.maxPerPlan) || capability.maxPerPlan < 1) {
    return `ai capability "${capability.op}" needs a maxPerPlan of at least 1`
  }
  if (capability.argsSchema?.type !== 'object' || capability.argsSchema.additionalProperties !== false) {
    return `ai capability "${capability.op}" needs a flat object argsSchema with additionalProperties: false`
  }
  for (const required of capability.argsSchema.required ?? []) {
    if (!(required in capability.argsSchema.properties)) {
      return `ai capability "${capability.op}" requires "${required}", which its schema does not declare`
    }
  }
  if (!capability.noun.trim() || !capability.where.trim()) {
    return `ai capability "${capability.op}" needs a noun and a where`
  }
  return null
}

/**
 * Registers what a plugin's AI builds can make. The owner is the loader's
 * marker when a register fn is running, else `options.pluginId`. An `op`
 * another plugin owns throws naming both; a malformed capability throws.
 */
export function registerPluginAiCapability(
  capability: PluginAiCapability,
  options?: { pluginId?: string },
): void {
  const problem = pluginAiCapabilityProblem(capability)
  if (problem) throw new Error(problem)
  const key = capability.op
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  const incumbent = resolvePluginServices(PLUGIN_AI_CAPABILITIES).find(
    (entry) => entry.key === key,
  )
  if (incumbent && pluginId && incumbent.pluginId !== pluginId) {
    throw new Error(
      `ai capability "${key}" is already registered by "${incumbent.pluginId}"; ` +
        `refused "${pluginId}"`,
    )
  }
  registerPluginService(PLUGIN_AI_CAPABILITIES, capability, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
    key,
  })
}

export interface ResolvedPluginAiCapability {
  /** The plugin that owns the operation. */
  pluginId: string
  capability: PluginAiCapability
}

/** Every registered capability with its owner, in registration order. */
export function pluginAiCapabilities(): ResolvedPluginAiCapability[] {
  return resolvePluginServices(PLUGIN_AI_CAPABILITIES).map((entry) => ({
    pluginId: entry.pluginId,
    capability: entry.impl,
  }))
}

/** The capability for an operation, with its owner, or `null` when nothing registered it. */
export function pluginAiCapability(op: string): ResolvedPluginAiCapability | null {
  const key = op.trim()
  const entry = resolvePluginServices(PLUGIN_AI_CAPABILITIES).find((one) => one.key === key)
  return entry ? { pluginId: entry.pluginId, capability: entry.impl } : null
}

/**
 * What is wrong with an item's arguments against its schema; empty when
 * nothing is. Pure, and the same answer on both sides of the seam: the
 * planner holds the model to it, and an owner may hold its content to it.
 */
export function pluginAiCapabilityArgsProblems(
  schema: PluginAiCapabilityArgsSchema,
  args: Readonly<Record<string, unknown>>,
): string[] {
  const problems: string[] = []
  for (const name of schema.required ?? []) {
    const value = args[name]
    if (value === undefined || value === null || value === '') problems.push(`"${name}" is required`)
  }
  for (const [name, value] of Object.entries(args)) {
    const property = schema.properties[name]
    if (!property) {
      problems.push(`"${name}" is not an argument`)
      continue
    }
    if (value === undefined || value === null) continue
    switch (property.type) {
      case 'string':
        if (typeof value !== 'string') problems.push(`"${name}" must be text`)
        else {
          if (property.enum && !property.enum.includes(value)) {
            problems.push(`"${name}" must be one of ${property.enum.join(', ')}`)
          }
          if (property.maxLength !== undefined && value.length > property.maxLength) {
            problems.push(`"${name}" must be at most ${property.maxLength} characters`)
          }
        }
        break
      case 'integer':
      case 'number':
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          (property.type === 'integer' && !Number.isInteger(value))
        ) {
          problems.push(`"${name}" must be ${property.type === 'integer' ? 'a whole number' : 'a number'}`)
        } else {
          if (property.minimum !== undefined && value < property.minimum) {
            problems.push(`"${name}" must be at least ${property.minimum}`)
          }
          if (property.maximum !== undefined && value > property.maximum) {
            problems.push(`"${name}" must be at most ${property.maximum}`)
          }
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') problems.push(`"${name}" must be true or false`)
        break
      case 'array':
        if (!Array.isArray(value) || value.some((one) => typeof one !== 'string')) {
          problems.push(`"${name}" must be a list of text`)
        } else {
          if (property.maxItems !== undefined && value.length > property.maxItems) {
            problems.push(`"${name}" must hold at most ${property.maxItems}`)
          }
          const items = property.items
          for (const one of value as string[]) {
            if (items?.enum && !items.enum.includes(one)) {
              problems.push(`"${name}" holds "${one}", which is not one of ${items.enum.join(', ')}`)
              break
            }
            if (items?.maxLength !== undefined && one.length > items.maxLength) {
              problems.push(`"${name}" holds an entry longer than ${items.maxLength} characters`)
              break
            }
          }
        }
        break
    }
  }
  return problems
}
