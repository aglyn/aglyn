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

import { checkEntitlement } from '@aglyn/aglyn/server'
import {
  checkRateLimit,
  emailUnverifiedResponse,
  featureLockdownRefusal,
  firebaseAdmin,
  getOrgForUser,
  isImpersonationSession,
  isServerReleaseFlagOnForOrg,
  lockdownRefusal,
  rateLimitHeaders,
} from '@aglyn/tenant-data-admin'
import {
  docsGroundingBlock,
  retrieveDocsSections,
  DOCS_SITE_ORIGIN,
} from '../../_lib/assist-retrieval'
import {
  checkAssistQuota,
  recordAssistExchange,
  type AssistTokenUsage,
} from '../../_lib/assist-usage'

/**
 * Aglyn Assist chat proxy (AGL-1860, phase 1 — capability levels 1–2).
 *
 * The gate ladder, in order (every step can go red and each has a spec that
 * forces it): 405 → 501 no ANTHROPIC_API_KEY → 401 no token → 403
 * email-unverified → 400 bad body → 403 not a member → 404 release flag off
 * (a released-off feature does not exist; staff bypass) → 423 lockdown
 * (platform/org/user + the `ai-assist` feature kill switch) → 429 rate
 * limit → 429 quota (free: N messages/UTC-day; entitled: monthly runaway
 * guard) → the model call.
 *
 * Capability tiers: entitled orgs (`aiAssist`, Pro+) get docs-grounded
 * answers PLUS page-context awareness (level 2 — the current route/host is
 * injected so the assistant can walk the user through the view they are
 * on). Free orgs get level 1 only: docs-grounded answers and deep links;
 * any client-sent page context is deliberately dropped.
 *
 * Streaming: the route re-emits Anthropic's SSE stream as simplified
 * `data: {type:'delta',text}` events, then one `{type:'done', exchangeId,
 * usage, quota, docs}` after the exchange + meters are recorded.
 *
 * Thinking is DISABLED explicitly. On Sonnet 5 an omitted `thinking` runs
 * ADAPTIVE — the default flipped from Sonnet 4.6 — and `max_tokens` caps
 * thinking plus answer together, so leaving it off the request would spend
 * output-priced thinking tokens on "how do I publish a screen", stall the
 * stream behind a silent think (display defaults to `omitted`, i.e. empty
 * thinking blocks), and truncate the answer inside the same 1024-token
 * ceiling. `effort: low` is the documented posture for a scoped chat
 * workload; both are asserted in the spec so a silent default change fails.
 *
 * Prompt caching: the static system block carries the breakpoint so the
 * per-turn variation (context + retrieval) sits after it. Note the prefix
 * is currently BELOW Sonnet 5's 1024-token cacheable minimum, so it does
 * not actually cache yet — the breakpoint is correct placement that starts
 * paying the moment the prefix or the model changes, not a live saving.
 * `usage.cacheReadTokens` on the exchange doc is where to confirm that.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/**
 * Sonnet-class default: the margin constraint on this feature is hard, and
 * a docs-grounded how-to is exactly the shape Sonnet serves well. Env
 * override exists for incident response (see ASSIST_TOKEN_RATES_USD — the
 * cost telemetry follows the model id, so an override cannot silently make
 * the per-org cost numbers lie).
 */
export function assistModel(): string {
  return process.env.ASSIST_MODEL || 'claude-sonnet-5'
}

const MAX_QUESTION_CHARS = 4000
const MAX_HISTORY_TURNS = 24
const MAX_HISTORY_CHARS = 8000
const MAX_OUTPUT_TOKENS = 1024
/** Scoped, latency-sensitive chat: the low rung, deliberately. */
const ASSIST_EFFORT = 'low'
/** Stored-answer cap — the data loop needs the gist, not an unbounded doc. */
const MAX_STORED_ANSWER_CHARS = 20000

/**
 * The stable system prefix — MUST stay byte-identical across requests (it
 * carries the prompt-cache breakpoint; per-turn content goes in the second
 * system block). Keep every volatile detail out of this string.
 */
const STATIC_SYSTEM = `You are Aglyn Assist, the in-console helper for Aglyn — a multi-tenant website-building and commerce platform. You are embedded in the customer console and answer questions about using Aglyn: building sites in the Besigner, publishing, domains, commerce, bookings, workflows, datasets, members and roles, billing and plans, and the marketplace.

Rules:
- Ground answers in the provided documentation sections when they are relevant, and cite them by linking their URLs with markdown links. Never invent a docs URL — only link URLs given to you.
- When the user should go somewhere in the console, link the console path as a markdown link with a root-relative path (for example [Billing](/acme/billing)) only when you are certain of the path from the context provided; otherwise describe the navigation in words.
- Be concise and task-focused: answer the question, give the steps, link the source. Skip preamble.
- You cannot perform actions, fill forms, or change anything — you answer and direct. If asked to do something, explain the steps the user can take instead.
- If the question is not about Aglyn, say so briefly and point the user back to Aglyn topics.
- If you do not know, say so and suggest contacting support from the Support page rather than guessing.`

interface AssistHistoryTurn {
  role: 'user' | 'assistant'
  text: string
}

interface AssistRequestBody {
  orgId: string
  question: string
  history: AssistHistoryTurn[]
  context: { route: string; hostId: string; orgSlug: string } | null
}

/** Validate + clamp the request body; null when structurally unusable. */
export function parseAssistBody(payload: unknown): AssistRequestBody | null {
  const body = (payload ?? {}) as Record<string, unknown>
  const orgId = String(body.orgId ?? '').trim()
  const question = String(body.question ?? '')
    .trim()
    .slice(0, MAX_QUESTION_CHARS)
  if (!orgId || !question) return null
  const rawHistory = Array.isArray(body.history) ? body.history : []
  const history: AssistHistoryTurn[] = []
  for (const turn of rawHistory.slice(-MAX_HISTORY_TURNS)) {
    const role = (turn as Record<string, unknown>)?.role
    const text = String((turn as Record<string, unknown>)?.text ?? '')
      .trim()
      .slice(0, MAX_HISTORY_CHARS)
    if ((role === 'user' || role === 'assistant') && text) {
      history.push({ role, text })
    }
  }
  // The conversation MUST open on a user turn or the API 400s the whole
  // request. The client sends a trailing window of its thread, and a window
  // boundary lands mid-exchange as often as not — so a long-running panel
  // thread would start failing at exactly the twelfth message, which is the
  // sort of bug that only shows up for the users who like the feature most.
  while (history.length && history[0].role === 'assistant') history.shift()
  const rawContext = body.context as Record<string, unknown> | null | undefined
  const context = rawContext
    ? {
        route: String(rawContext.route ?? '').slice(0, 500),
        hostId: String(rawContext.hostId ?? '').slice(0, 100),
        orgSlug: String(rawContext.orgSlug ?? '').slice(0, 100),
      }
    : null
  return { orgId, question, history, context }
}

/** Level-2 context block (entitled orgs only). */
function contextBlock(
  context: NonNullable<AssistRequestBody['context']>,
  orgName: string,
  plan: string,
): string {
  const lines = [
    'Current console context:',
    context.route && `- Current console page path: ${context.route}`,
    context.orgSlug && `- Organization URL slug: ${context.orgSlug}`,
    context.hostId && `- Currently selected site (host) id: ${context.hostId}`,
    orgName && `- Organization name: ${orgName}`,
    plan && `- Organization plan: ${plan}`,
    'Use this to walk the user through the page they are on when relevant.',
  ].filter(Boolean)
  return `\n\n${lines.join('\n')}`
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return Response.json(
      { error: 'Aglyn Assist is not configured (ANTHROPIC_API_KEY).' },
      { status: 501 },
    )
  }
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    payload = null
  }
  const body = parseAssistBody(payload)
  if (!body) {
    return Response.json(
      { error: 'Missing orgId or question' },
      { status: 400 },
    )
  }

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const staff = decoded['staff'] === true

    const resolved = await getOrgForUser(decoded.uid, body.orgId)
    if (!resolved || resolved.orgId !== body.orgId) {
      return Response.json(
        { error: 'You are not a member of that organization' },
        { status: 403 },
      )
    }
    const org = resolved.org ?? {}

    // Release flag (AGL-1653 rule: the flag closes the ROUTE, not just the
    // UI). A released-off feature does not exist → 404. Staff previews.
    if (!staff && !(await isServerReleaseFlagOnForOrg('release_assist', body.orgId))) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    // Lockdown: scope verdict (platform/org/user), then the ai-assist
    // feature kill switch (AGL-1510 — provider incident / cost runaway).
    const locked = await lockdownRefusal({
      request,
      staff,
      uid: decoded.uid,
      org: org as Record<string, unknown>,
    })
    if (locked) return locked
    const featureLocked = await featureLockdownRefusal({
      feature: 'ai-assist',
      staff,
    })
    if (featureLocked) return featureLocked

    const rate = checkRateLimit(`assist:${decoded.uid}`, {
      limit: 20,
      windowMs: 60_000,
    })
    if (!rate.allowed) {
      return Response.json(
        { error: 'Too many messages — slow down a moment', reason: 'rate' },
        { status: 429, headers: rateLimitHeaders(rate) },
      )
    }

    // The paid gate. NEVER answered from a loading default: `org` here is a
    // resolved server-side doc, and a plan-less org resolves as free —
    // which is a real answer (limited mode), not a denial.
    const entitled = checkEntitlement(org, 'aiAssist')
    const firestore = app.firestore()
    const quota = await checkAssistQuota(firestore, body.orgId, entitled)
    if (!quota.allowed) {
      return Response.json(
        {
          error: entitled
            ? 'This workspace reached its assistant limit for the month'
            : `Free workspaces get ${quota.limit} assistant messages a day — upgrade to Pro for more`,
          reason: 'quota',
          quota,
        },
        { status: 429 },
      )
    }

    // Level-1 grounding for everyone; level-2 page context is Pro+ only.
    const scored = retrieveDocsSections(body.question)
    const docsPaths = scored.map(({ section }) => section.path + section.anchor)
    const docs = scored.map(({ section }) => ({
      title: section.heading
        ? `${section.title} — ${section.heading}`
        : section.title,
      url: `${DOCS_SITE_ORIGIN}${section.path}${section.anchor}`,
    }))
    let dynamicBlock = docsGroundingBlock(scored)
    if (entitled && body.context) {
      dynamicBlock =
        contextBlock(
          body.context,
          String((org as Record<string, unknown>).name ?? ''),
          String((org as Record<string, unknown>).plan ?? ''),
        ) + dynamicBlock
    }

    const messages = [
      ...body.history.map((turn) => ({
        role: turn.role,
        content: turn.text,
      })),
      { role: 'user', content: body.question },
    ]

    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: assistModel(),
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: true,
        // See the header comment: omitting these is NOT the same as
        // sending them — the model-side defaults are adaptive thinking at
        // `high` effort, which this workload neither needs nor can afford.
        thinking: { type: 'disabled' },
        output_config: { effort: ASSIST_EFFORT },
        system: [
          {
            type: 'text',
            text: STATIC_SYSTEM,
            cache_control: { type: 'ephemeral' },
          },
          ...(dynamicBlock ? [{ type: 'text', text: dynamicBlock }] : []),
        ],
        messages,
      }),
    })

    if (!upstream.ok || !upstream.body) {
      const errorPayload = await upstream.json().catch(() => null)
      console.error('assist upstream error', upstream.status, errorPayload)
      return Response.json(
        {
          error:
            (errorPayload as { error?: { message?: string } } | null)?.error
              ?.message ?? 'Assistant request failed',
        },
        { status: 502 },
      )
    }

    // Re-emit Anthropic's SSE as simplified events, accumulate the answer +
    // usage, and record the exchange before the final `done` event.
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const upstreamBody = upstream.body
    const tier: 'free' | 'entitled' = entitled ? 'entitled' : 'free'
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }
        let answer = ''
        let stopReason: string | null = null
        const usage: AssistTokenUsage = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }
        try {
          const reader = upstreamBody.getReader()
          let buffer = ''
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              let event: Record<string, unknown>
              try {
                event = JSON.parse(line.slice('data: '.length))
              } catch {
                continue
              }
              if (event.type === 'message_start') {
                const messageUsage = (event.message as { usage?: Record<string, number> })?.usage
                usage.inputTokens = messageUsage?.input_tokens ?? 0
                usage.cacheReadTokens = messageUsage?.cache_read_input_tokens ?? 0
                usage.cacheWriteTokens = messageUsage?.cache_creation_input_tokens ?? 0
              } else if (event.type === 'content_block_delta') {
                const delta = event.delta as { type?: string; text?: string }
                if (delta?.type === 'text_delta' && delta.text) {
                  answer += delta.text
                  emit({ type: 'delta', text: delta.text })
                }
              } else if (event.type === 'message_delta') {
                const deltaUsage = (event.usage as Record<string, number>) ?? {}
                usage.outputTokens = deltaUsage.output_tokens ?? usage.outputTokens
                stopReason =
                  ((event.delta as { stop_reason?: string })?.stop_reason ??
                    stopReason) ||
                  null
              } else if (event.type === 'error') {
                const error = event.error as { message?: string } | undefined
                emit({ type: 'error', error: error?.message ?? 'Assistant stream failed' })
              }
            }
          }
          // A refusal is an HTTP 200 with an empty or partial answer, not an
          // error — so without this the user watches the spinner stop and
          // gets nothing back. Truncation is the same shape: the tokens are
          // spent either way, and silence reads as a broken feature.
          if (stopReason === 'refusal') {
            emit({
              type: 'error',
              error: answer
                ? 'The assistant stopped part-way through that answer. Try rephrasing the question.'
                : 'The assistant could not answer that one. Try rephrasing, or ask about a different part of Aglyn.',
            })
          } else if (stopReason === 'max_tokens') {
            emit({
              type: 'error',
              error: 'That answer was cut short — ask for the next part, or narrow the question.',
            })
          }

          // The data loop + meters — recorded even for a partial answer:
          // tokens were spent either way and the miner wants the question.
          let exchangeId: string | null = null
          try {
            exchangeId = await recordAssistExchange(firestore, body.orgId, {
              uid: decoded.uid,
              question: body.question,
              answer: answer.slice(0, MAX_STORED_ANSWER_CHARS),
              route: body.context?.route ?? '',
              hostId: body.context?.hostId || null,
              model: assistModel(),
              tier,
              usage,
              docsPaths,
              stopReason,
            })
          } catch (error) {
            console.error('assist exchange record failed', error)
          }
          emit({
            type: 'done',
            exchangeId,
            usage,
            docs,
            quota: { ...quota, used: quota.used + 1, remaining: Math.max(0, quota.remaining - 1) },
          })
        } catch (error) {
          console.error('assist stream failed', error)
          emit({ type: 'error', error: 'Assistant stream failed' })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        ...rateLimitHeaders(rate),
      },
    })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Assistant request failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
