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
import { runPluginDeclarationsRepair } from './plugin-declarations-repair'

/**
 * Site chat tools (AGL-4250): what a plugin lets the AI chat on a published
 * site look up, and propose, for a visitor.
 *
 * The chat belongs to one plugin and the facts it needs belong to others: a
 * store's products, a site's open booking slots, its upcoming events. No
 * plugin imports another, so each registers its tools here from its own
 * server entry, and the chat lists the tools of the plugins on for the site
 * it is answering on.
 *
 * Two kinds, and the difference is the whole safety posture:
 *
 * - A `lookup` reads. Its answer is quoted to the model as data, never as an
 *   instruction, and may carry cards the visitor sees (a product's photo and
 *   price). It never writes.
 * - A `proposal` checks that what the visitor asked for exists and is open,
 *   and answers the confirm card the widget draws. The card names a request
 *   the VISITOR's browser sends, with the visitor's own cookies, when the
 *   visitor presses it. The server never sends it: nothing a model says can
 *   pay, book, reserve or change an account.
 *
 * Every tool is scoped to the one site the chat is answering on; the host id
 * it is handed is the only site it may read.
 */

/** What the owner allowed the chat to do, from least to most. */
export type SiteChatCapability = 'answer' | 'cart' | 'book'

export const SITE_CHAT_CAPABILITIES: readonly SiteChatCapability[] = ['answer', 'cart', 'book']

/** A card the widget draws under an answer. */
export interface SiteChatCard {
  kind: 'product' | 'stay' | 'event' | 'service' | 'slot'
  title: string
  /** A site path: `/products/day-pass`. Never another origin; absent with no page. */
  url?: string
  imageUrl?: string
  /** Formatted for the site: "$45". */
  price?: string
  /** The struck-through price beside a sale price. */
  compareAtPrice?: string
  /** One line under the title: "Saturdays, 10–11:30" or "From $8". */
  caption?: string
}

/**
 * The request a confirm card sends when the visitor presses it: a POST to one
 * of the site's own API routes, as JSON. `path` must be one of the tool's
 * declared `endpoints`; the chat refuses any other.
 */
export interface SiteChatProposalRequest {
  path: string
  body: Record<string, unknown>
}

/**
 * What the card asks the visitor before it sends: their name and email for
 * a booking, say. Typed by the visitor on the card, merged into the request
 * body under `name`, and never seen by the chat.
 */
export interface SiteChatProposalField {
  name: string
  label: string
  type: 'text' | 'email' | 'tel'
  required: boolean
}

export interface SiteChatProposal {
  kind: 'add-to-cart' | 'reserve' | 'book'
  /** What the visitor fills in on the card before pressing it. */
  fields?: SiteChatProposalField[]
  /** Sends a fresh `Idempotency-Key` with the request, for a door that takes one. */
  idempotent?: boolean
  /**
   * A window event the page's own elements listen for, dispatched once the
   * request went through: a cart badge refreshing after an add.
   */
  afterEvent?: string
  /** The card's heading: "Add Adult day pass to your cart?" */
  title: string
  /** What will happen, in a line or two the visitor reads before pressing. */
  summary: string
  /** The confirm button: "Add to cart", "Reserve these dates". */
  confirmLabel: string
  request: SiteChatProposalRequest
  /**
   * Where the visitor goes once it is done, when somewhere: the cart, or the
   * reservation's checkout.
   */
  thenUrl?: string
  card?: SiteChatCard
}

export interface SiteChatToolAnswer {
  /**
   * What the model is told, as quoted data. Plain text a few hundred words at
   * most; the chat caps it.
   */
  text: string
  cards?: SiteChatCard[]
  /** A proposal tool's answer, when what was asked for can be done. */
  proposal?: SiteChatProposal
}

export interface SiteChatToolRequest {
  /** The one site the tool may read. */
  hostId: string
  /** The model's arguments, already checked against `inputSchema`'s shape by the tool. */
  input: Record<string, unknown>
  /** The site's time zone, for dates the tool states. */
  timeZone?: string
}

export interface SiteChatTool {
  /** Unique across plugins: `<plugin>_<verb>`, lowercase, digits and `_`. */
  name: string
  /** For the model: what it finds or proposes, and when to use it. */
  description: string
  /** A JSON schema of `type: 'object'`. */
  inputSchema: Record<string, unknown>
  kind: 'lookup' | 'proposal'
  /** The least the owner must have allowed for the tool to be offered. */
  capability: SiteChatCapability
  /** A proposal tool's request paths, as its plugin registered them. */
  endpoints?: readonly string[]
  run(request: SiteChatToolRequest): Promise<SiteChatToolAnswer>
}

export interface RegisteredSiteChatTool {
  pluginId: string
  tool: SiteChatTool
}

export const PLUGIN_SITE_CHAT_TOOLS = definePluginServiceContract<SiteChatTool>(
  'core.site-chat-tools',
  { multiple: true },
)

const TOOL_NAME = /^[a-z][a-z0-9_]{2,63}$/

export function registerPluginSiteChatTool(
  tool: SiteChatTool,
  options?: { pluginId?: string },
): void {
  if (!TOOL_NAME.test(tool.name)) {
    throw new Error(`a site chat tool name must match ${TOOL_NAME}: ${tool.name}`)
  }
  if (tool.kind === 'proposal' && !tool.endpoints?.length) {
    throw new Error(`a proposal tool must declare its endpoints: ${tool.name}`)
  }
  registerPluginService(PLUGIN_SITE_CHAT_TOOLS, tool, {
    key: tool.name,
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** Whether `allowed` admits a tool that needs `needed`. */
export function siteChatCapabilityAdmits(
  allowed: readonly SiteChatCapability[],
  needed: SiteChatCapability,
): boolean {
  return needed === 'answer' || allowed.includes(needed)
}

/**
 * The tools of the plugins on for a site, the first registration of each
 * name, filtered to what the owner allowed. Declarations are repaired once
 * when nothing is registered, as the other server seams do.
 */
export async function listPluginSiteChatTools(
  enabledPluginIds: readonly string[],
  allowed: readonly SiteChatCapability[] = ['answer'],
): Promise<RegisteredSiteChatTool[]> {
  if (!enabledPluginIds.length) return []
  if (!resolvePluginServices(PLUGIN_SITE_CHAT_TOOLS).length) {
    try {
      await runPluginDeclarationsRepair()
    } catch (error) {
      console.error('[site-chat] the declarations repair failed', error)
    }
  }
  const on = new Set(enabledPluginIds)
  const seen = new Set<string>()
  const out: RegisteredSiteChatTool[] = []
  for (const entry of resolvePluginServices(PLUGIN_SITE_CHAT_TOOLS)) {
    if (!on.has(entry.pluginId)) continue
    const tool = entry.impl
    if (seen.has(tool.name) || !siteChatCapabilityAdmits(allowed, tool.capability)) continue
    seen.add(tool.name)
    out.push({ pluginId: entry.pluginId, tool })
  }
  return out
}

/**
 * Whether a proposal's request may be shown as a confirm card: a site API
 * path the tool declared, with no other origin, query or traversal in it.
 */
export function siteChatProposalRequestAllowed(
  tool: Pick<SiteChatTool, 'endpoints'>,
  request: SiteChatProposalRequest | undefined,
): boolean {
  if (!request || typeof request.path !== 'string') return false
  const path = request.path.replace(/^\/?api\//, '')
  if (!/^[a-z0-9][a-z0-9/_-]*$/.test(path) || path.includes('..')) return false
  return Boolean(tool.endpoints?.includes(path))
}

/**
 * Who the visitor is, when a plugin knows: a signed-in site member's first
 * name, for "Good morning, Pat". The plugin that keeps site accounts reads
 * its own session cookie and answers; the chat never sees the session. One
 * reader: the first registered.
 */
export interface SiteChatVisitorReader {
  readVisitor(request: {
    hostId: string
    cookies: Readonly<Record<string, string>>
  }): Promise<{ name: string } | null>
}

export const PLUGIN_SITE_CHAT_VISITOR = definePluginServiceContract<SiteChatVisitorReader>(
  'core.site-chat-visitor',
  { multiple: false },
)

export function registerPluginSiteChatVisitorReader(
  reader: SiteChatVisitorReader,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_SITE_CHAT_VISITOR, reader, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The visitor reader of a plugin on for the site, or `null`. */
export function pluginSiteChatVisitorReader(
  enabledPluginIds: readonly string[],
): SiteChatVisitorReader | null {
  const on = new Set(enabledPluginIds)
  return resolvePluginServices(PLUGIN_SITE_CHAT_VISITOR).find((entry) => on.has(entry.pluginId))?.impl ?? null
}
