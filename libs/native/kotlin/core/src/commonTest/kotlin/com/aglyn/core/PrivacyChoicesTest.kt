// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.core

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** A sink that records the Analytics switch and the events, nothing else. */
private class SwitchSink : TelemetrySink {
  val calls = mutableListOf<String>()
  override fun record(error: Throwable, context: String) { calls += "record $context" }
  override fun breadcrumb(message: String) {}
  override fun setUser(uid: String?) {}
  override fun setValue(key: String, value: String) {}
  override fun log(event: String, parameters: Map<String, String>) { calls += "event $event" }
  override fun setAnalyticsCollection(on: Boolean) { calls += "analytics $on" }
}

/** "Your Privacy Choices": the analytics choice kept on this device, read before telemetry starts and applied at once. */
class PrivacyChoicesTest {
  @AfterTest
  fun reset() = Telemetry.stop()

  /** Nothing stored: what the build does today (Analytics on wherever the build collects). */
  @Test
  fun withNothingStoredAnalyticsFollowTheBuild() {
    val store = InMemoryKeyValueStore()
    assertTrue(PrivacyChoices.analyticsAllowed(store))
    val sink = SwitchSink()
    Telemetry.start(collecting = true, sink = sink, analytics = PrivacyChoices.analyticsAllowed(store))
    Telemetry.screen("home")
    assertEquals(listOf("analytics true", "event screen_view"), sink.calls)
  }

  /** A stored refusal is read before start: Analytics is switched off and no event is logged; errors still go to crash reports. */
  @Test
  fun aStoredRefusalIsReadBeforeStart() {
    val store = InMemoryKeyValueStore().apply { set(PrivacyChoices.ANALYTICS_KEY, "false") }
    val sink = SwitchSink()
    Telemetry.start(collecting = true, sink = sink, analytics = PrivacyChoices.analyticsAllowed(store))
    Telemetry.screen("home")
    Telemetry.event(TelemetryEvent.SIGN_IN)
    Telemetry.record(IllegalStateException("x"), "place")
    assertEquals(listOf("analytics false", "record place"), sink.calls)
  }

  /** Flipping the switch stores the choice and calls the collection switch at once, both ways. */
  @Test
  fun flippingTheSwitchAppliesAtOnce() {
    val store = InMemoryKeyValueStore()
    val sink = SwitchSink()
    Telemetry.start(collecting = true, sink = sink, analytics = true)
    PrivacyChoices.setAnalytics(store, false)
    assertFalse(PrivacyChoices.analyticsAllowed(store))
    Telemetry.event(TelemetryEvent.SIGN_IN)
    PrivacyChoices.setAnalytics(store, true)
    Telemetry.event(TelemetryEvent.SIGN_IN)
    assertEquals(listOf("analytics true", "analytics false", "analytics true", "event sign_in"), sink.calls)
  }

  /** A build that does not collect (debug, emulator stack) sends nothing whatever the choice; the choice is still kept. */
  @Test
  fun aBuildThatDoesNotCollectStaysSilent() {
    val store = InMemoryKeyValueStore()
    val sink = SwitchSink()
    Telemetry.start(collecting = false, sink = sink, analytics = true)
    PrivacyChoices.setAnalytics(store, false)
    PrivacyChoices.setAnalytics(store, true)
    Telemetry.screen("home")
    assertEquals(emptyList(), sink.calls)
    assertTrue(PrivacyChoices.analyticsAllowed(store))
  }
}
