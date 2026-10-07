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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { isHostPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import {
  pluginAiCapabilities,
  registerPluginAiCapability,
  type PluginAiCapability,
  type ResolvedPluginAiCapability,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { filterEnabledPluginsByReleaseFlags } from '@aglyn/tenant-data-admin/server/release-flags'
import { AI_TEMPLATE_SUBJECTS } from '../model/ai-template-subjects'
import { AI_SITE_PASS_CREDITS } from '../model/ai-site-job'
import type { AiBuildOps } from '../model/ai-build-job'
import { aiJobStepRunnerFor } from './ai-jobs'

/**
 * What THIS plugin lets a build make (AGL-3616), registered on the core's
 * capability contract exactly as any other plugin registers its own, so the
 * planner, the gates and the estimate read one list and name no plugin.
 *
 * Every one is built by a runner this plugin already has (`runnerKind`):
 * pages, layouts, forms, components and email designs are the plan's
 * creations and screens; templates, campaigns and automations are items with
 * arguments. A campaign and an automation are still WRITTEN by the marketing
 * and workflows plugins, through the writers their runners already call.
 */

/** This plugin's id, as its registrations name their owner. */
const AI_PLUGIN_ID = 'ai'

const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false } as const

const passes = (count: number) => () => count * AI_SITE_PASS_CREDITS

/** The operations this plugin owns, as it registers them. */
export const AI_OWNED_CAPABILITIES: readonly PluginAiCapability[] = [
  {
    op: 'page',
    noun: 'page',
    where: 'Pages',
    intents: ['new pages: home, about, services, contact, pricing, a landing page'],
    argsSchema: NO_ARGS,
    maxPerPlan: 8,
    freeAllowed: true,
    runnerKind: 'page',
    estimateCredits: passes(6),
    degrade: 'omit',
  },
  {
    op: 'layout',
    noun: 'layout',
    where: 'Layouts',
    intents: ['a header and footer shared by pages'],
    argsSchema: NO_ARGS,
    maxPerPlan: 1,
    freeAllowed: true,
    runnerKind: 'layout',
    estimateCredits: passes(1),
    degrade: 'fallback',
  },
  {
    op: 'form',
    noun: 'form',
    where: 'Forms',
    intents: ['a contact form, a quote request, a sign-up form'],
    argsSchema: NO_ARGS,
    maxPerPlan: 3,
    freeAllowed: true,
    runnerKind: 'form',
    estimateCredits: passes(1),
    degrade: 'omit',
  },
  {
    op: 'component',
    noun: 'component',
    where: 'Components',
    intents: ['a reusable card or block placed on several pages'],
    argsSchema: NO_ARGS,
    maxPerPlan: 4,
    freeAllowed: false,
    runnerKind: 'component',
    estimateCredits: passes(1),
    degrade: 'omit',
  },
  {
    op: 'email',
    noun: 'email design',
    where: 'Emails → Templates',
    intents: ['an email design: a welcome, a reply, an announcement'],
    argsSchema: NO_ARGS,
    maxPerPlan: 2,
    freeAllowed: false,
    runnerKind: 'email',
    estimateCredits: passes(1),
    degrade: 'omit',
  },
  {
    op: 'template',
    noun: 'page template',
    where: 'Templates',
    intents: ['a page template for blog posts, products or authors'],
    argsSchema: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description: 'What each page shows: entry (a collection entry), product or author.',
          enum: AI_TEMPLATE_SUBJECTS,
        },
        collectionId: {
          type: 'string',
          description: 'For entry: the collection id from the site inventory.',
          maxLength: 100,
        },
      },
      required: ['subject'],
      additionalProperties: false,
    },
    maxPerPlan: 2,
    freeAllowed: false,
    runnerKind: 'template',
    estimateCredits: passes(6),
    degrade: 'omit',
  },
  {
    op: 'campaign',
    noun: 'email campaign',
    where: 'Marketing → Campaigns',
    intents: ['an email campaign drafted and left unsent'],
    argsSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'What the campaign is called.', maxLength: 120 },
      },
      additionalProperties: false,
    },
    maxPerPlan: 2,
    freeAllowed: false,
    runnerKind: 'campaign',
    estimateCredits: passes(2),
    degrade: 'omit',
  },
  {
    op: 'workflow',
    noun: 'automation',
    where: 'Automations',
    intents: ['an automation: when a form is sent, do something'],
    argsSchema: NO_ARGS,
    maxPerPlan: 2,
    freeAllowed: false,
    runnerKind: 'workflow',
    estimateCredits: passes(1),
    degrade: 'omit',
  },
]

/** Registers this plugin's build operations; the console surface calls it. */
export function registerAiBuildCapabilities(): void {
  for (const capability of AI_OWNED_CAPABILITIES) {
    registerPluginAiCapability(capability, { pluginId: AI_PLUGIN_ID })
  }
}

/** What decides which operations a build may use here. */
export interface AiBuildOpsContext {
  orgId: string
  hostId: string | null
  org: Partial<AglynOrgBilling> | null
  /** The site document, for the plugins switched on and off on it. */
  host: Readonly<Record<string, unknown>> | null
  freeTaste: boolean
}

export interface AiBuildOpsDeps {
  /** The registered capabilities; the core registry's otherwise. */
  capabilities?: () => ResolvedPluginAiCapability[]
  /** The release-flag read; the platform's otherwise. */
  releasedPlugins?: (pluginIds: string[], orgId: string) => Promise<string[]>
  /** Whether a runner is registered for a kind; the machine's otherwise. */
  hasRunner?: (kind: string) => boolean
}

/**
 * The operations a build may plan on this site, by op (AGL-3616): every
 * registered capability whose owner runs here — switched on for the
 * workspace and the site, past its release flag — whose entitlement the plan
 * holds, which the Free taste may use where the workspace is on it, and,
 * for an AI-run operation, whose runner this process loaded. One release-flag
 * read for every owner at once. What a member may do and what an allowance
 * has left are the owner's to say when the item runs (`refusal`).
 */
export async function aiBuildOps(context: AiBuildOpsContext, deps: AiBuildOpsDeps = {}): Promise<AiBuildOps> {
  const all = (deps.capabilities ?? pluginAiCapabilities)()
  const hasRunner = deps.hasRunner ?? ((kind: string) => aiJobStepRunnerFor(kind as never) !== null)
  const owners = [...new Set(all.map((one) => one.pluginId).filter((id) => id !== AI_PLUGIN_ID))]
  const released = new Set(
    owners.length
      ? await (deps.releasedPlugins ??
          ((ids, orgId) => filterEnabledPluginsByReleaseFlags(ids, { orgId, authorization: null })))(owners, context.orgId)
      : [],
  )
  const ops = new Map<string, PluginAiCapability>()
  for (const { pluginId, capability } of all) {
    if (pluginId !== AI_PLUGIN_ID) {
      if (!released.has(pluginId)) continue
      if (!isHostPluginEnabled(context.org as { enabledPlugins?: string[] } | null, context.host, pluginId)) continue
    }
    if (capability.feature && !checkEntitlement(context.org, capability.feature)) continue
    if (context.freeTaste && !capability.freeAllowed) continue
    if (capability.runnerKind && !hasRunner(capability.runnerKind)) continue
    ops.set(capability.op, capability)
  }
  return ops
}

/**
 * The lines the plan step's request lists the item operations in: each op
 * with what it makes, its arguments and their meaning. Per site, so they ride
 * the job's own turn and never a cached system block.
 */
export function aiBuildOpLines(ops: AiBuildOps, structural: readonly string[]): string[] {
  const items = [...ops.values()].filter((one) => !structural.includes(one.op))
  if (!items.length) return ['Operations for items: none on this site. Leave items empty.']
  const lines = ['Operations for items (anything else goes in create or screens):']
  for (const one of items) {
    const args = Object.entries(one.argsSchema.properties).map(([name, property]) => {
      const required = one.argsSchema.required?.includes(name) ? '' : ' (optional)'
      const choices = property.enum ? ` one of ${property.enum.join('|')}` : ''
      return `${name}: ${property.type}${choices}${required} — ${property.description}`
    })
    lines.push(
      `- ${one.op}: ${aiNounWithArticle(one.noun)}, at most ${one.maxPerPlan}; for ${one.intents.join('; ')}.${
        one.pageBlocks?.length ? ` A page section that uses it places the ${one.pageBlocks.join(' or ')} block: put new:<name> in that section's uses.` : ''
      } Args: ${args.length ? `{ ${args.join('; ')} }` : '{}'}.`,
    )
  }
  return lines
}

function aiNounWithArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`
}

/** What a build can make here, in the owner's words, for the chat's instructions. */
export function aiBuildIntents(ops: AiBuildOps): string[] {
  return [...ops.values()].flatMap((one) => one.intents)
}
