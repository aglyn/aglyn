// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.core

// A SAVE IS NEVER PRESSED ON THE CACHE'S COPY, AND NEVER REFUSED FOR IT (AGL-4047): the console's `isSeedChecking`,
// `seedCheckingText` and `rebaseSeedEdits`. A form seeded from a read only the device cache has answered holds its Save,
// with the reason beside it, until the server's copy is in; and when a newer copy arrives, what the person changed keeps
// their value while everything they left alone follows the new copy. The Apple kit's SeedEdits.swift.

/** What a held Save says beside it, for the guard's subject ("site settings", "entry"). */
fun seedCheckingText(subject: String): String = "Checking your $subject with the server…"

/**
 * What a Save pressed while held says when the server's copy never came within the guard's wait (AGL-4047, the console's
 * `seedUnconfirmedText`): nothing was saved, what was typed is still there, and saving again in a moment is the remedy.
 */
fun seedUnconfirmedText(subject: String): String =
  "We could not confirm your $subject with the server yet, so nothing was saved. What you entered is still here. " +
    "Check your connection and save again in a moment."

/** One value over a seed that moved from [previous] to [next]: kept when the person changed it, else the new seed. */
fun <T> rebased(current: T, previous: T, next: T): T = if (current == previous) next else current

/**
 * A form's values over a seed that moved from [previous] to [next], key by key (`rebaseSeedEdits`): a key the person changed
 * (or cleared) keeps what they made it, every other key follows the new seed.
 */
fun <V> rebased(current: Map<String, V>, previous: Map<String, V>, next: Map<String, V>): Map<String, V> =
  buildMap {
    for (key in next.keys + current.keys + previous.keys) {
      val edited = current[key] != previous[key] || (key in current) != (key in previous)
      val source = if (edited) current else next
      if (key in source) @Suppress("UNCHECKED_CAST") put(key, source[key] as V)
    }
  }
