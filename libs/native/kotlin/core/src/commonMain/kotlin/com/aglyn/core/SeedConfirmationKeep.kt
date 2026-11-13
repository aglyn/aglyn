// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.core

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * A listener the server confirmed stays confirmed through a short fall back to the device cache (AGL-4047, the
 * console's `listen-confirmation.ts`, #2670).
 *
 * A confirmed listener reads `fromCache` again whenever the device drops off the network for a moment, though its values
 * did not move. A form seeded from it then held its next Save, and refused it once the guard's wait ran out. Such a fall
 * is not what the guard exists for: a cached snapshot that FOLLOWS a confirmation on the same listener holds nothing
 * older than that confirmation, since the cache only moves forward, and up to the fall the listener heard every change
 * as it happened. So the confirmation is kept for [KEPT_MS] from the first cached snapshot: the listener keeps reporting
 * `fromCache` false. If the server has not confirmed it again by then, the confirmation LAPSES and the listener reports
 * `fromCache` true like any unconfirmed one, so a save waits for the server. The deadline is read from the wall clock,
 * so a device that slept through it lapses as it wakes. The Apple kit's `SeedConfirmationKeep`.
 */
class SeedConfirmationKeep {
  /** The server's latest word on this listener was a confirmation, and it has not lapsed. */
  var confirmed = false
    private set

  /** Epoch ms at which a confirmation kept through a fall lapses; null while none is being kept. */
  var keptUntil: Long? = null
    private set

  /** A confirmation is being kept through a fall back to the cache. */
  val keeping: Boolean get() = keptUntil != null

  /**
   * A snapshot arrived. Returns the `fromCache` the listener reports: the snapshot's own, except that a cached snapshot
   * following a confirmation reads false until the keep's deadline.
   */
  fun report(fromCache: Boolean, nowMs: Long, keptMs: Long = keptForMs): Boolean {
    if (!fromCache) {
      confirmed = true
      keptUntil = null
      return false
    }
    if (confirmed && keptMs > 0) {
      val until = keptUntil ?: (nowMs + keptMs)
      keptUntil = until
      if (nowMs < until) return false
    }
    reset()
    return true
  }

  /** The wall clock passed a kept confirmation's deadline: it lapses. True when it lapsed now. */
  fun lapseIfOverdue(nowMs: Long): Boolean {
    val until = keptUntil ?: return false
    if (nowMs < until) return false
    reset()
    return true
  }

  /** The listener was refused or torn down: nothing it said before counts. */
  fun reset() {
    confirmed = false
    keptUntil = null
  }

  companion object {
    /** How long a confirmation is kept after the fall: the console's `SEED_CONFIRMATION_KEPT_MS`. */
    const val KEPT_MS = 60_000L

    /** How long a confirmation is kept. A test that pins the lapse sets it, and puts back [KEPT_MS]. */
    var keptForMs = KEPT_MS
  }
}

/**
 * One listener's keep, with the watch that lapses it. While a confirmation is kept it reads the wall clock ([now]) every
 * [tickMs], so a device that slept lapses within a tick of waking; on the lapse it calls [onLapse], which delivers the
 * last snapshot again as the cache's. Call it from one thread: the listener's callbacks and [scope]'s dispatcher.
 */
class SeedConfirmationKeeper(
  private val scope: CoroutineScope,
  private val now: () -> Long,
  private val tickMs: Long = TICK_MS,
  private val onLapse: () -> Unit,
) {
  private val keep = SeedConfirmationKeep()
  private var watch: Job? = null

  /** A snapshot arrived: the `fromCache` to report for it. */
  fun report(fromCache: Boolean): Boolean {
    val reported = keep.report(fromCache, now())
    if (keep.keeping) {
      if (watch == null) startWatch()
    } else {
      stopWatch()
    }
    return reported
  }

  /** The listener was refused or removed. */
  fun reset() {
    keep.reset()
    stopWatch()
  }

  /** Lapses a kept confirmation whose deadline the wall clock has passed, and says so. */
  fun lapseIfOverdue(): Boolean {
    if (!keep.lapseIfOverdue(now())) return false
    watch = null
    onLapse()
    return true
  }

  private fun startWatch() {
    watch = scope.launch {
      while (isActive) {
        delay(tickMs)
        if (lapseIfOverdue()) return@launch
      }
    }
  }

  private fun stopWatch() {
    watch?.cancel()
    watch = null
  }

  companion object {
    /** How often a kept confirmation reads the wall clock. */
    const val TICK_MS = 1_000L
  }
}
