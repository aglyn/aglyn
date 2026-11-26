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

import { resolveSiteTimeZone } from '@aglyn/aglyn/app-utils/collection-entry-date'
import { resolveMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { resolveEffectivePlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { buildSectionIndex, rankSections } from '@aglyn/aglyn/app-utils/section-retrieval'
import { resolveHostEnabledPlugins } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import {
  listPluginSiteChatTools,
  pluginSiteChatVisitorReader,
  type SiteChatCard,
} from '@aglyn/aglyn/plugin-manager/plugin-site-chat-tools'
import { listPluginSiteSearchSources } from '@aglyn/aglyn/plugin-manager/plugin-site-search'
import {
  consumeRateLimit,
  filterEnabledPluginsByReleaseFlags,
  firebaseAdmin,
  getOrgForHost,
  isServerReleaseFlagOnForOrg,
} from '@aglyn/tenant-data-admin'
import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import { tokenSigningSecret } from '@aglyn/tenant-data-admin/server/media-signing'
import {
  EmailNotVerifiedError,
  verifyConsoleIdToken,
} from '@aglyn/tenant-data-admin/server/firebase-admin'
import { getSiteLockdown } from '@aglyn/tenant-data-admin/server/tenant-write-lockdown'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { retrieveSiteSections } from '@aglyn/tenant-runtime/site-section-index'
import { FieldValue } from 'firebase-admin/firestore'
import { aiSiteContextBlock } from '../model/ai-site-context'
import { isAiOnForSite } from '../model/ai-site-switch'
import {
  SITE_CHAT_RELEASE_FLAG,
  SITE_CHAT_SETTINGS_COLLECTION,
  SITE_CHAT_SETTINGS_DOC,
  SITE_CHATS_COLLECTION,
  readStoredSiteChatSettings,
  siteChatOnPlan,
  siteChatPlanCredits,
  type SiteChatConversationSummary,
  type SiteChatTurn,
} from '../model/site-chat'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import { aiProviderReady, runAiRequest } from '../runtime/ai-runtime'
import { readAiSiteContext } from '../runtime/site-context'
import { assistBandRefuses, assistCreditsFromUsd } from '../usage/assist-credits'
import {
  estimateAssistCostUsd,
  recordAssistCost,
  releaseAssistMessage,
  reserveAssistMessage,
} from '../usage/assist-usage'
import { holdSiteChatTurn, readSiteChatMonth, settleSiteChatTurn } from '../usage/site-chat-meter'
import { createSiteChatHandler, type SiteChatDeps, type SiteChatSite } from './site-chat'
import { readSiteChatSettingsDoc, siteChatReleasedFor } from './site-chat-page-reads'
import {
  createSiteChatConversationsHandler,
  createSiteChatSettingsHandler,
  type SiteChatOwnerDeps,
} from './site-chat-owner-routes'
import {
  createSiteChatHandOffHandler,
  createSiteChatHistoryHandler,
  type SiteChatVisitorDeps,
} from './site-chat-visitor-routes'
import { readRequestCookie } from './site-chat-session'

/**
 * The site chat door wired to the platform (AGL-4250). Everything the door
 * decides is in `site-chat.ts` and its spec; this file only says where each
 * answer comes from.
 */

const firestore = () => firebaseAdmin.app().firestore()
const CHAT_ROUTE = AI_ROUTING_TABLE['assist.chat']

/** A conversation keeps this many turns; older ones fall off the front. */
const STORED_TURNS = 60
/** Conversations expire on their own (a TTL policy on `expiresAt`). */
const CONVERSATION_RETENTION_DAYS = 90
/** Listings the search sources are asked for, and the cards a turn may cite. */
const CANDIDATE_SCAN = 200
const CANDIDATE_LIMIT = 6
/** A listing's score must clear this to be offered to the model. */
const CANDIDATE_MIN_SCORE = 1.5

const SEARCH_KIND: Record<string, SiteChatCard['kind']> = {
  products: 'product',
  events: 'event',
  stays: 'stay',
  services: 'service',
}

const conversationRef = (hostId: string, conversationId: string) =>
  firestore().collection('hosts').doc(hostId).collection(SITE_CHATS_COLLECTION).doc(conversationId)

function cookiesOf(request: Request): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index < 1) continue
    const name = part.slice(0, index).trim()
    out[name] = readRequestCookie(request, name)
  }
  return out
}

export const siteChatPlatformDeps: SiteChatDeps = {
  readSite: async (hostId) => {
    const snapshot = await firestore().collection('hosts').doc(hostId).get()
    if (!snapshot.exists) return null
    const host = { ...(snapshot.data() as Record<string, any>), $id: hostId }
    const owner = await getOrgForHost(hostId)
    if (!owner) return null
    const org = owner.org as Record<string, any>
    const enabledPlugins = await filterEnabledPluginsByReleaseFlags(
      resolveHostEnabledPlugins(org as never, host as never),
      { orgId: owner.orgId },
    )
    return {
      host,
      orgId: owner.orgId,
      org,
      plan: resolveEffectivePlan(org as never),
      timeZone: resolveSiteTimeZone(org as never, host as never),
      enabledPlugins,
    }
  },
  flagOn: (orgId) => siteChatReleasedFor(orgId),
  aiOnForSite: (site) => isAiOnForSite(site.org, site.host),
  readSettings: (hostId) => readSiteChatSettingsDoc(hostId),
  providerReady: () => aiProviderReady(),
  secret: () => tokenSigningSecret(),
  rateLimit: async (key, limit, windowMs) => (await consumeRateLimit(key, { limit, windowMs })).allowed,
  holdTurn: (site, settings) =>
    holdSiteChatTurn(firestore(), {
      orgId: site.orgId,
      hostId: site.host.$id,
      planCredits: siteChatPlanCredits(site.plan),
      ownerCap: settings.monthlyCreditCap,
    }),
  settleTurn: (site, hold, outcome) =>
    settleSiteChatTurn(firestore(), { orgId: site.orgId, hostId: site.host.$id, hold, ...outcome }),
  reserveBand: async (site) => {
    // A workspace whose band is a wall (its own hard cap, or a plan that
    // sells nothing past it) is held to it exactly as console Assist is.
    // Every other workspace's band is sold past at its plan's rate, and the
    // site-chat allotment above is the cap that binds.
    if (!assistBandRefuses(site.org as never)) return { allowed: true, release: async () => undefined }
    const quota = await reserveAssistMessage(
      firestore(),
      site.orgId,
      checkEntitlement(site.org as never, 'aiAssist'),
      new Date(),
      site.org as never,
      { uid: null, hostId: site.host.$id },
    )
    return { allowed: quota.allowed, release: () => releaseAssistMessage(firestore(), site.orgId, quota) }
  },
  recordCost: async (site, usage, model, stopReason) => {
    await recordAssistCost(firestore(), site.orgId, {
      route: 'site-chat',
      hostId: site.host.$id,
      model,
      tier: 'entitled',
      usage,
      docsPaths: [],
      stopReason,
      deflected: false,
      uid: null,
    })
    return assistCreditsFromUsd(estimateAssistCostUsd(usage, model))
  },
  businessBlock: async (site) => {
    const context = await readAiSiteContext(firestore(), {
      orgId: site.orgId,
      hostId: site.host.$id,
      host: site.host,
    })
    // The business and how to reach it, and nothing else of what the console
    // assistant is told: no drafts, no form ids, no owner preferences.
    return context?.profile ? aiSiteContextBlock({ profile: context.profile }) : ''
  },
  sections: async (site, question) =>
    (await retrieveSiteSections(site.host as never, question, 5)).map(({ section }) => ({
      url: section.url,
      title: section.title,
      heading: section.heading,
      text: section.text,
    })),
  candidates: async (site, question) => {
    const sources = await listPluginSiteSearchSources(site.enabledPlugins)
    if (!sources.length) return []
    const answers = await Promise.all(
      sources.map(({ source }) =>
        source
          .items({ hostId: site.host.$id, query: question.toLowerCase().slice(0, 100), limit: CANDIDATE_SCAN })
          .then((items) => items.map((item) => ({ item, kind: SEARCH_KIND[source.key] ?? 'product' })))
          .catch(() => []),
      ),
    )
    const listings = answers.flat()
    const index = buildSectionIndex(
      listings.map(({ item, kind }) => ({
        title: item.title,
        heading: '',
        text: [item.snippet, ...(item.terms ?? [])].join(' '),
        item,
        kind,
      })),
    )
    return rankSections(index, question, { limit: CANDIDATE_LIMIT, idf: true })
      .filter(({ score }) => score >= CANDIDATE_MIN_SCORE)
      .map(({ section }) => {
        const imageUrl = resolveMediaSrc(section.item.imageUrl, { hostId: site.host.$id })
        return {
          kind: section.kind,
          title: section.item.title,
          url: section.item.url,
          ...(imageUrl ? { imageUrl } : {}),
          ...(section.item.caption ? { caption: section.item.caption } : {}),
        } satisfies SiteChatCard
      })
  },
  tools: (site, allowed) => listPluginSiteChatTools(site.enabledPlugins, allowed),
  member: async (request, site) => {
    const reader = pluginSiteChatVisitorReader(site.enabledPlugins)
    if (!reader) return null
    return reader.readVisitor({ hostId: site.host.$id, cookies: cookiesOf(request) })
  },
  readTurns: async (hostId, conversationId) => {
    const snapshot = await conversationRef(hostId, conversationId).get()
    const turns = snapshot.exists ? snapshot.get('turns') : null
    return Array.isArray(turns) ? (turns as SiteChatTurn[]) : []
  },
  appendTurns: async (site, conversationId, turns, meta) => {
    const ref = conversationRef(site.host.$id, conversationId)
    await firestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const kept = snapshot.exists && Array.isArray(snapshot.get('turns')) ? (snapshot.get('turns') as SiteChatTurn[]) : []
      const now = Date.now()
      transaction.set(
        ref,
        {
          hostId: site.host.$id,
          turns: [...kept, ...turns].slice(-STORED_TURNS),
          turnCount: FieldValue.increment(turns.filter((turn) => turn.role === 'visitor').length),
          firstQuestion: String(snapshot.get?.('firstQuestion') ?? meta.firstQuestion).slice(0, 300),
          proposals: FieldValue.increment(meta.proposals),
          ...(meta.handedOff ? { handedOff: true } : {}),
          ...(meta.member ? { member: { name: meta.member.name.slice(0, 80) } } : {}),
          ...(snapshot.exists ? {} : { startedAt: now }),
          updatedAt: now,
          expiresAt: new Date(now + CONVERSATION_RETENTION_DAYS * 24 * 60 * 60 * 1000),
        },
        { merge: true },
      )
    })
  },
  // The console chat's own step: the same scoped, latency-sensitive chat
  // workload, so the same tier, no thinking and the low effort rung.
  model: () => aiModelForStep('assist.chat'),
  stream: (request) =>
    runAiRequest({
      ...request,
      stream: true,
      ...(CHAT_ROUTE.thinking ? { thinking: CHAT_ROUTE.thinking } : {}),
      ...(CHAT_ROUTE.effort ? { effort: CHAT_ROUTE.effort } : {}),
    }),
  // The trusted-hop address, never a header the caller wrote.
  clientAddress: (request) => readClientIp(request.headers) ?? '',
  now: () => new Date(),
}

let handler: ReturnType<typeof createSiteChatHandler> | null = null

/** The door, built once per process. */
export function siteChatDoor(): (request: Request) => Promise<Response> {
  return (handler ??= createSiteChatHandler(siteChatPlatformDeps))
}

export type { SiteChatSite }

/** The door's own rungs, for the visitor's side doors: on, or `null`. */
async function siteChatSiteOn(hostId: string): Promise<{ enabledPlugins: readonly string[] } | null> {
  const deps = siteChatPlatformDeps
  const site = await deps.readSite(hostId)
  if (!site || !siteChatOnPlan(site.plan) || !deps.aiOnForSite(site)) return null
  if (!(await deps.flagOn(site.orgId))) return null
  if (!readStoredSiteChatSettings(await deps.readSettings(hostId)).enabled) return null
  return { enabledPlugins: site.enabledPlugins }
}

const visitorDeps: SiteChatVisitorDeps = {
  secret: () => tokenSigningSecret(),
  siteOn: siteChatSiteOn,
  readTurns: (hostId, id) => siteChatPlatformDeps.readTurns(hostId, id),
  member: async (request, hostId, enabledPlugins) => {
    const reader = pluginSiteChatVisitorReader(enabledPlugins)
    return reader ? reader.readVisitor({ hostId, cookies: cookiesOf(request) }) : null
  },
  saveHandOff: async (hostId, id, handOff) => {
    await conversationRef(hostId, id).set(
      { handedOff: true, handOff: { ...handOff, at: Date.now() }, updatedAt: Date.now() },
      { merge: true },
    )
  },
  rateLimit: (key, limit, windowMs) => siteChatPlatformDeps.rateLimit(key, limit, windowMs),
}

let historyHandler: ((request: Request) => Promise<Response>) | null = null
let handOffHandler: ((request: Request) => Promise<Response>) | null = null

export function siteChatHistoryDoor(): (request: Request) => Promise<Response> {
  return (historyHandler ??= createSiteChatHistoryHandler(visitorDeps))
}

export function siteChatHandOffDoor(): (request: Request) => Promise<Response> {
  return (handOffHandler ??= createSiteChatHandOffHandler(visitorDeps))
}

const summaryOf = (id: string, data: Record<string, any>): SiteChatConversationSummary => ({
  id,
  startedAt: Number(data['startedAt'] ?? 0),
  updatedAt: Number(data['updatedAt'] ?? 0),
  turns: Number(data['turnCount'] ?? 0),
  firstQuestion: String(data['firstQuestion'] ?? ''),
  proposals: Number(data['proposals'] ?? 0),
  handedOff: data['handedOff'] === true,
  member: data['member']?.name ? { name: String(data['member'].name) } : null,
})

const ownerDeps: SiteChatOwnerDeps = {
  verifyIdToken: async (token) => {
    const decoded = await verifyConsoleIdToken(token)
    return { uid: decoded.uid, staff: decoded['staff'] === true }
  },
  isEmailUnverified: (error) => error instanceof EmailNotVerifiedError,
  readSiteAccess: async (hostId) => {
    const host = await firestore().collection('hosts').doc(hostId).get()
    if (!host.exists) return null
    const owner = await getOrgForHost(hostId).catch(() => null)
    return {
      memberRoles: (host.get('memberRoles') ?? {}) as Record<string, unknown>,
      memberPermissions: host.get('memberPermissions'),
      orgId: owner?.orgId ?? null,
    }
  },
  readPlan: async (orgId) => {
    const owner = await firestore().collection('orgs').doc(orgId).get()
    return resolveEffectivePlan((owner.data() ?? null) as never)
  },
  flagOn: (orgId) => isServerReleaseFlagOnForOrg(SITE_CHAT_RELEASE_FLAG as never, orgId),
  siteLocked: async (hostId) => Boolean(await getSiteLockdown(hostId)),
  readSettings: (hostId) => siteChatPlatformDeps.readSettings(hostId),
  writeSettings: async (hostId, settings, uid) => {
    await firestore()
      .collection('hosts')
      .doc(hostId)
      .collection(SITE_CHAT_SETTINGS_COLLECTION)
      .doc(SITE_CHAT_SETTINGS_DOC)
      .set({ ...settings, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid })
  },
  dropSiteCache: async (hostId) =>
    (await dropPluginSiteCache({ hostIds: [hostId], reason: 'site chat settings changed' })).complete,
  readMonth: (orgId, hostId) => readSiteChatMonth(firestore(), orgId, hostId),
  listConversations: async (hostId, limit) => {
    const snapshot = await firestore()
      .collection('hosts')
      .doc(hostId)
      .collection(SITE_CHATS_COLLECTION)
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .get()
    return snapshot.docs.map((doc) => summaryOf(doc.id, doc.data() as Record<string, any>))
  },
  readConversation: async (hostId, id) => {
    const snapshot = await conversationRef(hostId, id).get()
    if (!snapshot.exists) return null
    const data = snapshot.data() as Record<string, any>
    return {
      summary: summaryOf(id, data),
      turns: Array.isArray(data['turns']) ? (data['turns'] as SiteChatTurn[]) : [],
      handOff: data['handOff'] ?? null,
    }
  },
}

let settingsHandler: ReturnType<typeof createSiteChatSettingsHandler> | null = null
let conversationsHandler: ReturnType<typeof createSiteChatConversationsHandler> | null = null

export function siteChatSettingsDoor() {
  return (settingsHandler ??= createSiteChatSettingsHandler(ownerDeps))
}

export function siteChatConversationsDoor() {
  return (conversationsHandler ??= createSiteChatConversationsHandler(ownerDeps))
}
