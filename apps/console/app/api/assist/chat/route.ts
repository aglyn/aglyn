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
  recordAssistExchange,
  releaseAssistMessage,
  reserveAssistMessage,
  type AssistTokenUsage,
} from '@aglyn/tenant-data-admin'
import {
  docsGroundingBlock,
  retrieveDocsSections,
  DOCS_SITE_ORIGIN,
} from '../../_lib/assist-retrieval'
import {
  describeView,
  extractAssistAction,
  finalAssistText,
  resolveAssistProposal,
  safeOrgFacts,
  sanitiseId,
  sanitiseRoute,
  viewFactsBlock,
  viewScreenBlock,
  visibleAssistText,
} from '../../_lib/assist-view-context'

/**
 * Aglyn Assist chat proxy (AGL-1860, phase 1 — capability levels 1–2).
 *
 * The gate ladder, in order (every step can go red and each has a spec that
 * forces it): 405 → 501 no ANTHROPIC_API_KEY → 401 no token → 403
 * email-unverified → 400 bad body → 403 not a member → 404 release flag off
 * (a released-off feature does not exist; staff bypass) → 403 unscoped/wrong
 * org (AGL-1934 — the request must NAME the org it meters) → 423 lockdown
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
 * Prompt caching: the system array is ordered stable → volatile across FOUR
 * blocks, with breakpoints after the first two.
 *
 *   1. static prompt        [breakpoint]  identical everywhere
 *   2. screen description   [breakpoint]  identical per ROUTE, any tenant
 *   3. request facts                      workspace, plan, host, path
 *   4. docs retrieval                     follows the question
 *
 * Caching is a prefix match, so breakpoint 2 covers blocks 1+2 together. The
 * split between 2 and 3 is the whole design and it is easy to get wrong:
 * folding the workspace name and plan into block 2 reads more natural and
 * makes the prefix unique per tenant, so on a shared console every org warms
 * its own copy and the entry is usually cold when it matters. Derived purely
 * from the route, block 2 serves every workspace on that screen.
 *
 * Two breakpoints rather than one because a request with no screen block
 * (free tier, unrecognised route) would otherwise get no cache at all.
 *
 * Measured: block 1 is ~933 tokens and blocks 1+2 come to ~1,030–1,190
 * depending on the screen, against Sonnet 5's 1,024-token minimum. So it
 * caches, with little headroom — and on a shorter screen description it may
 * not. `usage.cacheReadTokens` on the exchange doc is the only thing that
 * settles it in production; a prefix under the minimum caches silently not
 * at all. Note the minimum moves with the model (512 on Opus 5, 4,096 on
 * Opus 4.6), so ASSIST_MODEL changes the arithmetic.
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
 * carries the first prompt-cache breakpoint; per-turn content goes in the
 * blocks after it). Keep every volatile detail out of this string.
 *
 * Level 2 grew this deliberately rather than incidentally. The three
 * additions — guiding from the current screen, the two-depth answer, and
 * the proposal protocol — are what the capability IS, and they belong in the
 * cached prefix rather than the per-turn block precisely because they never
 * vary. A longer static prefix is also the cheaper one once it crosses the
 * model's minimum cacheable length: it is billed at cache-read rates on
 * every turn after the first.
 */
const STATIC_SYSTEM = `You are Aglyn Assist, the in-console helper for Aglyn — a multi-tenant website-building and commerce platform. You are embedded in the customer console and answer questions about using Aglyn: building sites in the Besigner, publishing, domains, commerce, bookings, workflows, datasets, members and roles, billing and plans, and the marketplace.

Rules:
- Ground answers in the provided documentation sections when they are relevant, and cite them by linking their URLs with markdown links. Never invent a docs URL — only link URLs given to you.
- When the user should go somewhere in the console, link the console path as a markdown link with a root-relative path (for example [Billing](/acme/billing)) only when you are certain of the path from the context provided; otherwise describe the navigation in words.
- Be concise and task-focused: answer the question, give the steps, link the source. Skip preamble.
- If the question is not about Aglyn, say so briefly and point the user back to Aglyn topics.
- If you do not know, say so and suggest contacting support from the Support page rather than guessing.

Guiding from the current screen:
- When you are told where the user is, answer about THAT screen first. "Where do I do this?" is usually answered by the page they already have open, and sending someone away from a screen that can already do the job is the most common way to be unhelpful while sounding correct.
- Use only the facts given about the screen. Do not assert that a page contains a particular button, tab or field unless the screen description or the documentation says so — a confidently invented control costs the user more time than saying you are not sure.
- Name the next thing to do in the order the user will do it. Prefer one concrete next step over a list of everything possible.

Two depths, one answer:
- Aglyn's users run from first-time business owners to working developers, and they get the same message. Lead with the plain answer: what to click, in ordinary words, with no jargon and nothing assumed about what they already know.
- Then, when there is genuinely something technical to add — the route path, the identifier in the URL, the field or API behind the screen — add ONE final paragraph that begins exactly "Under the hood:" and carries it. The console collapses that paragraph, so a beginner never has to read it and a developer never has to ask for it.
- Do not write an "Under the hood:" paragraph when it would only restate the plain answer in longer words. Nothing technical to add is a normal outcome.
- Never talk down. No "don't worry", no "it's easy", no praise for the question.

Proposing an action:
- You cannot perform actions, fill in forms, publish, or change anything. Nothing you do saves data.
- Where the screen description lists actions, you may PROPOSE one when the user has asked to get something done and that action is the way to start it. The console shows your proposal as a card the user has to confirm; confirming only opens the page, and they still fill in and submit the form themselves.
- To propose, end your message with a fenced block containing only JSON: a fence line reading three backticks followed by aglyn:action, then {"id": "<an id from the screen description>", "params": {…}}, then a closing three-backtick line.
- Propose at most one action per message, and only ids listed for the screen the user is on. Supply only the params that id declares. Anything else is discarded.
- Write the message as if the card may not appear, because it may not. Say what the user should do; never say you have done it, opened it, or filled anything in.
- If the screen lists no actions, or nothing needs doing, write no block at all. Most answers have none.`

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

/**
 * Top-level console path segments that are a SECTION, not an org slug.
 * Mirrors `resolveNavSection` in `hooks/use-secondary-nav.ts`: every other
 * first segment is `/[orgSlug]/…`.
 */
const ORGLESS_PATH_SEGMENTS = new Set(['admin', 'manage'])

export type AssistScopeRefusal = 'no-org' | 'wrong-org'

/**
 * Whether this request may be METERED against `body.orgId` (AGL-1934).
 *
 * Membership is checked above this and answers a different question: *may
 * this caller reach that org at all*. It cannot catch the reported bug,
 * because in that bug the caller **is** a member — `useCurrentOrg()` falls
 * back to a remembered selection and then to the user's FIRST org, so the
 * workspace picker posted questions attributed and billed to a workspace
 * nobody opened. A membership check waves that through: every one of the
 * four cards on the picker passes it.
 *
 * So the server asks the second question too: **did the request NAME the org
 * it wants billed?** The only evidence available is the page the question was
 * asked from, which the client already sends as `context` — the route path
 * and, when the page was opened on a workspace subdomain, that subdomain's
 * slug. This mirrors `urlNamesOrg()` (AGL-1130) on the server side, so the
 * client gate and the billing boundary agree by construction rather than by
 * the client being trusted to have one.
 *
 * Two refusals, and they are deliberately asymmetric:
 *
 *   - `no-org` — the page named no workspace at all (`/`, `/manage/*` off a
 *     subdomain, `/admin/*` anywhere). There is no correct attribution for a
 *     question asked from a page with no workspace in scope, so the answer is
 *     a refusal, not a guess. This is the reported bug, and refusing it here
 *     is what makes a future client-side regression a VISIBLE failure instead
 *     of quiet mis-billing.
 *   - `wrong-org` — the page named a workspace and it is not this one. A
 *     POSITIVE contradiction only, exactly as AGL-1916 settled it: `slug` is
 *     absent on plenty of org docs, and an org that cannot state its own slug
 *     must not have every message refused. Only a slug that actively
 *     disagrees suppresses.
 *
 * `/admin/*` is the platform's own view and names no workspace on ANY
 * hostname — a staff subdomain session does not rescue it, same as
 * `urlNamesOrg`'s `section.kind === 'admin'` short-circuit.
 */
export function assistScopeRefusal(
  context: AssistRequestBody['context'],
  orgSlug: string,
): AssistScopeRefusal | null {
  const first = String(context?.route ?? '')
    .split('/')
    .filter(Boolean)[0]
  const staffConsole = first === 'admin'
  const pathSlug = !first || ORGLESS_PATH_SEGMENTS.has(first) ? '' : first
  const subdomainSlug = staffConsole ? '' : String(context?.orgSlug ?? '').trim()
  if (!pathSlug && !subdomainSlug) return 'no-org'
  if (!orgSlug) return null
  if (pathSlug && pathSlug !== orgSlug) return 'wrong-org'
  if (subdomainSlug && subdomainSlug !== orgSlug) return 'wrong-org'
  return null
}

/**
 * The level-2 view block (entitled orgs only) and the scope the proposal
 * channel resolves against.
 *
 * Everything here is either a static registry lookup or a sanitised scalar.
 * Nothing is read out of the customer's data: `safeOrgFacts` is an allowlist
 * of two fields, and the three client-supplied strings are filtered before
 * they reach a system block — `route` in particular, which is whatever the
 * panel says the pathname is and would otherwise be an instruction-injection
 * channel straight into the model's own instructions.
 */
function buildViewBlock(
  context: NonNullable<AssistRequestBody['context']>,
  org: Record<string, unknown>,
): {
  /** Cacheable, route-derived, tenant-agnostic. */
  screen: string
  /** Per-request; sits after the last breakpoint. */
  facts: string
  view: ReturnType<typeof describeView>
  scope: { orgSlug: string; hostId: string }
} {
  const route = sanitiseRoute(context.route)
  const hostId = sanitiseId(context.hostId)
  // Which slug builds a destination path. The org document's own slug is
  // authoritative; the URL's first segment is the fallback, because `slug`
  // is absent on plenty of org docs (AGL-1916) and a workspace that cannot
  // state its own must still get working links. Not the client's `orgSlug`
  // field — that is the SUBDOMAIN, empty on every apex route, and taking it
  // would silently drop every proposal on `app.aglyn.com`.
  const pathSlug = route.split('/').filter(Boolean)[0] ?? ''
  const orgSlug =
    sanitiseId(String(org['slug'] ?? '')) ||
    (ORGLESS_PATH_SEGMENTS.has(pathSlug) ? '' : sanitiseId(pathSlug))
  const view = describeView(route)
  const { name, plan } = safeOrgFacts(org)
  return {
    screen: viewScreenBlock(view),
    facts: viewFactsBlock({ route, hostId, orgSlug, name, plan }),
    view,
    scope: { orgSlug, hostId },
  }
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

    // The request must NAME the org it is about to be metered against
    // (AGL-1934). Below the flag check on purpose: a released-off deployment
    // must keep answering 404 for everything, including a malformed scope.
    const scopeRefusal = assistScopeRefusal(
      body.context,
      String((org as Record<string, unknown>).slug ?? ''),
    )
    if (scopeRefusal) {
      return Response.json(
        {
          error:
            scopeRefusal === 'no-org'
              ? 'Open a workspace before asking the assistant'
              : 'That question named a different workspace',
          reason: 'scope',
        },
        { status: 403 },
      )
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
    // RESERVED, not merely checked (AGL-2057). The counter moves here, in a
    // transaction, BEFORE a single token is spent — because the old order
    // (check now, count at stream completion) let concurrent requests and
    // abandoned streams past the cap, and an abandoned-stream loop is
    // unbounded provider spend on a workspace that pays nothing.
    const quota = await reserveAssistMessage(firestore, body.orgId, entitled)
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
    const docsBlock = docsGroundingBlock(scored)
    // Level 2 is the paid rung. A free workspace gets docs grounding and
    // deep links; the view block, and with it the proposal channel, is not
    // assembled at all — not assembled-then-withheld, so there is no path
    // where a free org's prompt carries it.
    const guide = entitled && body.context ? buildViewBlock(body.context, org as Record<string, unknown>) : null

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
        // Stable → volatile, with a breakpoint after each stable block.
        // See the header: the view block is identical for everyone on the
        // route, so the combined prefix is written once and read after; the
        // docs block follows the QUESTION and must therefore come last,
        // where it invalidates nothing behind it.
        system: [
          {
            type: 'text',
            text: STATIC_SYSTEM,
            cache_control: { type: 'ephemeral' },
          },
          ...(guide?.screen
            ? [
                {
                  type: 'text',
                  text: guide.screen,
                  cache_control: { type: 'ephemeral' },
                },
              ]
            : []),
          ...(guide ? [{ type: 'text', text: guide.facts }] : []),
          ...(docsBlock ? [{ type: 'text', text: docsBlock }] : []),
        ],
        messages,
      }),
    })

    if (!upstream.ok || !upstream.body) {
      const errorPayload = await upstream.json().catch(() => null)
      console.error('assist upstream error', upstream.status, errorPayload)
      // The provider was never reached, so no tokens were spent — give the
      // reservation back rather than charging an outage to the ten messages a
      // free workspace gets in a day.
      await releaseAssistMessage(firestore, body.orgId, quota).catch((error) =>
        console.error('assist reservation release failed', error),
      )
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
        // `raw` is everything the model wrote; `emitted` tracks how much of
        // the VISIBLE prefix has already gone down the wire. The proposal
        // fence must never reach the panel as text — a user watching raw
        // JSON appear mid-answer reads it as the assistant breaking — and
        // trimming at the end would be too late, because deltas are already
        // sent by then.
        let raw = ''
        let emitted = 0
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
                  raw += delta.text
                  const visible = visibleAssistText(raw)
                  if (visible.length > emitted) {
                    emit({ type: 'delta', text: visible.slice(emitted) })
                    emitted = visible.length
                  }
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
          // End of stream: the fence ambiguity is resolved, so flush the
          // tail that was being held back in case it became one. Without
          // this an answer closing on a code fence loses its last three
          // characters, on screen and in the stored exchange alike.
          const answer = finalAssistText(raw)
          if (answer.length > emitted) {
            emit({ type: 'delta', text: answer.slice(emitted) })
            emitted = answer.length
          }

          // The proposal, if the model made one. Validated against the view
          // it was given — an unknown id, a foreign id or an undeclared
          // param is dropped, and the destination is composed from the
          // registry rather than taken from the completion. A dropped
          // proposal costs the user a button; an honoured bad one costs
          // them trust.
          const proposal = guide
            ? resolveAssistProposal(extractAssistAction(raw), guide.view, guide.scope)
            : null

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
            // Inert data. The panel renders it as a card the user must
            // confirm, and confirming navigates — see the write boundary in
            // `assist-view-context.ts`.
            proposal,
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
