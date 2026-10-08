package com.aglyn.hardware

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertSame
import kotlin.test.assertTrue

private const val PI = "pi_123456789"
private const val SECRET = "pi_123456789_secret_abcdefghij"

/** Records what the sequence asked the SDK for, and answers from a script. */
private class ScriptedPort(
  var retrieved: TerminalResult = TerminalResult.Ok(TerminalIntent(PI, "requires_payment_method", 1150)),
  var collected: TerminalResult = TerminalResult.Ok(TerminalIntent(PI, "requires_confirmation", 1150)),
  var confirmed: TerminalResult = TerminalResult.Ok(TerminalIntent(PI, "requires_capture", 1150)),
) : TerminalPaymentPort {
  val calls = mutableListOf<String>()
  var skipTipping: Boolean? = null

  override suspend fun retrieve(clientSecret: String): TerminalResult = retrieved.also { calls += "retrieve" }

  override suspend fun collect(intentId: String, skipTipping: Boolean): TerminalResult {
    calls += "collect"
    this.skipTipping = skipTipping
    return collected
  }

  override suspend fun confirm(intentId: String): TerminalResult = confirmed.also { calls += "confirm" }
}

private val M2 = DeviceReader("STRM2", "Stripe Reader M2", CardCollectorKind.BLUETOOTH, simulated = true, deviceType = "STRIPE_M2")
private val WISEPAD = M2.copy(id = "WP3", deviceType = "WISEPAD_3")
private val REQUEST = CardCollectRequest(PI, SECRET, 1150)

class DeviceReaderTest {
  @Test
  fun retrievesCollectsThenConfirms() = runTest {
    val port = ScriptedPort()
    assertEquals(CardCollectOutcome.Collected(PI, 1150, 0), collectCardPayment(port, REQUEST, M2))
    assertEquals(listOf("retrieve", "collect", "confirm"), port.calls)
    assertEquals(true, port.skipTipping)
  }

  @Test
  fun refusesBeforeTheCardIsAskedFor() = runTest {
    val port = ScriptedPort()
    val noReader = collectCardPayment(port, REQUEST, null)
    assertEquals("Connect Tap to Pay or a card reader first.", (noReader as CardCollectOutcome.Failed).message)
    val forged = collectCardPayment(port, REQUEST.copy(clientSecret = "pi_999999999_secret_abcdefghij"), M2)
    assertEquals("The payment to collect does not match its secret.", (forged as CardCollectOutcome.Failed).message)
    assertTrue(port.calls.isEmpty())

    port.retrieved = TerminalResult.Ok(TerminalIntent(PI, "requires_payment_method", 999))
    val wrongAmount = collectCardPayment(port, REQUEST, M2)
    assertEquals("The amount to charge does not match the register. Start the payment again.", (wrongAmount as CardCollectOutcome.Failed).message)
    port.retrieved = TerminalResult.Ok(TerminalIntent("pi_999999999", "requires_payment_method", 1150))
    assertIs<CardCollectOutcome.Failed>(collectCardPayment(port, REQUEST, M2))
    assertEquals(listOf("retrieve", "retrieve"), port.calls)
  }

  @Test
  fun anAlreadyAuthorizedIntentIsReportedNotChargedAgain() = runTest {
    val port = ScriptedPort(retrieved = TerminalResult.Ok(TerminalIntent(PI, "requires_capture", 1150, tipCents = 150)))
    assertEquals(CardCollectOutcome.Collected(PI, 1150, 150), collectCardPayment(port, REQUEST, M2))
    assertEquals(listOf("retrieve"), port.calls)
  }

  @Test
  fun aCanceledCollectionChargesNobody() = runTest {
    val port = ScriptedPort(collected = TerminalResult.Error(TerminalError("CANCELED", "Canceled")))
    assertEquals(CardCollectOutcome.Canceled(PI), collectCardPayment(port, REQUEST, M2))
    assertEquals(listOf("retrieve", "collect"), port.calls)
  }

  @Test
  fun aConfirmErrorAfterAuthorizationStillCounts() = runTest {
    val authorized = TerminalIntent(PI, "requires_capture", 1150)
    val port = ScriptedPort(confirmed = TerminalResult.Error(TerminalError("API_ERROR", "timeout", intent = authorized)))
    assertEquals(CardCollectOutcome.Collected(PI, 1150, 0), collectCardPayment(port, REQUEST, M2))

    port.confirmed = TerminalResult.Error(TerminalError("DECLINED_BY_STRIPE_API", "declined", declineCode = "insufficient_funds"))
    val declined = collectCardPayment(port, REQUEST, M2) as CardCollectOutcome.Failed
    assertEquals("Declined: insufficient funds. Ask for another card.", declined.message)
    assertEquals("DECLINED_BY_STRIPE_API", declined.code)
  }

  @Test
  fun onlyATippingReaderIsAskedForATip() = runTest {
    val port = ScriptedPort()
    collectCardPayment(port, REQUEST.copy(tipEligible = true), M2)
    assertEquals(true, port.skipTipping)
    collectCardPayment(port, REQUEST.copy(tipEligible = true), WISEPAD)
    assertEquals(false, port.skipTipping)
    collectCardPayment(port, REQUEST, WISEPAD)
    assertEquals(true, port.skipTipping)
  }

  @Test
  fun errorsReadAsWords() {
    assertEquals("The card was declined. Ask for another card.", collectErrorMessage(TerminalError("DECLINED_BY_READER"), "x"))
    assertEquals("Issuer says no", collectErrorMessage(TerminalError("DECLINED_BY_STRIPE_API", apiMessage = "Issuer says no"), "x"))
    assertEquals("The card reader disconnected. Reconnect it and try again.", collectErrorMessage(TerminalError("NOT_CONNECTED_TO_READER"), "x"))
    assertEquals("fallback", collectErrorMessage(TerminalError("UNEXPECTED_SDK_ERROR", message = " "), "fallback"))
    assertEquals("Turn on Bluetooth to find card readers.", friendlyDiscoveryError("BLUETOOTH_DISABLED", null))
    assertTrue(friendlyDiscoveryError("TAP_TO_PAY_UNSUPPORTED_DEVICE", "raw").startsWith("This device cannot take Tap to Pay."))
    assertEquals("raw", friendlyConnectError("SOMETHING_NEW", "raw"))
    assertEquals("Insert or swipe the card.", readerPrompt("INSERT_OR_SWIPE_CARD"))
    assertEquals("Follow the prompt on the reader.", readerPrompt("SOMETHING_NEW"))
    assertEquals("Ready: tap, insert the card.", readerInputPrompt(listOf("TAP", "INSERT", "OTHER")))
    assertEquals("Present the card.", readerInputPrompt(emptyList()))
  }

  @Test
  fun anUpdateIsDueOnlyPastItsDeadline() {
    val now = 1_800_000_000_000L
    assertFalse(updateIsDue(null, now))
    assertFalse(updateIsDue("not a date", now))
    assertTrue(updateIsDue("2026-01-01T00:00:00Z", now))
    assertFalse(updateIsDue("2099-01-01T00:00:00Z", now))
  }

  @Test
  fun namesReaders() {
    assertEquals("Tap to Pay (simulated)", deviceReaderLabel(CardCollectorKind.TAP_TO_PAY, "TAP_TO_PAY_DEVICE", null, null, simulated = true))
    assertEquals("Stripe Reader M2 STRM2 (simulated)", deviceReaderLabel(CardCollectorKind.BLUETOOTH, "STRIPE_M2", null, "STRM2", simulated = true))
    assertEquals("Front counter", deviceReaderLabel(CardCollectorKind.BLUETOOTH, "WISEPAD_3", "Front counter", "WP3", simulated = false))
  }

  @Test
  fun aCollectorWithoutDeviceReadersHasNothingToDiscover() {
    assertSame(NoDeviceReaderControls, SimulatedCardCollector().deviceReaders)
    assertTrue(SimulatedCardCollector().deviceReaders.kinds.isEmpty())
  }
}

class CameraScanFilterTest {
  @Test
  fun aBarcodeInViewCountsOnceUntilItLeaves() {
    val filter = CameraScanFilter(repeatAfterMs = 1_000)
    assertEquals("012345678905", filter.accept(" 012345678905 ", 0))
    assertEquals(null, filter.accept("012345678905", 100))
    assertEquals(null, filter.accept("012345678905", 900))
    // Still in view: each read pushes the window on.
    assertEquals(null, filter.accept("012345678905", 1_800))
    assertEquals("012345678905", filter.accept("012345678905", 3_000))
    assertEquals("SKU-1", filter.accept("SKU-1", 3_010))
  }

  @Test
  fun noiseIsNotAScan() {
    val filter = CameraScanFilter()
    assertEquals(null, filter.accept(null, 0))
    assertEquals(null, filter.accept("12", 0))
    assertEquals(null, filter.accept("x".repeat(65), 0))
    assertEquals(null, filter.accept("12\u000034", 0))
    filter.reset()
  }
}
