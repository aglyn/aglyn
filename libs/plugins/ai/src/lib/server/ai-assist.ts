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
  assistCreditsFromUsd,
  assistFreeTasteRefusalText,
  assistOwnControlRefusalText,
} from '@aglyn/aglyn/app-utils/assist-credits'
import { resolveEffectivePlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { aiAllotmentRefusalText } from '../model/ai-allotments'
import { resolveAiModelChoice } from '../providers/model-choice'
import { aiUsageMeter } from '../usage/ai-usage-meter'
import {
  permissionRefusal,
  checkRateLimit,
  featureLockdownRefusal,
  firebaseAdmin,
  getOrgForUser,
  lockdownRefusal,
  memberHasPermissionOnHost,
  rateLimitHeaders,
} from '@aglyn/tenant-data-admin'
import { recordUserAiRefusal } from '../usage/ai-usage-by-user'
import {
  estimateAssistCostUsd,
  publicAssistQuota,
  recordAssistCost,
  releaseAssistMessage,
  reserveAssistMessage,
  type AssistReservation,
} from '../usage/assist-usage'
import { logAiAssistSection } from '../activity/ai-activity'
// By its own entry point rather than the barrel (AGL-2903): this handler's
// spec replaces the barrel with a closed-world factory, and nothing replaces
// the entry point, so the spec exercises the real request shape and the real
// error boundary rather than a stub that agrees with the handler.
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import {
  AiUpstreamError,
  aiProviderReady,
  runAiRequest,
  type AiResult,
  type AiTool,
} from '../runtime/ai-runtime'
import {
  ASSIST_SECTION_TOOL_NAME,
  assistModeSystemBlocks,
  assistSectionTool,
  readAssistSection,
  type AiAssistMode,
} from './ai-assist-prompts'
// By its own entry point for the same reason (AGL-2925): the per-address
// rung is real in the spec, keyed on whatever address the harness sends.
import { checkAiClientIpRateLimit } from '../runtime/ai-abuse-guards'

/**
 * The model each mode is served by, through the routing table — tiered by
 * what the mode actually asks for (AGL-2486), not one model for all three.
 *
 * - **element** → the fast tier (`copy.element`). Rewriting one button label
 *   or one heading to an instruction is a short, bounded transformation with
 *   the source text supplied: the least model-shaped work on this route and
 *   the highest-volume (a user clicking "improve this" runs it repeatedly on
 *   the same element).
 * - **blog** → the balanced tier (`copy.blog`). A post body is real long-form
 *   writing, and the difference between tiers is legible to the reader.
 * - **section** → the balanced tier (`copy.section`). A constrained-JSON node
 *   subtree over the published-component allowlist is a structured-generation
 *   task with a schema the sanitizer will reject if it is got wrong, and a
 *   rejected generation costs the whole request rather than part of it.
 *
 * ⚠️ NO PROMPT CACHING IS LOST BY THE FAST RUNG. Each mode's static text now
 * carries a breakpoint (`assistModeSystemBlocks`), but none of the three is
 * long enough for its model to cache: the catalog states each model's
 * minimum and `runtime/ai-prompt-cache.spec.ts` measures every door against
 * it. That is why the tier drop is free here and NOT free on
 * `/api/assist/chat`, whose ~1,030-token prefix clears the balanced tier's
 * minimum and would stop caching entirely on the fast tier's — cheaper per
 * token, dearer per request, and invisible either way without that
 * measurement. See the header of `assist-chat.ts`.
 *
 * The cost meter prices by model id, so the value returned here MUST be the
 * one passed to `recordAssistCost` — same call, same variable. A tiering
 * change that updates the request and not the meter reports one tier's money
 * for another tier's tokens, which is the failure the by-model rate table
 * exists to stop.
 */
export function assistModelForMode(mode: AiAssistMode): string {
  return aiModelForStep(assistStepKindForMode(mode))
}

/** The routing table's step kind for each mode. */
export function assistStepKindForMode(
  mode: AiAssistMode,
): 'copy.element' | 'copy.blog' | 'copy.section' {
  return mode === 'element' ? 'copy.element' : mode === 'blog' ? 'copy.blog' : 'copy.section'
}

/**
 * Per-uid burst limit, matched to `/api/assist/chat`'s 20/min so a client
 * cannot arbitrage the two assist doors against each other.
 */
const ASSIST_RATE_LIMIT = 20
const ASSIST_RATE_WINDOW_MS = 60_000

const SECTION_MAX_TOKENS = AI_ROUTING_TABLE['copy.section'].maxTokens
const BLOG_MAX_TOKENS = AI_ROUTING_TABLE['copy.blog'].maxTokens
const ELEMENT_MAX_TOKENS = AI_ROUTING_TABLE['copy.element'].maxTokens

/**
 * What a `refusal` stop is answered with. The model declined the brief —
 * a policy verdict on the instruction, not a fault — so the sentence asks
 * for a different one rather than a retry. The tokens were spent and are
 * metered before this is sent.
 */
const REFUSED = {
  error: 'The AI declined that instruction — try a different one.',
}

/**
 * AI assist (AGL-89/130/169), the besigner copy assistant's door — the
 * section mode composes over the published-component allowlist and every
 * generated subtree passes the node-definition sanitizer a marketplace
 * install passes, before it reaches a canvas. `/api/ai/assist` is served by
 * the plugin API dispatcher under the `ai` prefix. Gated on a ready provider,
 * one registered with its key set (501 without, the same degrade pattern as
 * Stripe); auth via Firebase ID token.
 *
 * The provider call is `runAiRequest`, the runtime every AI door shares
 * (AGL-2903). This handler owns the ladder below and the response shapes;
 * `ai-assist-prompts.ts` owns the three prompts and the section tool; the
 * runtime owns the wire, the usage arithmetic and the error boundary. The
 * request keeps the model per mode, the `max_tokens` and the absent
 * `thinking` field it has always had — a fast-tier model rejects an explicit
 * one, and the balanced modes keep the model default.
 *
 * A section arrives through a strict tool (AGL-2937). It used to be asked
 * for as bare JSON and parsed: a parse that failed answered 502 with the
 * tokens already spent, so the whole request bought nothing and the member's
 * next move was to spend it again. The text parse is kept behind the tool,
 * for a provider whose adapter has none.
 *
 * ── The spend ladder (AGL-2073) ────────────────────────────────────────────
 *
 * This route reached the provider behind nothing but an entitlement check. Free
 * orgs could not get in, so the free tier was safe — but for any Pro org it
 * had no rate limit, no quota, no per-org cost telemetry, and it resolved the
 * org from the USER rather than the request, so someone with one paid org got
 * assist charged against whichever org `getOrgForUser` happened to return. One
 * subscription, unbounded and unmeasured provider spend.
 *
 * The ladder now, in order, each rung able to go red on its own:
 * 405 → 501 no ready provider → 401 no token → 400 bad body (the request
 * must NAME the org it is metered against) → 403 not a member of that org →
 * 423 the workspace's AI pause → 403 the member's role lacks `ai.use`, or
 * `ai.generate` for a section (AGL-2927; staff pass) → 403 no `aiAssist`
 * entitlement → 423 org lockdown → 429 rate limit → 429 quota → the model
 * call → meter.
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
 *   calling the provider uncapped. An unavailable meter must stop the spending,
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
  if (!aiProviderReady()) {
    return res
      .status(501)
      .json({ error: 'AI assist is not configured (no AI provider key).' })
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

    // Permission (AGL-2927), directly after membership. The element and
    // blog modes are assistance and sell under `ai.use`; a generated
    // section is a generation and sells under `ai.generate`. Decided on the
    // caller's own axis — the org catalog for an org-wide member, the site
    // the body named for a collaborator, who is refused when it named none.
    // A fact about the caller, so it is answered before the plan is. Staff
    // pass, as at every other org route. Beside it, the workspace-scoped
    // pause on `ai-assist`: the dispatcher already applied the platform-wide
    // switch by path, before it knew which org the body would name.
    const staff = decoded['staff'] === true
    const aiPaused = await featureLockdownRefusal({
      feature: 'ai-assist',
      staff,
      orgId,
    })
    if (aiPaused) return forwardRefusal(res, aiPaused)
    const permission = mode === 'section' ? 'ai.generate' : 'ai.use'
    if (
      !staff &&
      !(await memberHasPermissionOnHost(orgId, hostId, resolved.member, permission))
    ) {
      return forwardRefusal(res, permissionRefusal(permission))
    }

    const entitled = checkEntitlement(org, 'aiAssist')
    if (!entitled) {
      return res.status(403).json({ error: 'AI assist requires a Pro plan' })
    }

    // Org-scoped lockdown. The dispatcher already evaluates platform and user
    // scope plus the `ai-assist` feature kill switch, but its org scope needs
    // a `hostId` this route's callers do not send — so a suspended workspace
    // kept spending. The org doc is already in hand, so the verdict is free.
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
    // The same window keyed on the trusted-hop client address (AGL-2925):
    // accounts rotated behind one address share one budget.
    const ipRate = checkAiClientIpRateLimit(headers)
    if (ipRate && !ipRate.allowed) {
      for (const [name, value] of Object.entries(rateLimitHeaders(ipRate))) {
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
      // `org` is the document `entitled` came from, and it is what makes
      // the plan's own assist band bind rather than the operator backstop
      // alone. Generative building is the dearest thing this route serves,
      // so the band it spends against has to be the one that was sold.
      reservation = await reserveAssistMessage(
        firestore,
        orgId,
        entitled,
        new Date(),
        org,
        // The allotments that apply (AGL-2942): the asker's own, theirs on
        // the canvas's site, and the site's.
        { uid: decoded.uid, hostId: hostId || null },
      )
    } catch (error) {
      // FAIL CLOSED. The reservation is the only global bound on what this
      // route can spend at the provider; if it cannot be taken there is no cap,
      // and no cap is worse than no answer.
      console.error('assist reservation failed', error)
      return res
        .status(503)
        .json({ error: 'AI assist is temporarily unavailable' })
    }
    // A refusal is the asker's as well as the workspace's (AGL-2928): their
    // month counts it beside the org counter the reservation moved.
    recordUserAiRefusal(firestore, orgId, decoded.uid, reservation)
    if (!reservation.allowed) {
      const refusedBy = reservation.refusedBy
      // A hard allotment (AGL-2942): the monthly line a manager drew for
      // the asker or the site, with the sentence naming who can raise it.
      if (refusedBy === 'allotment') {
        return res.status(429).json({
          error: aiAllotmentRefusalText(reservation.allotment?.refusal?.scope),
          reason: 'quota',
          quota: publicAssistQuota(reservation),
          meter: aiUsageMeter(reservation),
        })
      }
      // The org's own controls are a 402, not a 429: credits past the band
      // are for sale and this workspace either switched the sale off
      // (AGL-2653) or capped what it would buy (AGL-2898), so the sentence
      // names the control that refused — the same sentence the console
      // assistant gives, from the same helper. Every other refusal keeps
      // the 429.
      const ownControl = assistOwnControlRefusalText(org, refusedBy)
      return res.status(ownControl ? 402 : 429).json({
        error:
          ownControl ??
          // The Free taste's own precautions (AGL-2925), in the sentences
          // the console assistant uses.
          assistFreeTasteRefusalText(refusedBy) ??
          'This workspace reached its AI assist limit for the month — contact support if you need a higher cap',
        // CREDITS, never the reservation itself — see `publicAssistQuota`.
        quota: publicAssistQuota(reservation),
        meter: aiUsageMeter(reservation),
      })
    }

    const tier: 'free' | 'entitled' = entitled ? 'entitled' : 'free'
    // ONE resolution, read by both the request and the meter — see
    // `assistModelForMode`. Two call sites would let them drift. A model the
    // asker picked (AGL-2942) replaces the routing table's answer only when
    // the plan, the org's restriction and the allotment allowlists all allow
    // it; anything else runs on Auto.
    const held = reservation
    const choice = resolveAiModelChoice(assistStepKindForMode(mode), body?.model, {
      plan: resolveEffectivePlan(org),
      allotmentModels: held.allotment?.models ?? null,
      orgModels: held.allotment?.orgModels ?? null,
    })
    const model = choice?.model ?? assistModelForMode(mode)
    /** The usage strip's envelope for an answered request (AGL-2942). */
    const meterFor = (result: AiResult) =>
      aiUsageMeter(held, {
        lastCredits: assistCreditsFromUsd(estimateAssistCostUsd(result.usage, model)),
        model: { id: model, auto: choice?.auto ?? true },
      })
    /** Meter what the provider actually charged us for, per org. */
    // The account the reservation drew on (AGL-2925), read once here: the
    // closure below runs after `reservation` may have been cleared by a
    // refund, and a refund never reaches the meter.
    const free = reservation?.free ?? null
    const meter = (result: AiResult): Promise<unknown> =>
      recordAssistCost(firestore, orgId, {
        route: `/api/ai/assist/${mode}`,
        hostId: hostId || null,
        model,
        tier,
        usage: result.usage,
        docsPaths: [],
        stopReason: result.stopReason,
        free,
      }).catch((error) => console.error('assist cost metering failed', error))

    /**
     * One provider call, with the refund decided at the boundary: a refused
     * request (a non-2xx answer) spent nothing, so the reservation goes back
     * — against the keys it RECORDED, never against "now" — and the caller
     * gets the runtime's fixed sentence, never the provider's (AGL-2815).
     * A result, even a refusal, means the tokens ARE spent: every exit after
     * it meters and none refunds. Anything else thrown never reached the
     * provider and is left to the outer catch, which refunds too.
     */
    const ask = async (
      content: string,
      maxTokens: number,
      tools?: AiTool[],
    ): Promise<AiResult | null> => {
      try {
        const result = await runAiRequest({
          model,
          maxTokens,
          stream: false,
          // The mode's prompt with the acceptable-use rules ahead of it
          // (AGL-2925), from `ai-assist-prompts.ts` so a spec can read what
          // this route sends without standing up the route.
          system: assistModeSystemBlocks(mode),
          messages: [{ role: 'user', content }],
          ...(tools ? { tools } : {}),
        })
        providerAnswered = true
        await meter(result)
        return result
      } catch (error) {
        if (!(error instanceof AiUpstreamError)) throw error
        providerAnswered = true
        await releaseReservation(firestore, orgId, reservation as AssistReservation)
        reservation = null
        res.status(502).json({ error: error.message })
        return null
      }
    }

    // Generate section (AGL-169): a constrained-JSON node subtree over the
    // marketplace component allowlist; the response passes the same
    // sanitizer as marketplace installs before it ever reaches a canvas.
    if (mode === 'section') {
      const result = await ask(
        `Section to design: ${instruction}`,
        SECTION_MAX_TOKENS,
        [assistSectionTool()],
      )
      if (!result) return
      if (result.kind === 'refusal') {
        return res.status(502).json({ ...REFUSED, meter: meterFor(result) })
      }
      const read = readAssistSection(result)
      if (read.status !== 'ok') {
        // Unreadable is the provider's fault and rejected is the answer's,
        // the two statuses this route has always drawn that line between.
        return res.status(read.status === 'unreadable' ? 502 : 422).json({ error: read.error })
      }
      // A subtree is going back (AGL-2929): the act, its size and its site in
      // the customer's feed — never the instruction or the copy generated.
      await logAiAssistSection(
        { uid: decoded.uid, email: decoded.email ?? null },
        {
          orgId,
          hostId: hostId || null,
          nodeCount: Object.keys(read.section.nodes).length,
        },
      )
      return res.status(200).json({ section: read.section, meter: meterFor(result) })
    }

    const result = await ask(
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
      mode === 'blog' ? BLOG_MAX_TOKENS : ELEMENT_MAX_TOKENS,
    )
    if (!result) return
    if (result.kind === 'refusal') {
      return res.status(502).json({ ...REFUSED, meter: meterFor(result) })
    }
    const output = result.text.trim()
    if (!output) {
      return res.status(502).json({ error: 'Empty AI response', meter: meterFor(result) })
    }
    return res.status(200).json({ text: output, meter: meterFor(result) })
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
