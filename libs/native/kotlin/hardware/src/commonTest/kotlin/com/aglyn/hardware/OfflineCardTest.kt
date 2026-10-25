package com.aglyn.hardware

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

private class FakeOfflinePort(
  var created: OfflineTerminalResult = OfflineTerminalResult.Ok(OfflineTerminalIntent(null, "requires_payment_method", 2479, storedOffline = false)),
  var collected: OfflineTerminalResult? = null,
  var confirmed: OfflineTerminalResult = OfflineTerminalResult.Ok(
    OfflineTerminalIntent(null, "requires_capture", 2479, storedOffline = true, brand = "visa", last4 = "4242"),
  ),
) : OfflineTerminalPort {
  val calls = mutableListOf<String>()
  var request: OfflineCardRequest? = null

  override suspend fun create(request: OfflineCardRequest): OfflineTerminalResult {
    calls += "create"
    this.request = request
    return created
  }

  override suspend fun collect(saleKey: String): OfflineTerminalResult {
    calls += "collect"
    return collected ?: created
  }

  override suspend fun confirm(saleKey: String): OfflineTerminalResult {
    calls += "confirm"
    return confirmed
  }
}

/** A card taken with no connection (AGL-4039): the Apple kit's `OfflineCardTests`, case for case. */
class OfflineCardTest {
  private val key = "off8f2f9807c22c4fe3b1ed9042c497949d"
  private val m2 = DeviceReader("STRM2", "Stripe Reader M2", CardCollectorKind.BLUETOOTH, simulated = true, deviceType = "STRIPE_M2")

  private fun request(amount: Long = 2479, destination: String = "acct_merchant") =
    OfflineCardRequest(key, amount, "usd", destination, mapOf("kind" to "pos-offline", "saleKey" to key))

  @Test
  fun aStoredCardIsTakenWithoutAStripeId() = runTest {
    val port = FakeOfflinePort()
    assertEquals(OfflineCardOutcome.Taken(OfflineCardTaken(key, null, "visa", "4242")), collectOfflineCardPayment(port, request(), m2))
    assertEquals(listOf("create", "collect", "confirm"), port.calls)
    assertEquals("acct_merchant", port.request?.destination)
  }

  @Test
  fun aCardStripeAuthorizedAfterAllKeepsItsId() = runTest {
    val port = FakeOfflinePort(confirmed = OfflineTerminalResult.Ok(OfflineTerminalIntent("pi_3Q0abcdEFGH12345", "requires_capture", 2479, storedOffline = false)))
    assertEquals(OfflineCardOutcome.Taken(OfflineCardTaken(key, "pi_3Q0abcdEFGH12345")), collectOfflineCardPayment(port, request(), m2))
  }

  @Test
  fun aDeclineWhileStripeIsReachableIsSaidAtTheCounter() = runTest {
    val port = FakeOfflinePort(confirmed = OfflineTerminalResult.Error(TerminalError("DECLINED_BY_STRIPE_API", declineCode = "insufficient_funds")))
    val outcome = assertIs<OfflineCardOutcome.Failed>(collectOfflineCardPayment(port, request(), m2))
    assertEquals("DECLINED_BY_STRIPE_API", outcome.code)
  }

  @Test
  fun aCanceledCardChargesNobody() = runTest {
    val port = FakeOfflinePort(collected = OfflineTerminalResult.Error(TerminalError("CANCELED")))
    assertEquals(OfflineCardOutcome.Canceled, collectOfflineCardPayment(port, request(), m2))
    assertEquals(listOf("create", "collect"), port.calls)
  }

  @Test
  fun nothingStartsWithoutAReaderOrAWellFormedRequest() = runTest {
    val port = FakeOfflinePort()
    assertIs<OfflineCardOutcome.Failed>(collectOfflineCardPayment(port, request(), null))
    assertIs<OfflineCardOutcome.Failed>(collectOfflineCardPayment(port, request(destination = ""), m2))
    assertIs<OfflineCardOutcome.Failed>(collectOfflineCardPayment(port, request(amount = 0), m2))
    assertEquals(emptyList(), port.calls)
  }

  @Test
  fun anIntentForAnotherAmountIsRefusedBeforeTheCard() = runTest {
    val port = FakeOfflinePort(created = OfflineTerminalResult.Ok(OfflineTerminalIntent(null, "requires_payment_method", 1, storedOffline = false)))
    assertIs<OfflineCardOutcome.Failed>(collectOfflineCardPayment(port, request(), m2))
    assertEquals(listOf("create"), port.calls)
  }

  @Test
  fun stripesOfflineLimitIsSaidInTheRegistersWordsNeverTheSdks() = runTest {
    val port = FakeOfflinePort(confirmed = OfflineTerminalResult.Error(TerminalError("AMOUNT_EXCEEDS_MAX_OFFLINE_AMOUNT", apiMessage = "Amount exceeds max offline amount.")))
    assertEquals(
      OfflineCardOutcome.Failed("This card is over Stripe's $10,000 limit for a card taken offline. Take it when you're back online, or take cash.", "AMOUNT_EXCEEDS_MAX_OFFLINE_AMOUNT"),
      collectOfflineCardPayment(port, request(), m2),
    )
    assertEquals(
      "This sale is over your offline card limit. Take it when you're back online, or take cash.",
      offlineCardErrorMessage(TerminalError("NOT_CONNECTED_TO_INTERNET_AND_REQUIRE_ONLINE_SET"), "x"),
    )
  }

  @Test
  fun theStoreLimitsAreEnforcedAgainAtTheSdk() {
    fun limited(amount: Long, today: Long = 0) =
      OfflineCardRequest(key, amount, "usd", "acct_merchant", mapOf("saleKey" to key), maxSaleCents = 10_000, maxDeviceDailyCents = 500_000, takenTodayCents = today)
    assertEquals(false, offlineCardRequiresOnline(limited(10_000), 0))
    assertEquals(true, offlineCardRequiresOnline(limited(10_001), 0))
    assertEquals(true, offlineCardRequiresOnline(limited(2_000, today = 499_000), 0))
    assertEquals(true, offlineCardRequiresOnline(limited(2_000), 499_000))
  }

  @Test
  fun whatAForwardMeans() {
    assertEquals(OfflineCardForward.Status.AUTHORIZED, offlineForwardStatus("pi_1", "requires_capture"))
    assertEquals(OfflineCardForward.Status.AUTHORIZED, offlineForwardStatus("pi_1", "succeeded"))
    assertEquals(OfflineCardForward.Status.DECLINED, offlineForwardStatus("pi_1", "requires_payment_method"))
    assertEquals(OfflineCardForward.Status.FAILED, offlineForwardStatus(null, null))
  }

  @Test
  fun theLedgerKeepsOneForwardPerSaleUntilApplied() {
    var held: String? = null
    val ledger = OfflineCardForwardLedger(object : OfflineCardForwardStore {
      override fun read() = held
      override fun write(value: String?) { held = value }
    })
    ledger.record(OfflineCardForward("a", null, OfflineCardForward.Status.FAILED))
    ledger.record(OfflineCardForward("a", "pi_1", OfflineCardForward.Status.AUTHORIZED))
    ledger.record(OfflineCardForward("b", "pi_2", OfflineCardForward.Status.DECLINED, message = "Declined.\tTry\nagain"))
    assertEquals(listOf(OfflineCardForward.Status.AUTHORIZED, OfflineCardForward.Status.DECLINED), ledger.all().map { it.status })
    assertEquals("Declined. Try again", ledger.all().last().message)
    ledger.remove(setOf("a"))
    assertEquals(listOf("b"), ledger.all().map { it.saleKey })
  }

  @Test
  fun aCardIsNamedTheWayAReceiptNamesIt() {
    assertEquals("Visa •••• 4242", offlineCardLabel("visa", "4242"))
    assertEquals("Card", offlineCardLabel(null, null))
    assertEquals("American Express •••• 0005", offlineCardLabel("amex", "0005"))
  }
}
