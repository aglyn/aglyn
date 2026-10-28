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

import { DUPLICABLE_HOST_RESOURCE_KINDS, DUPLICATE_NAME_MAX } from '@aglyn/aglyn/app-utils/duplicate-resource'
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
import { AI_BUILD_THEME_OP, type AiBuildOps } from '../model/ai-build-job'
import { AI_LOGIC_FUNCTION_RESOURCE } from '../model/ai-logic-job'
import { AI_AUTOMATION_RESOURCE } from '../model/ai-workflow-job'
import { AI_EDIT_TARGET_KINDS } from '../model/ai-edit-job'
import { AI_CAMPAIGN_RESOURCE } from './ai-job-campaign-step'
import { aiPluginDraftOwner, type AiPluginDraftOwnerLookup } from './ai-job-plugin-drafts'
import { aiJobStepRunnerFor } from './ai-jobs'
import { AI_SETTINGS_ARGS_SCHEMA, AI_SETTINGS_WHERE } from './ai-job-settings-step'
import { AI_MEDIA_ARGS_SCHEMA, AI_MEDIA_LIMITS, AI_MEDIA_WHERE } from './ai-job-media-step'
import { AI_TRACKING_ARGS_SCHEMA, AI_TRACKING_WHERE, aiTrackingInputFields, aiTrackingMissingInput } from './ai-job-tracking-step'
import { AI_PRIVACY_ARGS_SCHEMA, AI_PRIVACY_WHERE } from './ai-job-privacy-step'

/**
 * What THIS plugin lets a build make (AGL-3616), registered on the core's
 * capability contract exactly as any other plugin registers its own, so the
 * planner, the gates and the estimate read one list and name no plugin.
 *
 * Every one is built by a runner this plugin already has (`runnerKind`):
 * pages, layouts, forms, components and email designs are the plan's
 * creations and screens; templates, campaigns and automations are items with
 * arguments. A campaign and an automation are still WRITTEN by the marketing
 * and workflows plugins, through the writers their runners already call, and
 * a site function by the logic plugin's `function` writer, which the `logic`
 * runner calls when its job is a build's unit. A change to a page or layout
 * the site already has is the `edit` runner's, and a change to its header or
 * footer menu the `navigation` runner's (AGL-3728), a copy of something
 * it has the `duplicate` runner's (AGL-3740), a change to its settings
 * the `settings` runner's (AGL-3748), organizing its media library the
 * `media` runner's (AGL-3752), a change to its analytics and
 * advertising tags the `tracking` runner's (AGL-3751), and a change to its
 * theme the `theme` runner's proposal (AGL-4077).
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
  {
    // A function needs a model, so it is this plugin's operation; the logic
    // plugin owns the record and writes it (AGL-3616). New functions only: a
    // build never changes one the site already has.
    op: 'function',
    noun: 'site function',
    where: 'Logic → Functions',
    intents: ['a site function that works a value out from what it is given: a price, a total, a quote'],
    argsSchema: NO_ARGS,
    maxPerPlan: 2,
    // Free includes one function (`functionsPerHost: 1`), and Logic no feature.
    freeAllowed: true,
    quota: 'functionsPerHost',
    runnerKind: 'logic',
    estimateCredits: passes(1),
    degrade: 'omit',
  },
  {
    // A change to something the site already has (AGL-3616), made by the
    // `edit` runner: the Assist edit rung's protocol against the stored
    // document, saved as a version visitors do not see. Not on the Free
    // taste: without version history only an unpublished page can take a
    // change, which is rarely the page a request means, and its admission
    // would refuse the item after the plan was confirmed.
    op: 'edit',
    noun: 'page change',
    where: 'the page’s or layout’s versions',
    intents: [
      'a change to a page or layout the site already has — shorter copy, a new section, different wording — saved as a version visitors do not see until it is published',
    ],
    argsSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'The id of an existing page or layout from the site inventory.',
          maxLength: 64,
        },
        targetKind: {
          type: 'string',
          description: 'screen when target is a page, layout when it is a layout.',
          enum: AI_EDIT_TARGET_KINDS,
        },
      },
      required: ['target'],
      additionalProperties: false,
    },
    maxPerPlan: 3,
    freeAllowed: false,
    runnerKind: 'edit',
    estimateCredits: passes(1),
    degrade: 'omit',
  },
  {
    // The site's header and footer menus (AGL-3728): the Besigner's own Page
    // Links and Dropdown Menus in the site's layout, changed by code from the
    // words the planner wrote, saved as a version beside the live one. No
    // model, so no credits. Not on the Free taste, as `edit`: a layout is
    // always served, so without version history there is nowhere to land.
    op: 'navigation',
    noun: 'menu change',
    where: 'the layout’s versions',
    intents: [
      'changing the site’s header or footer menu — add, remove, rename, reorder or relink its items, or put items under a dropdown — saved as a layout version visitors do not see until it is published',
    ],
    argsSchema: {
      type: 'object',
      properties: {
        menu: {
          type: 'string',
          description: 'Which menu: header (the default), footer, or both.',
          enum: ['header', 'footer', 'both'],
        },
        layout: {
          type: 'string',
          description: 'The layout id from the site inventory, or new:<name> of a layout this plan makes; leave it out for the layout the site’s pages use.',
          maxLength: 64,
        },
        add: {
          type: 'array',
          description:
            'Items to add, each "Label => destination", or "Parent > Label => destination" to put it under the dropdown Parent. A destination is a page id from the site inventory, new:<page title> of a page this plan makes, a path such as /contact, or an https:// address.',
          items: { type: 'string', maxLength: 160 },
          maxItems: 12,
        },
        remove: {
          type: 'array',
          description: 'Labels of items to take out, as "Label" or "Parent > Label".',
          items: { type: 'string', maxLength: 100 },
          maxItems: 12,
        },
        rename: {
          type: 'array',
          description: 'Items to rename, each "Old label => New label".',
          items: { type: 'string', maxLength: 100 },
          maxItems: 12,
        },
        relink: {
          type: 'array',
          description: 'Items to point somewhere else, each "Label => destination", destinations as in add.',
          items: { type: 'string', maxLength: 160 },
          maxItems: 12,
        },
        order: {
          type: 'array',
          description: 'Top-level labels in the order wanted; items not named keep their order after them.',
          items: { type: 'string', maxLength: 60 },
          maxItems: 12,
        },
      },
      additionalProperties: false,
    },
    maxPerPlan: 1,
    freeAllowed: false,
    // Offered only where the change has somewhere to land: a plan with version history.
    feature: 'versioning',
    runnerKind: 'navigation',
    // Written by code from the plan's words: no model pass.
    estimateCredits: () => 0,
    degrade: 'omit',
  },
  {
    // A copy of something the site already has (AGL-3740), made by core's
    // `duplicateResource` — the console's own Duplicate… — so "another page
    // like Services" is copied rather than generated again. No model, so no
    // credits; the copy meets the plan's own counters as a create does,
    // which is why the Free taste may ask for one.
    op: 'duplicate',
    noun: 'copy',
    where: 'the list the original is on',
    intents: [
      'a copy of a page, component, layout, template, form, email design or workflow the site already has, as an unpublished draft to change — rather than making it again',
    ],
    argsSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          description: 'What to copy: screen (a page), component, layout, template, form, emailDesign or workflow.',
          enum: DUPLICABLE_HOST_RESOURCE_KINDS,
        },
        source: {
          type: 'string',
          description: 'The id of the thing to copy from the site inventory, or its exact name where the inventory does not list it.',
          maxLength: 64,
        },
        name: {
          type: 'string',
          description: 'What the copy is called; leave it out for "Copy of" the original’s name.',
          maxLength: DUPLICATE_NAME_MAX,
        },
      },
      required: ['kind', 'source'],
      additionalProperties: false,
    },
    maxPerPlan: 3,
    freeAllowed: true,
    runnerKind: 'duplicate',
    // Copied by code: no model pass.
    estimateCredits: () => 0,
    degrade: 'omit',
  },
  {
    // The site's settings (AGL-3748): the fields the console's settings
    // cards write — name, search defaults, favicon, logo and social image
    // from the media library, language, time zone, contact details and the
    // cookie banner's mode — held to the same limits and saved live when the
    // plan is confirmed, as a settings save is. No model, so no credits; every
    // plan may change its own settings, so the Free taste may too. Domains,
    // members, billing, plugins, indexing and anything with a credential are
    // not arguments, so they cannot be asked for.
    op: 'settings',
    noun: 'settings change',
    where: AI_SETTINGS_WHERE,
    intents: [
      'changing the site’s settings — its name, search title and description, title pattern, favicon, logo or social image (from images already in the media library), language, time zone, business name, description (tagline), phone, contact email or address, or the cookie banner’s mode — saved to the live site when the plan is confirmed',
    ],
    argsSchema: AI_SETTINGS_ARGS_SCHEMA,
    maxPerPlan: 1,
    freeAllowed: true,
    runnerKind: 'settings',
    // A setting has no draft state: saved, it is what the live site renders.
    live: true,
    // Written by code from the plan's values: no model pass.
    estimateCredits: () => 0,
    degrade: 'omit',
  },
  {
    // Organizing files already in the site's own media library (AGL-3752):
    // the folder each is filed in, its tags, its alt text and its name, as
    // the library's Details drawer and bulk actions write them, saved live
    // when the plan is confirmed. Never an upload, a copy, a replacement or a
    // deletion, and never the organization's shared library. No model, so no
    // credits; every plan has a media library, so the Free taste may too.
    op: 'media',
    noun: 'media library change',
    where: AI_MEDIA_WHERE,
    intents: [
      `organizing files already in the site’s media library — filing them in a folder (made if missing), adding or removing tags, renaming one, or writing alt text for an image the request describes or from the caption the library already holds — up to ${AI_MEDIA_LIMITS.files} files a change, saved live when the plan is confirmed; never uploading, copying or deleting a file`,
    ],
    argsSchema: AI_MEDIA_ARGS_SCHEMA,
    maxPerPlan: 4,
    freeAllowed: true,
    runnerKind: 'media',
    // A library file's details have no draft state: saved, they are what the library shows.
    live: true,
    // Written by code from the plan's values: no model pass.
    estimateCredits: () => 0,
    degrade: 'omit',
  },
  {
    // The site's analytics and advertising tags (AGL-3751): the ids the
    // console's Setup → Tracking card sets — Google Analytics, Tag Manager,
    // and the Meta, Google Ads, LinkedIn, TikTok and Pinterest tags — each
    // held to the card's own pattern, set or removed, saved live on confirm.
    // Only public ids the person states: never a credential (Ad conversions'
    // tokens, Zapier, webhook secrets), and never the consent banner, which
    // still decides where every tag loads. No model, so no credits; the card
    // is on every plan, so the Free taste may ask too.
    op: 'tracking',
    noun: 'tracking change',
    where: AI_TRACKING_WHERE,
    intents: [
      'connecting or removing the site’s Google Analytics, Google Tag Manager, Meta pixel, Google Ads, LinkedIn Insight, TikTok pixel or Pinterest tag by the ID the person gives (never one it makes up; ask for the ID when the request has none) — saved to the live site when the plan is confirmed, loading only where a visitor’s cookie consent allows',
    ],
    argsSchema: AI_TRACKING_ARGS_SCHEMA,
    maxPerPlan: 1,
    freeAllowed: true,
    runnerKind: 'tracking',
    // A tag has no draft state: saved, it is on every live page.
    live: true,
    // An item with no usable id asks for it instead of being built (AGL-3751).
    missingInput: aiTrackingMissingInput,
    // …and waits for it in `needs_input`, with a field naming the provider (AGL-3978).
    inputFields: aiTrackingInputFields,
    // Written by code from the plan's values: no model pass.
    estimateCredits: () => 0,
    degrade: 'omit',
  },
  {
    // Who can see the site (AGL-4033): maintenance mode, the Discourage search
    // engines switch and a page's visibility, as the console's three controls
    // set them, saved live on confirm. Never a page password, which would put
    // the password in the chat. No model, so no credits; every plan has these
    // controls, so the Free taste may ask too.
    op: 'privacy',
    noun: 'privacy change',
    where: AI_PRIVACY_WHERE,
    intents: [
      'making the site private or public again — maintenance mode (the whole site offline to every visitor until it is turned off; site admins only), hiding the site from search engines (it stays open to anyone with a link), or setting pages Public, Unlisted or Members only (Business plan and above) — saved to the live site when the plan is confirmed; never a page password, which the person sets in the page’s Page Access card',
    ],
    argsSchema: AI_PRIVACY_ARGS_SCHEMA,
    maxPerPlan: 1,
    freeAllowed: true,
    runnerKind: 'privacy',
    // None of these has a draft state: saved, it is what the live site does.
    live: true,
    // Written by code from the plan's values: no model pass.
    estimateCredits: () => 0,
    degrade: 'omit',
  },
  {
    // A change to the site's theme (AGL-4077): the theme runner's proposal —
    // the same one the Theme assistant makes — which the owner previews and
    // applies in Setup → Theme. The build writes nothing to the theme, so it
    // is never live. One a plan, on paid plans only; the Free taste changes
    // its theme in Setup → Theme.
    op: AI_BUILD_THEME_OP,
    noun: 'theme change',
    where: 'Setup → Theme',
    intents: [
      'a change to the site’s theme — its colors, fonts or corners — proposed for the owner to apply in Setup → Theme; the build never changes the live theme',
    ],
    argsSchema: NO_ARGS,
    maxPerPlan: 1,
    freeAllowed: false,
    runnerKind: 'theme',
    estimateCredits: passes(1),
    degrade: 'omit',
  },
]

/**
 * The resource another plugin writes for each operation of this plugin's that
 * cannot be built without it. The operation runs where that writer's owner
 * runs — registered, switched on for the workspace and the site, and past its
 * release flag — exactly as an operation that owner registered would.
 */
export const AI_OWNED_OP_WRITERS: Readonly<Partial<Record<string, string>>> = {
  function: AI_LOGIC_FUNCTION_RESOURCE,
  // A campaign is written by the marketing plugin's campaign writer, an
  // automation by the workflows plugin's: neither is offered where its
  // writer's plugin is off, rather than planned and then skipped.
  campaign: AI_CAMPAIGN_RESOURCE,
  workflow: AI_AUTOMATION_RESOURCE,
}

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
  /** Which plugin writes a resource; the core's registry otherwise. */
  writerOwner?: AiPluginDraftOwnerLookup
}

/**
 * The operations a build may plan on this site, by op (AGL-3616): every
 * registered capability whose owner runs here — switched on for the
 * workspace and the site, past its release flag; for one of this plugin's
 * operations another plugin writes (`AI_OWNED_OP_WRITERS`), that writer's
 * owner, and a writer registered at all — whose entitlement the plan
 * holds, which the Free taste may use where the workspace is on it, and,
 * for an AI-run operation, whose runner this process loaded. One release-flag
 * read for every owner at once. What a member may do and what an allowance
 * has left are the owner's to say when the item runs (`refusal`).
 */
export async function aiBuildOps(context: AiBuildOpsContext, deps: AiBuildOpsDeps = {}): Promise<AiBuildOps> {
  const all = (deps.capabilities ?? pluginAiCapabilities)()
  const hasRunner = deps.hasRunner ?? ((kind: string) => aiJobStepRunnerFor(kind as never) !== null)
  const writerOwner = deps.writerOwner ?? aiPluginDraftOwner
  // The plugin each of this plugin's operations depends on, by op; `null` where its writer is not registered.
  const writtenBy = new Map<string, string | null>()
  for (const { pluginId, capability } of all) {
    const resource = pluginId === AI_PLUGIN_ID ? AI_OWNED_OP_WRITERS[capability.op] : undefined
    if (resource) writtenBy.set(capability.op, writerOwner(resource))
  }
  const owners = [
    ...new Set(
      [...all.map((one) => one.pluginId), ...writtenBy.values()].filter(
        (id): id is string => !!id && id !== AI_PLUGIN_ID,
      ),
    ),
  ]
  const released = new Set(
    owners.length
      ? await (deps.releasedPlugins ??
          ((ids, orgId) => filterEnabledPluginsByReleaseFlags(ids, { orgId, authorization: null })))(owners, context.orgId)
      : [],
  )
  const ops = new Map<string, PluginAiCapability>()
  for (const { pluginId, capability } of all) {
    // The plugin that must run here: the owner, or for one of this plugin's
    // operations, the plugin that writes what it makes.
    const runsOn = pluginId === AI_PLUGIN_ID ? writtenBy.get(capability.op) : pluginId
    if (runsOn === null) continue
    if (runsOn !== undefined && runsOn !== AI_PLUGIN_ID) {
      if (!released.has(runsOn)) continue
      if (!isHostPluginEnabled(context.org as { enabledPlugins?: string[] } | null, context.host, runsOn)) continue
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
      // An array's values are named too (AGL-3616): told only "days: array",
      // the live canonical plan wrote "monday" for the enum's "mon".
      const choices = property.enum
        ? ` one of ${property.enum.join('|')}`
        : property.items?.enum
          ? ` of ${property.items.enum.join('|')}`
          : ''
      return `${name}: ${property.type}${choices}${required} — ${property.description}`
    })
    lines.push(
      `- ${one.op}: ${aiNounWithArticle(one.noun)}, at most ${one.maxPerPlan}; for ${one.intents.join('; ')}.${
        one.pageBlocks?.length ? ` A page section that uses it places the ${one.pageBlocks.join(' or ')} block: put new:<name> in that section's uses.` : ''
      } Args: ${args.length ? `{ ${args.join('; ')} }` : '{}'}.`,
    )
  }
  // The plan's own vocabulary has a theme change in create, which a build
  // does not build there (AGL-4077): the item is the one way it is made.
  if (ops.has(AI_BUILD_THEME_OP)) lines.push(AI_BUILD_THEME_OP_LINE)
  // Measured live on the canonical request (AGL-3616): asked for "forms for
  // bookings", the planner made a plain form rather than the operation that
  // takes bookings. An operation does the job; a form that imitates it does not.
  lines.push(
    'When the request asks for what one of these operations makes, plan that operation as an item, and place it on the page that offers it. Never stand in for it with a form, page or component that only imitates it: a form that collects what the operation would handle does not do its job. A form is for what no operation here makes, such as general inquiries.',
  )
  return lines
}

/** What the plan is told where a build may change the theme (AGL-4077). */
export const AI_BUILD_THEME_OP_LINE =
  'A change to the theme is planned as the theme item, never as a theme change in create: at most one, and only when the request asks for a different look.'

function aiNounWithArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`
}

/** What a build can make here, in the owner's words, for the chat's instructions. */
export function aiBuildIntents(ops: AiBuildOps): string[] {
  return [...ops.values()].flatMap((one) => one.intents)
}
