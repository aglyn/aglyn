// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.pluginhost

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

/** The title bar's Back and Forward walk whole places: the screen with the sidebar's mode it was opened in. */
class NavHistoryTest {
  private data class Place(val screen: String, val mode: String? = null)

  @Test
  fun backAndForwardWalkThePlacesOpened() {
    var history = NavHistory.of(Place("home")).record(Place("orders")).record(Place("pages"))
    history = history.back()
    assertEquals(Place("orders"), history.current)
    history = history.forward()
    assertEquals(Place("pages"), history.current)
    assertEquals(history, history.forward())
    history = history.back().record(Place("analytics"))
    assertFalse(history.canGoForward, "a new place drops what was ahead")
    assertEquals(listOf("home", "orders", "analytics"), history.places.map { it.screen })
  }

  @Test
  fun theSameScreenInAnotherModeIsAnotherPlace() {
    var history = NavHistory.of(Place("home"))
      .record(Place("home", "workspaceSettings"))
      .record(Place("home", "workspaceSettings"))
    assertEquals(2, history.places.size, "the place on screen again is not recorded twice")
    history = history.back()
    assertEquals(Place("home"), history.current)
    assertFalse(history.canGoBack)
  }

  @Test
  fun onlyTheNewestPlacesAreKeptAndTheCurrentCanBeFilledIn() {
    var history = NavHistory.of(Place("0"), limit = 3)
    for (n in 1..5) history = history.record(Place("$n"))
    assertEquals(listOf("3", "4", "5"), history.places.map { it.screen })
    history = history.replaceCurrent(Place("5", "siteSettings")).back()
    assertEquals(Place("4"), history.current)
    assertEquals(Place("5", "siteSettings"), history.forward().current)
  }
}
