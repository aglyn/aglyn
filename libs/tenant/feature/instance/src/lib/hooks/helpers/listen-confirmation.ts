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
 * THE LISTENERS THE SERVER HAS NOT CONFIRMED YET, FOR A SAVE THAT NEEDS ONE
 * (AGL-4120).
 *
 * `writeGuardedBySeed` was handed one boolean, read when the button was
 * clicked, and refused the moment it was true. So a save made a second before
 * the server answered was thrown back at the person who made it, with an
 * instruction to reload — though nothing was wrong and waiting would have
 * done. Under load that window ran to a minute (measured in production, beta.297).
 *
 * A guard cannot watch a value it was passed by copy, and fifty-eight call
 * sites pass one. So the four hooks that produce `fromCache` report here, and
 * the guard asks this module instead of its caller: every listener that was
 * unconfirmed at the click has now heard from the server.
 *
 * ## Which listeners
 *
 * The seed's own, when the save names it (AGL-4135). Each hook that produces
 * `fromCache` also returns a {@link ListenHandle}, which always points at that
 * hook's current listener, and a call site that passes it to the guard waits
 * on that read alone ({@link whenListenConfirmed}).
 *
 * Otherwise all of them, because the guard cannot name its own. That errs one
 * way only: a listener nobody is saving can make a save wait, or refuse it, by
 * being slow, refused or torn down during the wait. It can never let a save
 * through on an unconfirmed seed, because the seed's own listener is in the set
 * being waited on. Measured in production with another tab starving the shared
 * cache (AGL-4135), every listener on a page is slow at once, so waiting on all
 * of them is waiting on the slowest one.
 *
 * Waiting on one listener keeps the same promise. A refusal or a teardown
 * never counts as a confirmation: the wait goes on, for the retry that reports
 * again or for the listener that replaces it, and ends unconfirmed at the
 * deadline if neither comes.
 *
 * ## A confirmation can change what is on screen
 *
 * The seed being protected may be out of date, which is the whole point of the
 * guard. When a listener's confirmation brought values that differ from the
 * ones it had shown, the form the person edited was built from the old ones,
 * so writing it now would overwrite the new ones: the exact loss the guard
 * exists to stop. That settles as `refreshed` and the save is refused for one
 * click, so they see the new values first.
 *
 * ## A confirmation is kept through a short fall back to the cache (AGL-4047)
 *
 * A listener the server has confirmed reads `fromCache` again whenever the
 * client's online state goes `Offline`, which the SDK applies to every view at
 * once (`syncEngineApplyOnlineStateChange`). In the console that is routine,
 * and has nothing to do with the values: a background tab handing the shared
 * cache to the visible one cycles its network (`firestore-primary-yield.ts`),
 * as does a stall recovery in either tab, and every secondary tab takes the
 * holder's `Offline` from the shared client state. The view comes back only
 * when the server marks its target current again, which behind a starved lease
 * holder took longer than the guard's wait. So a card confirmed minutes
 * earlier, whose stored copy never changed, held its next Save for 12 s and
 * then refused it (production, v1.22.2: 2 of 4 presses on Business profile,
 * 30–60 s after an earlier save, with a second console tab open).
 *
 * Such a fall is not the danger the guard exists for. The guard stops a form
 * seeded from a copy the server never vouched for, which can be any age. A
 * cached snapshot that FOLLOWS a confirmation on the same listener can hold
 * nothing older than that confirmation, because the cache only ever moves
 * forward (server values, or writes made on this device); and up to the fall
 * the listener was hearing every change as it happened. So a confirmed
 * listener stays confirmed for {@link SEED_CONFIRMATION_KEPT_MS} after it
 * falls back: the hook keeps reporting `fromCache: false`, and a save writes
 * at once. If the server has not confirmed it again by then, the confirmation
 * LAPSES and the listener is unconfirmed like any other: the hook reports
 * `fromCache: true`, a save waits for the server, and it is refused only if
 * nothing comes within the guard's own wait. The deadline is read from the
 * wall clock as well as a timer, so a device that slept through it never
 * saves over a copy it has not heard about since.
 */

/**
 * How long a save waits for a confirmation before saying so. Past the 8 s stall
 * window, so a client that really is silent has been recovered by the time the
 * wait ends, and short enough to read as a slow save rather than a dead button.
 */
export const SEED_CONFIRM_WAIT_MS = 12_000

let confirmWaitMs = SEED_CONFIRM_WAIT_MS

/**
 * How long a save waits. For a spec that pins what happens when the confirmation
 * never comes, which is the refusal and not the wait: pass `0`, and restore the
 * default (no argument) when done, the way `setStaleSessionCheck` is unregistered.
 */
export function setSeedConfirmWaitMs(ms: number = SEED_CONFIRM_WAIT_MS): void {
  confirmWaitMs = ms
}

/**
 * How long a save waits, as set now: for a Save pressed while it is held
 * (`useHeldSave`, AGL-4047), which keeps the press for exactly as long as the
 * guard would have waited for it.
 */
export function seedConfirmWaitMs(): number {
  return confirmWaitMs
}

/**
 * How long a listener the server confirmed stays confirmed after it falls back
 * to the cache (AGL-4047). Longer than a handoff of the shared cache between
 * two tabs takes to re-confirm (reads waited up to 18.9 s behind a background
 * holder, and a lease went 23.7 s stale, measured in production in AGL-4204),
 * and short enough that a client the server has really stopped answering is
 * soon treated as one.
 */
export const SEED_CONFIRMATION_KEPT_MS = 60_000

let confirmationKeptMs = SEED_CONFIRMATION_KEPT_MS

/**
 * How long a confirmation is kept. For a spec that pins what happens once it
 * lapses: pass `0` to lapse at the fall, and restore the default (no argument)
 * when done.
 */
export function setSeedConfirmationKeptMs(
  ms: number = SEED_CONFIRMATION_KEPT_MS,
): void {
  confirmationKeptMs = ms
}

/** The part of a document snapshot {@link sameDocument} reads. */
interface DocumentValues {
  exists: () => boolean
  data: () => unknown
}

/**
 * Whether two snapshots of one document hold the same values. Read only on the
 * step from a cached snapshot to a confirmed one, never on every update, because
 * the SDK hands a doc listener no list of what changed.
 */
export function sameDocument(a: DocumentValues, b: DocumentValues): boolean {
  if (a.exists() !== b.exists()) return false
  return JSON.stringify(a.data()) === JSON.stringify(b.data())
}

/** How the wait ended. */
export type ListenSettlement =
  /** Every listener that was unconfirmed at the start has heard from the server. */
  | 'confirmed'
  /** They did, and at least one brought different values from the ones it showed. */
  | 'refreshed'
  /** The wait ran out, or a listener was refused or went away before answering. */
  | 'unconfirmed'
  /**
   * No listener here was unconfirmed, so whatever said the seed is unconfirmed
   * is not one this module can vouch for. The caller's answer stands.
   */
  | 'untracked'

/** One listener's line in the record. */
interface Token {
  /**
   * Where its last word left it. A refusal or a teardown is never `confirmed`.
   * A confirmed listener that fell back to the cache stays `confirmed` until
   * its confirmation lapses (`keptUntil`).
   */
  state: 'unconfirmed' | 'confirmed' | 'released'
  /** Its latest confirmation brought values that differ from the ones it showed. */
  changed: boolean
  /**
   * Epoch ms at which a confirmation kept through a fall back to the cache
   * lapses; null while the listener is not on a kept confirmation.
   */
  keptUntil: number | null
  /** End a kept confirmation now: the listener is unconfirmed from here. */
  lapse: () => void
}

interface Waiter {
  pending: Set<Token>
  refreshed: boolean
  lost: boolean
  finish: (settlement: ListenSettlement) => void
}

/** A save waiting on one listener (AGL-4135). */
interface SeedWaiter {
  handle: HandleState
  finish: (settlement: ListenSettlement) => void
}

declare const listenHandleBrand: unique symbol

/**
 * One hook's listener, for a save that waits on it alone (AGL-4135). Stable
 * for the life of the hook, and always points at the hook's CURRENT listener,
 * so a listener replaced during the wait (new deps, a reopen) is the one
 * waited on. Opaque: a call site only hands it to `writeGuardedBySeed`.
 */
export interface ListenHandle {
  readonly [listenHandleBrand]: true
}

interface HandleState {
  token: Token | null
}

/** A handle for one hook instance. Create it once (`useState(createListenHandle)`). */
export function createListenHandle(): ListenHandle {
  const state: HandleState = { token: null }
  return state as unknown as ListenHandle
}

const unconfirmed = new Set<Token>()
const waiters = new Set<Waiter>()
const seedWaiters = new Set<SeedWaiter>()

function settleWaiters(token: Token, how: { changed?: boolean; lost?: boolean }) {
  for (const waiter of [...waiters]) {
    if (!waiter.pending.delete(token)) continue
    if (how.changed) waiter.refreshed = true
    if (how.lost) waiter.lost = true
    if (waiter.pending.size > 0) continue
    if (waiter.lost) waiter.finish('unconfirmed')
    else waiter.finish(waiter.refreshed ? 'refreshed' : 'confirmed')
  }
}

function settleSeedWaiters(token: Token) {
  for (const waiter of [...seedWaiters]) {
    if (waiter.handle.token !== token) continue
    waiter.finish(token.changed ? 'refreshed' : 'confirmed')
  }
}

export interface ListenConfirmation {
  /**
   * A snapshot arrived. `changed` says a confirmation brought different values
   * from the ones this listener had shown; a first answer showed nothing, so
   * it cannot have changed anything.
   *
   * Returns the `fromCache` the hook reports: the snapshot's own, except that
   * a cached snapshot following a confirmation reads `false` while the
   * confirmation is kept (AGL-4047).
   */
  report: (fromCache: boolean, changed?: boolean) => boolean
  /**
   * The listener was refused. A wait on every listener ends unconfirmed; a wait
   * on this one goes on, for the retry.
   */
  release: () => void
  /**
   * The listener was torn down. As `release`, and its handle no longer points
   * at it, so a wait on this one goes on for the listener that replaces it.
   */
  close: () => void
}

export interface TrackListenOptions {
  /**
   * A confirmation kept through a fall back to the cache has lapsed: the hook
   * reports `fromCache: true` from now on, until the server answers.
   */
  onLapse?: () => void
}

/**
 * One listener's line in the record. Unconfirmed from the start, for the same
 * reason every hook's `fromCache` state starts true. With `handle`, the handle
 * points at this listener from now on.
 */
export function trackListenConfirmation(
  handle?: ListenHandle,
  options: TrackListenOptions = {},
): ListenConfirmation {
  let keepTimer: ReturnType<typeof setTimeout> | null = null
  const endKeep = () => {
    if (keepTimer) clearTimeout(keepTimer)
    keepTimer = null
    token.keptUntil = null
  }
  const unconfirm = () => {
    token.state = 'unconfirmed'
    token.changed = false
    unconfirmed.add(token)
  }
  const token: Token = {
    state: 'unconfirmed',
    changed: false,
    keptUntil: null,
    lapse: () => {
      if (token.keptUntil === null) return
      endKeep()
      if (token.state !== 'confirmed') return
      unconfirm()
      options.onLapse?.()
    },
  }
  unconfirmed.add(token)
  const bound = handle as unknown as HandleState | undefined
  if (bound) bound.token = token
  const release = () => {
    endKeep()
    token.state = 'released'
    token.changed = false
    unconfirmed.delete(token)
    settleWaiters(token, { lost: true })
  }
  return {
    report: (fromCache, changed = false) => {
      if (fromCache) {
        // Confirmed, and now the cache's: the client's online state moved,
        // not the values. Kept, from the first such snapshot (AGL-4047).
        if (token.state === 'confirmed' && confirmationKeptMs > 0) {
          if (token.keptUntil === null) {
            token.keptUntil = Date.now() + confirmationKeptMs
            keepTimer = setTimeout(token.lapse, confirmationKeptMs)
          }
          if (Date.now() < token.keptUntil) return false
          token.lapse()
          return true
        }
        endKeep()
        unconfirm()
        return true
      }
      endKeep()
      token.state = 'confirmed'
      token.changed = changed
      unconfirmed.delete(token)
      settleWaiters(token, { changed })
      settleSeedWaiters(token)
      return false
    },
    release,
    close: () => {
      release()
      if (bound?.token === token) bound.token = null
    },
  }
}

/**
 * Whether the listener `handle` points at is on a kept confirmation whose
 * deadline the wall clock has passed (AGL-4047): a device that slept, or a tab
 * whose timers were held back, has not run the lapse yet. It lapses now, so
 * the caller treats the seed as unconfirmed and waits for the server.
 */
export function lapseOverdueConfirmation(handle: ListenHandle): boolean {
  const token = (handle as unknown as HandleState).token
  if (!token || token.keptUntil === null || Date.now() < token.keptUntil) {
    return false
  }
  token.lapse()
  return token.state === 'unconfirmed'
}

/**
 * Resolves when every listener unconfirmed right now has settled, or after
 * `timeoutMs`. Never rejects.
 */
export function whenListensConfirmed(
  timeoutMs: number = confirmWaitMs,
): Promise<ListenSettlement> {
  if (unconfirmed.size === 0) return Promise.resolve('untracked')
  return new Promise((resolve) => {
    const waiter: Waiter = {
      pending: new Set(unconfirmed),
      refreshed: false,
      lost: false,
      finish: (settlement) => {
        clearTimeout(timer)
        waiters.delete(waiter)
        resolve(settlement)
      },
    }
    const timer = setTimeout(() => waiter.finish('unconfirmed'), timeoutMs)
    waiters.add(waiter)
  })
}

/**
 * Resolves when the listener `handle` points at is confirmed, or after
 * `timeoutMs` (AGL-4135). Never rejects.
 *
 * - **Already confirmed**: at once, `refreshed` if that confirmation changed
 *   the values on screen. The caller read `fromCache` before it landed. A
 *   confirmation kept through a fall back to the cache counts, until its
 *   deadline (AGL-4047); past it, the listener is unconfirmed and waited on.
 * - **Unconfirmed, refused or torn down**: waits. A refused listener retries
 *   and reports again; a torn-down one is replaced, and the handle points at
 *   the replacement. Neither is ever taken for a confirmation.
 * - **No listener behind the handle** (its hook has not listened, or has
 *   stopped): `untracked`, so the caller's answer stands.
 */
export function whenListenConfirmed(
  handle: ListenHandle,
  timeoutMs: number = confirmWaitMs,
): Promise<ListenSettlement> {
  const state = handle as unknown as HandleState
  const token = state.token
  if (!token) return Promise.resolve('untracked')
  lapseOverdueConfirmation(handle)
  if (token.state === 'confirmed') {
    return Promise.resolve(token.changed ? 'refreshed' : 'confirmed')
  }
  return new Promise((resolve) => {
    const waiter: SeedWaiter = {
      handle: state,
      finish: (settlement) => {
        clearTimeout(timer)
        seedWaiters.delete(waiter)
        resolve(settlement)
      },
    }
    const timer = setTimeout(() => waiter.finish('unconfirmed'), timeoutMs)
    seedWaiters.add(waiter)
  })
}
