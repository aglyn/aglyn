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

import type {
  PluginPersonChangesPage,
  PluginPersonChangesRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import {
  EVENT_MAX_AGE_MS,
  EVENTS_PER_RUN,
  MARKETING_PLATFORMS_PLUGIN_ID,
  SYNC_BACKOFF_BASE_MS,
  SYNC_BACKOFF_MAX_MS,
  SYNC_CONNECTIONS_PER_TICK,
  SYNC_INTERVAL_MS,
  SYNC_LEASE_MS,
  SYNC_MAX_CONSECUTIVE_FAILURES,
  SYNC_MAX_PAGES_PER_RUN,
  SYNC_PAGE_SIZE,
} from '../constants'
import { MARKETING_PROVIDERS, type MarketingProviderId } from '../model/connections'
import { isProviderError, ProviderError } from '../providers/http'
import {
  splitName,
  type MarketingProvider,
  type ProviderContact,
  type ProviderCredential,
} from '../providers/provider'
import type { ConnectionStore, StoredConnection } from './store'

/**
 * ONE CONNECTION'S SYNC (AGL-3639): what a run does, in the order it does it,
 * and what it leaves behind for the next.
 *
 * ## The order is the loop guard
 *
 * 1. **Read back first.** Consent changes made at the provider since its
 *    cursor are applied to the site: an unsubscribe there is filed as the
 *    site's own unsubscribe, marked `via` this connection — unless the site
 *    already answers "unsubscribed" for the person, in which case it is the
 *    echo of what this connection sent; a return there lifts only a row this
 *    connection filed. Reading first means a person
 *    who just left over there is suppressed before the push below could
 *    describe them as subscribed.
 * 2. **People out.** The people the site holds that changed since the
 *    contacts cursor — the whole set on the first run, which is the
 *    backfill — each with the status the site's own sends would give them.
 *    A person with no basis the site may use is left out, not added.
 * 3. **Refusals out.** The site's suppression rows written since that
 *    cursor, as unsubscribes — except a row whose `via` is this connection,
 *    which came FROM the provider and is not handed back to it. That marker
 *    is the source-of-change half of the loop guard; the provider being told
 *    "subscribed" only for a NEW member is the other half.
 * 4. **Events.** Commerce events owed to the connection, for the people the
 *    site may market to.
 *
 * Every cursor is saved as soon as its page is applied, so a run that fails
 * part-way resumes where it stopped rather than from the start.
 *
 * ## Failure
 *
 * A refused credential stops the connection (`reconnect`); a rate limit sets
 * the next attempt to when the provider said; anything else backs off,
 * doubling from five minutes to six hours, and twelve failures in a row stop
 * it (`error`) until the merchant presses Sync now. Every failure is a log
 * row the page shows.
 */

export interface SyncRunDeps {
  now(): number
  store: ConnectionStore
  provider(id: MarketingProviderId): MarketingProvider
  /** Opens the stored credential, refreshing an expiring OAuth token. Throws `ProviderError('auth')` when it cannot. */
  credential(id: string, connection: StoredConnection): Promise<ProviderCredential>
  isLocked(hostId: string): Promise<boolean>
  /** The org a site belongs to, its document, and whether its plan carries the feature. */
  org(hostId: string): Promise<{ orgId: string; org: Record<string, unknown>; entitled: boolean } | null>
  peopleChangedSince(request: PluginPersonChangesRequest): Promise<PluginPersonChangesPage | null>
  readStatuses(input: {
    hostId: string
    org: Record<string, unknown>
    people: Array<{ email: string; data: Readonly<Record<string, unknown>> | null }>
  }): Promise<Array<'subscribed' | 'unsubscribed' | 'withheld'>>
  suppressionChanges(input: {
    hostId: string
    after: string | null
    limit: number
  }): Promise<{ rows: Array<{ email: string; reason: string; via: string | null }>; next: string | null }>
  /**
   * What the site would answer today for each address, found by address:
   * `null` for an address the site holds no record of. Read before an
   * unsubscribe from the provider is filed, so the provider handing back an
   * unsubscribe this connection itself sent is not filed as the person's.
   */
  currentStatuses(input: {
    hostId: string
    orgId: string
    org: Record<string, unknown>
    emails: string[]
  }): Promise<Map<string, 'subscribed' | 'unsubscribed' | 'withheld' | null>>
  recordUnsubscribes(input: { hostId: string; emails: string[]; via: string; detail: string }): Promise<number>
  releaseUnsubscribes(input: { hostId: string; emails: string[]; via: string }): Promise<number>
}

/** What one run did, for the tick's report and the log. */
export interface SyncRunReport {
  outcome: 'ok' | 'skipped' | 'failed'
  contactsPushed: number
  consentPulled: number
  eventsSent: number
  more: boolean
}

/** The `via` a connection marks the unsubscribes it files: `<plugin>:<provider>`. */
export const viaFor = (provider: MarketingProviderId) => `${MARKETING_PLATFORMS_PLUGIN_ID}:${provider}`

/** The wait after the `failures`th failure in a row. */
export const backoffMs = (failures: number): number =>
  Math.min(SYNC_BACKOFF_MAX_MS, SYNC_BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1))

const SKIPPED: SyncRunReport = { outcome: 'skipped', contactsPushed: 0, consentPulled: 0, eventsSent: 0, more: false }

export async function runConnectionSync(
  deps: SyncRunDeps,
  id: string,
  options: { maxPages?: number } = {},
): Promise<SyncRunReport> {
  const maxPages = Math.max(1, Math.min(SYNC_MAX_PAGES_PER_RUN, options.maxPages ?? SYNC_MAX_PAGES_PER_RUN))
  const startedAtMs = deps.now()
  const leased = await deps.store.lease(id, startedAtMs, SYNC_LEASE_MS)
  if (!leased) return SKIPPED
  const connection = leased
  const label = MARKETING_PROVIDERS[connection.provider].label
  const report: SyncRunReport = { outcome: 'ok', contactsPushed: 0, consentPulled: 0, eventsSent: 0, more: false }

  // Paused, not failed: a locked site's sync waits for the lift, untouched.
  if (await deps.isLocked(connection.hostId)) {
    await deps.store.patch(id, { leaseUntilMs: 0, nextRunAtMs: startedAtMs + SYNC_INTERVAL_MS })
    return SKIPPED
  }
  const owner = await deps.org(connection.hostId)
  if (!owner || !owner.entitled) {
    await deps.store.patch(id, {
      leaseUntilMs: 0,
      nextRunAtMs: startedAtMs + SYNC_INTERVAL_MS,
      lastError: owner ? 'Your plan no longer includes marketing platforms, so this connection is not syncing.' : 'This site no longer belongs to a workspace.',
      updatedAtMs: startedAtMs,
    })
    return SKIPPED
  }

  const via = viaFor(connection.provider)
  const target = { listId: connection.listId, tag: connection.tag ?? '' }
  const cursors = { ...connection.cursors }
  const saveCursors = (extra: Partial<StoredConnection> = {}) =>
    deps.store.patch(id, { cursors: { ...cursors }, updatedAtMs: deps.now(), ...extra })

  try {
    const provider = deps.provider(connection.provider)
    const credential = await deps.credential(id, connection)
    let pages = 0

    if (connection.syncContacts !== false) {
      if (MARKETING_PROVIDERS[connection.provider].listNoun && !connection.listId) {
        throw new ProviderError('invalid', `Choose the ${label} ${MARKETING_PROVIDERS[connection.provider].listNoun} contacts go into`)
      }

      // 1. Read back first.
      for (let more = true; more && pages < maxPages; pages += 1) {
        const page = await provider.pullConsent(credential, target, cursors.provider)
        if (!page) break
        let left = page.changes.filter((change) => change.status === 'unsubscribed').map((change) => change.email)
        if (left.length) {
          // An address the site already answers "unsubscribed" for is the
          // echo of what this connection sent — a declined basis, a bounce,
          // the site's own unsubscribe. Filing it again as the person's
          // choice over there would outlive the site's own record: a person
          // who later consented on the site would stay suppressed by it.
          const now = await deps.currentStatuses({
            hostId: connection.hostId,
            orgId: owner.orgId,
            org: owner.org,
            emails: left,
          })
          left = left.filter((email) => now.get(email) !== 'unsubscribed')
        }
        const back = page.changes.filter((change) => change.status === 'subscribed').map((change) => change.email)
        if (left.length) {
          report.consentPulled += await deps.recordUnsubscribes({
            hostId: connection.hostId,
            emails: left,
            via,
            detail: `Unsubscribed in ${label}.`,
          })
        }
        if (back.length) {
          report.consentPulled += await deps.releaseUnsubscribes({ hostId: connection.hostId, emails: back, via })
        }
        cursors.provider = page.cursor
        await saveCursors()
        more = page.more
        if (more && pages + 1 >= maxPages) report.more = true
      }

      // 2. People out — the backfill on the first run, the changes after.
      let reachedEnd = false
      for (; pages < maxPages; pages += 1) {
        const page = await deps.peopleChangedSince({
          hostId: connection.hostId,
          orgId: owner.orgId,
          after: cursors.contacts,
          limit: SYNC_PAGE_SIZE,
        })
        if (!page) {
          reachedEnd = true
          break
        }
        if (page.next === null) {
          reachedEnd = true
          break
        }
        const statuses = page.people.length
          ? await deps.readStatuses({
              hostId: connection.hostId,
              org: owner.org,
              people: page.people.map((person) => ({ email: person.email as string, data: person.data })),
            })
          : []
        const contacts: ProviderContact[] = []
        page.people.forEach((person, index) => {
          const status = statuses[index]
          if (!person.email || (status !== 'subscribed' && status !== 'unsubscribed')) return
          contacts.push({
            email: person.email,
            status,
            ...splitName(person.profile.name),
            phone: person.profile.phone,
            tags: person.profile.tags,
            lifetimeValueCents: person.profile.lifetimeValueCents,
            ordersCount: person.profile.ordersCount,
          })
        })
        if (contacts.length) {
          const pushed = await provider.pushContacts(credential, target, contacts)
          report.contactsPushed += pushed.pushed
          for (const skip of pushed.skipped.slice(0, 5)) {
            await deps.store.appendLog(id, {
              atMs: deps.now(),
              kind: 'error',
              message: `${label} did not take one contact: ${skip.reason}`,
            })
          }
        }
        cursors.contacts = page.next
        await saveCursors()
      }
      if (!reachedEnd) report.more = true
      else if (!connection.backfillDone) await saveCursors({ backfillDone: true })

      // 3. Refusals out, except the ones that came from this provider.
      for (; pages < maxPages; pages += 1) {
        const page = await deps.suppressionChanges({
          hostId: connection.hostId,
          after: cursors.suppressions,
          limit: SYNC_PAGE_SIZE,
        })
        if (page.next === null) break
        const contacts: ProviderContact[] = page.rows
          .filter((row) => row.via !== via)
          .map((row) => ({
            email: row.email,
            status: 'unsubscribed',
            firstName: null,
            lastName: null,
            phone: null,
            tags: [],
            lifetimeValueCents: null,
            ordersCount: null,
          }))
        if (contacts.length) {
          const pushed = await provider.pushContacts(credential, target, contacts)
          report.contactsPushed += pushed.pushed
        }
        cursors.suppressions = page.next
        await saveCursors()
        if (pages + 1 >= maxPages) report.more = true
      }
    }

    // 4. Events owed to the connection.
    if (connection.syncEvents !== false && provider.sendEvent) {
      const owed = (await deps.store.pendingEvents(id, EVENTS_PER_RUN)).filter(
        ({ stored }) => (stored.nextAttemptAtMs ?? 0) <= deps.now(),
      )
      // Events go only for people the site may market to: an event creates
      // or updates the person's profile over there, and a flow it starts is
      // marketing. One the site answers anything else for is dropped, as is
      // one too old for any flow to act on.
      const statuses = owed.length
        ? await deps.currentStatuses({
            hostId: connection.hostId,
            orgId: owner.orgId,
            org: owner.org,
            emails: [...new Set(owed.map(({ stored }) => stored.event.email))],
          })
        : new Map<string, 'subscribed' | 'unsubscribed' | 'withheld' | null>()
      for (const { id: eventId, stored } of owed) {
        if (
          statuses.get(stored.event.email) !== 'subscribed' ||
          deps.now() - (stored.event.occurredAtMs ?? 0) > EVENT_MAX_AGE_MS
        ) {
          await deps.store.eventDelivered(eventId)
          continue
        }
        try {
          await provider.sendEvent(credential, stored.event)
          await deps.store.eventDelivered(eventId)
          report.eventsSent += 1
        } catch (error) {
          // The connection's own problems end the run; the event's own
          // refusal is the event's and the rest still go.
          if (isProviderError(error) && (error.kind === 'auth' || error.kind === 'rate-limit')) throw error
          const message = error instanceof Error ? error.message : String(error)
          const verdict = await deps.store.eventFailed(eventId, stored, message, deps.now())
          if (verdict === 'failed') {
            await deps.store.appendLog(id, {
              atMs: deps.now(),
              kind: 'event-failed',
              message: `${label} did not take the ${stored.event.name} event for order ${stored.event.orderNumber ?? stored.event.orderId ?? ''}: ${message}`.trim(),
            })
          }
        }
      }
    }

    const finishedAtMs = deps.now()
    await deps.store.patch(id, {
      cursors: { ...cursors },
      leaseUntilMs: 0,
      consecutiveFailures: 0,
      lastError: null,
      lastRunAtMs: finishedAtMs,
      lastSuccessAtMs: finishedAtMs,
      // A run that stopped at its page budget goes again on the next tick.
      nextRunAtMs: report.more ? finishedAtMs : finishedAtMs + SYNC_INTERVAL_MS,
      totals: {
        contactsPushed: (connection.totals?.contactsPushed ?? 0) + report.contactsPushed,
        consentPulled: (connection.totals?.consentPulled ?? 0) + report.consentPulled,
        eventsSent: (connection.totals?.eventsSent ?? 0) + report.eventsSent,
      },
      updatedAtMs: finishedAtMs,
    })
    if (report.contactsPushed || report.consentPulled || report.eventsSent) {
      await deps.store.appendLog(id, {
        atMs: finishedAtMs,
        kind: 'run',
        message: describeRun(report),
        contactsPushed: report.contactsPushed,
        consentPulled: report.consentPulled,
        eventsSent: report.eventsSent,
      })
    }
    return report
  } catch (error) {
    const failedAtMs = deps.now()
    const message = error instanceof Error ? error.message : String(error)
    const patch: Partial<StoredConnection> = {
      cursors: { ...cursors },
      leaseUntilMs: 0,
      lastRunAtMs: failedAtMs,
      lastError: message.slice(0, 300),
      updatedAtMs: failedAtMs,
    }
    if (isProviderError(error) && error.kind === 'auth') {
      patch.status = 'reconnect'
    } else if (isProviderError(error) && error.kind === 'rate-limit') {
      // The provider's own pacing, not a fault: no step up the backoff.
      patch.nextRunAtMs = failedAtMs + Math.max(60_000, error.retryAfterMs ?? 60_000)
    } else {
      const failures = (connection.consecutiveFailures ?? 0) + 1
      patch.consecutiveFailures = failures
      patch.nextRunAtMs = failedAtMs + backoffMs(failures)
      if (failures >= SYNC_MAX_CONSECUTIVE_FAILURES) patch.status = 'error'
    }
    await deps.store.patch(id, patch)
    await deps.store.appendLog(id, { atMs: failedAtMs, kind: 'error', message: message.slice(0, 300) })
    return { ...report, outcome: 'failed' }
  }
}

function describeRun(report: SyncRunReport): string {
  const parts: string[] = []
  if (report.contactsPushed) parts.push(`${report.contactsPushed} contact${report.contactsPushed === 1 ? '' : 's'} sent`)
  if (report.consentPulled) parts.push(`${report.consentPulled} subscription change${report.consentPulled === 1 ? '' : 's'} read back`)
  if (report.eventsSent) parts.push(`${report.eventsSent} event${report.eventsSent === 1 ? '' : 's'} sent`)
  return parts.join(', ') || 'Nothing to sync'
}

/** What one tick of the console job did. */
export interface SyncTickReport extends Record<string, number> {
  connections: number
  ok: number
  failed: number
  contactsPushed: number
  consentPulled: number
  eventsSent: number
}

/**
 * One tick: every due connection, one after another, until the deadline. A
 * connection's failure is its own (logged on it); the tick goes on.
 */
export async function runSyncTick(deps: SyncRunDeps, context: { deadlineMs: number }): Promise<SyncTickReport> {
  const tick: SyncTickReport = { connections: 0, ok: 0, failed: 0, contactsPushed: 0, consentPulled: 0, eventsSent: 0 }
  const due = await deps.store.listDue(deps.now(), SYNC_CONNECTIONS_PER_TICK)
  for (const id of due) {
    if (deps.now() >= context.deadlineMs) break
    const report = await runConnectionSync(deps, id).catch((error) => {
      console.error(`[marketing-platforms] sync of ${id} threw`, error)
      return { ...SKIPPED, outcome: 'failed' as const }
    })
    if (report.outcome === 'skipped') continue
    tick.connections += 1
    if (report.outcome === 'ok') tick.ok += 1
    else tick.failed += 1
    tick.contactsPushed += report.contactsPushed
    tick.consentPulled += report.consentPulled
    tick.eventsSent += report.eventsSent
  }
  return tick
}
