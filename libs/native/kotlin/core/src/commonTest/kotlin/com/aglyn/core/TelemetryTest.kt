package com.aglyn.core

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.CancellationException

/** Everything Telemetry hands its sink, in order. */
private class RecordingSink : TelemetrySink {
  val calls = mutableListOf<String>()
  override fun record(error: Throwable, context: String) { calls += "record $context ${error.message}" }
  override fun breadcrumb(message: String) { calls += "crumb $message" }
  override fun setUser(uid: String?) { calls += "user ${uid ?: "-"}" }
  override fun setValue(key: String, value: String) { calls += "key $key=$value" }
  override fun log(event: String, parameters: Map<String, String>) {
    calls += "event $event " + parameters.entries.sortedBy { it.key }.joinToString(",") { "${it.key}=${it.value}" }
  }
}

private class UnknownHostException(message: String) : Exception(message)

class TelemetryTest {
  @AfterTest
  fun reset() = Telemetry.stop()

  private fun driveEverything() {
    Telemetry.record(IllegalStateException("denied"), "firestore.listen:sites")
    Telemetry.screen("site.pages")
    Telemetry.event(TelemetryEvent.POS_SALE_COMPLETED, mapOf("tender" to "cash"))
    Telemetry.user("uid-1")
  }

  @Test
  fun theHookIsANoOpWhenCollectionIsOff() {
    val sink = RecordingSink()
    Telemetry.start(collecting = false, sink = sink, app = AglynAppId.AGLYN, version = "1.0.0", build = "1")
    assertFalse(Telemetry.isCollecting)
    driveEverything()
    assertEquals(emptyList(), sink.calls)
  }

  @Test
  fun collectionOnReportsTheVersionScreenEventsUidAndErrors() {
    val sink = RecordingSink()
    Telemetry.start(collecting = true, sink = sink, app = AglynAppId.POS, version = "1.0.0-beta.282", build = "29878357")
    assertTrue(Telemetry.isCollecting)
    driveEverything()
    assertEquals(
      listOf(
        "key app_version=1.0.0-beta.282", "key app_build=29878357", "key app=aglyn-pos",
        "record firestore.listen:sites denied",
        "key screen=site.pages", "crumb screen site.pages", "event screen_view screen_class=site.pages,screen_name=site.pages",
        "crumb pos_sale_completed", "event pos_sale_completed tender=cash",
        "user uid-1",
      ),
      sink.calls,
    )
  }

  @Test
  fun stoppingTurnsTheHookBackIntoANoOp() {
    val sink = RecordingSink()
    Telemetry.start(collecting = true, sink = sink)
    Telemetry.stop()
    val before = sink.calls.toList()
    driveEverything()
    assertEquals(before, sink.calls)
  }

  @Test
  fun anErrorIsSentOncePerKindAndPlaceAndNoiseNever() {
    val sink = RecordingSink()
    Telemetry.start(collecting = true, sink = sink)
    Telemetry.record(IllegalStateException("first"), "firestore.listen:sites")
    Telemetry.record(IllegalStateException("again"), "firestore.listen:sites")
    Telemetry.record(IllegalStateException("other place"), "firestore.listen:orgs")
    Telemetry.record(CancellationException("left the screen"), "firestore.listen:sites")
    Telemetry.record(RuntimeException("wrapped", UnknownHostException("offline")), "firestore.count:sites")
    assertEquals(
      listOf("record firestore.listen:sites first", "record firestore.listen:orgs other place"),
      sink.calls.filter { it.startsWith("record") },
    )
  }

  @Test
  fun onlyIdentifiersLeaveTheApp() {
    val sink = RecordingSink()
    Telemetry.start(collecting = true, sink = sink)
    sink.calls.clear()
    // A name or free text in a screen key or a parameter is never sent as it is.
    Telemetry.screen("Jordan's Bakery")
    Telemetry.event(TelemetryEvent.SIGN_IN, mapOf("method" to "password", "email" to "jordan@example.com", "note" to "two words"))
    Telemetry.screen("site.pages")
    Telemetry.screen("site.pages")
    assertEquals(
      listOf(
        "key screen=other", "crumb screen other", "event screen_view screen_class=other,screen_name=other",
        "crumb sign_in", "event sign_in method=password",
        "key screen=site.pages", "crumb screen site.pages", "event screen_view screen_class=site.pages,screen_name=site.pages",
      ),
      sink.calls,
    )
    assertEquals("firestore.listen:hostMemberships", Telemetry.firestoreContext("listen", "users/u1/hostMemberships"))
    assertEquals("firestore.get:hosts", Telemetry.firestoreContext("get", "hosts/h1"))
  }

  @Test
  fun telemetryIsOnForProductionAndOffForTheEmulatorStack() {
    val production = AglynEnv(
      firebaseApiKey = "key", firebaseAuthDomain = "x.firebaseapp.com", firebaseProjectId = "x", firebaseAppId = "1:1:android:1",
    )
    assertTrue(AglynConfig.read(production, AglynAppId.AGLYN).telemetry)
    assertFalse(AglynConfig.read(production.copy(telemetry = "off"), AglynAppId.AGLYN).telemetry)
    assertFalse(AglynConfig.read(production.copy(telemetry = "maybe"), AglynAppId.AGLYN).telemetry)
    val emulator = production.copy(consoleUrl = "http://10.0.2.2:4200", authEmulatorHost = "10.0.2.2:9099")
    assertFalse(AglynConfig.read(emulator, AglynAppId.AGLYN).telemetry)
    // Even asked for, a local stack never reports.
    assertFalse(AglynConfig.read(emulator.copy(telemetry = "on"), AglynAppId.POS).telemetry)
  }
}
