// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.core

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * A confirmed listener stays confirmed through a short fall back to the cache, and lapses by the wall clock (AGL-4047,
 * the console's `listen-confirmation.spec.ts`, #2670). The Apple kit's SeedConfirmationKeepTests asserts the same.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SeedConfirmationKeepTest {
  private val start = 1_000_000_000L

  @Test
  fun anUnconfirmedListenerReportsTheCacheAsItIs() {
    val keep = SeedConfirmationKeep()
    assertTrue(keep.report(fromCache = true, nowMs = start, keptMs = 60_000), "never confirmed: nothing to keep")
    assertFalse(keep.keeping)
    assertFalse(keep.report(fromCache = false, nowMs = start, keptMs = 60_000))
    assertTrue(keep.confirmed)
  }

  @Test
  fun aConfirmationIsKeptThroughAShortFallAndRenewedByTheServer() {
    val keep = SeedConfirmationKeep()
    keep.report(fromCache = false, nowMs = start, keptMs = 60_000)
    assertFalse(keep.report(fromCache = true, nowMs = start + 1_000, keptMs = 60_000), "kept: still confirmed")
    assertEquals(start + 61_000, keep.keptUntil, "counted from the first fall")
    assertFalse(keep.report(fromCache = true, nowMs = start + 30_000, keptMs = 60_000))
    assertEquals(start + 61_000, keep.keptUntil, "a second cached snapshot keeps the deadline")
    assertFalse(keep.report(fromCache = false, nowMs = start + 40_000, keptMs = 60_000), "the server answers again")
    assertFalse(keep.keeping)
    assertFalse(keep.report(fromCache = true, nowMs = start + 200_000, keptMs = 60_000), "a later fall is kept afresh")
    assertEquals(start + 260_000, keep.keptUntil)
  }

  @Test
  fun aKeptConfirmationLapsesAtItsDeadline() {
    val keep = SeedConfirmationKeep()
    keep.report(fromCache = false, nowMs = start, keptMs = 60_000)
    keep.report(fromCache = true, nowMs = start, keptMs = 60_000)
    assertFalse(keep.lapseIfOverdue(start + 59_999))
    assertTrue(keep.lapseIfOverdue(start + 60_000))
    assertFalse(keep.confirmed)
    assertTrue(keep.report(fromCache = true, nowMs = start + 61_000, keptMs = 60_000), "lapsed: the cache is the cache")
    assertFalse(keep.keeping, "and is not kept again until the server confirms")
  }

  @Test
  fun aCachedSnapshotPastTheDeadlineLapsesItWithoutTheWatch() {
    val keep = SeedConfirmationKeep()
    keep.report(fromCache = false, nowMs = start, keptMs = 60_000)
    keep.report(fromCache = true, nowMs = start, keptMs = 60_000)
    assertTrue(keep.report(fromCache = true, nowMs = start + 600_000, keptMs = 60_000), "a device that slept past it")
    assertFalse(keep.confirmed)
  }

  @Test
  fun noKeepLapsesAtTheFall() {
    val keep = SeedConfirmationKeep()
    keep.report(fromCache = false, nowMs = start, keptMs = 0)
    assertTrue(keep.report(fromCache = true, nowMs = start, keptMs = 0))
  }

  @Test
  fun aResetForgetsTheConfirmation() {
    val keep = SeedConfirmationKeep()
    keep.report(fromCache = false, nowMs = start, keptMs = 60_000)
    keep.reset()
    assertTrue(keep.report(fromCache = true, nowMs = start, keptMs = 60_000), "a refused listener's confirmation never counts")
  }

  @Test
  fun theKeeperLapsesByTheWallClockAndRedeliversAsTheCaches() = runTest {
    var clock = start
    var lapses = 0
    val keeper = SeedConfirmationKeeper(backgroundScope, { clock }) { lapses++ }

    assertFalse(keeper.report(fromCache = false))
    assertFalse(keeper.report(fromCache = true), "kept")
    advanceTimeBy(5_000)
    runCurrent()
    assertEquals(0, lapses, "the wall clock has not reached the deadline")

    // The device slept: its timers stood still while the wall clock moved past the deadline.
    clock = start + 61_000
    advanceTimeBy(1_000)
    runCurrent()
    assertEquals(1, lapses)
    assertTrue(keeper.report(fromCache = true), "lapsed")
    advanceTimeBy(5_000)
    runCurrent()
    assertEquals(1, lapses, "it lapses once")
  }

  @Test
  fun theServerAnsweringStopsTheWatch() = runTest {
    var clock = start
    var lapses = 0
    val keeper = SeedConfirmationKeeper(backgroundScope, { clock }) { lapses++ }

    keeper.report(fromCache = false)
    keeper.report(fromCache = true)
    assertFalse(keeper.report(fromCache = false), "the server confirmed again")
    clock = start + 600_000
    advanceTimeBy(5_000)
    runCurrent()
    assertEquals(0, lapses)
  }
}
