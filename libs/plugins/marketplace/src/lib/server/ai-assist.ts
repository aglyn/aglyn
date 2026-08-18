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
  checkEntitlement,
  type PluginApiHandler,
  type PluginApiResponse,
} from '@aglyn/aglyn/server'
import {
  checkRateLimit,
  firebaseAdmin,
  getOrgForUser,
  lockdownRefusal,
  rateLimitHeaders,
  recordAssistCost,
  releaseAssistMessage,
  reserveAssistMessage,
  type AssistReservation,
  type AssistTokenUsage,
} from '@aglyn/tenant-data-admin'
import {
  MARKETPLACE_COMPONENT_ID_ALLOWLIST,
  sanitizeMarketplaceDefinition,
} from '../model/marketplace'

/**
 * Sonnet-class, fixed. The cost meter prices by model id, so a hard-coded
 * constant here means the per-org money is exact rather than approximately
 * right. If this ever becomes configurable, the override has to be read where
 * the request is built AND passed to the meter in the same breath.
 */
const MODEL = 'claude-sonnet-5'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/**
 * Per-uid burst limit, matched to `/api/assist/chat`'s 20/min so a client
 * cannot arbitrage the two assist doors against each other.
 */
const ASSIST_RATE_LIMIT = 20
const ASSIST_RATE_WINDOW_MS = 60_000

const SECTION_MAX_TOKENS = 3000
const BLOG_MAX_TOKENS = 2048
const ELEMENT_MAX_TOKENS = 1024

/**
 * AI assist (AGL-89/130/169), relocated from the console app route into the
 * marketplace plugin (AGL-418) — the section mode composes over the marketplace
 * component allowlist and every generated subtree passes the marketplace
 * install sanitizer, so the plugin owns the contract. URL `/api/ai/assist`
 * is preserved through the dispatcher. Env-gated on ANTHROPIC_API_KEY (501
 * without, same degrade pattern as Stripe); auth via Firebase ID token.
 *
 * ── The spend ladder (AGL-2073) ────────────────────────────────────────────
 *
 * This route reached Anthropic behind nothing but an entitlement check. Free
 * orgs could not get in, so the free tier was safe — but for any Pro org it
 * had no rate limit, no quota, no per-org cost telemetry, and it resolved the
 * org from the USER rather than the request, so someone with one paid org got
 * assist charged against whichever org `getOrgForUser` happened to return. One
 * subscription, unbounded and unmeasured provider spend.
 *
 * The ladder now, in order, each rung able to go red on its own:
 * 405 → 501 no ANTHROPIC_API_KEY → 401 no token → 400 bad body (the request
 * must NAME the org it is metered against) → 403 not a member of that org →
 * 403 no `aiAssist` entitlement → 423 org lockdown → 429 rate limit → 429
 * quota → the model call → meter.
 *
 * Two deliberate choices about which way each rung fails:
 *
 * - **The rate limiter fails SOFT and is not the spend bound.** It is a
 *   per-instance in-memory window, so N serverless instances admit N × 20/min;
 *   it smooths bursts and nothing more. Treating it as the cap would be the
 *   fail-open this issue is about.
 * - **The reservation fails CLOSED.** It is the only global, atomic bound on
 *   provider spend, so a reservation that cannot be taken — a Firestore
 *   outage, a contended transaction — refuses the request with 503 rather than
 *   calling Anthropic uncapped. An unavailable meter must stop the spending,
 *   not wave it through.
 *
 * The reservation is `reserveAssistMessage` — the same shared counter the
 * console chat route moves (AGL-2057), not a second mechanism. That is what
 * closes the "uncapped for paid" hole the earlier audit named: an entitled org
 * carries the monthly runaway guard, and because both doors move the SAME
 * counter, an org's monthly assist budget is shared across them rather than
 * doubled by having two.
 *
 * Metering is `recordAssistCost`, the signal + rollup half of the assist
 * meters WITHOUT the verbatim half: what a customer types here is their own
 * site copy and blog bodies, and retaining that for 180 days is a data flow
 * the published privacy disclosure does not describe. The margin question is
 * answered by the signal alone.
 */
export const aiAssistHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res
      .status(501)
      .json({ error: 'AI assist is not configured (ANTHROPIC_API_KEY).' })
  }

  const headers = req.headers as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  const body = req.body ?? {}
  const text = String(body?.text ?? '').slice(0, 12000)
  const instruction = String(body?.instruction ?? '').slice(0, 500)
  // Modes (AGL-130): 'element' rewrites short copy; 'blog' writes or
  // improves markdown-lite entry bodies with title/excerpt context.
  const mode =
    body?.mode === 'blog'
      ? 'blog'
      : body?.mode === 'section'
        ? 'section'
        : 'element'
  const title = String(body?.title ?? '').slice(0, 200)
  const excerpt = String(body?.excerpt ?? '').slice(0, 500)
  // The request must NAME the org it is about to be metered against
  // (AGL-2073, the AGL-1934 rule applied to this door). Resolving the org
  // from the user alone charged a multi-org user's assist to whichever org
  // came back first — and handed their free workspaces a paid feature.
  const orgId = String(body?.orgId ?? '').trim()
  const hostId = String(body?.hostId ?? '')
    .trim()
    .slice(0, 128)
  if (!instruction) {
    return res.status(400).json({ error: 'Missing instruction' })
  }
  if (!orgId) {
    return res
      .status(400)
      .json({ error: 'Open a workspace before using AI assist' })
  }

  let reservation: AssistReservation | null = null
  let providerAnswered = false
  let firestore: FirebaseFirestore.Firestore | null = null

  try {
    const app = firebaseAdmin.app()
    firestore = app.firestore()
    const decoded = await app.auth().verifyIdToken(idToken)

    // Plan gate (AGL-469): AI assist is a Pro+ entitlement with real token
    // cost — resolve the caller's org and check it server-side; a plan-less
    // org resolves as `free` and is denied. Scoped to the NAMED org, so
    // membership of some other paid org is not a key to this one.
    const resolved = await getOrgForUser(decoded.uid, orgId)
    if (!resolved || resolved.orgId !== orgId) {
      return res
        .status(403)
        .json({ error: 'You are not a member of that organization' })
    }
    const org = resolved.org ?? {}
    const entitled = checkEntitlement(org, 'aiAssist')
    if (!entitled) {
      return res.status(403).json({ error: 'AI assist requires a Pro plan' })
    }

    // Org-scoped lockdown. The dispatcher already evaluates platform and user
    // scope plus the `ai-assist` feature kill switch, but its org scope needs
    // a `hostId` this route's callers do not send — so a suspended workspace
    // kept spending. The org doc is already in hand, so the verdict is free.
    const staff = decoded['staff'] === true
    const locked = await lockdownRefusal({
      request: { method: req.method },
      staff,
      uid: decoded.uid,
      org: org as Record<string, unknown>,
    })
    if (locked) return forwardRefusal(res, locked)

    const rate = checkRateLimit(`ai-assist:${decoded.uid}`, {
      limit: ASSIST_RATE_LIMIT,
      windowMs: ASSIST_RATE_WINDOW_MS,
    })
    if (!rate.allowed) {
      for (const [name, value] of Object.entries(rateLimitHeaders(rate))) {
        res.setHeader(name, value)
      }
      return res
        .status(429)
        .json({ error: 'Too many AI requests — slow down a moment' })
    }

    // RESERVED, not merely checked (AGL-2057/2073). Read-and-increment in one
    // transaction, BEFORE a single token is spent, so N concurrent requests
    // cannot all read the same "under the cap" and a client that drops the
    // connection has already been counted.
    try {
      reservation = await reserveAssistMessage(firestore, orgId, entitled)
    } catch (error) {
      // FAIL CLOSED. The reservation is the only global bound on what this
      // route can spend at Anthropic; if it cannot be taken there is no cap,
      // and no cap is worse than no answer.
      console.error('assist reservation failed', error)
      return res
        .status(503)
        .json({ error: 'AI assist is temporarily unavailable' })
    }
    if (!reservation.allowed) {
      return res.status(429).json({
        error:
          'This workspace reached its AI assist limit for the month — contact support if you need a higher cap',
        quota: reservation,
      })
    }

    const tier: 'free' | 'entitled' = entitled ? 'entitled' : 'free'
    /** Meter what the provider actually charged us for, per org. */
    const meter = (payload: unknown): Promise<unknown> =>
      recordAssistCost(firestore, orgId, {
        route: `/api/ai/assist/${mode}`,
        hostId: hostId || null,
        model: MODEL,
        tier,
        usage: assistUsageFrom(payload),
        docsPaths: [],
        stopReason: stopReasonFrom(payload),
      }).catch((error) => console.error('assist cost metering failed', error))

    // Generate section (AGL-169): a constrained-JSON node subtree over the
    // marketplace component allowlist; the response passes the same
    // sanitizer as marketplace installs before it ever reaches a canvas.
    if (mode === 'section') {
      const response = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: SECTION_MAX_TOKENS,
          system:
            'You design one website section inside a site builder. Reply ' +
            'with ONLY a JSON object, no prose or code fences: ' +
            '{"rootId":"n1","nodes":{"n1":{"$id":"n1","componentId":"muiStack","parentId":null,"props":{},"nodes":["n2"]},...}}. ' +
            'Every node needs $id, componentId, parentId (null for the ' +
            'root), and children listed in "nodes" (child ids). Allowed ' +
            `componentIds: ${MARKETPLACE_COMPONENT_ID_ALLOWLIST.join(', ')}. ` +
            'Useful props — muiStack: {direction:"row"|"column", spacing, ' +
            'justifyContent, alignItems}; muiTypography: {children, ' +
            'variant:"h1".."h6"|"body1"|"subtitle1"}; muiButton: ' +
            '{children, variant:"contained"|"outlined", color}; image: ' +
            '{src, alt}; muiContainer: {maxWidth:"sm"|"md"|"lg"}. Keep it ' +
            'small: 4-12 nodes, one root container. Leave image src empty. ' +
            'Write real copy, not lorem ipsum.',
          messages: [
            { role: 'user', content: `Section to design: ${instruction}` },
          ],
        }),
      })
      providerAnswered = true
      const payload = await response.json()
      if (!response.ok) {
        console.error(payload)
        // No tokens were spent, so the reservation goes back — against the
        // keys it RECORDED, never against "now".
        await releaseReservation(firestore, orgId, reservation)
        reservation = null
        return res
          .status(502)
          .json({ error: payload?.error?.message ?? 'AI request failed' })
      }
      // Past here the tokens ARE spent, whatever we make of the answer, so
      // every exit below meters and none of them refunds.
      await meter(payload)
      const raw = (payload?.content ?? [])
        .filter((block: any) => block?.type === 'text')
        .map((block: any) => block.text)
        .join('')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
      let parsed: any
      try {
        parsed = JSON.parse(raw)
      } catch {
        return res.status(502).json({ error: 'AI returned invalid JSON' })
      }
      const sanitized = sanitizeMarketplaceDefinition({
        rootId: String(parsed?.rootId ?? ''),
        nodes: parsed?.nodes ?? {},
      })
      if (sanitized.ok === false) {
        return res.status(422).json({ error: sanitized.error })
      }
      return res
        .status(200)
        .json({ section: { rootId: sanitized.rootId, nodes: sanitized.nodes } })
    }

    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: mode === 'blog' ? BLOG_MAX_TOKENS : ELEMENT_MAX_TOKENS,
        system:
          mode === 'blog'
            ? 'You write blog posts inside a site builder. Reply with ONLY ' +
              'the post body in markdown-lite: **bold**, *italic*, ## ' +
              'headings, - lists, [links](https://url). No front matter, ' +
              'title line, or preamble — the title renders separately.'
            : 'You write website copy inside a site builder. Reply with ' +
              'ONLY the final text for the element — no quotes, preamble, ' +
              'or markdown. Keep roughly the same length and role as the ' +
              'current text unless the instruction says otherwise.',
        messages: [
          {
            role: 'user',
            content:
              mode === 'blog'
                ? [
                    title && `Title: ${title}`,
                    excerpt && `Excerpt: ${excerpt}`,
                    text && `Current body:\n${text}`,
                    `Instruction: ${instruction}`,
                  ]
                    .filter(Boolean)
                    .join('\n\n')
                : text
                  ? `Current element text:\n${text}\n\nInstruction: ${instruction}`
                  : `Write website element text. Instruction: ${instruction}`,
          },
        ],
      }),
    })
    providerAnswered = true
    const payload = await response.json()
    if (!response.ok) {
      console.error(payload)
      await releaseReservation(firestore, orgId, reservation)
      reservation = null
      return res
        .status(502)
        .json({ error: payload?.error?.message ?? 'AI request failed' })
    }
    await meter(payload)
    const output = (payload?.content ?? [])
      .filter((block: any) => block?.type === 'text')
      .map((block: any) => block.text)
      .join('')
      .trim()
    if (!output) return res.status(502).json({ error: 'Empty AI response' })
    return res.status(200).json({ text: output })
  } catch (error) {
    console.error(error)
    // The provider was never reached — a token verification failure, a DNS
    // error, a socket reset before any response. Nothing was spent, so the
    // reservation must not be. If the provider DID answer, the tokens are
    // real and the reservation stays consumed however the request ends.
    if (firestore && reservation && !providerAnswered) {
      await releaseReservation(firestore, orgId, reservation)
    }
    return res.status(500).json({ error: 'Assist failed' })
  }
}

/**
 * Hand a reservation back, never letting the refund itself fail the request.
 * Released against the keys the RESERVATION recorded — a reservation taken at
 * 23:59:59 and released at 00:00:01 must not credit the next day.
 */
async function releaseReservation(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  reservation: AssistReservation,
): Promise<void> {
  await releaseAssistMessage(firestore, orgId, reservation).catch((error) =>
    console.error('assist reservation release failed', error),
  )
}

/** Anthropic's `usage` block, in the meter's shape. Missing fields read 0. */
export function assistUsageFrom(payload: unknown): AssistTokenUsage {
  const usage = (payload as { usage?: Record<string, unknown> } | null)?.usage
  const count = (value: unknown): number => {
    const parsed = Number(value ?? 0)
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
  }
  return {
    inputTokens: count(usage?.['input_tokens']),
    outputTokens: count(usage?.['output_tokens']),
    cacheReadTokens: count(usage?.['cache_read_input_tokens']),
    cacheWriteTokens: count(usage?.['cache_creation_input_tokens']),
  }
}

/** The model's own `stop_reason`, or null when it did not send one. */
export function stopReasonFrom(payload: unknown): string | null {
  const reason = (payload as { stop_reason?: unknown } | null)?.stop_reason
  return typeof reason === 'string' && reason ? reason : null
}

/** Re-emit a lockdown `Response` through the plugin API's res object. */
async function forwardRefusal(
  res: PluginApiResponse,
  refusal: Response,
): Promise<void> {
  const retryAfter = refusal.headers.get('Retry-After')
  if (retryAfter) res.setHeader('Retry-After', retryAfter)
  const body = await refusal.json().catch(() => ({ error: 'locked' }))
  res.status(refusal.status).json(body)
}
