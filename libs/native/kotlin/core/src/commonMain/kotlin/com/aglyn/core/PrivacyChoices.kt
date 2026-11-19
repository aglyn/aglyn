// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.core

/**
 * "Your Privacy Choices" (Console chrome row 3; the owner's decision of 2026-11-19): the person's analytics choice, kept
 * on THIS device ([KeyValueStore]: SharedPreferences on Android), never on the account. It is read before telemetry
 * starts (`FirebaseTelemetrySink.install`) and applied at once when the switch moves. With nothing stored the apps do
 * what the build does today: a release build on production sends Analytics; a debug build sends nothing whatever the
 * choice. Crash reports are not part of it. The Apple kit's `PrivacyChoices.swift`.
 */
object PrivacyChoices {
  /** The device setting's key. */
  const val ANALYTICS_KEY = "aglyn.privacyChoices.analytics"

  /** The stored choice; true (allowed) when the person never chose. */
  fun analyticsAllowed(store: KeyValueStore): Boolean = store.get(ANALYTICS_KEY) != "false"

  /** Stores the choice on this device and applies it at once. */
  fun setAnalytics(store: KeyValueStore, allowed: Boolean) {
    store.set(ANALYTICS_KEY, allowed.toString())
    Telemetry.setAnalytics(allowed)
  }
}
