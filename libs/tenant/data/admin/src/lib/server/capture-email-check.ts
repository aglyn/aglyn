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
 * THE DELIVERABILITY CHECK AT CAPTURE (AGL-3328).
 *
 * A person arrives — a form, an import, the New lead drawer, `POST
 * /v1/contacts`, a list add — and the address they gave is looked at
 * before anybody writes to it: the domain's MX, from the platform cache
 * `email-deliverability.ts` keeps. A domain that takes no mail (no MX, or
 * RFC 7505's null MX) puts `undeliverable` — "Would bounce" — on every
 * record the address is, through the core's record email-state seam, so the
 * record a person opens says so and the lists' `emailStatus` filter finds
 * it.
 *
 * ## Never on the write's time
 *
 * The writers that call this — `addHostLead`, `upsertHostContact`,
 * `enrollListMember`, the API's contact create — have finished their own
 * write when they do, and they do not wait: {@link scheduleCapturedEmailCheck}
 * queues the address and runs the queue in `after()`, once the response
 * has gone. One flush per invocation, however many rows an import wrote,
 * so a file of five hundred people from forty domains asks forty domains.
 *
 * `after()` rather than a bare promise (AGL-2327): a serverless invocation
 * is frozen the moment its response is sent, and work scheduled any other
 * way does not run. Outside a request — a script, a spec — there is nothing
 * to defer to, and nothing is checked; the backfill covers what those
 * write.
 *
 * ## The check's own verdict, and only that, is taken back
 *
 * `undeliverable` is the weakest refusal (`email-state.ts`): any real bounce
 * or block replaces it. The check withdraws it when the domain takes mail
 * again — a typo'd domain somebody since registered, a company that set up
 * its mail — and only when the record's standing verdict is that one; a
 * bounce is never cleared by DNS. A writer that knows the record held it
 * says so (`predicted`), which is what lets every other capture skip the
 * read a withdrawal costs.
 *==========================================*/

import type { EmailState } from '@aglyn/aglyn/app-utils/email-state'
import { isPublicMailboxDomain } from '@aglyn/aglyn/app-utils/crm'
import { stampRecordEmailState } from '@aglyn/aglyn/plugin-manager/plugin-record-email-state'
import {
  bareSenderAddress,
  decidingDeliverabilityFinding,
  type EmailDeliverabilityCode,
  type EmailDeliverabilityVerdict,
  type MailGateway,
  type MailGatewayChip,
  mailDomainRefusesMail,
  mailGatewayChip,
  mailGatewayStanding,
  normalizeDeliverabilityEmail,
} from '@aglyn/shared-util-email'
import {
  isGatewayHeldVerdict,
  isNoMailServerVerdict,
  type MailDeliverabilityDeps,
  readMailDeliverability,
} from './email-deliverability'

/** One captured address, and whose records it lands on. */
export interface CapturedEmail {
  /** The organization whose records carry it; or `hostId`, which the writer reads the organization off. */
  orgId?: string | null
  hostId?: string | null
  email: string
  /**
   * The record already holds the check's own `undeliverable` verdict: a
   * domain that answers now withdraws it, and one that still takes no mail
   * writes nothing again.
   */
  predicted?: boolean
}

/** What one run of the check did. */
export interface CapturedEmailCheckReport {
  /** Addresses whose domain was answered for. */
  checked: number
  /** Addresses whose domain takes no mail. */
  undeliverable: number
  /** Records the seam moved to "Would bounce". */
  stamped: number
  /** Records whose "Would bounce" was withdrawn. */
  withdrawn: number
}

/**
 * How long an import waits, past its last write, for its addresses' mail
 * servers before it answers without the count (see `settleWithin`).
 */
export const IMPORT_MAIL_CHECK_GRACE_MS = 5_000

/** The seam's writes in flight at once. */
const STAMP_CONCURRENCY = 8

/** Addresses one invocation may hold for its flush; past it, the backfill catches up. */
const QUEUE_MAX = 20_000

/** Runs `work` over `items`, at most `limit` at a time. */
async function eachLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      await work(item)
    }
  })
  await Promise.all(runners)
}

/**
 * The detail a "Would bounce" carries. A missing mail server is what the
 * chip already says; a null MX is the domain saying it outright, which is
 * worth the words.
 */
function undeliverableDetail(verdict: EmailDeliverabilityVerdict): string | null {
  return verdict.intel?.status === 'null_mx'
    ? `${verdict.domain} publishes a null MX record: it says it accepts no email.`
    : null
}

/** The address a verdict answers for, as the seam keys it. */
function stampTarget(item: CapturedEmail): { orgId?: string; hostId?: string } | null {
  const orgId = String(item.orgId ?? '').trim()
  if (orgId) return { orgId }
  const hostId = String(item.hostId ?? '').trim()
  return hostId ? { hostId } : null
}

/**
 * Checks the addresses and writes what was found onto their records: "Would
 * bounce" for a domain that takes no mail, the withdrawal of a standing
 * "Would bounce" for one that does again. Never throws — the capture has
 * already happened, and a record left unstamped is what the backfill is for.
 */
export async function checkCapturedEmails(
  items: readonly CapturedEmail[],
  deps: MailDeliverabilityDeps = {},
): Promise<CapturedEmailCheckReport> {
  const report: CapturedEmailCheckReport = { checked: 0, undeliverable: 0, stamped: 0, withdrawn: 0 }
  // One entry per record set: the same address captured twice for one
  // organization in one flush is asked about once, and a `predicted` on
  // either capture stands.
  const unique = new Map<string, CapturedEmail & { email: string }>()
  for (const item of items) {
    const email = normalizeDeliverabilityEmail(item?.email)
    const target = item ? stampTarget(item) : null
    if (!email || !target) continue
    const key = `${target.orgId ?? `host:${target.hostId}`}|${email}`
    const held = unique.get(key)
    unique.set(key, { ...target, email, predicted: Boolean(held?.predicted || item.predicted) })
  }
  if (!unique.size) return report

  const nowMs = deps.nowMs ?? Date.now()
  let verdicts: Map<string, EmailDeliverabilityVerdict>
  try {
    verdicts = await readMailDeliverability(
      {
        emails: [...new Set([...unique.values()].map((item) => item.email))],
        purpose: 'bulk',
        sendingDomain: null,
        scope: null,
      },
      { ...deps, nowMs },
    )
  } catch (error) {
    console.error('[deliverability] captured addresses could not be checked', error)
    return report
  }

  const writes: Array<() => Promise<void>> = []
  for (const item of unique.values()) {
    const verdict = verdicts.get(item.email)
    if (!verdict || verdict.outcome === 'unchecked') continue
    report.checked += 1
    const target = { ...(item.orgId ? { orgId: item.orgId } : { hostId: item.hostId ?? '' }) }
    if (isNoMailServerVerdict(verdict)) {
      report.undeliverable += 1
      if (item.predicted) continue
      const state: EmailState = {
        status: 'undeliverable',
        atMs: nowMs,
        source: 'check',
        detail: undeliverableDetail(verdict),
      }
      writes.push(async () => {
        const stamped = await stampRecordEmailState({ ...target, email: item.email, state })
        report.stamped += stamped?.records ?? 0
      })
    } else if (item.predicted && verdict.intel && !mailDomainRefusesMail(verdict.intel.status)) {
      const state: EmailState = { status: 'undeliverable', atMs: nowMs, source: 'check', detail: null }
      writes.push(async () => {
        const withdrawn = await stampRecordEmailState({ ...target, email: item.email, state, withdraw: true })
        report.withdrawn += withdrawn?.records ?? 0
      })
    }
  }
  await eachLimited(writes, STAMP_CONCURRENCY, (write) => write())
  return report
}

/*==========================================
 * THE QUEUE, FLUSHED AFTER THE RESPONSE
 *==========================================*/

const queued: CapturedEmail[] = []
let flushScheduled = false

type AfterResponse = (task: () => Promise<void>) => void

/**
 * Next's `after()`, required when first asked for rather than imported:
 * `next/server` evaluates web `Request` classes at load, which a jsdom spec
 * reaching one of the writers cannot, and this module rides every writer's
 * import. `null` where it cannot be loaded.
 */
function afterResponse(): AfterResponse | null {
  try {
    const loaded = require('next/server') as { after?: AfterResponse }
    return typeof loaded?.after === 'function' ? loaded.after : null
  } catch {
    return null
  }
}

/** Runs whatever is queued. Exported for the spec; production reaches it through `after()`. */
export async function flushCapturedEmailChecks(deps: MailDeliverabilityDeps = {}): Promise<CapturedEmailCheckReport> {
  flushScheduled = false
  const batch = queued.splice(0)
  if (!batch.length) return { checked: 0, undeliverable: 0, stamped: 0, withdrawn: 0 }
  return checkCapturedEmails(batch, deps)
}

/**
 * Queues one captured address for the check, which runs once the response
 * has been sent — see the module note. Returns at once, never throws, and
 * costs the caller nothing but the push.
 */
export function scheduleCapturedEmailCheck(item: CapturedEmail): void {
  try {
    if (!item || !normalizeDeliverabilityEmail(item.email) || !stampTarget(item)) return
    if (queued.length >= QUEUE_MAX) return
    queued.push({ ...item })
    if (flushScheduled) return
    try {
      const after = afterResponse()
      if (!after) throw new Error('no request to run after')
      after(() => flushCapturedEmailChecks().then(() => undefined))
      flushScheduled = true
    } catch {
      // No request to run after: a script or a spec. Nothing is checked.
      queued.length = 0
    }
  } catch (error) {
    console.error('[deliverability] a captured address could not be queued', error)
  }
}

/** Test seam: drop anything queued. */
export function resetCapturedEmailChecksForTests(): void {
  queued.length = 0
  flushScheduled = false
}

/** What is queued, for the spec. */
export function queuedCapturedEmailsForTests(): readonly CapturedEmail[] {
  return queued
}

/*==========================================
 * WHAT AN IMPORT REPORTS
 *==========================================*/

/**
 * Which of these addresses (normalized) have a domain that takes no mail,
 * from the same cache the check writes — what an import's result counts.
 * Never rejects: `null` when the answer could not be had, and the import
 * says nothing rather than something untrue.
 */
export async function findUndeliverableEmails(
  emails: readonly string[],
  deps: MailDeliverabilityDeps = {},
): Promise<Set<string> | null> {
  const wanted = [
    ...new Set(emails.map((email) => normalizeDeliverabilityEmail(email)).filter((email): email is string => Boolean(email))),
  ]
  if (!wanted.length) return new Set()
  try {
    const verdicts = await readMailDeliverability(
      { emails: wanted, purpose: 'bulk', sendingDomain: null, scope: null },
      deps,
    )
    const found = new Set<string>()
    for (const [email, verdict] of verdicts) if (isNoMailServerVerdict(verdict)) found.add(email)
    return found
  } catch (error) {
    console.error('[deliverability] an import’s addresses could not be checked', error)
    return null
  }
}

/**
 * `promise`'s answer, or `null` when it has not arrived within `ms`. An
 * import starts its lookups with its first row and waits this long past its
 * last write for them; a slower answer still stamps the records, through the
 * check the writes queued, and only the count is left unsaid.
 */
export async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, ms))
  })
  try {
    return await Promise.race([promise, late])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** How many of `emails` a {@link findUndeliverableEmails} answer names; `undefined` without an answer. */
export function countUndeliverableEmails(
  emails: readonly string[],
  undeliverable: ReadonlySet<string> | null,
): number | undefined {
  if (!undeliverable) return undefined
  let count = 0
  for (const email of new Set(emails.map((entry) => normalizeDeliverabilityEmail(entry)))) {
    if (email && undeliverable.has(email)) count += 1
  }
  return count
}

/*==========================================
 * ONE ADDRESS, AS A RECORD PAGE AND A COMPOSER READ IT
 *==========================================*/

/** What a surface shows for one address before somebody writes to it. */
export interface AddressDeliverability {
  /** The address, normalized; `null` when it is not one. */
  email: string | null
  /** Whether the domain's MX was read; `false` means nothing is known, and nothing is warned. */
  checked: boolean
  /** The finding a composer warns with — a domain with no mail server, or a gateway holding this sender. */
  code: Extract<EmailDeliverabilityCode, 'no_mx' | 'null_mx' | 'gateway_held'> | null
  /** That finding in a sentence, as the engine words it. */
  message: string | null
  /** The gateway in front of the address, when its MX names one. */
  gateway: MailGateway | null
  /** The chip beside the address: the gateway, and what it did with this sender's mail this week. */
  chip: MailGatewayChip | null
}

/**
 * One address's standing for the site mail would leave from: the platform
 * MX cache (looked up, server side, when cold) and the sending domain's
 * gateway ledger. Read, never written onto a record — a composer asks it
 * before a send and a record page before it draws the address. `from` is
 * the sending identity's address; without one, no ledger is read and
 * nothing is held.
 */
export async function readAddressDeliverability(
  input: { email: string; from?: string | null },
  deps: MailDeliverabilityDeps = {},
): Promise<AddressDeliverability> {
  const email = normalizeDeliverabilityEmail(input.email)
  const none: AddressDeliverability = { email, checked: false, code: null, message: null, gateway: null, chip: null }
  if (!email) return none
  const sender = bareSenderAddress(input.from ?? null)
  const sendingDomain = sender ? sender.slice(sender.lastIndexOf('@') + 1) : null
  const nowMs = deps.nowMs ?? Date.now()
  let verdict: EmailDeliverabilityVerdict | undefined
  try {
    verdict = (
      await readMailDeliverability(
        { emails: [email], purpose: 'bulk', sendingDomain, scope: null },
        { ...deps, nowMs },
      )
    ).get(email)
  } catch (error) {
    console.error('[deliverability] an address could not be checked', error)
    return none
  }
  if (!verdict?.intel) return none
  const deciding = decidingDeliverabilityFinding(verdict)
  const warns = isNoMailServerVerdict(verdict) || isGatewayHeldVerdict(verdict)
  const standing = verdict.gateway ?? mailGatewayStanding(verdict.intel.gateway, null, nowMs)
  let chip = mailGatewayChip(standing)
  // A public mailbox provider's MX is the provider's, not a gateway the
  // person's company chose: "Google Workspace" beside a gmail.com address
  // says something untrue. It keeps a chip only for a verdict this week.
  if (chip?.tone === 'neutral' && isPublicMailboxDomain(verdict.domain)) chip = null
  return {
    email,
    checked: true,
    code: warns && deciding ? (deciding.code as AddressDeliverability['code']) : null,
    message: warns && deciding ? deciding.message : null,
    gateway: verdict.intel.gateway === 'none' ? null : verdict.intel.gateway,
    chip,
  }
}
