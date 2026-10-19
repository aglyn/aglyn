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
import type {
  OrderHistoryEntry as CommerceOrderHistoryEntry,
  OrderHistoryPageRequest,
} from '@aglyn/plugins-commerce/contracts'
import {
  ORDER_BACKFILL_DAYS,
  ORDER_PAGE_SIZE,
  OUTBOX_MAX_AGE_MS,
  OUTBOX_PER_RUN,
  RECENT_ORDERS_KEPT,
  SYNC_BACKOFF_BASE_MS,
  SYNC_BACKOFF_MAX_MS,
  SYNC_CONNECTIONS_PER_TICK,
  SYNC_INTERVAL_MS,
  SYNC_LEASE_MS,
  SYNC_MAX_CONSECUTIVE_FAILURES,
  SYNC_MAX_PAGES_PER_RUN,
  SYNC_PAGE_SIZE,
} from '../constants'
import { HELP_DESK_PROVIDERS, type HelpDeskProviderId } from '../model/connections'
import { helpDeskOrderFromView, mergeRecentOrders, type HelpDeskOrder, type HelpDeskOrderBuyer } from '../model/orders'
import { isProviderError } from '../providers/http'
import type { HelpDeskCredential, HelpDeskCustomer, HelpDeskProvider, HelpDeskTicket } from '../providers/provider'
import type { ConnectionStore, StoredConnection, StoredCustomer } from './store'

/**
 * ONE CONNECTION'S SYNC (AGL-3824): what a run does, in the order it does it,
 * and what it leaves behind for the next.
 *
 * 1. **Buyers out.** The people the site holds that changed since the
 *    people cursor — every one on the first runs — and who have ordered at
 *    the site, added to the help desk or renamed there. A person who never
 *    ordered is not a buyer and is not sent.
 * 2. **Recent orders, once.** On the first runs, the site's paid orders of
 *    the last {@link ORDER_BACKFILL_DAYS} days before it was connected, read
 *    through commerce's order history service, each filed under its buyer.
 * 3. **What is owed.** The orders commerce's events brought since, and —
 *    where the merchant switched it on — the contact form messages, each
 *    opened as a new ticket from its sender.
 *
 * Every cursor is saved as soon as its page is applied, so a run that stops
 * part-way resumes where it stopped. What the connection learns of a buyer
 * (the help desk's id for them, their latest orders) is kept beside it, so
 * each order carries the buyer's recent orders, not only the newest.
 *
 * ## Failure
 *
 * A refused credential stops the connection (`reconnect`); a rate limit sets
 * the next attempt to when the help desk said; anything else backs off,
 * doubling from five minutes to six hours, and twelve failures in a row stop
 * it (`error`) until the merchant presses Sync now. One order or message the
 * help desk will not take is that item's failure: retried with its own
 * backoff, then logged and dropped, while the rest go on.
 */

/** One stored order of commerce's history: the fields this plugin reads, in commerce's contract (AGL-3980). */
export type OrderHistoryEntry = Pick<CommerceOrderHistoryEntry, 'createdAtMs' | 'paidAtMs' | 'order'>

export interface SyncRunDeps {
  now(): number
  store: ConnectionStore
  provider(id: HelpDeskProviderId): HelpDeskProvider
  /** Opens the stored credential. Throws `ProviderError('auth')` when it cannot. */
  credential(id: string, connection: StoredConnection): Promise<HelpDeskCredential>
  isLocked(hostId: string): Promise<boolean>
  /**
   * The org a site belongs to, whether its plan carries the store, whether
   * the plugin is on for the site, and where its orders open in the console.
   */
  site(
    hostId: string,
  ): Promise<{ orgId: string; entitled: boolean; enabled: boolean; orderUrl(orderId: string): string | null } | null>
  peopleChangedSince(request: PluginPersonChangesRequest): Promise<PluginPersonChangesPage | null>
  /** Commerce's order history, oldest first; `null` when no plugin reads it in this process. */
  orderHistory(request: OrderHistoryPageRequest): Promise<OrderHistoryEntry[] | null>
  /** The platform's name, for the help desks that label where data came from. */
  source: string
}

/** What one run did, for the tick's report and the log. */
export interface SyncRunReport {
  outcome: 'ok' | 'skipped' | 'failed'
  customersPushed: number
  ordersPushed: number
  ticketsCreated: number
  more: boolean
}

/** The wait after the `failures`th failure in a row. */
export const backoffMs = (failures: number): number =>
  Math.min(SYNC_BACKOFF_MAX_MS, SYNC_BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1))

const SKIPPED: SyncRunReport = { outcome: 'skipped', customersPushed: 0, ordersPushed: 0, ticketsCreated: 0, more: false }

/** A failure that is the connection's (its credential, its pacing), which ends the run rather than one item. */
const endsTheRun = (error: unknown) => isProviderError(error) && (error.kind === 'auth' || error.kind === 'rate-limit')

/** The help desk saying the buyer it was given is gone (deleted, or merged into another). */
const buyerGone = (error: unknown) => isProviderError(error) && (error.status === 404 || error.status === 410)

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export async function runConnectionSync(
  deps: SyncRunDeps,
  id: string,
  options: { maxPages?: number; deadlineMs?: number } = {},
): Promise<SyncRunReport> {
  const maxPages = Math.max(1, Math.min(SYNC_MAX_PAGES_PER_RUN, options.maxPages ?? SYNC_MAX_PAGES_PER_RUN))
  const startedAtMs = deps.now()
  const leased = await deps.store.lease(id, startedAtMs, SYNC_LEASE_MS)
  if (!leased) return SKIPPED
  const connection = leased
  const info = HELP_DESK_PROVIDERS[connection.provider]
  const report: SyncRunReport = { outcome: 'ok', customersPushed: 0, ordersPushed: 0, ticketsCreated: 0, more: false }
  const outOfTime = () => typeof options.deadlineMs === 'number' && deps.now() >= options.deadlineMs

  // Paused, not failed: a locked site's sync waits for the lift, untouched.
  if (await deps.isLocked(connection.hostId)) {
    await deps.store.patch(id, { leaseUntilMs: 0, nextRunAtMs: startedAtMs + SYNC_INTERVAL_MS })
    return SKIPPED
  }
  const site = await deps.site(connection.hostId)
  if (!site || !site.entitled || !site.enabled) {
    // Switched off for the site: what was owed meanwhile is not sent later.
    if (site && !site.enabled) {
      for (const { id: itemId } of await deps.store.pendingItems(id, OUTBOX_PER_RUN)) await deps.store.itemDelivered(itemId)
    }
    await deps.store.patch(id, {
      leaseUntilMs: 0,
      nextRunAtMs: startedAtMs + SYNC_INTERVAL_MS,
      lastError: !site
        ? 'This site no longer belongs to a workspace.'
        : !site.entitled
          ? 'Your plan no longer includes the store, so this help desk is not syncing.'
          : 'Help desks is switched off for this site, so nothing is sent.',
      updatedAtMs: startedAtMs,
    })
    return SKIPPED
  }

  const cursors = { people: connection.cursors?.people ?? null, ordersMs: connection.cursors?.ordersMs ?? null }
  const backfill = { people: connection.backfill?.people === true, orders: connection.backfill?.orders === true }
  const save = (extra: Partial<StoredConnection> = {}) =>
    deps.store.patch(id, { cursors: { ...cursors }, backfill: { ...backfill }, updatedAtMs: deps.now(), ...extra })
  const notices: string[] = []

  try {
    const provider = deps.provider(connection.provider)
    const credential = await deps.credential(id, connection)
    const missingTarget = (purpose: 'tickets' | 'orders') => info.target?.purpose === purpose && !connection.targetId
    const emptyCustomer = (buyer: HelpDeskOrderBuyer): StoredCustomer => ({
      orgId: site.orgId,
      connectionId: id,
      hostId: connection.hostId,
      email: buyer.email,
      remoteId: null,
      name: buyer.name,
      orders: [],
      updatedAtMs: deps.now(),
    })

    /** The buyer at the help desk: upserted when the connection has no id for them or their name changed. */
    const ensureCustomer = async (customer: HelpDeskCustomer): Promise<StoredCustomer & { remoteId: string }> => {
      const known = (await deps.store.getCustomer(id, customer.email)) ?? emptyCustomer(customer)
      const renamed = Boolean(customer.name && customer.name !== known.name)
      if (known.remoteId && !renamed) return known as StoredCustomer & { remoteId: string }
      const ref = await provider.upsertCustomer(credential, customer, known.remoteId)
      const next = { ...known, remoteId: ref.remoteId, name: customer.name ?? known.name, updatedAtMs: deps.now() }
      await deps.store.putCustomer(id, next)
      report.customersPushed += 1
      return next
    }

    /** A remembered buyer the help desk no longer has: forgotten, so the next attempt finds or adds them again. */
    const forgetBuyer = async (email: string) => {
      const known = await deps.store.getCustomer(id, email)
      if (known) await deps.store.putCustomer(id, { ...known, remoteId: null, updatedAtMs: deps.now() })
    }

    const pushOrder = async (buyer: HelpDeskOrderBuyer, order: HelpDeskOrder) => {
      const withUrl = { ...order, url: site.orderUrl(order.id) }
      const customer = { email: buyer.email, name: buyer.name, phone: null }
      try {
        const known = await ensureCustomer(customer)
        const recent = mergeRecentOrders(known.orders ?? [], withUrl, RECENT_ORDERS_KEPT)
        await provider.pushOrder(credential, {
          customer,
          remoteId: known.remoteId,
          order: withUrl,
          recent,
          targetId: connection.targetId,
          source: deps.source,
        })
        await deps.store.putCustomer(id, { ...known, orders: recent, updatedAtMs: deps.now() })
        report.ordersPushed += 1
      } catch (error) {
        if (buyerGone(error)) await forgetBuyer(buyer.email)
        throw error
      }
    }

    const openTicket = async (ticket: HelpDeskTicket) => {
      const customer = { email: ticket.email, name: ticket.name, phone: null }
      try {
        const known = await ensureCustomer(customer)
        await provider.createTicket(credential, {
          ticket,
          remoteId: known.remoteId,
          targetId: connection.targetId,
          source: deps.source,
          nowMs: deps.now(),
        })
        report.ticketsCreated += 1
      } catch (error) {
        if (buyerGone(error)) await forgetBuyer(ticket.email)
        throw error
      }
    }

    const ordersOn = connection.syncCustomers !== false && !missingTarget('orders')
    const ticketsOn = connection.sendTickets === true && !missingTarget('tickets')
    if (connection.syncCustomers !== false && missingTarget('orders') && info.target) {
      notices.push(`Choose the ${info.label} ${info.target.noun} orders go into, and buyers start syncing.`)
    }
    if (connection.sendTickets === true && missingTarget('tickets') && info.target) {
      notices.push(`Choose the ${info.label} ${info.target.noun} contact form messages go to, and they start arriving.`)
    }

    let pages = 0
    if (ordersOn) {
      // 1. Buyers out — the whole set on the first runs, the changes after.
      while (!outOfTime()) {
        if (pages >= maxPages) {
          report.more = true
          break
        }
        const page = await deps.peopleChangedSince({
          hostId: connection.hostId,
          orgId: site.orgId,
          after: cursors.people,
          limit: SYNC_PAGE_SIZE,
        })
        pages += 1
        if (!page || page.next === null) {
          backfill.people = true
          break
        }
        for (const person of page.people) {
          const email = String(person.email ?? '').trim().toLowerCase()
          if (!email || !((person.profile.ordersCount ?? 0) > 0)) continue
          await ensureCustomer({ email, name: person.profile.name, phone: person.profile.phone })
        }
        cursors.people = page.next
        await save()
      }

      // 2. The recent orders, once.
      const untilMs = connection.connectedAtMs ?? startedAtMs
      while (!backfill.orders && !outOfTime()) {
        if (pages >= maxPages) {
          report.more = true
          break
        }
        const fromMs = cursors.ordersMs ?? untilMs - ORDER_BACKFILL_DAYS * 24 * 60 * 60 * 1000
        const entries = await deps.orderHistory({ hostId: connection.hostId, fromMs, untilMs, limit: ORDER_PAGE_SIZE })
        pages += 1
        // No reader in this process (a deployment without the store's
        // history): there is nothing to copy, and orders arrive by events.
        if (entries === null) {
          backfill.orders = true
          break
        }
        for (const entry of entries) {
          if (entry.paidAtMs === null) continue
          const read = helpDeskOrderFromView(entry.order, entry.createdAtMs)
          if (!read) continue
          try {
            await pushOrder(read.buyer, read.order)
          } catch (error) {
            if (endsTheRun(error) || !isProviderError(error)) throw error
            await deps.store.appendLog(id, {
              atMs: deps.now(),
              kind: 'item-failed',
              message: `${info.label} did not take order ${read.order.number ?? read.order.id}: ${error.message}`,
            })
          }
        }
        const last = entries[entries.length - 1]
        if (last) cursors.ordersMs = last.createdAtMs + 1
        if (entries.length < ORDER_PAGE_SIZE) backfill.orders = true
        await save()
      }
    }

    // 3. What is owed.
    const owed = (await deps.store.pendingItems(id, OUTBOX_PER_RUN)).filter(
      ({ stored }) => (stored.nextAttemptAtMs ?? 0) <= deps.now(),
    )
    for (const { id: itemId, stored } of owed) {
      if (outOfTime()) {
        report.more = true
        break
      }
      const kindOn = stored.kind === 'order' ? ordersOn : ticketsOn
      const switchedOff = stored.kind === 'order' ? connection.syncCustomers === false : connection.sendTickets !== true
      // Switched off since it was owed: not sent. Waiting on a menu pick: kept until it is too old.
      if (switchedOff || deps.now() - (stored.createdAtMs ?? 0) > OUTBOX_MAX_AGE_MS) {
        await deps.store.itemDelivered(itemId)
        continue
      }
      if (!kindOn) continue
      try {
        if (stored.kind === 'order' && stored.order && stored.buyer) await pushOrder(stored.buyer, stored.order)
        else if (stored.kind === 'ticket' && stored.ticket) await openTicket(stored.ticket)
        await deps.store.itemDelivered(itemId)
      } catch (error) {
        if (endsTheRun(error)) throw error
        const message = messageOf(error)
        const verdict = await deps.store.itemFailed(itemId, stored, message, deps.now())
        if (verdict === 'failed') {
          const what =
            stored.kind === 'order'
              ? `order ${stored.order?.number ?? stored.order?.id ?? ''}`
              : `the contact form message from ${stored.email}`
          await deps.store.appendLog(id, {
            atMs: deps.now(),
            kind: 'item-failed',
            message: `${info.label} did not take ${what}: ${message}`.slice(0, 300),
          })
        }
      }
    }

    const finishedAtMs = deps.now()
    await deps.store.patch(id, {
      cursors: { ...cursors },
      backfill: { ...backfill },
      leaseUntilMs: 0,
      consecutiveFailures: 0,
      lastError: notices.length ? notices.join(' ') : null,
      lastRunAtMs: finishedAtMs,
      lastSuccessAtMs: finishedAtMs,
      // A run that stopped at its page budget or its deadline goes again on the next tick.
      nextRunAtMs: report.more ? finishedAtMs : finishedAtMs + SYNC_INTERVAL_MS,
      totals: {
        customersPushed: (connection.totals?.customersPushed ?? 0) + report.customersPushed,
        ordersPushed: (connection.totals?.ordersPushed ?? 0) + report.ordersPushed,
        ticketsCreated: (connection.totals?.ticketsCreated ?? 0) + report.ticketsCreated,
      },
      updatedAtMs: finishedAtMs,
    })
    if (report.customersPushed || report.ordersPushed || report.ticketsCreated) {
      await deps.store.appendLog(id, {
        atMs: finishedAtMs,
        kind: 'run',
        message: describeRun(report, info.ticketNoun),
        customersPushed: report.customersPushed,
        ordersPushed: report.ordersPushed,
        ticketsCreated: report.ticketsCreated,
      })
    }
    return report
  } catch (error) {
    const failedAtMs = deps.now()
    const message = messageOf(error).slice(0, 300)
    const patch: Partial<StoredConnection> = {
      cursors: { ...cursors },
      backfill: { ...backfill },
      leaseUntilMs: 0,
      lastRunAtMs: failedAtMs,
      lastError: message,
      updatedAtMs: failedAtMs,
    }
    if (isProviderError(error) && error.kind === 'auth') {
      patch.status = 'reconnect'
    } else if (isProviderError(error) && error.kind === 'rate-limit') {
      // The help desk's own pacing, not a fault: no step up the backoff.
      patch.nextRunAtMs = failedAtMs + Math.max(60_000, error.retryAfterMs ?? 60_000)
    } else {
      const failures = (connection.consecutiveFailures ?? 0) + 1
      patch.consecutiveFailures = failures
      patch.nextRunAtMs = failedAtMs + backoffMs(failures)
      if (failures >= SYNC_MAX_CONSECUTIVE_FAILURES) patch.status = 'error'
    }
    // What the run had done before it stopped still counts.
    patch.totals = {
      customersPushed: (connection.totals?.customersPushed ?? 0) + report.customersPushed,
      ordersPushed: (connection.totals?.ordersPushed ?? 0) + report.ordersPushed,
      ticketsCreated: (connection.totals?.ticketsCreated ?? 0) + report.ticketsCreated,
    }
    await deps.store.patch(id, patch)
    await deps.store.appendLog(id, { atMs: failedAtMs, kind: 'error', message })
    return { ...report, outcome: 'failed' }
  }
}

function describeRun(report: SyncRunReport, ticketNoun: string): string {
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`
  const parts: string[] = []
  if (report.customersPushed) parts.push(`${plural(report.customersPushed, 'customer')} sent`)
  if (report.ordersPushed) parts.push(`${plural(report.ordersPushed, 'order')} sent`)
  if (report.ticketsCreated) parts.push(`${plural(report.ticketsCreated, ticketNoun)} opened`)
  return parts.join(', ') || 'Nothing to sync'
}

/** What one tick of the console job did. */
export interface SyncTickReport extends Record<string, number> {
  connections: number
  ok: number
  failed: number
  customersPushed: number
  ordersPushed: number
  ticketsCreated: number
}

/**
 * One tick: every due connection, one after another, until the deadline. A
 * connection's failure is its own (logged on it); the tick goes on.
 */
export async function runSyncTick(deps: SyncRunDeps, context: { deadlineMs: number }): Promise<SyncTickReport> {
  const tick: SyncTickReport = { connections: 0, ok: 0, failed: 0, customersPushed: 0, ordersPushed: 0, ticketsCreated: 0 }
  const due = await deps.store.listDue(deps.now(), SYNC_CONNECTIONS_PER_TICK)
  for (const id of due) {
    if (deps.now() >= context.deadlineMs) break
    const report = await runConnectionSync(deps, id, { deadlineMs: context.deadlineMs }).catch((error) => {
      console.error(`[help-desks] sync of ${id} threw`, error)
      return { ...SKIPPED, outcome: 'failed' as const }
    })
    if (report.outcome === 'skipped') continue
    tick.connections += 1
    if (report.outcome === 'ok') tick.ok += 1
    else tick.failed += 1
    tick.customersPushed += report.customersPushed
    tick.ordersPushed += report.ordersPushed
    tick.ticketsCreated += report.ticketsCreated
  }
  return tick
}
