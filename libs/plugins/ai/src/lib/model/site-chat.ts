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
  normalizeSitePathList,
  sitePathListShows,
  type SitePathListMode,
} from '@aglyn/aglyn/app-utils/site-path-patterns'
import type {
  SiteChatCapability,
  SiteChatCard,
  SiteChatProposal,
} from '@aglyn/aglyn/plugin-manager/plugin-site-chat-tools'
import type { OrgPlan } from '@aglyn/aglyn/foundation/definitions/org-billing.types'

/**
 * Aglyn AI on a published site (AGL-4250): the owner's settings, the slice a
 * page carries, the wire format, and the site-chat credit allotment. Free of
 * any server or React dependency, so the console card, the site runtime and
 * the door read one definition.
 */

/** The visitor's door, on the published site only (`tenantApi`). */
export const SITE_CHAT_ROUTE = 'ai/site-chat'
/** The owner's settings, on the console only (`consoleApi`). */
export const SITE_CHAT_SETTINGS_ROUTE = 'ai/site-chat/settings'
/** The owner's conversations and figures, on the console only. */
export const SITE_CHAT_CONVERSATIONS_ROUTE = 'ai/site-chat/conversations'
/** A visitor's own conversation so far, on the published site. */
export const SITE_CHAT_HISTORY_ROUTE = 'ai/site-chat/history'

/** The release flag, off by default; a released-off door answers 404. */
export const SITE_CHAT_RELEASE_FLAG = 'release_ai_site_chat'

/** The site runtime's id: `contributes.site.features`. */
export const SITE_CHAT_RUNTIME_ID = 'ai-site-chat'
/** The page prop the enricher answers. */
export const SITE_CHAT_PAGE_PROP = 'aiSiteChat'
/** The console widget on a site's settings page. */
export const SITE_CHAT_WIDGET_ID = 'ai-site-chat-settings'

/** `hosts/{hostId}/pluginSettings/{SITE_CHAT_SETTINGS_DOC}`. */
export const SITE_CHAT_SETTINGS_COLLECTION = 'pluginSettings'
export const SITE_CHAT_SETTINGS_DOC = 'ai-site-chat'
/** `hosts/{hostId}/siteChats/{conversationId}`: one per visitor session. */
export const SITE_CHATS_COLLECTION = 'siteChats'
/** `orgs/{orgId}/siteChatUsage/{YYYY-MM}`: the allotment's meter. */
export const SITE_CHAT_USAGE_COLLECTION = 'siteChatUsage'

/** The visitor session cookie, per site. */
export const siteChatCookieName = (hostId: string): string => `aglyn_chat_${hostId}`

export const SITE_CHAT_GREETING_MAX = 200
export const SITE_CHAT_OPENING_MAX = 400
export const SITE_CHAT_CHIP_MAX = 40
export const SITE_CHAT_CHIPS_MAX = 4
export const SITE_CHAT_MAX_PATHS = 50
export const SITE_CHAT_MAX_PATH_LENGTH = 200
/** What one visitor message may carry. */
export const SITE_CHAT_MESSAGE_MAX = 1_000
/** Turns one conversation may take in a day. */
export const SITE_CHAT_TURNS_PER_CONVERSATION = 30
/** Turns the history keeps verbatim for the model. */
export const SITE_CHAT_HISTORY_TURNS = 8

export const SITE_CHAT_DEFAULT_GREETING = 'Hi! Ask me anything about us.'

export type SiteChatPosition = 'right' | 'left'

export interface SiteChatSettings {
  enabled: boolean
  /** The first line in the panel. */
  greeting: string
  /**
   * The owner's opening message, shown once per visitor before they ask
   * anything (a promotion, an announcement). '' for none.
   */
  openingMessage: string
  /** Suggested questions under the greeting. */
  chips: string[]
  /** What the chat may do besides answering. */
  capabilities: SiteChatCapability[]
  pages: SitePathListMode
  paths: string[]
  position: SiteChatPosition
  /**
   * The owner's own ceiling on what visitor chats may spend in a month, in
   * credits, under the plan's site-chat allotment; `null` for the allotment.
   */
  monthlyCreditCap: number | null
  /** Hand a visitor to a person (the Inbox) when the chat cannot help. */
  handOff: boolean
}

export const SITE_CHAT_DEFAULT_SETTINGS: SiteChatSettings = {
  enabled: false,
  greeting: SITE_CHAT_DEFAULT_GREETING,
  openingMessage: '',
  chips: [],
  capabilities: ['answer'],
  pages: 'all',
  paths: [],
  position: 'right',
  monthlyCreditCap: null,
  handOff: true,
}

const CAPABILITY_SET: readonly SiteChatCapability[] = ['answer', 'cart', 'book']

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''

export type SiteChatSettingsResult = { settings: SiteChatSettings } | { error: string }

export function normalizeSiteChatSettings(input: unknown): SiteChatSettingsResult {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const greetingText = typeof raw['greeting'] === 'string' ? raw['greeting'].trim() : ''
  if (greetingText.length > SITE_CHAT_GREETING_MAX) {
    return { error: `Keep the greeting under ${SITE_CHAT_GREETING_MAX} characters.` }
  }
  const openingText = typeof raw['openingMessage'] === 'string' ? raw['openingMessage'].trim() : ''
  if (openingText.length > SITE_CHAT_OPENING_MAX) {
    return { error: `Keep the opening message under ${SITE_CHAT_OPENING_MAX} characters.` }
  }
  const chips: string[] = []
  for (const entry of Array.isArray(raw['chips']) ? raw['chips'] : []) {
    const chip = clean(entry, 200)
    if (!chip) continue
    if (chip.length > SITE_CHAT_CHIP_MAX) {
      return { error: `Keep each suggested question under ${SITE_CHAT_CHIP_MAX} characters.` }
    }
    if (!chips.includes(chip)) chips.push(chip)
  }
  if (chips.length > SITE_CHAT_CHIPS_MAX) {
    return { error: `Offer at most ${SITE_CHAT_CHIPS_MAX} suggested questions.` }
  }
  const capabilities = CAPABILITY_SET.filter(
    (capability) =>
      capability === 'answer' ||
      (Array.isArray(raw['capabilities']) && raw['capabilities'].includes(capability)),
  )
  const list = normalizeSitePathList(
    { pages: raw['pages'] ?? 'all', paths: raw['paths'] },
    { noun: 'the chat', maxPaths: SITE_CHAT_MAX_PATHS, maxLength: SITE_CHAT_MAX_PATH_LENGTH },
  )
  if ('error' in list) return { error: list.error }
  let monthlyCreditCap: number | null = null
  if (raw['monthlyCreditCap'] !== null && raw['monthlyCreditCap'] !== undefined && raw['monthlyCreditCap'] !== '') {
    const cap = Number(raw['monthlyCreditCap'])
    if (!Number.isFinite(cap) || cap < 0) return { error: 'The monthly cap is a number of credits, 0 or more.' }
    monthlyCreditCap = Math.min(10_000_000, Math.floor(cap))
  }
  return {
    settings: {
      enabled: raw['enabled'] === true,
      greeting: greetingText.replace(/\s+/g, ' ') || SITE_CHAT_DEFAULT_GREETING,
      openingMessage: openingText.replace(/[ \t]+/g, ' '),
      chips,
      capabilities,
      pages: list.pages,
      paths: list.paths,
      position: raw['position'] === 'left' ? 'left' : 'right',
      monthlyCreditCap,
      handOff: raw['handOff'] !== false,
    },
  }
}

/** A stored document read back; anything unreadable is the defaults, off. */
export function readStoredSiteChatSettings(stored: unknown): SiteChatSettings {
  if (!stored || typeof stored !== 'object') return { ...SITE_CHAT_DEFAULT_SETTINGS }
  const result = normalizeSiteChatSettings(stored)
  return 'error' in result ? { ...SITE_CHAT_DEFAULT_SETTINGS } : result.settings
}

/** What a page the chat shows on carries for the runtime. */
export interface SiteChatSlice {
  greeting: string
  openingMessage: string
  chips: string[]
  capabilities: SiteChatCapability[]
  position: SiteChatPosition
  handOff: boolean
}

export function siteChatSliceForPage(
  settings: SiteChatSettings,
  path: string,
  pathUnknown = false,
): SiteChatSlice | null {
  if (!settings.enabled) return null
  if (!sitePathListShows(settings, path, pathUnknown)) return null
  return {
    greeting: settings.greeting,
    openingMessage: settings.openingMessage,
    chips: settings.chips,
    capabilities: settings.capabilities,
    position: settings.position,
    handOff: settings.handOff,
  }
}

/** A slice off the page props, checked; `null` for anything else. */
export function readSiteChatSlice(value: unknown): SiteChatSlice | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const greeting = clean(raw['greeting'], SITE_CHAT_GREETING_MAX)
  if (!greeting) return null
  return {
    greeting,
    openingMessage:
      typeof raw['openingMessage'] === 'string' ? raw['openingMessage'].slice(0, SITE_CHAT_OPENING_MAX) : '',
    chips: (Array.isArray(raw['chips']) ? raw['chips'] : [])
      .map((chip) => clean(chip, SITE_CHAT_CHIP_MAX))
      .filter(Boolean)
      .slice(0, SITE_CHAT_CHIPS_MAX),
    capabilities: CAPABILITY_SET.filter(
      (capability) =>
        capability === 'answer' || (Array.isArray(raw['capabilities']) && raw['capabilities'].includes(capability)),
    ),
    position: raw['position'] === 'left' ? 'left' : 'right',
    handOff: raw['handOff'] !== false,
  }
}

// ── The site-chat allotment ────────────────────────────────────────────────

/**
 * Credits a month visitor chats may spend, by plan. They are the workspace's
 * own AI credits (one pool, billed as every other AI request is), held under
 * their own hard cap so a busy site can never drain what the team's console
 * assistant runs on. Free has none: site chat is a Starter-and-up feature.
 * An owner may set a lower cap per site; nothing raises it past these.
 */
export const SITE_CHAT_CREDITS_BY_PLAN: Readonly<Record<OrgPlan, number>> = {
  free: 0,
  starter: 1_000,
  pro: 5_000,
  enterprise: 20_000,
}

/** The plan's allotment, `0` for a plan without site chat. */
export function siteChatPlanCredits(plan: OrgPlan | string | null | undefined): number {
  return SITE_CHAT_CREDITS_BY_PLAN[plan as OrgPlan] ?? 0
}

/** Whether the plan includes site chat at all. */
export function siteChatOnPlan(plan: OrgPlan | string | null | undefined): boolean {
  return siteChatPlanCredits(plan) > 0
}

/**
 * The ceiling one site's chats spend against this month: the plan's
 * allotment for the workspace, narrowed by the site owner's own cap.
 */
export function siteChatCeiling(
  planCredits: number,
  ownerCap: number | null | undefined,
): number {
  const plan = Math.max(0, Math.floor(Number(planCredits) || 0))
  if (ownerCap === null || ownerCap === undefined) return plan
  return Math.min(plan, Math.max(0, Math.floor(Number(ownerCap) || 0)))
}

/**
 * Credits held for one turn before it runs. A turn costs a few credits on the
 * fast tier; the hold is the most a turn is allowed to cost, so the cap can
 * be passed by at most one turn's difference while two run at once.
 */
export const SITE_CHAT_TURN_HOLD_CREDITS = 40

// ── The wire format ────────────────────────────────────────────────────────

/** A visitor's turn as the widget posts it. */
export interface SiteChatRequestBody {
  hostId: string
  message: string
  /** The page the visitor is on, for "this page" questions. */
  path?: string
}

/**
 * The events the door streams, one per `data:` line, the shape console
 * Assist streams: text arrives as `delta`s and the turn ends with `done`.
 */
export type SiteChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'cards'; cards: SiteChatCard[] }
  | { type: 'proposal'; proposal: SiteChatProposal }
  | { type: 'handoff'; message: string }
  | { type: 'done'; conversationId: string; sources: SiteChatSource[] }
  | { type: 'error'; error: string; reason?: string }

/** A page the answer used, linked under it. */
export interface SiteChatSource {
  title: string
  url: string
}

/** One stored turn of a conversation. */
export interface SiteChatTurn {
  role: 'visitor' | 'assistant'
  text: string
  at: number
  cards?: SiteChatCard[]
  proposal?: SiteChatProposal
  sources?: SiteChatSource[]
}

/** What the console lists for a conversation. */
export interface SiteChatConversationSummary {
  id: string
  startedAt: number
  updatedAt: number
  turns: number
  firstQuestion: string
  /** A proposal the visitor was shown, by kind. */
  proposals: number
  handedOff: boolean
  member?: { name: string } | null
}

/** What a refusal says to a visitor; never a reason only staff should see. */
export const SITE_CHAT_UNAVAILABLE_COPY =
  'The chat is not available right now. Please call or email us, and we will be glad to help.'
export const SITE_CHAT_BUSY_COPY = 'Lots of questions right now. Please try again in a minute.'
export const SITE_CHAT_CONVERSATION_LIMIT_COPY =
  'We have covered a lot today. For anything else, please call or email us.'

/** One site's month, for the owner's card. */
export interface SiteChatMonth {
  month: string
  credits: number
  questions: number
  proposals: number
  conversations: number
  /** What the workspace's sites spent together. */
  workspaceCredits: number
}

/** What the owner's settings door answers. */
export interface SiteChatSettingsAnswer {
  settings: SiteChatSettings
  canManage: boolean
  /** The plan includes site chat (Starter and up). */
  onPlan: boolean
  /** The release flag is on for the workspace. */
  released: boolean
  /** The plan's allotment, the ceiling this site spends against, and the month. */
  planCredits: number
  ceiling: number
  month: SiteChatMonth | null
}
