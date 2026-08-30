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

/**
 * The Resend send endpoint. Every outbound application email in Aglyn goes
 * through here — invites, receipts, usage summaries, campaigns, staff alerts.
 *
 * Auth email (verification, password reset) is Firebase's job and does NOT
 * come through this module.
 */
import {
  type EmailSendPriority,
  emailSendRateWindowStartMs,
  getEmailSendGovernor,
  isRefusablePriority,
  resolveSendPriority,
} from './send-rate'
import { renderTextEmailHtml } from './text-email-html'
import {
  sendingIdentityRefusal,
  type SendingIdentityVerdict,
} from './sending-domain'

export const RESEND_SEND_ENDPOINT = 'https://api.resend.com/emails'

/** A Resend delivery tag, used for webhook attribution (AGL-268). */
export interface EmailTag {
  name: string
  value: string
}

export interface SendEmailOptions {
  /** One or more recipient addresses. */
  to: string | string[]
  subject: string
  /** Plain-text body. Supply at least one of `text` or `html`. */
  text?: string
  /**
   * HTML body. Supply at least one of `text` or `html`.
   *
   * Omitted, one is synthesized from `text` so the message always carries an
   * HTML part — a text-only message has no anchors, so its links are inert in
   * the inbox and Resend's click tracking has nothing to rewrite. See
   * `text-email-html.ts`.
   */
  html?: string
  /** Extra MIME headers, e.g. `List-Unsubscribe`. */
  headers?: Record<string, string>
  /** Delivery tags for the opens/clicks webhook. */
  tags?: EmailTag[]
  replyTo?: string | string[]
  /**
   * Overrides the configured sender. Almost nothing should set this — the
   * whole point of `USAGE_EMAIL_FROM` is one verified sender identity.
   */
  from?: string
  /**
   * White-label display name for the sender (White-Label Phase 1). Replaces
   * only the display name in front of the configured verified address — the
   * address itself must stay on the verified domain, so this cannot forge a
   * different sender. Ignored when `from` is set explicitly. Callers pass
   * `resolveBrandingProfile(org).fromName` here so an agency's mail reads as
   * their brand instead of "Aglyn".
   */
  fromName?: string
  /**
   * The server-resolved sending identity for this message, from
   * `resolveSendingIdentity`.
   *
   * Supplied, it decides the address and it may refuse the send outright —
   * both `from` and `fromName` are subordinate to it, because a verdict is
   * the answer to "may this leave, and as whom" and a request-shaped
   * override is not. Omitted, every existing caller keeps the behavior it
   * had: the configured platform identity with an optional display name.
   *
   * Callers resolve it from the ORG DOCUMENT, never from request input. An
   * address assembled from a request body is a `From:` override wearing a new
   * name, and the invariant `applyFromName` exists to hold is that the
   * address cannot move off a verified identity.
   */
  sendingIdentity?: SendingIdentityVerdict | null
  /**
   * Short label for logs, e.g. `'invite'` or `'usage-summary'`. Makes a
   * failure in the runtime logs traceable to the feature that caused it.
   *
   * Since AGL-2407 it is also stamped as a Resend `context` TAG on every
   * send — see `contextTag` below.
   */
  context?: string
  /**
   * What the platform send-rate governor is allowed to do to this message
   * (AGL-2409). Omitted, it is derived from `context`: `'campaign'` is a
   * campaign and everything else is transactional, so no existing caller
   * changes and the default is the one that can never be refused.
   *
   * Set it to `'bulk'` ONLY from a resumable sweep — a cron that leaves its
   * subject unstamped and picks it up on the next run. A refusal for a bulk
   * send means "not this hour", and a caller that cannot come back would turn
   * that into a message nobody ever gets.
   */
  priority?: EmailSendPriority
}

/**
 * The `context` tag, attached to every send (AGL-2407).
 *
 * ## Why this is here and not at 37 call sites
 *
 * Until now `tags` were set by exactly one sender, `campaign-send.ts`, which
 * stamps `hostId` and `campaignId` for the opens/clicks webhook. Everything
 * else went out with NO tags at all, so a bounce on an invite, a password
 * reset, a receipt or a usage summary reached the webhook carrying nothing to
 * identify it, and was dropped.
 *
 * The obvious fix — thread an identifier through every call site — asks 37
 * places to remember, which is the shape that produces the 38th that does
 * not. But `context` is ALREADY threaded through 35 of the 37 for logging,
 * and it is exactly the right value: it names the sender. So the tag is
 * derived here, once, and no caller changes.
 *
 * Resend tag values are restricted to ASCII letters, digits, `_` and `-`;
 * anything else is rejected and would fail the whole send. Every `context` in
 * the tree is already a plain slug, but this is mail delivery — a value that
 * makes the send fail is far worse than a value that is sanitised — so the
 * label is normalised rather than trusted, and a context that sanitises to
 * nothing yields no tag rather than an invalid one.
 */
export function contextTag(context: string | undefined): EmailTag[] {
  const value = String(context ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return value ? [{ name: 'context', value }] : []
}

/**
 * Why a send did not happen. `unconfigured`, `no-recipient` and
 * `rate-limited` mean nothing was attempted; `rejected` and `network` mean
 * Resend was called and failed.
 *
 * `rate-limited` (AGL-2409) is the ONLY one of these that a caller may
 * reasonably retry unchanged, and the only one that can ever be produced for
 * a campaign or a bulk sweep and never for a transactional message.
 */
export type SendEmailFailureReason =
  | 'unconfigured'
  | 'no-recipient'
  | 'rejected'
  | 'network'
  | 'rate-limited'
  /**
   * The org selected a custom sending domain and that domain is not verified.
   *
   * Distinct from `unconfigured` because the two need opposite responses: an
   * unconfigured deployment is the operator's to fix, while this is a
   * customer's DNS that is not finished, and the customer is the only person
   * who can finish it. `detail` carries the sentence naming the domain.
   *
   * This is the LAST line of defence, not the visible one. A caller that
   * reaches it has already skipped the check its route should have made, and
   * a refusal seen only here is a log line — which is the shape of the
   * `USAGE_EMAIL_FROM` outage. `performCampaignSend` refuses first, with a
   * `409`, so a person finds out.
   */
  | 'unverified-domain'

export type SendEmailResult =
  | { sent: true; id: string | null }
  | {
      sent: false
      reason: SendEmailFailureReason
      /** HTTP status, when Resend answered. */
      status?: number
      /** Resend's error body or the thrown message, trimmed for logs. */
      detail?: string
      /**
       * `rate-limited` only: when the platform hourly window rolls and the
       * caller may try again. A resumable sweep does not need to wait on it —
       * its next scheduled run is the retry.
       */
      retryAtMs?: number
    }

/**
 * The retry instant when the platform send-rate governor deferred this
 * message, or `null` for every other outcome (AGL-2409).
 *
 * A FUNCTION rather than `result.reason === 'rate-limited'` at each call site,
 * because `strictNullChecks` is OFF repo-wide and TypeScript will not narrow a
 * boolean-literal discriminant without it: `if (result.sent) … else
 * result.reason` does not compile, in every consumer, for a reason that has
 * nothing to do with this union. One helper is also one place to change if the
 * shape of a deferral ever moves.
 */
export function rateLimitedRetryAtMs(
  result: SendEmailResult | null | undefined,
): number | null {
  const failure = result as { reason?: string; retryAtMs?: number } | null
  if (!failure || failure.reason !== 'rate-limited') return null
  const retryAtMs = Number(failure.retryAtMs)
  return Number.isFinite(retryAtMs) ? retryAtMs : 0
}

export interface EmailConfig {
  apiKey: string | undefined
  from: string | undefined
}

/**
 * Reads the email environment.
 *
 * Deliberately read per call rather than captured at module load: these run
 * in serverless handlers where the module may be evaluated during a build,
 * long before the runtime env exists.
 */
export function getEmailConfig(): EmailConfig {
  return {
    apiKey: process.env.RESEND_API_KEY || undefined,
    from: process.env.USAGE_EMAIL_FROM || undefined,
  }
}

/**
 * True when both `RESEND_API_KEY` and `USAGE_EMAIL_FROM` are present.
 *
 * Callers that answer an HTTP request (rather than firing best-effort mail)
 * use this to return a 501 with an actionable message instead of pretending
 * to have sent something.
 */
export function isEmailConfigured(): boolean {
  const { apiKey, from } = getEmailConfig()
  return Boolean(apiKey && from)
}

/**
 * Applies a white-label display name to a configured sender while keeping
 * its verified address (White-Label Phase 1). Accepts either a bare address
 * (`noreply@aglyn.com`) or an RFC-5322 `Name <addr>` header and returns
 * `"<fromName>" <addr>`. A blank name, or a value with no extractable
 * address, yields the original `from` untouched — the sender identity is
 * never dropped on the floor.
 */
export function applyFromName(
  from: string | undefined,
  fromName: string | undefined,
): string | undefined {
  const name = (fromName ?? '').trim()
  if (!from || !name) return from
  const angle = from.match(/<([^>]+)>/)
  const address = (angle ? angle[1] : from).trim()
  if (!address.includes('@')) return from
  // Quote the display name so commas/specials stay inside one mailbox.
  return `"${name.replace(/"/g, '')}" <${address}>`
}

function normalizeRecipients(to: string | string[]): string[] {
  const list = Array.isArray(to) ? to : [to]
  return list
    .map((address) => String(address ?? '').trim())
    .filter((address) => address.includes('@'))
}

/** A Resend send payload in the provider's own wire shape. */
export interface ResendSendPayload {
  to?: unknown
  from?: unknown
  subject?: unknown
  [field: string]: unknown
}

/**
 * The one place that POSTs to Resend's send endpoint, and the last thing
 * standing between a payload and the network.
 *
 * A payload carrying no recipient cannot become a message. Resend answers it
 * `422 missing_required_field`, which costs an API call and then shows up in
 * the vendor dashboard as a red line indistinguishable from mail that
 * genuinely failed to deliver — carrying no subject, no recipient and nothing
 * naming the code that produced it. Diagnosing that means reading a log
 * outside the deployment and guessing. So the refusal happens here, before
 * the fetch, and names the caller's `context`.
 *
 * It throws rather than returning a `SendEmailResult`: this is a programming
 * error, not a delivery outcome. `sendEmail` filters recipients well before
 * it reaches this call, so nothing on the ordinary path can trip it. The
 * guard exists because `RESEND_SEND_ENDPOINT` is exported and any module can
 * therefore reach the send endpoint on its own, bypassing every check
 * `sendEmail` owns.
 */
export async function postResendEmail(
  apiKey: string,
  payload: ResendSendPayload,
  context?: string,
): Promise<Response> {
  const raw = payload?.to
  const recipients = (Array.isArray(raw) ? raw : raw == null ? [] : [raw])
    .map((address) => String(address ?? '').trim())
    .filter(Boolean)
  if (!recipients.length) {
    throw new Error(
      `${context ? `${context} ` : ''}send refused before the network — a ` +
        'Resend payload with no `to` field cannot become a message, and the ' +
        'attempt would surface only as a 422 in the Resend dashboard',
    )
  }

  return fetch(RESEND_SEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/**
 * Sends one email through Resend.
 *
 * **Never throws and never rejects.** Outbound mail is best-effort across
 * every caller in this codebase — a checkout must not fail because a receipt
 * bounced — so every outcome comes back as a `SendEmailResult` instead. The
 * one thing callers must not do is ignore the result: `sent` is what tells
 * the user whether a message actually went out (AGL-708).
 *
 * When the env vars are missing this warns once per call and returns
 * `{ sent: false, reason: 'unconfigured' }` rather than failing, so local and
 * preview environments keep working without a Resend account.
 */
export async function sendEmail(
  options: SendEmailOptions,
): Promise<SendEmailResult> {
  const { apiKey, from: configuredFrom } = getEmailConfig()
  const label = options.context ? `${options.context} email` : 'email'

  /*
   * THE SENDING-IDENTITY REFUSAL.
   *
   * Enforced here AND at the campaign route, independently, for the reason
   * the send-rate governor is enforced twice: the route's check is the one a
   * person sees, and this one is what holds when a caller does not make it.
   * A governor is injectable and a route is skippable, so neither may be the
   * only thing standing between an unverified domain and a send.
   *
   * Placed above the `apiKey`/`from` gate so a refusal cannot be reported as
   * `unconfigured` — the two have different owners and different fixes.
   */
  const identityRefusal = sendingIdentityRefusal(options.sendingIdentity)
  if (identityRefusal) {
    console.warn(`${label} refused — ${identityRefusal.message}`)
    return {
      sent: false,
      reason: 'unverified-domain',
      detail: identityRefusal.message,
    }
  }

  // A resolved identity outranks both `from` and the configured sender: it is
  // the server's answer to which verified address this message leaves on.
  // Without one, explicit `from` wins and otherwise the white-label display
  // name is applied to the configured verified sender (White-Label Phase 1).
  const resolvedFrom = options.sendingIdentity?.from ?? null
  const from = resolvedFrom
    ? applyFromName(resolvedFrom, options.fromName)
    : options.from ?? applyFromName(configuredFrom, options.fromName)

  if (!apiKey || !from) {
    console.warn(
      `${label} skipped — set RESEND_API_KEY and USAGE_EMAIL_FROM to ` +
        'deliver mail',
    )
    return { sent: false, reason: 'unconfigured' }
  }

  const to = normalizeRecipients(options.to)
  if (!to.length) {
    console.warn(`${label} skipped — no valid recipient address`)
    return { sent: false, reason: 'no-recipient' }
  }

  /*
   * THE PLATFORM SEND-RATE GOVERNOR (AGL-2409).
   *
   * Asked on EVERY send, including transactional ones, because the ceiling is
   * about total volume on one sending domain — a governor that only saw
   * campaigns would report a quiet hour while ten thousand receipts went out.
   * The governor counts what it grants.
   *
   * Two properties this block must have, in order:
   *
   *  1. **A refusal is honoured only for a refusable priority.** This is the
   *     second of the two enforcement points described in `send-rate.ts`.
   *     `emailSendRateVerdict` already cannot refuse a transactional send;
   *     the governor is INJECTABLE, so a wrong one is reachable, and the send
   *     path must still be unable to drop a password reset. Anything that is
   *     not explicitly a campaign or a bulk sweep sends regardless of the
   *     answer.
   *  2. **It fails open.** A governor that throws — Firestore unreachable, no
   *     Admin app, a bug — must not stop mail. The counter being unavailable
   *     is an outage on the control, and an outage on a control that turns
   *     into an outage on the product is a worse bug than the burst it was
   *     guarding. The same posture `sendEmail` takes everywhere else: it
   *     never throws, and neither does this.
   */
  const priority = resolveSendPriority(options.context, options.priority)
  const governor = getEmailSendGovernor()
  if (governor) {
    let verdict: Awaited<ReturnType<typeof governor>> | null
    try {
      verdict = await governor({ priority, count: to.length, context: options.context })
    } catch (error) {
      console.error(`${label} send-rate governor failed — allowing`, error)
      verdict = null
    }
    if (verdict && !verdict.allowed && isRefusablePriority(priority)) {
      const retryAtMs =
        verdict.retryAtMs ?? emailSendRateWindowStartMs(Date.now())
      console.warn(
        `${label} deferred — platform send rate reached ` +
          `(${verdict.used ?? '?'}/${verdict.ceiling ?? '?'} this hour)`,
      )
      return {
        sent: false,
        reason: 'rate-limited',
        retryAtMs,
        detail:
          `Platform hourly send rate reached (${verdict.ceiling ?? '?'}/hour). ` +
          'Transactional mail is unaffected.',
      }
    }
  }

  try {
    const response = await postResendEmail(
      apiKey,
      {
        from,
        to,
        subject: options.subject,
        ...(options.text ? { text: options.text } : {}),
        // The HTML part, from the caller when it has one and otherwise
        // synthesized from `text`. A message with no HTML part carries no
        // anchors, so its links are not links in the inbox AND Resend has
        // nothing to rewrite for click tracking — see `text-email-html.ts`.
        // The caller always wins: this can only fill a gap, never override a
        // designed template.
        ...(() => {
          const html = options.html || renderTextEmailHtml(options.text ?? '', options.subject)
          return html ? { html } : {}
        })(),
        ...(options.headers ? { headers: options.headers } : {}),
        // The caller's tags plus the `context` tag (AGL-2407). Caller-first
        // so a sender that stamps its own `context` keeps it: a tag list with
        // two entries of one name is not a shape worth discovering in
        // production, and the explicit one is the more specific.
        ...(() => {
          const caller = options.tags ?? []
          const derived = caller.some((tag) => tag?.name === 'context')
            ? []
            : contextTag(options.context)
          const tags = [...caller, ...derived]
          return tags.length ? { tags } : {}
        })(),
        ...(options.replyTo ? { reply_to: options.replyTo } : {}),
      },
      options.context,
    )

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      console.error(`${label} failed`, response.status, detail)
      return {
        sent: false,
        reason: 'rejected',
        status: response.status,
        detail: detail.slice(0, 500),
      }
    }

    const body = (await response.json().catch(() => null)) as {
      id?: string
    } | null
    return { sent: true, id: body?.id ?? null }
  } catch (error) {
    console.error(`${label} failed`, error)
    return {
      sent: false,
      reason: 'network',
      detail: String((error as Error)?.message ?? error).slice(0, 500),
    }
  }
}

export default sendEmail
