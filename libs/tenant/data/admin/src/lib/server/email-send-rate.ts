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
 * THE PLATFORM SEND-RATE GOVERNOR — durable half (AGL-2409).
 *
 * The policy is pure and lives in `@aglyn/shared-util-email`
 * (`send-rate.ts`); this adds the Firestore counter that makes the ceiling
 * global rather than per-instance, the configuration read that makes a ramp a
 * value change instead of a deploy, and the installation that puts the whole
 * thing on `sendEmail`'s path.
 *
 * ## Storage: the `rateLimits` collection, on purpose
 *
 * Both documents live in `rateLimits`, the same collection AGL-794's counters,
 * AGL-1679's degradation markers and AGL-1907's signup-refusal markers already
 * use, for the reason those two state: it inherits the deny-all security rule
 * and the `expiresAt` TTL policy that already exist rather than needing a new
 * collection, a rules deploy and a second TTL policy.
 *
 *  - `rateLimits/sendRate_{windowStartMs}` — one document per hour, holding
 *    the count. Carries `expiresAt`, so the TTL policy sweeps it.
 *  - `rateLimits/sendRateConfig` — the ceiling. **Carries NO `expiresAt`, and
 *    must never be given one**, or the TTL policy that serves the counters
 *    would quietly delete the configuration and the platform would silently
 *    revert to the compiled-in default. `emailSendRateConfigWrite` is the one
 *    writer and `email-send-rate.spec.ts` asserts the field is absent.
 *
 * The window document does NOT carry `lastAtMs`. AGL-1693's rate-limiter
 * health probe queries this collection with `where('lastAtMs', '>=', cutoff)`;
 * a per-hour document in that range would compete with the degradation
 * markers the probe exists to find. It uses `sentAtMs`, which keeps the two
 * queries disjoint at the index level — the same reasoning, and the same
 * mistake avoided, as `refusedAtMs` on the signup markers.
 *
 * ## Failure posture: OPEN
 *
 * If the counter or the config cannot be read, every send is granted. That is
 * the opposite of `consumeRateLimit`'s fail-closed-on-contention rule, and the
 * difference is what the two controls protect. A brute-force limiter that
 * fails open lets an attacker in; this one failing open lets a campaign out.
 * The cost of failing CLOSED here is refusing a paying customer's campaign
 * because of an unrelated Firestore blip — and, worse, refusing a bulk sweep
 * that a customer's month depends on. Neither is worth the hour of ramp it
 * would buy back, and the operator can see it: a degraded grant is reported
 * and surfaced on /admin/emails.
 */

import {
  type EmailSendGovernorRequest,
  type EmailSendGovernorVerdict,
  type EmailSendPriority,
  type EmailSendRateConfig,
  type EmailSendRateVerdict,
  EMAIL_SEND_RATE_WINDOW_MS,
  emailSendRateVerdict,
  emailSendRateWindowStartMs,
  normalizeEmailSendRateConfig,
  orgHourlyCampaignCeiling,
  setEmailSendGovernor,
} from '@aglyn/shared-util-email'
import { firebaseAdmin } from './firebase-admin'
import { RATE_LIMIT_COLLECTION } from './rate-limit-store'

/** Document id of the live ceiling. NEVER written with `expiresAt`. */
export const EMAIL_SEND_RATE_CONFIG_DOC = 'sendRateConfig'

/** Id prefix for the per-hour counters. */
export const EMAIL_SEND_RATE_WINDOW_PREFIX = 'sendRate_'

/** The counter document id for a window. */
export function emailSendRateWindowDocId(windowStartMs: number): string {
  return `${EMAIL_SEND_RATE_WINDOW_PREFIX}${windowStartMs}`
}

/**
 * Config cache TTL.
 *
 * 15s, the same number and the same reasoning as the platform lockdown doc:
 * this sits on a path that every outbound message crosses, so a per-send read
 * would be one Firestore read per email platform-wide, and 15s is the
 * worst-case lag between staff moving the ramp and a warm process honouring
 * it. A ramp is measured in hours; fifteen seconds is free.
 */
const CONFIG_TTL_MS = 15_000

let configCache: { at: number; config: EmailSendRateConfig } | undefined
let configPending: Promise<EmailSendRateConfig> | undefined

/** Drop the in-process config cache — called by the console after a write. */
export function invalidateEmailSendRateConfigCache(): void {
  configCache = undefined
  configPending = undefined
}

/**
 * The live ceiling. Falls back to the compiled-in default on any read error,
 * which is the fail-open posture stated above: an unreachable config must not
 * be read as a ceiling of zero.
 */
export async function readEmailSendRateConfig(options?: {
  firestore?: any
  now?: number
}): Promise<EmailSendRateConfig> {
  const now = options?.now ?? Date.now()
  if (!options?.firestore && configCache && now - configCache.at < CONFIG_TTL_MS) {
    return configCache.config
  }
  const load = async (): Promise<EmailSendRateConfig> => {
    let config = normalizeEmailSendRateConfig(null)
    try {
      const firestore = options?.firestore ?? firebaseAdmin.app().firestore()
      const snapshot = await firestore
        .collection(RATE_LIMIT_COLLECTION)
        .doc(EMAIL_SEND_RATE_CONFIG_DOC)
        .get()
      config = normalizeEmailSendRateConfig(
        snapshot.exists ? (snapshot.data() as Partial<EmailSendRateConfig>) : null,
      )
    } catch {
      // Fail open: an unreachable config is an outage, not a ceiling of zero.
    }
    return config
  }
  // An injected firestore is a test or a one-off read; never cached, so a
  // spec cannot poison the process cache for the next one.
  if (options?.firestore) return load()
  if (!configPending) {
    configPending = load()
      .then((config) => {
        configCache = { at: now, config }
        return config
      })
      .finally(() => {
        configPending = undefined
      })
  }
  return configPending
}

export interface ConsumeEmailSendBudgetOptions {
  priority: EmailSendPriority
  /** Messages this send would add. */
  count: number
  now?: number
  firestore?: any
  /** Injectable for tests; otherwise read (and cached) from Firestore. */
  config?: EmailSendRateConfig
}

export interface ConsumeEmailSendBudgetResult extends EmailSendRateVerdict {
  windowStartMs: number
  /** True when the counter was unreachable and this failed open. */
  degraded: boolean
}

/**
 * Counts `count` messages against the current hour, globally, and answers
 * whether they may go.
 *
 * The transaction reads the counter and writes an ABSOLUTE value derived from
 * that read — not `FieldValue.increment` — because the read is the authority
 * for the decision. Firestore aborts and re-runs the callback when a
 * document it read has moved, so two concurrent sweeps cannot both see the
 * same headroom and both take it. An increment would be atomic on the number
 * and useless for the decision, which is exactly the read-then-write shape
 * AGL-2267 is about one surface over.
 *
 * A refused send writes NOTHING. A caller that will retry next hour must not
 * have spent budget on being told no.
 */
export async function consumeEmailSendBudget(
  options: ConsumeEmailSendBudgetOptions,
): Promise<ConsumeEmailSendBudgetResult> {
  const now = options.now ?? Date.now()
  const windowStartMs = emailSendRateWindowStartMs(now)
  const resetMs = windowStartMs + EMAIL_SEND_RATE_WINDOW_MS
  const config =
    options.config ??
    (await readEmailSendRateConfig({ firestore: options.firestore, now }))

  const fallback = (): ConsumeEmailSendBudgetResult => ({
    ...emailSendRateVerdict({
      priority: options.priority,
      used: 0,
      count: options.count,
      ceiling: config.perHour,
      enabled: false,
      windowStartMs,
    }),
    windowStartMs,
    degraded: true,
  })

  try {
    const firestore = options.firestore ?? firebaseAdmin.app().firestore()
    const ref = firestore
      .collection(RATE_LIMIT_COLLECTION)
      .doc(emailSendRateWindowDocId(windowStartMs))

    const verdict = await firestore.runTransaction(async (tx: any) => {
      const snapshot = await tx.get(ref)
      const used = Number((snapshot.exists ? snapshot.get('count') : 0) ?? 0)
      const decision = emailSendRateVerdict({
        priority: options.priority,
        used,
        count: options.count,
        ceiling: config.perHour,
        enabled: config.enabled,
        windowStartMs,
      })
      if (!decision.allowed) return decision
      tx.set(
        ref,
        {
          count: decision.used + Math.max(0, Math.floor(Number(options.count) || 0)),
          windowStartMs,
          // NOT `lastAtMs` — see the storage note at the top of this file.
          sentAtMs: now,
          // The TTL field the counters in this collection already use. Two
          // windows of retention so the console can show the hour just gone.
          expiresAt: new Date(resetMs + EMAIL_SEND_RATE_WINDOW_MS),
        },
        { merge: true },
      )
      return decision
    })

    return { ...(verdict as EmailSendRateVerdict), windowStartMs, degraded: false }
  } catch (error) {
    console.error('[send-rate] counter unavailable — allowing', error)
    return fallback()
  }
}

/**
 * What the current hour looks like. Read-only, for the staff console.
 *
 * Returns `used: 0` rather than throwing when the window document does not
 * exist, which is the ordinary state of a quiet hour.
 */
export async function readEmailSendRateWindow(options?: {
  firestore?: any
  now?: number
}): Promise<{ windowStartMs: number; resetMs: number; used: number }> {
  const now = options?.now ?? Date.now()
  const windowStartMs = emailSendRateWindowStartMs(now)
  const resetMs = windowStartMs + EMAIL_SEND_RATE_WINDOW_MS
  try {
    const firestore = options?.firestore ?? firebaseAdmin.app().firestore()
    const snapshot = await firestore
      .collection(RATE_LIMIT_COLLECTION)
      .doc(emailSendRateWindowDocId(windowStartMs))
      .get()
    const used = Number((snapshot.exists ? snapshot.get('count') : 0) ?? 0)
    return {
      windowStartMs,
      resetMs,
      used: Number.isFinite(used) && used > 0 ? Math.floor(used) : 0,
    }
  } catch {
    return { windowStartMs, resetMs, used: 0 }
  }
}

/** Id prefix for the per-org, per-hour campaign counters. */
export const EMAIL_ORG_SEND_RATE_WINDOW_PREFIX = 'sendRateOrg_'

/**
 * The per-org counter document id for a window.
 *
 * A separate document per org rather than a map field on the platform window,
 * so two orgs sending in the same hour contend on their own documents instead
 * of serialising on one. The platform window is already a single hot document
 * and adding N org fields to it would make every campaign in the hour a write
 * conflict with every other.
 */
export function emailOrgSendRateWindowDocId(
  windowStartMs: number,
  orgId: string,
): string {
  return `${EMAIL_ORG_SEND_RATE_WINDOW_PREFIX}${windowStartMs}_${orgId}`
}

/** The current hour for one org. Read-only, for a usage surface. */
export async function readOrgEmailSendWindow(options: {
  orgId: string
  firestore?: any
  now?: number
}): Promise<{ windowStartMs: number; resetMs: number; used: number }> {
  const now = options.now ?? Date.now()
  const windowStartMs = emailSendRateWindowStartMs(now)
  const resetMs = windowStartMs + EMAIL_SEND_RATE_WINDOW_MS
  if (!options.orgId) return { windowStartMs, resetMs, used: 0 }
  try {
    const firestore = options.firestore ?? firebaseAdmin.app().firestore()
    const snapshot = await firestore
      .collection(RATE_LIMIT_COLLECTION)
      .doc(emailOrgSendRateWindowDocId(windowStartMs, options.orgId))
      .get()
    const used = Number((snapshot.exists ? snapshot.get('count') : 0) ?? 0)
    return {
      windowStartMs,
      resetMs,
      used: Number.isFinite(used) && used > 0 ? Math.floor(used) : 0,
    }
  } catch {
    return { windowStartMs, resetMs, used: 0 }
  }
}

/** The answer to a per-org hourly claim. Every field is a stated number. */
export interface OrgEmailSendClaimResult {
  allowed: boolean
  /** Count in this org's window BEFORE this send. */
  used: number
  /** What this org may send in an hour. */
  ceiling: number
  /** Headroom after this send, floored at 0. */
  remaining: number
  /** When the window rolls and a deferred campaign may go. */
  retryAtMs: number
  /** True when the counter was unreachable and this failed open. */
  degraded: boolean
}

/**
 * THE PER-ORG SHARE OF THE PLATFORM HOUR.
 *
 * The platform governor bounds total volume; it does not bound how much of
 * that total ONE tenant may take. Without this, a single org with a large
 * audience occupies the whole hour and every other customer's campaigns are
 * refused by a ceiling they did nothing to reach — one tenant denying service
 * to the rest, on a limit they cannot see.
 *
 * The ceiling is derived, not configured: `orgHourlyCampaignCeiling` is a
 * share of whatever the live platform ceiling currently is, so a staff ramp
 * moves both together and the two can never drift into contradiction. See
 * `send-ceilings.ts` for the arithmetic and the relations it maintains.
 *
 * **Campaigns only.** This function is not on `sendEmail`'s path and is called
 * from the campaign sender alone. A transactional message can never reach it,
 * which is the same boundary `emailSendRateVerdict` enforces one layer down
 * and for the same reason: a password reset refused by a throttle converts a
 * reputation risk into an outage on somebody else's business.
 *
 * ## Fails OPEN
 *
 * An unreachable counter grants the send, matching `consumeEmailSendBudget`.
 * A refusal produced by a Firestore blip is a refused campaign for a paying
 * customer, and the hour of pacing it buys back is not worth it.
 *
 * ## Claimed, not reconciled
 *
 * The claim is taken for the whole batch and never refunded, unlike the
 * monthly reservation. The window is one hour and TTL-swept, so an
 * undelivered remainder costs the org the rest of that hour and nothing
 * after it — where an unreconciled MONTHLY claim would cost the rest of the
 * month, which is why that one is reconciled and this one is not. The error
 * is in the direction that can only ever pace mail more, never let more out.
 */
export async function claimOrgEmailSendBudget(options: {
  orgId: string
  /** Messages this campaign would send. */
  count: number
  /** The live platform ceiling; the org share is derived from it. */
  platformPerHour: number
  /** False parks the control, exactly as the platform governor's flag does. */
  enabled?: boolean
  now?: number
  firestore?: any
}): Promise<OrgEmailSendClaimResult> {
  const now = options.now ?? Date.now()
  const windowStartMs = emailSendRateWindowStartMs(now)
  const retryAtMs = windowStartMs + EMAIL_SEND_RATE_WINDOW_MS
  const ceiling = orgHourlyCampaignCeiling(options.platformPerHour)
  const count = Math.max(0, Math.floor(Number(options.count) || 0))

  const granted = (used: number, degraded: boolean): OrgEmailSendClaimResult => ({
    allowed: true,
    used,
    ceiling,
    remaining: Math.max(0, ceiling - (used + count)),
    retryAtMs,
    degraded,
  })

  // A parked control still reports the ceiling, so a surface reading this
  // shows a real number rather than blanking while the control is off.
  if (options.enabled === false) return granted(0, false)
  // No org means the counter has nowhere to live. The monthly reservation
  // refuses in this case because an unattributable campaign must not send
  // unbounded; here the monthly claim has already made that decision, so
  // failing open costs nothing it has not already been charged for.
  if (!options.orgId) return granted(0, true)

  try {
    const firestore = options.firestore ?? firebaseAdmin.app().firestore()
    const ref = firestore
      .collection(RATE_LIMIT_COLLECTION)
      .doc(emailOrgSendRateWindowDocId(windowStartMs, options.orgId))

    return await firestore.runTransaction(async (tx: any) => {
      const snapshot = await tx.get(ref)
      const rawUsed = Number((snapshot.exists ? snapshot.get('count') : 0) ?? 0)
      // A corrupt or negative counter must not read as headroom.
      const used =
        Number.isFinite(rawUsed) && rawUsed > 0 ? Math.floor(rawUsed) : 0
      if (used + count > ceiling) {
        // A refused claim writes NOTHING. A campaign that will be retried
        // next hour must not have spent budget on being told no.
        return {
          allowed: false,
          used,
          ceiling,
          remaining: Math.max(0, ceiling - used),
          retryAtMs,
          degraded: false,
        }
      }
      // An absolute write from this transaction's own read, not
      // `FieldValue.increment` — the read is the authority for the decision,
      // and an increment would be atomic on the number while proving nothing
      // about the value the decision was made from.
      tx.set(
        ref,
        {
          count: used + count,
          windowStartMs,
          orgId: options.orgId,
          // NOT `lastAtMs` — the rate-limiter health probe queries this
          // collection on that field and a per-hour document in its range
          // would compete with the markers it exists to find.
          sentAtMs: now,
          expiresAt: new Date(retryAtMs + EMAIL_SEND_RATE_WINDOW_MS),
        },
        { merge: true },
      )
      return granted(used, false)
    })
  } catch (error) {
    console.error('[send-rate] org window unavailable — allowing', error)
    return granted(0, true)
  }
}

/**
 * The document the console writes when staff move the ramp.
 *
 * Returned rather than written so the route owns the write (and the audit row
 * beside it), and so a spec can assert the SHAPE without a Firestore. The one
 * thing it must never contain is `expiresAt`.
 */
export function emailSendRateConfigWrite(input: {
  perHour: number
  enabled: boolean
  actorEmail?: string | null
  note?: string
  now?: number
}): Partial<EmailSendRateConfig> {
  const normalized = normalizeEmailSendRateConfig({
    perHour: input.perHour,
    enabled: input.enabled,
    note: input.note,
    updatedAtMs: input.now ?? Date.now(),
    updatedByEmail: input.actorEmail ?? null,
  })
  return {
    perHour: normalized.perHour,
    enabled: normalized.enabled,
    note: normalized.note,
    updatedAtMs: normalized.updatedAtMs,
    updatedByEmail: normalized.updatedByEmail,
  }
}

/**
 * Puts the durable governor on `sendEmail`'s path.
 *
 * **Called at module load**, from the bottom of this file, so that importing
 * `@aglyn/tenant-data-admin` anywhere is enough — every server surface in the
 * product already imports that barrel, and `export *` forces this module to
 * evaluate. The alternative, an `installEmailSendGovernor()` call at each
 * server entrypoint, is the 37-places-to-remember shape this codebase already
 * rejected once for the `context` tag.
 *
 * Idempotent: installing twice replaces the same closure with an equivalent
 * one, and the closure holds no state — the state is the Firestore document.
 */
export function installEmailSendGovernor(): void {
  setEmailSendGovernor(
    async (
      request: EmailSendGovernorRequest,
    ): Promise<EmailSendGovernorVerdict> => {
      const result = await consumeEmailSendBudget({
        priority: request.priority,
        count: request.count,
      })
      return {
        allowed: result.allowed,
        ceiling: result.ceiling,
        used: result.used,
        remaining: result.remaining,
        retryAtMs: result.retryAtMs,
        degraded: result.degraded,
      }
    },
  )
}

installEmailSendGovernor()
