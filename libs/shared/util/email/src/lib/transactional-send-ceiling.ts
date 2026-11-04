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

/*==========================================
 * THE DAILY TRANSACTIONAL CEILING ON THE SEND SEAM (AGL-4145).
 *
 * Campaign mail has a monthly band and a site's one-to-one mail has a daily
 * pace. Everything else a site sends — receipts, order and shipping notices,
 * booking mail, abandoned-cart and review asks, dunning, workflow steps,
 * member posts — had neither, so one workspace could put an unbounded number
 * of messages on the provider at the platform's expense. This is the bound:
 * a per-ORGANIZATION count of those messages per UTC day, refused past a
 * ceiling sized so that no real store reaches it.
 *
 * It is an ABUSE control, not something a plan sells: nothing customer-facing
 * names it, and the figure is a containment line far above any real store's
 * day. A refusal is an incident staff hear about, not a quota a merchant is
 * shown.
 *
 * ## Split the way every other control on this path is
 *
 * The DECISION about which messages the ceiling governs is pure and lives
 * here ({@link transactionalCeilingSubject}). The COUNT is a store, so it is
 * injected by `@aglyn/tenant-data-admin` through
 * {@link setTransactionalSendCeilingGate}, which claims against
 * `orgs/{orgId}/counters/transactionalEmailSends` inside a transaction and
 * records a refusal where staff see it. Nothing installed is UNGATED, the
 * governor's posture: a deployment that never installs the store still sends.
 *
 * ## What it never touches
 *
 *  - SECURITY MAIL. A password reset, a sign-in or recovery link, an
 *    invitation, a lock notice: the message that lets somebody back into
 *    their own account is never counted and never refused, because a
 *    workspace at its ceiling is exactly the one whose owners may need it.
 *    The seam decides that BEFORE the gate is asked, so a wrong gate cannot
 *    refuse one.
 *  - CAMPAIGNS. They have their own monthly band and their own atomic claim.
 *  - PLATFORM MAIL. Aglyn's own account, billing and staff mail carries no
 *    workspace and is not any one customer's volume.
 *
 * ## How a refusal reads to a caller
 *
 * As `rate-limited` with `retryAtMs` at the next UTC midnight. The ceiling is
 * a RATE — the message is intact and tomorrow it sends — so a resumable sweep
 * defers it exactly as it defers an hourly governor refusal, with no new
 * vocabulary for a sweep built against the old one to misread as terminal.
 *=========================================*/

import type { SendingWorkspace } from './outbound-screen-gate'
import type { EmailSendPriority } from './send-rate'

/** One message's claim on its organization's day, as the gate takes it. */
export interface TransactionalSendCeilingRequest {
  orgId: string
  hostId: string | null
  /** Messages this send would add: the visible recipients plus blind copies. */
  count: number
  /** The organization's ceiling for the UTC day, as its workspace was stamped. */
  ceiling: number
  /** The sender's `context`, so a refusal names the feature that hit it. */
  context: string | null
  /** The instant the claim is taken; the gate keys the UTC day off it. */
  nowMs: number
}

/** What a granted claim took, so the seam can hand it back. */
export interface TransactionalSendCeilingClaim {
  orgId: string
  /** The UTC day the claim was counted on, `YYYY-MM-DD`. */
  dayKey: string
  count: number
}

export interface TransactionalSendCeilingVerdict {
  allowed: boolean
  ceiling?: number
  /** Messages already counted on the day before this one asked. */
  used?: number
  /** Refused only: the next UTC midnight, when the day's count starts again. */
  retryAtMs?: number
  /** Allowed only: the claim to release when the message does not leave. */
  claim?: TransactionalSendCeilingClaim | null
}

/** The durable half, installed once by `@aglyn/tenant-data-admin`. */
export interface TransactionalSendCeilingGate {
  claim(request: TransactionalSendCeilingRequest): Promise<TransactionalSendCeilingVerdict>
  /**
   * Gives back a claim whose message did not leave — the governor deferred
   * it, the provider refused it, the network failed. Without it a bulk sweep
   * deferred hourly during a busy platform hour would spend its whole day's
   * ceiling on retries of the same backlog. Never throws.
   */
  release(claim: TransactionalSendCeilingClaim): Promise<void>
  /**
   * Records a refusal where staff see it. Asked by the seam AFTER the claim
   * answered, outside the claim's time budget, so slow bookkeeping can never
   * turn a refusal into a send. Never throws.
   */
  refused?(
    request: TransactionalSendCeilingRequest,
    verdict: TransactionalSendCeilingVerdict,
  ): Promise<void>
}

let installedGate: TransactionalSendCeilingGate | null = null

/** Installs the durable gate. Called once, from `@aglyn/tenant-data-admin`. */
export function setTransactionalSendCeilingGate(
  gate: TransactionalSendCeilingGate | null,
): void {
  installedGate = gate
}

/** The installed gate, or null when nothing has been installed. */
export function getTransactionalSendCeilingGate(): TransactionalSendCeilingGate | null {
  return installedGate
}

/** Test seam: forget any installed gate. */
export function resetTransactionalSendCeilingGateForTests(): void {
  installedGate = null
}

/**
 * How long the seam waits for the gate before sending anyway. The same
 * figure the deliverability preflight waits, for the same reason: a slow
 * counter is an outage on the control, and it must not become a slow
 * checkout.
 */
export const TRANSACTIONAL_SEND_CEILING_TIMEOUT_MS = 2_500

/**
 * Contexts that are security mail whatever else they declare. Most security
 * mail is the platform's own and carries no workspace, so it never reaches
 * the ceiling anyway; these are named so that one which ever does is still
 * exempt. A site's own account mail declares `owedFor: 'account'`, which is
 * the exemption that covers it.
 */
export const TRANSACTIONAL_CEILING_EXEMPT_CONTEXTS: ReadonlySet<string> = new Set([
  'password-reset',
  'admin-password-reset',
  'password-changed-by-admin',
  'email-verification',
  'invite',
  'security-new-device',
  'security-passkey-added',
  'risk-notice',
])

/** Is this message security mail the ceiling never counts or refuses? */
export function isTransactionalCeilingExempt(input: {
  context?: string | null
  owedFor?: string | null
  accountBanExempt?: boolean | null
}): boolean {
  if (input.owedFor === 'account') return true
  if (input.accountBanExempt) return true
  return TRANSACTIONAL_CEILING_EXEMPT_CONTEXTS.has(String(input.context ?? '').trim())
}

/** Who the ceiling counts a message against, when it counts it at all. */
export interface TransactionalCeilingSubject {
  orgId: string
  hostId: string | null
  /** A finite, non-negative whole number. `0` refuses every governed message. */
  ceiling: number
}

/**
 * Whether the daily ceiling governs this message, and against whose day.
 * `null` when it does not.
 *
 * Governed: a SITE's message (tenant audience, a workspace stamped on its
 * identity by `hostSendingIdentity`) of any priority but `campaign`, that is
 * not security mail, from an organization whose ceiling is finite.
 *
 * `strictNullChecks` is off repo-wide, so the stamped ceiling is normalised
 * rather than trusted, and the two failure directions are deliberately
 * different: a ceiling that is absent or not a number means the workspace
 * was resolved without its organization — no ceiling is known, and none is
 * applied — while `Infinity` is the unlimited figure and needs no count.
 */
export function transactionalCeilingSubject(input: {
  audience?: string | null
  workspace?: SendingWorkspace | null
  priority: EmailSendPriority
  context?: string | null
  owedFor?: string | null
  accountBanExempt?: boolean | null
}): TransactionalCeilingSubject | null {
  if (input.audience !== 'tenant') return null
  const workspace = input.workspace
  const orgId = String(workspace?.orgId ?? '').trim()
  if (!orgId) return null
  if (input.priority === 'campaign') return null
  if (isTransactionalCeilingExempt(input)) return null
  const raw = workspace?.transactionalEmailsPerDay
  if (typeof raw !== 'number' || Number.isNaN(raw)) return null
  if (raw === Number.POSITIVE_INFINITY) return null
  return {
    orgId,
    hostId: String(workspace?.hostId ?? '').trim() || null,
    ceiling: Math.max(0, Math.floor(raw)),
  }
}

/** The UTC day a claim is counted on, `YYYY-MM-DD`. */
export function transactionalCeilingDayKey(nowMs: number = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}

/** The next UTC midnight after `nowMs` — when a refused organization sends again. */
export function transactionalCeilingResetMs(nowMs: number = Date.now()): number {
  const now = new Date(nowMs)
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
}

/**
 * Asks the installed gate, fail-open: `null` (send) when nothing is
 * installed, the gate throws, or it does not answer in time. Only an
 * explicit refusal stops the message.
 */
export async function askTransactionalSendCeiling(
  request: TransactionalSendCeilingRequest,
  label = 'email',
): Promise<TransactionalSendCeilingVerdict | null> {
  const gate = getTransactionalSendCeilingGate()
  if (!gate) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      gate.claim(request),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`${label} transactional ceiling timed out — allowing`)
          resolve(null)
        }, TRANSACTIONAL_SEND_CEILING_TIMEOUT_MS)
        ;(timer as { unref?: () => void })?.unref?.()
      }),
    ])
  } catch (error) {
    console.error(`${label} transactional ceiling failed — allowing`, error)
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Tells the installed gate a message was refused, for its record. Never throws. */
export async function reportTransactionalSendCeilingRefusal(
  request: TransactionalSendCeilingRequest,
  verdict: TransactionalSendCeilingVerdict,
  label = 'email',
): Promise<void> {
  const gate = getTransactionalSendCeilingGate()
  if (!gate?.refused) return
  try {
    await gate.refused(request, verdict)
  } catch (error) {
    console.error(`${label} transactional ceiling refusal record failed`, error)
  }
}

/** Hands a claim back to the installed gate. Never throws. */
export async function releaseTransactionalSendCeilingClaim(
  claim: TransactionalSendCeilingClaim | null | undefined,
  label = 'email',
): Promise<void> {
  if (!claim?.orgId || !(claim.count > 0)) return
  const gate = getTransactionalSendCeilingGate()
  if (!gate) return
  try {
    await gate.release(claim)
  } catch (error) {
    console.error(`${label} transactional ceiling release failed`, error)
  }
}
