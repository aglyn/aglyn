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
  siteChatProposalRequestAllowed,
  type RegisteredSiteChatTool,
  type SiteChatCapability,
  type SiteChatCard,
  type SiteChatProposal,
} from '@aglyn/aglyn/plugin-manager/plugin-site-chat-tools'
import type { AiMessage, AiStreamEvent, AiSystemBlock, AiTool, AiUsage } from '../providers/contract'
import {
  readStoredSiteChatSettings,
  SITE_CHAT_BUSY_COPY,
  SITE_CHAT_CONVERSATION_LIMIT_COPY,
  SITE_CHAT_HISTORY_TURNS,
  SITE_CHAT_MESSAGE_MAX,
  SITE_CHAT_TURNS_PER_CONVERSATION,
  SITE_CHAT_UNAVAILABLE_COPY,
  siteChatCookieName,
  siteChatOnPlan,
  siteChatPlanCredits,
  siteChatSliceForPage,
  type SiteChatEvent,
  type SiteChatSettings,
  type SiteChatTurn,
} from '../model/site-chat'
import {
  mintSiteChatSession,
  readRequestCookie,
  siteChatSessionCookie,
  verifySiteChatSession,
  type SiteChatSession,
} from './site-chat-session'
import {
  SITE_CHAT_HANDOFF_TOOL,
  siteChatCardsBlock,
  siteChatFactsBlock,
  siteChatHandOffTool,
  siteChatProviderTool,
  siteChatSafeText,
  siteChatSectionsBlock,
  siteChatSources,
  siteChatSystemBlocks,
  siteChatToolResultsBlock,
  type SiteChatGroundingSection,
} from './site-chat-prompt'
import type { SiteChatHold } from '../usage/site-chat-meter'

/**
 * The site chat door (AGL-4250): `POST /api/ai/site-chat` on a published
 * site, streamed as Server-Sent Events in the shape console Assist streams.
 *
 * The gate ladder, in order, each rung refusing before anything after it
 * runs or spends:
 *
 * 405 → 400 bad body → 404 unknown site, or a site whose workspace has no
 * site chat (the release flag off, a plan below Starter, AI switched off for
 * the site, the owner's switch off) — a feature that is not on does not exist
 * → 503 no provider → 429 per visitor address, per visitor session, per
 * conversation and per site and day → 503 credits (the site-chat allotment's
 * hard cap, then the workspace's own AI band), FAIL CLOSED: a meter that
 * cannot answer refuses → the model.
 *
 * The site and its workspace are read from the host document alone; the
 * request names a site, never an org. The dispatcher in front of this door
 * has already refused a cross-origin write and a locked-down site.
 *
 * A turn is at most two model calls. The first is offered the tools; when it
 * asks a lookup (are these dates free), the lookup runs on this site and the
 * second call answers from what it found, offered the proposal tools only. A
 * proposal is validated by its plugin and sent to the widget as a confirm
 * card; the door itself never sends the request a card names.
 */

export interface SiteChatSite {
  host: Record<string, any> & { $id: string }
  orgId: string
  org: Record<string, any>
  plan: string
  timeZone: string
  /** Plugins on for the site, as its pages decide them. */
  enabledPlugins: readonly string[]
}

export interface SiteChatDeps {
  readSite: (hostId: string) => Promise<SiteChatSite | null>
  flagOn: (orgId: string) => Promise<boolean>
  aiOnForSite: (site: SiteChatSite) => boolean
  readSettings: (hostId: string) => Promise<unknown>
  providerReady: () => boolean
  secret: () => string
  rateLimit: (key: string, limit: number, windowMs: number) => Promise<boolean>
  holdTurn: (site: SiteChatSite, settings: SiteChatSettings) => Promise<SiteChatHold>
  settleTurn: (
    site: SiteChatSite,
    hold: SiteChatHold,
    outcome: { spent: number; answered: boolean; proposals: number; newConversation: boolean },
  ) => Promise<void>
  /** The workspace's own band, with a release for a turn that spent nothing. */
  reserveBand: (site: SiteChatSite) => Promise<{ allowed: boolean; release: () => Promise<void> }>
  recordCost: (site: SiteChatSite, usage: AiUsage, model: string, stopReason: string | null) => Promise<number>
  businessBlock: (site: SiteChatSite) => Promise<string>
  sections: (site: SiteChatSite, question: string) => Promise<SiteChatGroundingSection[]>
  /** Products, stays and the like the site's search sources offer for a question. */
  candidates: (site: SiteChatSite, question: string) => Promise<SiteChatCard[]>
  tools: (site: SiteChatSite, allowed: readonly SiteChatCapability[]) => Promise<RegisteredSiteChatTool[]>
  member: (request: Request, site: SiteChatSite) => Promise<{ name: string } | null>
  readTurns: (hostId: string, conversationId: string) => Promise<SiteChatTurn[]>
  appendTurns: (
    site: SiteChatSite,
    conversationId: string,
    turns: SiteChatTurn[],
    meta: { firstQuestion: string; proposals: number; handedOff: boolean; member: { name: string } | null },
  ) => Promise<void>
  model: () => string
  stream: (request: {
    model: string
    system: AiSystemBlock[]
    messages: AiMessage[]
    tools?: AiTool[]
    maxTokens: number
  }) => Promise<AsyncIterable<AiStreamEvent>>
  clientAddress: (request: Request) => string
  now: () => Date
}

const HOST_ID = /^[A-Za-z0-9_-]{1,128}$/
const SITE_CHAT_MAX_OUTPUT_TOKENS = 700
const LOOKUP_RESULTS_MAX = 3

/** Visitor and site limits, per window. */
export const SITE_CHAT_LIMITS = {
  perAddressPerMinute: 12,
  perSessionPerMinute: 8,
  perSiteEachDay: 2_000,
} as const

const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers })

const notHere = () => json(404, { error: 'Not found' })

async function readBody(request: Request): Promise<{ hostId: string; message: string; path: string | null } | null> {
  let raw: Record<string, unknown>
  try {
    raw = (await request.json()) as Record<string, unknown>
  } catch {
    return null
  }
  const hostId = typeof raw?.['hostId'] === 'string' ? raw['hostId'] : ''
  const message = typeof raw?.['message'] === 'string' ? raw['message'].trim() : ''
  if (!HOST_ID.test(hostId) || !message || message.length > SITE_CHAT_MESSAGE_MAX) return null
  const path =
    typeof raw['path'] === 'string' && /^\/[^\s]{0,300}$/.test(raw['path']) && !raw['path'].startsWith('//')
      ? raw['path']
      : null
  return { hostId, message, path }
}

function todayIn(timeZone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone,
    }).format(now)
  } catch {
    return now.toDateString()
  }
}

function historyMessages(turns: readonly SiteChatTurn[], message: string): AiMessage[] {
  const recent = turns.slice(-SITE_CHAT_HISTORY_TURNS * 2)
  const messages: AiMessage[] = []
  for (const turn of recent) {
    const role = turn.role === 'visitor' ? 'user' : 'assistant'
    const text = turn.text.slice(0, 2_000)
    if (!text) continue
    // Two turns of one role in a row are folded, which every provider accepts.
    const last = messages[messages.length - 1]
    if (last && last.role === role) last.content = `${last.content as string}\n\n${text}`
    else messages.push({ role, content: text })
  }
  if (messages[0]?.role === 'assistant') messages.shift()
  const last = messages[messages.length - 1]
  if (last?.role === 'user') last.content = `${last.content as string}\n\n${message}`
  else messages.push({ role: 'user', content: message })
  return messages
}

const zeroUsage = (): AiUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })

function addUsage(total: AiUsage, usage: AiUsage): AiUsage {
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    cacheReadTokens: total.cacheReadTokens + usage.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + usage.cacheWriteTokens,
  }
}

export function createSiteChatHandler(deps: SiteChatDeps) {
  return async function siteChat(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' })
    const body = await readBody(request)
    if (!body) return json(400, { error: 'Ask a question of up to 1,000 characters.' })

    const site = await deps.readSite(body.hostId)
    if (!site) return notHere()
    if (!(await deps.flagOn(site.orgId))) return notHere()
    if (!siteChatOnPlan(site.plan) || !deps.aiOnForSite(site)) return notHere()
    const settings = readStoredSiteChatSettings(await deps.readSettings(body.hostId))
    if (!siteChatSliceForPage(settings, body.path ?? '/', !body.path)) return notHere()
    if (!deps.providerReady()) return json(503, { error: SITE_CHAT_UNAVAILABLE_COPY, reason: 'unconfigured' })

    // The visitor: their signed session on this site, or a new one.
    let secret: string
    try {
      secret = deps.secret()
    } catch {
      return json(503, { error: SITE_CHAT_UNAVAILABLE_COPY, reason: 'unconfigured' })
    }
    const now = deps.now()
    const cookieName = siteChatCookieName(body.hostId)
    let session: SiteChatSession | null = verifySiteChatSession(
      readRequestCookie(request, cookieName),
      body.hostId,
      secret,
      now.getTime(),
    )
    let setCookie: string | null = null
    if (!session) {
      const minted = mintSiteChatSession(body.hostId, secret, now.getTime())
      session = minted.session
      setCookie = siteChatSessionCookie(body.hostId, minted.token, new URL(request.url).protocol === 'https:')
    }
    const cookieHeaders: Record<string, string> = setCookie ? { 'Set-Cookie': setCookie } : {}

    // Limits: the visitor's address, their session, the conversation's day,
    // and the site's day. Each counter is durable; a store fault refuses.
    const address = deps.clientAddress(request) || 'unknown'
    const minute = 60_000
    const day = 24 * 60 * minute
    const limits = await Promise.all([
      deps.rateLimit(`site-chat:ip:${body.hostId}:${address}`, SITE_CHAT_LIMITS.perAddressPerMinute, minute),
      deps.rateLimit(`site-chat:session:${body.hostId}:${session.sid}`, SITE_CHAT_LIMITS.perSessionPerMinute, minute),
      deps.rateLimit(`site-chat:site:${body.hostId}`, SITE_CHAT_LIMITS.perSiteEachDay, day),
    ])
    if (limits.some((allowed) => !allowed)) {
      return json(429, { error: SITE_CHAT_BUSY_COPY, reason: 'rate' }, { ...cookieHeaders, 'Retry-After': '60' })
    }
    const conversationOk = await deps.rateLimit(
      `site-chat:conversation:${body.hostId}:${session.sid}`,
      SITE_CHAT_TURNS_PER_CONVERSATION,
      day,
    )
    if (!conversationOk) {
      return json(429, { error: SITE_CHAT_CONVERSATION_LIMIT_COPY, reason: 'conversation' }, cookieHeaders)
    }

    // Credits, failing closed: the allotment's hold, then the workspace band.
    let hold: SiteChatHold
    try {
      hold = await deps.holdTurn(site, settings)
    } catch (error) {
      console.error('[site-chat] the allotment could not be read', body.hostId, error)
      return json(503, { error: SITE_CHAT_UNAVAILABLE_COPY, reason: 'credits' }, cookieHeaders)
    }
    if (!hold.allowed) return json(503, { error: SITE_CHAT_UNAVAILABLE_COPY, reason: 'credits' }, cookieHeaders)
    let band: { allowed: boolean; release: () => Promise<void> }
    try {
      band = await deps.reserveBand(site)
    } catch (error) {
      console.error('[site-chat] the workspace band could not be read', body.hostId, error)
      await deps.settleTurn(site, hold, { spent: 0, answered: false, proposals: 0, newConversation: false })
      return json(503, { error: SITE_CHAT_UNAVAILABLE_COPY, reason: 'credits' }, cookieHeaders)
    }
    if (!band.allowed) {
      await deps.settleTurn(site, hold, { spent: 0, answered: false, proposals: 0, newConversation: false })
      return json(503, { error: SITE_CHAT_UNAVAILABLE_COPY, reason: 'credits' }, cookieHeaders)
    }

    const conversationId = session.sid
    const [business, sections, candidates, tools, member, turns] = await Promise.all([
      deps.businessBlock(site).catch(() => ''),
      deps.sections(site, body.message).catch(() => [] as SiteChatGroundingSection[]),
      deps.candidates(site, body.message).catch(() => [] as SiteChatCard[]),
      deps.tools(site, settings.capabilities).catch(() => [] as RegisteredSiteChatTool[]),
      deps.member(request, site).catch(() => null),
      deps.readTurns(body.hostId, conversationId).catch(() => [] as SiteChatTurn[]),
    ])
    const facts = siteChatFactsBlock({
      today: todayIn(site.timeZone, now),
      timeZone: site.timeZone,
      path: body.path,
      member,
    })
    const grounding = [siteChatSectionsBlock(sections), siteChatCardsBlock('Products and listings that may match', candidates)]
    const lookups = tools.filter(({ tool }) => tool.kind === 'lookup')
    const proposals = tools.filter(({ tool }) => tool.kind === 'proposal')
    const handOffTools = settings.handOff ? [siteChatHandOffTool] : []
    const messages = historyMessages(turns, body.message)
    const model = deps.model()

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: SiteChatEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        let usage = zeroUsage()
        let stopReason: string | null = null
        let answer = ''
        const shownCards: SiteChatCard[] = []
        let proposal: SiteChatProposal | null = null
        let handedOff = false
        let calls = 0
        const runRound = async (system: AiSystemBlock[], offered: AiTool[]) => {
          calls += 1
          const asked: { name: string; input: Record<string, unknown> }[] = []
          const events = await deps.stream({
            model,
            system,
            messages,
            ...(offered.length ? { tools: offered } : {}),
            maxTokens: SITE_CHAT_MAX_OUTPUT_TOKENS,
          })
          for await (const event of events) {
            if (event.type === 'delta') {
              answer += event.text
              send({ type: 'delta', text: event.text })
            } else if (event.type === 'tool') {
              asked.push({ name: event.name, input: event.input })
            } else if (event.type === 'done') {
              usage = addUsage(usage, event.usage)
              stopReason = event.stopReason
            } else if (event.type === 'error') {
              throw new Error('the provider stream failed')
            }
          }
          return asked
        }
        const runProposal = async (name: string, input: Record<string, unknown>) => {
          if (proposal) return
          const entry = proposals.find(({ tool }) => tool.name === name)
          if (!entry) return
          try {
            const result = await entry.tool.run({ hostId: site.host.$id, input, timeZone: site.timeZone })
            if (result.proposal && siteChatProposalRequestAllowed(entry.tool, result.proposal.request)) {
              proposal = result.proposal
              send({ type: 'proposal', proposal: result.proposal })
            } else if (result.text) {
              send({ type: 'delta', text: `${answer ? '\n\n' : ''}${result.text}` })
              answer += `${answer ? '\n\n' : ''}${result.text}`
            }
          } catch (error) {
            console.error('[site-chat] a proposal tool failed', name, error)
          }
        }
        let answered = false
        try {
          const first = siteChatSystemBlocks({ business, facts, grounding })
          const asked = await runRound(first, [
            ...lookups.map(({ tool }) => siteChatProviderTool(tool)),
            ...proposals.map(({ tool }) => siteChatProviderTool(tool)),
            ...handOffTools,
          ])
          const results: { name: string; text: string }[] = []
          for (const call of asked) {
            if (call.name === SITE_CHAT_HANDOFF_TOOL) {
              handedOff = true
              continue
            }
            const lookup = lookups.find(({ tool }) => tool.name === call.name)
            if (lookup && results.length < LOOKUP_RESULTS_MAX) {
              try {
                const found = await lookup.tool.run({ hostId: site.host.$id, input: call.input, timeZone: site.timeZone })
                results.push({ name: call.name, text: found.text })
                for (const card of found.cards ?? []) shownCards.push(card)
              } catch (error) {
                console.error('[site-chat] a lookup tool failed', call.name, error)
                results.push({ name: call.name, text: 'This lookup is not available right now.' })
              }
              continue
            }
            await runProposal(call.name, call.input)
          }
          if (results.length) {
            const second = siteChatSystemBlocks({
              business,
              facts,
              grounding: [...grounding, siteChatCardsBlock('What the lookups showed', shownCards), siteChatToolResultsBlock(results)],
            })
            if (answer) {
              answer += '\n\n'
              send({ type: 'delta', text: '\n\n' })
            }
            const again = await runRound(second, proposals.map(({ tool }) => siteChatProviderTool(tool)))
            for (const call of again) await runProposal(call.name, call.input)
          }
          shownCards.push(...mentionedCards(candidates, answer))
          if (shownCards.length) send({ type: 'cards', cards: dedupeCards(shownCards).slice(0, 6) })
          if (handedOff) send({ type: 'handoff', message: 'Want someone from the team to follow up? Leave your email and question.' })
          answered = true
          send({ type: 'done', conversationId, sources: siteChatSources(sections) })
        } catch (error) {
          console.error('[site-chat] the turn failed', site.host.$id, error)
          send({ type: 'error', error: SITE_CHAT_UNAVAILABLE_COPY, reason: 'upstream' })
        } finally {
          controller.close()
          let spent = 0
          if (calls > 0 && (usage.inputTokens || usage.outputTokens)) {
            spent = await deps.recordCost(site, usage, model, stopReason).catch(() => 0)
          } else {
            await band.release().catch(() => undefined)
          }
          await deps.settleTurn(site, hold, {
            spent,
            answered,
            proposals: proposal ? 1 : 0,
            newConversation: turns.length === 0,
          })
          if (answered) {
            const at = now.getTime()
            await deps
              .appendTurns(
                site,
                conversationId,
                [
                  { role: 'visitor', text: body.message, at },
                  {
                    role: 'assistant',
                    text: siteChatSafeText(answer).slice(0, 4_000),
                    at: at + 1,
                    ...(shownCards.length ? { cards: dedupeCards(shownCards).slice(0, 6) } : {}),
                    ...(proposal ? { proposal } : {}),
                    ...(sections.length ? { sources: siteChatSources(sections) } : {}),
                  },
                ],
                {
                  firstQuestion: turns.find((turn) => turn.role === 'visitor')?.text ?? body.message,
                  proposals: proposal ? 1 : 0,
                  handedOff,
                  member,
                },
              )
              .catch((error) => console.error('[site-chat] the conversation was not stored', error))
          }
        }
      },
    })
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
        ...cookieHeaders,
      },
    })
  }
}

/**
 * The listings an answer named: by a link to its page, or by its title. A
 * card shows only for what the answer is about, never for every listing the
 * search offered the model.
 */
export function mentionedCards(cards: readonly SiteChatCard[], answer: string): SiteChatCard[] {
  const text = answer.toLowerCase()
  return cards.filter(
    (card) =>
      (card.url ? text.includes(`](${card.url.toLowerCase()})`) : false) ||
      (card.title.length >= 3 && text.includes(card.title.toLowerCase())),
  )
}

function dedupeCards(cards: readonly SiteChatCard[]): SiteChatCard[] {
  const seen = new Set<string>()
  return cards.filter((card) => {
    if (card.url && (!card.url.startsWith('/') || card.url.startsWith('//'))) return false
    const key = card.url ?? `title:${card.title}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
