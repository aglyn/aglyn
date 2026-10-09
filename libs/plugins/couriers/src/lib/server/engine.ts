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
  PluginLocalDeliveryRecord,
  PluginLocalDeliveryRecords,
  PluginRecordCourier,
  PluginRecordCourierWrite,
} from '@aglyn/aglyn/plugin-manager/plugin-local-deliveries'
import { needsReseal, openSecret, sealSecret, type SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { HISTORY_KEPT, QUOTE_TTL_MS, RECONCILE_AFTER_MS, RUN_POLL_MS, SEEN_EVENTS_KEPT } from '../constants'
import {
  COURIER_PROVIDERS,
  COURIER_STATE_LABELS,
  courierStateIsFinal,
  type CourierKeyMode,
  type CourierOrderView,
  type CourierProviderId,
  type CourierQuoteView,
  type CourierRunView,
  type CourierState,
} from '../model/couriers'
import { isProviderError, ProviderError } from '../providers/http'
import type { CourierKeys, CourierProvider, CourierRunSnapshot } from '../providers/provider'
import {
  connectionId,
  keysSealContext,
  type CourierStore,
  type StoredConnection,
  type StoredDelivery,
  type StoredKeys,
  type StoredRun,
} from './store'

/**
 * THE COURIER ENGINE (AGL-3695): quote, book, follow and call off one
 * order's courier, with the merchant's own keys, and hand every step the
 * courier takes to the seller through core's `core.local-delivery-records`.
 *
 * ## One run per order, and a retry never books a second
 *
 * `courierDeliveries/{hostId}_{orderId}` holds the order's run, and booking
 * CLAIMS it in a transaction before the courier is called: a second book
 * while one is under way is refused, and a retry carrying the same attempt
 * key finds the run the first one claimed instead of booking again. The
 * courier itself is asked under OUR reference (`aglyn-{orderId}-{n}`), its
 * idempotency key, so even a booking whose answer was lost cannot become two
 * deliveries: the job asks the courier for that reference and adopts what it
 * finds, or releases the claim when the courier has none.
 *
 * ## Steps only go forward, and a repeat is a no-op
 *
 * A webhook or a lookup moves the run only forward (`requested` → `assigned`
 * → … → `delivered`), never out of a final state, and each webhook event's
 * key is remembered, so a redelivery writes nothing. The seller's step is
 * idempotent in its own right (`already`).
 *
 * ## Money
 *
 * The courier charges its fee to the merchant's own account. Nothing here
 * charges, collects or marks it up: the fee is stored only to show it.
 */

export class CourierRefusal extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'CourierRefusal'
    this.status = status
  }
}

export interface EngineDeps {
  now(): number
  store: CourierStore
  provider(id: CourierProviderId): CourierProvider
  keyring(): SecretBoxKeyring | null
  records(): PluginLocalDeliveryRecords | null
}

const RANK: Readonly<Record<CourierState, number>> = {
  requested: 0,
  assigned: 1,
  at_pickup: 2,
  picked_up: 3,
  at_dropoff: 4,
  returning: 5,
  delivered: 9,
  cancelled: 9,
  returned: 9,
}

/** Whether a run at `from` may move to `to`: forward only, and never out of a final state. */
export function courierStepAllowed(from: CourierState, to: CourierState): boolean {
  if (courierStateIsFinal(from)) return false
  if (courierStateIsFinal(to)) return true
  return RANK[to] >= RANK[from]
}

/** Our reference for an order's `n`th courier attempt: the courier's idempotency key. */
export const courierRef = (orderId: string, attempt: number): string => `aglyn-${orderId}-${attempt}`

/** The order a reference names, or `null` for one this plugin did not mint. */
export function orderIdOfRef(deliveryRef: string): string | null {
  const match = /^aglyn-(.+)-(\d+)$/.exec(deliveryRef)
  return match && !match[1].includes('/') ? match[1] : null
}

const label = (provider: CourierProviderId) => COURIER_PROVIDERS[provider].label

export function quoteView(delivery: StoredDelivery | null): CourierQuoteView | null {
  const quote = delivery?.quote
  if (!quote) return null
  return {
    provider: quote.provider,
    providerLabel: label(quote.provider),
    feeCents: quote.feeCents,
    currency: quote.currency,
    pickupEtaMs: quote.pickupEtaMs,
    dropoffEtaMs: quote.dropoffEtaMs,
    expiresAtMs: quote.expiresAtMs,
    testMode: quote.testMode,
  }
}

export function runView(run: StoredRun): CourierRunView {
  return {
    provider: run.provider,
    providerLabel: label(run.provider),
    deliveryRef: run.deliveryRef,
    state: run.state,
    stateLabel: COURIER_STATE_LABELS[run.state],
    pending: run.pending,
    trackingUrl: run.trackingUrl,
    etaMs: run.etaMs,
    pickupEtaMs: run.pickupEtaMs,
    feeCents: run.feeCents,
    currency: run.currency,
    reason: run.reason,
    testMode: run.testMode,
    cancelRequested: run.cancelRequested,
    createdAtMs: run.createdAtMs,
    updatedAtMs: run.updatedAtMs,
  }
}

export function orderView(orderId: string, delivery: StoredDelivery | null): CourierOrderView {
  return {
    orderId,
    quote: quoteView(delivery),
    run: delivery?.run ? runView(delivery.run) : null,
    history: (delivery?.history ?? []).map(runView),
  }
}

/** The run as the seller keeps it on the order. */
export function sellerCourier(run: StoredRun, nowMs: number): PluginRecordCourier {
  return {
    provider: run.provider,
    providerLabel: label(run.provider),
    deliveryRef: run.deliveryRef,
    state: run.state,
    ...(run.trackingUrl ? { trackingUrl: run.trackingUrl } : {}),
    ...(run.etaMs ? { etaMs: run.etaMs } : {}),
    ...(run.pickupEtaMs ? { pickupEtaMs: run.pickupEtaMs } : {}),
    ...(run.reason ? { reason: run.reason } : {}),
    ...(run.testMode ? { testMode: true } : {}),
    updatedAtMs: nowMs,
  }
}

/**
 * The delivery step a run's new state brings, and why: out the door once the
 * courier has it, delivered at the door, and FAILED when the courier itself
 * canceled or brought the goods back — never when the store called it off.
 */
export function sellerStep(
  before: CourierState | null,
  run: StoredRun,
): Pick<PluginRecordCourierWrite, 'move' | 'reason'> {
  if (before === run.state) return {}
  switch (run.state) {
    case 'picked_up':
    case 'at_dropoff':
      return { move: 'out_for_delivery' }
    case 'delivered':
      return { move: 'delivered' }
    case 'cancelled':
      if (run.cancelledByStore || run.cancelRequested) return {}
      return {
        move: 'failed',
        reason: `${label(run.provider)} canceled the delivery${run.reason ? `: ${run.reason}` : ''}`,
      }
    case 'returning':
    case 'returned':
      return {
        move: 'failed',
        reason: `${label(run.provider)} is bringing it back${run.reason ? `: ${run.reason}` : ''}`,
      }
    default:
      return {}
  }
}

/** Why the seller will not hand this drop to a courier now. */
function notDispatchable(record: PluginLocalDeliveryRecord): string {
  if (record.status === 'delivered') return 'This order was already delivered.'
  if (record.status === 'out_for_delivery') return 'This order is already out for delivery.'
  return `A courier can’t be sent for an order that is ${record.sellerStatus.replace(/_/g, ' ')}.`
}

const providerMessage = (error: unknown): string =>
  isProviderError(error) ? error.message : 'The courier could not be reached'

const empty = (hostId: string, orderId: string, orgId: string, nowMs: number): StoredDelivery => ({
  id: `${hostId}_${orderId}`,
  orgId,
  hostId,
  orderId,
  quote: null,
  run: null,
  history: [],
  attempts: 0,
  seenEvents: [],
  open: false,
  nextCheckAtMs: 0,
  updatedAtMs: nowMs,
})

/** A finished run, filed with the ones before it. */
const filed = (delivery: StoredDelivery): StoredRun[] =>
  delivery.run ? [delivery.run, ...delivery.history].slice(0, HISTORY_KEPT) : delivery.history

export function createEngine(deps: EngineDeps) {
  const keyringOrThrow = (): SecretBoxKeyring => {
    const keyring = deps.keyring()
    if (!keyring) throw new CourierRefusal(404, 'Couriers are not available on this deployment.')
    return keyring
  }

  /** Seals one mode's signing secret for storage. */
  function sealKeys(
    hostId: string,
    provider: CourierProviderId,
    mode: CourierKeyMode,
    keys: CourierKeys,
  ): Pick<StoredKeys, 'developerId' | 'keyId' | 'sealedSigningSecret' | 'sealedWith'> {
    const keyring = keyringOrThrow()
    return {
      developerId: keys.developerId,
      keyId: keys.keyId,
      sealedSigningSecret: sealSecret(keys.signingSecret, keyring.current, {
        context: keysSealContext(hostId, provider, mode),
      }),
      sealedWith: keyring.current.id,
    }
  }

  /** Opens one mode's keys for one call; reseals under the current key, best effort. */
  function openKeys(connection: StoredConnection, mode: CourierKeyMode): CourierKeys {
    const stored = connection[mode]
    if (!stored) {
      throw new CourierRefusal(
        409,
        mode === 'test'
          ? `This order was paid in test mode. Add your ${label(connection.provider)} test keys to send a test courier.`
          : `Add your ${label(connection.provider)} live keys to send a courier.`,
      )
    }
    const keyring = keyringOrThrow()
    let opened
    try {
      opened = openSecret(stored.sealedSigningSecret, keyring, {
        context: keysSealContext(connection.hostId, connection.provider, mode),
      })
    } catch {
      throw new CourierRefusal(409, `Your ${label(connection.provider)} keys can no longer be read. Connect them again.`)
    }
    if (needsReseal(opened, keyring)) {
      deps.store
        .patchConnection(connection.id, {
          [mode]: {
            ...stored,
            sealedSigningSecret: sealSecret(opened.plaintext, keyring.current, {
              context: keysSealContext(connection.hostId, connection.provider, mode),
            }),
            sealedWith: keyring.current.id,
          },
        } as Partial<StoredConnection>)
        .catch(() => undefined)
    }
    return { developerId: stored.developerId, keyId: stored.keyId, signingSecret: opened.plaintext }
  }

  async function connectionOrThrow(hostId: string, provider: CourierProviderId): Promise<StoredConnection> {
    const connection = await deps.store.getConnection(hostId, provider)
    if (!connection) throw new CourierRefusal(409, `Connect your ${label(provider)} account first.`)
    return connection
  }

  function recordsOrThrow(): PluginLocalDeliveryRecords {
    const records = deps.records()
    if (!records) throw new CourierRefusal(404, 'This site does not deliver orders itself.')
    return records
  }

  /** Why a drop cannot have a courier, in the merchant's words; `null` when it can. */
  function dropProblem(record: PluginLocalDeliveryRecord, connection: StoredConnection): string | null {
    if (!record.dispatchable) return notDispatchable(record)
    if (!record.pickup) return 'Add a full street address to the location deliveries leave from.'
    if (!record.pickup.phone && !connection.pickupPhone) {
      return 'Add the store’s phone number in the Couriers card, so the courier can call the store.'
    }
    if (!record.dropoff) return 'This order has no street address to deliver to.'
    if (!record.dropoff.phone) return 'This order has no phone number for the courier to call.'
    return null
  }

  /**
   * Hands a run's new state to the seller, and the step it brings. Never
   * throws: the run is ours and already stored; the seller's write is
   * retried by the next webhook or lookup, which finds it unchanged here.
   */
  async function tellSeller(hostId: string, orderId: string, before: CourierState | null, run: StoredRun | null): Promise<void> {
    const records = deps.records()
    if (!records) return
    try {
      await records.recordCourier({
        hostId,
        recordId: orderId,
        courier: run ? sellerCourier(run, deps.now()) : null,
        ...(run ? sellerStep(before, run) : {}),
      })
    } catch (error) {
      console.error('[couriers] the order was not updated', hostId, orderId, error)
    }
  }

  /**
   * Applies what the courier reports about a run: forward only, once per
   * webhook event. Answers what changed.
   */
  async function applySnapshot(
    hostId: string,
    orderId: string,
    snapshot: CourierRunSnapshot,
    options: { eventKey?: string; pendingResolved?: boolean } = {},
  ): Promise<'applied' | 'unchanged' | 'duplicate' | 'stale'> {
    const nowMs = deps.now()
    type Applied =
      | { kind: 'stale' }
      | { kind: 'duplicate' }
      | { kind: 'unchanged' }
      | { kind: 'applied'; before: CourierState; run: StoredRun }
    const outcome = await deps.store.updateDelivery<Applied>(hostId, orderId, (current) => {
      const run = current?.run
      if (!current || !run || run.deliveryRef !== snapshot.deliveryRef) return { result: { kind: 'stale' as const } }
      if (options.eventKey && current.seenEvents.includes(options.eventKey)) return { result: { kind: 'duplicate' as const } }
      const seenEvents = options.eventKey
        ? [...current.seenEvents, options.eventKey].slice(-SEEN_EVENTS_KEPT)
        : current.seenEvents
      const to = snapshot.state && courierStepAllowed(run.state, snapshot.state) ? snapshot.state : run.state
      const next: StoredRun = {
        ...run,
        state: to,
        pending: options.pendingResolved ? false : run.pending,
        trackingUrl: snapshot.trackingUrl ?? run.trackingUrl,
        etaMs: snapshot.etaMs ?? run.etaMs,
        pickupEtaMs: snapshot.pickupEtaMs ?? run.pickupEtaMs,
        feeCents: snapshot.feeCents ?? run.feeCents,
        currency: snapshot.currency ?? run.currency,
        reason: to === 'cancelled' || to === 'returning' || to === 'returned' ? (snapshot.reason ?? run.reason) : run.reason,
        updatedAtMs: nowMs,
      }
      const changed =
        next.state !== run.state ||
        next.pending !== run.pending ||
        next.trackingUrl !== run.trackingUrl ||
        next.etaMs !== run.etaMs ||
        next.pickupEtaMs !== run.pickupEtaMs ||
        next.feeCents !== run.feeCents ||
        next.reason !== run.reason
      const final = courierStateIsFinal(next.state)
      return {
        next: {
          ...current,
          run: next,
          seenEvents,
          open: !final,
          // A run waiting to be called off stays due now; the rest are looked at a poll away.
          nextCheckAtMs: final ? 0 : next.cancelRequested ? 0 : nowMs + RUN_POLL_MS,
          updatedAtMs: nowMs,
        },
        result: changed
          ? { kind: 'applied' as const, before: run.state, run: next }
          : { kind: 'unchanged' as const },
      }
    })
    if (outcome.kind === 'applied') await tellSeller(hostId, orderId, outcome.before, outcome.run)
    return outcome.kind
  }

  const engine = {
    applySnapshot,

    /** Saves a mode's keys after the courier accepted them. Admin's route. */
    async connect(input: {
      orgId: string
      hostId: string
      uid: string
      provider: CourierProviderId
      keys: Partial<Record<CourierKeyMode, CourierKeys>>
      newWebhookToken: () => { token: string; hash: string }
    }): Promise<{ connection: StoredConnection; webhookToken: string | null }> {
      const { hostId, provider } = input
      const modes = (['live', 'test'] as const).filter((mode) => input.keys[mode])
      if (!modes.length) throw new CourierRefusal(400, 'Enter your developer id, key id and signing secret.')
      const nowMs = deps.now()
      const adapter = deps.provider(provider)
      const existing = await deps.store.getConnection(hostId, provider)
      const sealed: Partial<Record<CourierKeyMode, StoredKeys>> = {}
      for (const mode of modes) {
        const keys = input.keys[mode] as CourierKeys
        try {
          await adapter.test(keys)
        } catch (error) {
          throw new CourierRefusal(
            isProviderError(error) && error.kind === 'auth' ? 400 : 502,
            `${label(provider)} refused your ${mode} keys: ${providerMessage(error)}`,
          )
        }
        sealed[mode] = {
          ...sealKeys(hostId, provider, mode, keys),
          lastTestOk: true,
          lastTestAtMs: nowMs,
          lastError: null,
        }
      }
      const minted = existing?.webhookTokenHash ? null : input.newWebhookToken()
      const connection: StoredConnection = {
        id: connectionId(hostId, provider),
        orgId: input.orgId,
        hostId,
        provider,
        live: sealed.live ?? existing?.live ?? null,
        test: sealed.test ?? existing?.test ?? null,
        pickupPhone: existing?.pickupPhone ?? null,
        pickupNote: existing?.pickupNote ?? null,
        webhookTokenHash: minted?.hash ?? existing?.webhookTokenHash ?? null,
        connectedByUid: existing?.connectedByUid || input.uid,
        createdAtMs: existing?.createdAtMs || nowMs,
        updatedAtMs: nowMs,
      }
      await deps.store.putConnection(connection)
      return { connection, webhookToken: minted?.token ?? null }
    },

    /** Tests every stored mode again and records the answer. */
    async test(hostId: string, provider: CourierProviderId): Promise<StoredConnection> {
      const connection = await connectionOrThrow(hostId, provider)
      const nowMs = deps.now()
      const patch: Partial<StoredConnection> = { updatedAtMs: nowMs }
      for (const mode of ['live', 'test'] as const) {
        const stored = connection[mode]
        if (!stored) continue
        let lastError: string | null = null
        try {
          await deps.provider(provider).test(openKeys(connection, mode))
        } catch (error) {
          lastError = error instanceof CourierRefusal ? error.message : providerMessage(error)
        }
        patch[mode] = { ...stored, lastTestOk: !lastError, lastTestAtMs: nowMs, lastError }
      }
      await deps.store.patchConnection(connection.id, patch)
      return { ...connection, ...patch }
    },

    /**
     * Prices a courier for one order now. Each quote has its own reference,
     * held for the courier's validity window; booking uses it.
     */
    async quote(input: { orgId: string; hostId: string; orderId: string; uid: string; provider: CourierProviderId }): Promise<CourierOrderView> {
      const { hostId, orderId, provider } = input
      const connection = await connectionOrThrow(hostId, provider)
      const record = await recordsOrThrow().read(hostId, orderId)
      if (!record) throw new CourierRefusal(404, 'That order is not a local delivery.')
      const problem = dropProblem(record, connection)
      if (problem) throw new CourierRefusal(409, problem)
      const mode: CourierKeyMode = record.testMode ? 'test' : 'live'
      const keys = openKeys(connection, mode)
      const nowMs = deps.now()
      // Claim a reference: refused while a run is under way.
      const attempt = await deps.store.updateDelivery(hostId, orderId, (current) => {
        const base = current ?? empty(hostId, orderId, input.orgId, nowMs)
        if (base.run && !courierStateIsFinal(base.run.state)) return { result: null }
        const attempts = base.attempts + 1
        return { next: { ...base, attempts, updatedAtMs: nowMs }, result: attempts }
      })
      if (attempt === null) throw new CourierRefusal(409, 'A courier is already on this order.')
      const deliveryRef = courierRef(orderId, attempt)
      const pickup = record.pickup as NonNullable<PluginLocalDeliveryRecord['pickup']>
      let quote
      try {
        quote = await deps.provider(provider).quote(keys, {
          deliveryRef,
          displayRef: record.displayRef,
          pickup: {
            ...pickup,
            ...(pickup.phone ? {} : connection.pickupPhone ? { phone: connection.pickupPhone } : {}),
            ...(connection.pickupNote
              ? { instructions: [pickup.instructions, connection.pickupNote].filter(Boolean).join(' — ') }
              : {}),
          },
          dropoff: record.dropoff as NonNullable<PluginLocalDeliveryRecord['dropoff']>,
          valueCents: record.valueCents,
          currency: record.currency,
          itemCount: record.itemCount,
        })
      } catch (error) {
        throw new CourierRefusal(
          isProviderError(error) && error.kind === 'auth' ? 409 : 502,
          `${label(provider)} could not price this delivery: ${providerMessage(error)}`,
        )
      }
      const quotedAtMs = deps.now()
      const expiresAtMs = Math.min(quote.expiresAtMs ?? Number.POSITIVE_INFINITY, quotedAtMs + QUOTE_TTL_MS)
      const stored = await deps.store.updateDelivery(hostId, orderId, (current) => {
        const base = current ?? empty(hostId, orderId, input.orgId, quotedAtMs)
        if (base.run && !courierStateIsFinal(base.run.state)) return { result: null }
        const next: StoredDelivery = {
          ...base,
          quote: {
            provider,
            deliveryRef: quote.deliveryRef || deliveryRef,
            feeCents: quote.feeCents,
            currency: quote.currency,
            pickupEtaMs: quote.pickupEtaMs,
            dropoffEtaMs: quote.dropoffEtaMs,
            expiresAtMs,
            testMode: record.testMode,
            createdAtMs: quotedAtMs,
            createdByUid: input.uid,
          },
          updatedAtMs: quotedAtMs,
        }
        return { next, result: next }
      })
      if (!stored) throw new CourierRefusal(409, 'A courier is already on this order.')
      return orderView(orderId, stored)
    },

    /**
     * Books the quoted courier. `idempotencyKey` is the console's attempt: a
     * retry with it answers the run the first attempt booked.
     */
    async dispatch(input: { hostId: string; orderId: string; uid: string; idempotencyKey: string }): Promise<CourierOrderView> {
      const { hostId, orderId, idempotencyKey } = input
      if (!/^[A-Za-z0-9_-]{8,120}$/.test(idempotencyKey)) throw new CourierRefusal(400, 'Missing attempt key')
      const record = await recordsOrThrow().read(hostId, orderId)
      if (!record) throw new CourierRefusal(404, 'That order is not a local delivery.')
      const nowMs = deps.now()
      type Claim =
        | { kind: 'existing'; delivery: StoredDelivery }
        | { kind: 'busy' }
        | { kind: 'no_quote' }
        | { kind: 'expired' }
        | { kind: 'not_dispatchable' }
        | { kind: 'claimed'; delivery: StoredDelivery; run: StoredRun }
      const claim = await deps.store.updateDelivery<Claim>(hostId, orderId, (current) => {
        if (current?.run && !courierStateIsFinal(current.run.state)) {
          return {
            result:
              current.run.idempotencyKey === idempotencyKey
                ? { kind: 'existing' as const, delivery: current }
                : { kind: 'busy' as const },
          }
        }
        // A retry of a booking that already finished: answer it, never book again.
        if (current?.run && current.run.idempotencyKey === idempotencyKey) {
          return { result: { kind: 'existing' as const, delivery: current } }
        }
        const quote = current?.quote
        if (!current || !quote) return { result: { kind: 'no_quote' as const } }
        if (quote.expiresAtMs <= nowMs) return { result: { kind: 'expired' as const } }
        if (!record.dispatchable) return { result: { kind: 'not_dispatchable' as const } }
        if (quote.testMode !== record.testMode) return { result: { kind: 'expired' as const } }
        const run: StoredRun = {
          provider: quote.provider,
          deliveryRef: quote.deliveryRef,
          state: 'requested',
          pending: true,
          idempotencyKey,
          trackingUrl: null,
          etaMs: quote.dropoffEtaMs,
          pickupEtaMs: quote.pickupEtaMs,
          feeCents: quote.feeCents,
          currency: quote.currency,
          reason: null,
          testMode: quote.testMode,
          cancelRequested: false,
          cancelReason: null,
          cancelledByStore: false,
          createdAtMs: nowMs,
          createdByUid: input.uid,
          updatedAtMs: nowMs,
        }
        const next: StoredDelivery = {
          ...current,
          quote: null,
          history: filed(current),
          run,
          seenEvents: [],
          open: true,
          nextCheckAtMs: nowMs + RECONCILE_AFTER_MS,
          updatedAtMs: nowMs,
        }
        return { next, result: { kind: 'claimed' as const, delivery: next, run } }
      })
      if (claim.kind === 'busy') throw new CourierRefusal(409, 'A courier is already on this order.')
      if (claim.kind === 'no_quote') throw new CourierRefusal(409, 'Get a quote first.')
      if (claim.kind === 'expired') throw new CourierRefusal(409, 'That quote expired. Get a new one.')
      if (claim.kind === 'not_dispatchable') throw new CourierRefusal(409, notDispatchable(record))
      if (claim.kind === 'existing') return orderView(orderId, claim.delivery)

      const { run } = claim
      const connection = await connectionOrThrow(hostId, run.provider)
      const keys = openKeys(connection, run.testMode ? 'test' : 'live')
      const adapter = deps.provider(run.provider)
      let snapshot: CourierRunSnapshot | null
      try {
        snapshot = await adapter.accept(keys, run.deliveryRef)
      } catch (error) {
        if (isProviderError(error) && error.kind === 'invalid' && error.status === 409) {
          // The courier already holds this reference: adopt what it booked.
          snapshot = await adapter.get(keys, run.deliveryRef).catch(() => null)
        } else if (!isProviderError(error) || error.kind === 'transient' || error.kind === 'rate-limit') {
          // Not known whether it booked. The run stays claimed and pending;
          // the job asks the courier under this reference and settles it.
          throw new CourierRefusal(
            502,
            `${label(run.provider)} did not answer, so it is not known whether a courier was booked. ` +
              'Don’t book again: this order is checked with the courier and updated within a few minutes.',
          )
        } else {
          // Refused outright: nothing was booked. Release the claim.
          const reason = providerMessage(error)
          await deps.store.updateDelivery(hostId, orderId, (current) => {
            if (!current?.run || current.run.deliveryRef !== run.deliveryRef) return { result: null }
            const failed: StoredRun = { ...current.run, state: 'cancelled', pending: false, reason, cancelledByStore: true, updatedAtMs: deps.now() }
            return {
              next: { ...current, run: null, history: [failed, ...current.history].slice(0, HISTORY_KEPT), open: false, nextCheckAtMs: 0, updatedAtMs: deps.now() },
              result: null,
            }
          })
          throw new CourierRefusal(409, `${label(run.provider)} did not book a courier: ${reason}`)
        }
      }
      // Settling the claim (`pending` → booked) is itself a change, so the
      // seller hears of the run even when the courier's first word moved nothing.
      if (snapshot) {
        await applySnapshot(hostId, orderId, { ...snapshot, deliveryRef: run.deliveryRef }, { pendingResolved: true })
      }
      return orderView(orderId, await deps.store.getDelivery(hostId, orderId))
    },

    /**
     * Calls the courier off. `byStore` is the merchant's own choice — the
     * delivery goes back to the store's driver, never "failed"; a refund or a
     * canceled order asks through the job with its reason.
     */
    async cancel(input: { hostId: string; orderId: string; reason: string; byStore: boolean }): Promise<CourierOrderView> {
      const { hostId, orderId } = input
      const delivery = await deps.store.getDelivery(hostId, orderId)
      const run = delivery?.run
      if (!run || courierStateIsFinal(run.state)) {
        // Nothing booked: drop a quote, if any, and answer.
        if (delivery?.quote) {
          await deps.store.updateDelivery(hostId, orderId, (current) =>
            current ? { next: { ...current, quote: null, updatedAtMs: deps.now() }, result: null } : { result: null },
          )
        }
        return orderView(orderId, await deps.store.getDelivery(hostId, orderId))
      }
      const connection = await connectionOrThrow(hostId, run.provider)
      const keys = openKeys(connection, run.testMode ? 'test' : 'live')
      let snapshot: CourierRunSnapshot
      try {
        snapshot = await deps.provider(run.provider).cancel(keys, run.deliveryRef)
      } catch (error) {
        if (isProviderError(error) && error.kind === 'not-found' && run.pending) {
          // The booking never reached the courier: nothing to call off.
          snapshot = { deliveryRef: run.deliveryRef, state: 'cancelled', trackingUrl: null, etaMs: null, pickupEtaMs: null, feeCents: null, currency: null, reason: 'The booking never reached the courier' }
        } else {
          throw new CourierRefusal(
            isProviderError(error) && error.kind === 'invalid' ? 409 : 502,
            `${label(run.provider)} did not cancel the courier: ${providerMessage(error)}`,
          )
        }
      }
      // Mark who asked BEFORE the cancel lands, so the step it brings is right.
      await deps.store.updateDelivery(hostId, orderId, (current) => {
        if (!current?.run || current.run.deliveryRef !== run.deliveryRef) return { result: null }
        return {
          next: {
            ...current,
            run: {
              ...current.run,
              cancelledByStore: input.byStore || current.run.cancelledByStore,
              cancelRequested: !input.byStore || current.run.cancelRequested,
              cancelReason: input.reason,
            },
          },
          result: null,
        }
      })
      await applySnapshot(
        hostId,
        orderId,
        { ...snapshot, deliveryRef: run.deliveryRef, state: 'cancelled', reason: snapshot.reason ?? input.reason },
        { pendingResolved: true },
      )
      return orderView(orderId, await deps.store.getDelivery(hostId, orderId))
    },

    /** Asks the courier where the run stands now. */
    async refresh(hostId: string, orderId: string): Promise<CourierOrderView> {
      const delivery = await deps.store.getDelivery(hostId, orderId)
      const run = delivery?.run
      if (!run || courierStateIsFinal(run.state)) return orderView(orderId, delivery)
      await settle(hostId, orderId, run)
      return orderView(orderId, await deps.store.getDelivery(hostId, orderId))
    },

    /**
     * The job's look at one open run: call it off when the order was
     * refunded or canceled, settle a lost booking, or read where it stands.
     */
    async work(delivery: StoredDelivery): Promise<'cancelled' | 'settled' | 'checked' | 'failed' | 'skipped'> {
      const run = delivery.run
      if (!run || courierStateIsFinal(run.state)) {
        await deps.store.updateDelivery(delivery.hostId, delivery.orderId, (current) =>
          current ? { next: { ...current, open: false, nextCheckAtMs: 0 }, result: null } : { result: null },
        )
        return 'skipped'
      }
      try {
        if (run.cancelRequested) {
          await engine.cancel({
            hostId: delivery.hostId,
            orderId: delivery.orderId,
            reason: run.cancelReason ?? 'The order was canceled',
            byStore: false,
          })
          return 'cancelled'
        }
        const outcome = await settle(delivery.hostId, delivery.orderId, run)
        return outcome
      } catch (error) {
        // Back off: the next look is a poll interval away, whatever failed.
        await deps.store.updateDelivery(delivery.hostId, delivery.orderId, (current) =>
          current?.run?.deliveryRef === run.deliveryRef
            ? { next: { ...current, nextCheckAtMs: deps.now() + RUN_POLL_MS }, result: null }
            : { result: null },
        )
        console.error('[couriers] run not checked', delivery.id, error instanceof Error ? error.message : error)
        return 'failed'
      }
    },
  }
  return engine

  /** Reads the run from the courier and applies it; a pending booking the courier never got is released. */
  async function settle(hostId: string, orderId: string, run: StoredRun): Promise<'settled' | 'checked'> {
    const connection = await connectionOrThrow(hostId, run.provider)
    const keys = openKeys(connection, run.testMode ? 'test' : 'live')
    try {
      const snapshot = await deps.provider(run.provider).get(keys, run.deliveryRef)
      await applySnapshot(hostId, orderId, { ...snapshot, deliveryRef: run.deliveryRef }, { pendingResolved: true })
      return run.pending ? 'settled' : 'checked'
    } catch (error) {
      if (run.pending && error instanceof ProviderError && error.kind === 'not-found') {
        // The booking never reached the courier: release the claim.
        await deps.store.updateDelivery(hostId, orderId, (current) => {
          if (!current?.run || current.run.deliveryRef !== run.deliveryRef) return { result: null }
          const released: StoredRun = {
            ...current.run,
            state: 'cancelled',
            pending: false,
            cancelledByStore: true,
            reason: 'The booking never reached the courier',
            updatedAtMs: deps.now(),
          }
          return {
            next: { ...current, run: null, history: [released, ...current.history].slice(0, HISTORY_KEPT), open: false, nextCheckAtMs: 0, updatedAtMs: deps.now() },
            result: null,
          }
        })
        return 'settled'
      }
      throw error
    }
  }
}

export type CourierEngine = ReturnType<typeof createEngine>
