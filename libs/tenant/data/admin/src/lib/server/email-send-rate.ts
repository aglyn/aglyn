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
