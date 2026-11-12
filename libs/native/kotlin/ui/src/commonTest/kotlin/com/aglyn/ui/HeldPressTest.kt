// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A Save pressed while it is held is kept and runs once the server's copy is in, or is refused after the guard's wait
 * (AGL-4047, the console's `useHeldSave`, #2643). The Apple kit's HeldPressTests asserts the same.
 */
class HeldPressTest {
  @Test
  fun aPressWithNothingHeldRunsAtOnce() {
    val held = HeldPress()
    assertTrue(held.pressed(checking = false))
    assertFalse(held.waiting)
  }

  @Test
  fun aPressDuringTheHoldIsKeptAndRunsWhenItLifts() {
    val held = HeldPress()
    assertFalse(held.pressed(checking = true), "kept, not run on the cache's copy")
    assertTrue(held.waiting)
    assertFalse(held.pressed(checking = true), "a second press is the same press")
    assertEquals(1, held.press)
    assertFalse(held.lifted(checking = true), "still held")
    assertTrue(held.lifted(checking = false), "the server's copy is in: run it")
    assertFalse(held.waiting)
    assertFalse(held.lifted(checking = false), "it runs once")
  }

  @Test
  fun aKeptPressWithNoConfirmationIsRefusedAndSavesNothing() {
    val held = HeldPress()
    held.pressed(checking = true)
    held.timedOut(FormHold.of("store settings").unconfirmed)
    assertFalse(held.waiting)
    assertEquals(
      "We could not confirm your store settings with the server yet, so nothing was saved. What you entered is still here. " +
        "Check your connection and save again in a moment.",
      held.refusal,
    )
    assertFalse(held.lifted(checking = false), "a refused press never runs later")
    assertTrue(held.pressed(checking = false), "the next press runs")
    assertNull(held.refusal, "and clears the refusal")
  }

  @Test
  fun aLiftBeforeTheWaitEndsMeansNoRefusal() {
    val held = HeldPress()
    held.pressed(checking = true)
    held.lifted(checking = false)
    held.timedOut("late")
    assertNull(held.refusal)
    assertEquals("Checking your entry with the server…", FormHold.of("entry").checking)
  }
}
