// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.pluginhost

/**
 * Where a window has been, for the title bar's Back and Forward (tablets and desktop): each place opened, in order, at
 * most [limit] of them. The Apple twin is AglynCore's `NavHistory`.
 *
 * A place is everything Back has to put back, not only the screen: the shell keeps the sidebar's settings mode in it, so
 * going Back out of Site settings or Workspace settings returns to the list that place was opened in, not the screen
 * alone over the list in use now (AGL-3996).
 */
data class NavHistory<P>(val places: List<P>, val index: Int, val limit: Int = 50) {
  val current: P get() = places[index]
  val canGoBack: Boolean get() = index > 0
  val canGoForward: Boolean get() = index < places.lastIndex

  /** A place opened: going somewhere new drops what was ahead; the place on screen again is not a new one. */
  fun record(place: P): NavHistory<P> {
    if (places[index] == place) return this
    val next = (places.take(index + 1) + place).takeLast(limit.coerceAtLeast(1))
    return copy(places = next, index = next.lastIndex)
  }

  /** The place before this one on screen; unchanged when there is none. */
  fun back(): NavHistory<P> = if (canGoBack) copy(index = index - 1) else this

  /** The place after this one on screen; unchanged when there is none. */
  fun forward(): NavHistory<P> = if (canGoForward) copy(index = index + 1) else this

  /** What is now known about the place on screen, in its stead, without making it a new place. */
  fun replaceCurrent(place: P): NavHistory<P> = copy(places = places.toMutableList().also { it[index] = place })

  companion object {
    fun <P> of(start: P, limit: Int = 50): NavHistory<P> = NavHistory(listOf(start), 0, limit)
  }
}
