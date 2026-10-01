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
  disableNetwork,
  enableNetwork,
  type Firestore,
} from 'firebase/firestore'

import { browserWedgeEscalationFor } from './firestore-multitab-wedge'

/**
 * RECOVERING A FIRESTORE CLIENT THAT HAS STOPPED SYNCING (AGL-3373).
 *
 * ## The wedge
 *
 * The console runs the persistent cache with `persistentMultipleTabManager`
 * (`firestore-cache.ts`). Only the PRIMARY tab talks to the backend; every
 * other tab reads the shared IndexedDB cache and takes its online state from
 * a `localStorage` record the primary writes. A secondary that believes the
 * client is online answers a `getDocs` only once the primary has synced the
 * query, and raises no first snapshot for a listener whose cache is empty.
 *
 * When the primary dies without handing over — a crashed, discarded or
 * frozen tab — its "Online" record outlives it, and until some tab runs the
 * lease election and wins, nothing syncs. The election runs on a 4-second
 * timer inside each tab, which the browser throttles to about once a minute
 * in a hidden tab. On 2026-09-28 no live tab synced for about ten minutes:
 * the notifications page never left its loading state and a staff page sat
 * on its splash until a fresh tab (which wins the election on start) was
 * opened.
 *
 * ## The recovery, and why it is this one
 *
 * `disableNetwork` then `enableNetwork`, from the tab that noticed. Both are
 * public API, and in the multi-tab client each one calls
 * `setNetworkEnabled`, which schedules the lease election for IMMEDIATE
 * execution instead of the next (possibly throttled) timer tick. A visible
 * tab that finds the lease lapsed takes it, starts its own streams and
 * writes its own online state, which replaces the dead tab's. A tab that was
 * already primary with a silently dead stream gets fresh streams.
 *
 * Nothing is lost. Writes made meanwhile sit in the mutation queue (in
 * IndexedDB, under the persistent cache) and are sent when the network comes
 * back; the SDK's own contract for `disableNetwork` is that writes queue.
 *
 * The rejected alternatives:
 *
 * - **Clearing the persistence cache** (`terminate` + `clearIndexedDbPersistence`).
 *   It deletes the mutation queue, so pending writes are lost, and
 *   `waitForPendingWrites` cannot drain them first because draining is the
 *   very thing that is stuck. It also refuses to run while any other tab
 *   holds the database, which in a multi-tab wedge is always. And
 *   `terminate` invalidates the one `Firestore` instance every hook in the
 *   console holds.
 * - **Pruning the dead tab's online-state record at startup**, beside the
 *   AGL-2845 prune. The SDK already ignores an online-state record at
 *   startup unless its writer is an active, non-zombie client
 *   (`WebStorageSharedClientState.handleOnlineStateEvent`), and a freshly
 *   started tab wins the election anyway — which is why a fresh tab fixed
 *   the incident. The tabs that stayed stuck were the ones ALREADY running,
 *   which a startup prune never reaches.
 * - **`persistentSingleTabManager`.** It removes cross-tab dependency, but
 *   every tab after the first falls back to a memory cache, so writes made
 *   offline in those tabs are lost when they close. And a tab still on the
 *   multi-tab build that meets a single-tab lease holder fails its queue
 *   with `failed-precondition` until reloaded, so the rollout itself would
 *   wedge the tabs left open across it.
 *
 * ## Guards
 *
 * - **Online only.** A browser that reports no network is correctly offline,
 *   and the cache answering is the cache doing its job.
 * - **Visible only.** A hidden tab's timers are throttled and its reader is
 *   not waiting; if it is stalled, it recovers the moment it is looked at.
 * - **Once per {@link STALL_RECOVERY_COOLDOWN_MS} per client.** Every list on
 *   a page stalls together, and one cycle serves them all. A concurrent
 *   request shares the cycle already running.
 * - **The network is always re-enabled**, including when disabling fails.
 * - **Each step is bounded by {@link NETWORK_STEP_TIMEOUT_MS}.** Both calls are
 *   queued on the client's AsyncQueue, and when another tab has locked the
 *   shared IndexedDB they queue behind an operation that never finishes
 *   (AGL-3428). Unbounded, the first such cycle never settled, and every
 *   later recovery request shared it forever.
 *
 * ## When the cycle is not enough (AGL-3428)
 *
 * A tab frozen partway through an IndexedDB transaction holds every store the
 * SDK uses, and the election the cycle forces cannot run. For a client on the
 * durable multi-tab cache the cycle is followed by the lease check in
 * `firestore-multitab-wedge.ts`, which moves the tab to a memory cache when
 * the lease shows the wedge.
 */

/**
 * How long a server read or a listener's first server-confirmed snapshot may
 * take before the client is treated as stalled. A healthy console answers
 * in well under two seconds; this leaves room for a slow network without
 * leaving a reader on a spinner for long.
 */
export const FIRESTORE_STALL_MS = 8_000

/** The least time between two recoveries of the same client. */
export const STALL_RECOVERY_COOLDOWN_MS = 30_000

/**
 * The longest `disableNetwork` or `enableNetwork` may take. Both finish in
 * milliseconds on a client whose queue is moving.
 */
export const NETWORK_STEP_TIMEOUT_MS = 5_000

/** What a recovery request did. */
export type StallRecoveryOutcome =
  /** The browser reports no network: the cache is the right answer. */
  | 'offline'
  /** The tab is hidden: nobody is waiting on it. */
  | 'hidden'
  /** A recovery ran moments ago; this request rode on it. */
  | 'cooling'
  /** The network was cycled. */
  | 'recovered'
  /** The cycle threw or timed out; the network was still re-enabled if at all possible. */
  | 'failed'
  /** The multi-tab cache was wedged and this tab is moving to the memory cache. */
  | 'fell-back'

export interface StallRecoveryDeps {
  /** Take the client off the network. */
  disable: () => Promise<void>
  /** Put it back. */
  enable: () => Promise<void>
  /** `navigator.onLine`, or `true` where there is no navigator. */
  isOnline?: () => boolean
  /** Whether the document is visible, or `true` where there is none. */
  isVisible?: () => boolean
  now?: () => number
  cooldownMs?: number
  /** The bound on each of `disable` and `enable`. */
  stepTimeoutMs?: number
  /**
   * Runs after every cycle; resolves `true` when it has moved the tab off
   * the shared cache. Only a multi-tab client has one.
   */
  afterCycle?: () => Promise<boolean>
}

export interface StallRecovery {
  recover: () => Promise<StallRecoveryOutcome>
}

const browserOnline = () =>
  typeof navigator === 'undefined' || navigator.onLine !== false

const documentVisible = () =>
  typeof document === 'undefined' || document.visibilityState !== 'hidden'

/** The recovery for one client, with its guards. Pure over `deps`. */
export function createStallRecovery(deps: StallRecoveryDeps): StallRecovery {
  const {
    disable,
    enable,
    isOnline = browserOnline,
    isVisible = documentVisible,
    now = Date.now,
    cooldownMs = STALL_RECOVERY_COOLDOWN_MS,
    stepTimeoutMs = NETWORK_STEP_TIMEOUT_MS,
    afterCycle,
  } = deps
  let lastStartedAt: number | undefined
  let running: Promise<StallRecoveryOutcome> | undefined

  /** Whether `step` settled successfully within `stepTimeoutMs`. */
  const bounded = (step: () => Promise<void>): Promise<boolean> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), stepTimeoutMs)
      const done = (ok: boolean) => {
        clearTimeout(timer)
        resolve(ok)
      }
      try {
        step().then(
          () => done(true),
          () => done(false),
        )
      } catch {
        done(false)
      }
    })

  const cycle = async (): Promise<StallRecoveryOutcome> => {
    let outcome: StallRecoveryOutcome = 'recovered'
    if (!(await bounded(disable))) outcome = 'failed'
    if (!(await bounded(enable))) outcome = 'failed'
    if (afterCycle) {
      try {
        if (await afterCycle()) return 'fell-back'
      } catch {
        // The escalation is best effort; the cycle's own outcome stands.
      }
    }
    return outcome
  }

  return {
    recover: () => {
      if (running) return running
      if (!isOnline()) return Promise.resolve('offline')
      if (!isVisible()) return Promise.resolve('hidden')
      const at = now()
      if (lastStartedAt !== undefined && at - lastStartedAt < cooldownMs) {
        return Promise.resolve('cooling')
      }
      lastStartedAt = at
      running = cycle().finally(() => {
        running = undefined
      })
      return running
    },
  }
}

const recoveries = new WeakMap<Firestore, StallRecovery>()

/**
 * Recovers `firestore` if it has stalled. Safe to call from every reader
 * that notices: the guards above collapse the calls into at most one network
 * cycle per cooldown. Never rejects.
 */
export function recoverStalledFirestore(
  firestore: Firestore | null | undefined,
): Promise<StallRecoveryOutcome> {
  if (!firestore || typeof firestore !== 'object') {
    return Promise.resolve('failed')
  }
  let recovery = recoveries.get(firestore)
  if (!recovery) {
    recovery = createStallRecovery({
      disable: () => disableNetwork(firestore),
      enable: () => enableNetwork(firestore),
      afterCycle: browserWedgeEscalationFor(firestore),
    })
    recoveries.set(firestore, recovery)
  }
  return recovery.recover().catch(() => 'failed' as const)
}

/**
 * Arms a stall timer for one read or listen. If `disarm` has not been called
 * within `stallMs`, `onStall` runs (by default, {@link recoverStalledFirestore}).
 * A tab that is hidden when the timer fires waits until it is shown, since
 * that is when a reader is waiting again.
 *
 * Returns `disarm`, which is idempotent.
 */
export function armFirestoreStallWatch(
  firestore: Firestore | null | undefined,
  options: { stallMs?: number; onStall?: () => void } = {},
): () => void {
  const { stallMs = FIRESTORE_STALL_MS } = options
  const onStall =
    options.onStall ?? (() => void recoverStalledFirestore(firestore))
  let done = false
  let onVisible: (() => void) | undefined
  const fire = () => {
    if (done) return
    if (!documentVisible() && typeof document !== 'undefined') {
      onVisible = () => {
        if (!documentVisible()) return
        document.removeEventListener('visibilitychange', onVisible!)
        onVisible = undefined
        fire()
      }
      document.addEventListener('visibilitychange', onVisible)
      return
    }
    done = true
    onStall()
  }
  const timer = setTimeout(fire, stallMs)
  return () => {
    if (done) return
    done = true
    clearTimeout(timer)
    if (onVisible && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible)
    }
  }
}
