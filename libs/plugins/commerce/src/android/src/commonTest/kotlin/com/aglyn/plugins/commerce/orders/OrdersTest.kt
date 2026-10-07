package com.aglyn.plugins.commerce.orders

import com.aglyn.contracts.OrderStatus
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.Live
import com.aglyn.plugins.commerce.pos.Load
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun line(quantity: Long, type: String = "physical") = mapOf(
  "name" to "Mug", "productId" to "p1", "quantity" to quantity, "unitAmountCents" to 1200L, "productType" to type,
)

private fun orderDoc(id: String, vararg fields: Pair<String, Any?>) =
  FirestoreDoc(id, "hosts/h1/orders/$id", mapOf("number" to 1042L, "createdAtMs" to 1_700_000_000_000L) + fields)

/** Answers each page from [pages] in order, recording what was asked. */
private class PagedReader(private val pages: List<FirestorePage>) : FirestoreReader {
  val asked = mutableListOf<FirestoreQuery>()
  override suspend fun get(path: String): FirestoreDoc? = null
  override suspend fun page(query: FirestoreQuery): FirestorePage {
    asked += query
    return pages.getOrElse(asked.size - 1) { FirestorePage(emptyList(), null) }
  }
  override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
  override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
}

private class RecordingApi(var failWith: Throwable? = null) : OrderActionsApi {
  val calls = mutableListOf<String>()
  private fun record(call: String) {
    calls += call
    failWith?.let { throw it }
  }
  override suspend fun fulfill(orderId: String, carrier: String?, trackingNumber: String?, notify: Boolean, attemptKey: String) =
    record("fulfill $orderId $carrier $trackingNumber $notify $attemptKey")
  override suspend fun markDelivered(orderId: String) = record("delivered $orderId")
  override suspend fun refund(orderId: String, amountCents: Long?, attemptKey: String) = record("refund $orderId $amountCents $attemptKey")
  override suspend fun cancel(orderId: String) = record("cancel $orderId")
  override suspend fun receiptChannels() = setOf(ReceiptChannel.EMAIL, ReceiptChannel.SMS)
  override suspend fun sendReceipt(orderId: String, channel: ReceiptChannel, to: String) = record("receipt $orderId ${channel.raw} $to")
}

class OrdersTest {
  @Test
  fun eachChipIsAClauseOnTheOneQuery() {
    val all = ordersQuery("h1", OrderFilter.ALL)
    assertEquals("hosts/h1/orders", all.collectionPath)
    assertEquals("createdAtMs", all.orderBy.single().field)
    assertTrue(all.orderBy.single().descending)
    assertEquals(ORDERS_PAGE_SIZE, all.limit)
    assertTrue(all.filters.isEmpty())

    val unfulfilled = ordersQuery("h1", OrderFilter.UNFULFILLED).filters.single()
    assertEquals("status", unfulfilled.field)
    assertEquals(FilterOp.IN, unfulfilled.op)
    assertEquals(listOf("paid", "partially_fulfilled"), unfulfilled.value)

    val disputes = ordersQuery("h1", OrderFilter.DISPUTES).filters.single()
    assertEquals("disputeKey", disputes.field)
    assertEquals(FilterOp.EQ, disputes.op)
    assertEquals("open", disputes.value)
  }

  @Test
  fun aSearchIsATokenOfTheBuyerOrTheNumber() {
    val query = ordersQuery("h1", OrderFilter.ALL, "Ada")
    val search = query.filters.single { it.field == "searchTokens" }
    assertEquals(FilterOp.ARRAY_CONTAINS, search.op)
    assertEquals("ada", search.value)
  }

  @Test
  fun aRowShowsTheConsolesLabelTotalAndBuyer() {
    val row = orderRow(
      orderDoc(
        "o1",
        "status" to "paid",
        "channel" to "pos",
        "customerEmail" to "ada@example.com",
        "lineItems" to listOf(line(2), line(1)),
        "totals" to mapOf("totalCents" to 3600L),
        "livemode" to false,
        "disputeKey" to "open",
      ),
    )
    assertEquals("#1042", row.label)
    assertEquals(OrderStatus.PAID, row.status)
    assertEquals("Paid", row.statusLabel)
    assertEquals("POS", row.channelLabel)
    assertEquals("ada@example.com", row.customer)
    assertEquals(3L, row.itemCount)
    assertEquals(3600.0, row.netCents)
    assertTrue(row.testMode)
    assertTrue(row.disputeOpen)
  }

  @Test
  fun anOrderWithNoStatusOrBuyerReadsAsAPendingGuestOrder() {
    val row = orderRow(FirestoreDoc("abcdef123456", "hosts/h1/orders/abcdef123456", emptyMap()))
    assertEquals("#123456", row.label)
    assertEquals(OrderStatus.PENDING, row.status)
    assertEquals("Guest", row.customer)
    assertFalse(row.testMode)
  }

  @Test
  fun aPaidOrderOffersShippingRefundCancelAndTheReceipt() {
    val detail = orderDetail(
      orderDoc("o1", "status" to "paid", "customerEmail" to "ada@example.com", "lineItems" to listOf(line(2)), "totals" to mapOf("totalCents" to 2400L)),
    )
    assertEquals(OrderActions(fulfill = true, markDelivered = false, refund = true, cancel = true, resendReceipt = true), detail.actions)
    assertEquals(2400.0, detail.refundableCents)
  }

  @Test
  fun aShippedOrderOffersDeliveryNotShipping() {
    val detail = orderDetail(
      orderDoc(
        "o1",
        "status" to "fulfilled",
        "lineItems" to listOf(line(2)),
        "totals" to mapOf("totalCents" to 2400L),
        "fulfillments" to listOf(
          mapOf("id" to "f1", "atMs" to 5L, "lineItemIds" to listOf(0L), "carrier" to "usps", "trackingNumber" to "9400", "trackingUrl" to "http://insecure.example"),
        ),
      ),
    )
    assertFalse(detail.actions.fulfill)
    assertTrue(detail.actions.markDelivered)
    assertFalse(detail.actions.cancel)
    val shipment = detail.shipments.single()
    assertEquals("2× Mug", shipment.summary)
    assertNull(shipment.trackingUrl, "only an https tracking link is offered")
  }

  @Test
  fun anOpenDisputeRefusesARefundButAnInquiryDoesNot() {
    val dispute = { status: String -> mapOf("id" to "dp", "amountCents" to 2400L, "openedAtMs" to 1L, "status" to status) }
    val base = arrayOf("status" to "paid", "lineItems" to listOf(line(1)), "totals" to mapOf("totalCents" to 2400L))
    assertFalse(orderDetail(orderDoc("o1", *base, "dispute" to dispute("needs_response"))).actions.refund)
    assertTrue(orderDetail(orderDoc("o1", *base, "dispute" to dispute("warning_needs_response"))).actions.refund)
  }

  @Test
  fun aDigitalOnlyOrderHasNothingToShip() {
    val detail = orderDetail(orderDoc("o1", "status" to "paid", "lineItems" to listOf(line(1, "digital")), "totals" to mapOf("totalCents" to 900L)))
    assertFalse(detail.actions.fulfill)
  }

  @Test
  fun moneyAsTypedBecomesCents() {
    assertEquals(1250L, parseMoneyCents("12.50"))
    assertEquals(1250L, parseMoneyCents("$12.5"))
    assertEquals(1200L, parseMoneyCents("12"))
    assertEquals(5L, parseMoneyCents(".05"))
    assertEquals(123456L, parseMoneyCents("1,234.56"))
    assertNull(parseMoneyCents("12.345"))
    assertNull(parseMoneyCents("abc"))
    assertNull(parseMoneyCents(""))
  }

  @Test
  fun aRefundAmountMustBeAboveZeroAndWithinWhatIsLeft() {
    assertEquals("Enter an amount above zero", checkRefundAmount(null, 1000.0))
    assertEquals("Enter an amount above zero", checkRefundAmount(0, 1000.0))
    assertEquals("That is more than is left to refund", checkRefundAmount(1001, 1000.0))
    assertNull(checkRefundAmount(1000, 1000.0))
  }

  @Test
  fun aReceiptNeedsAnAddressOrANumber() {
    assertNull(checkReceiptRecipient(ReceiptChannel.EMAIL, " ada@example.com "))
    assertEquals("Enter an email address", checkReceiptRecipient(ReceiptChannel.EMAIL, "ada@"))
    assertNull(checkReceiptRecipient(ReceiptChannel.SMS, "+1 (512) 555-0100"))
    assertEquals("Enter a phone number", checkReceiptRecipient(ReceiptChannel.SMS, "call me"))
  }

  @Test
  fun theListPagesOnFromTheLastRowAndStopsAtTheEnd() = runTest {
    val reader = PagedReader(
      listOf(
        FirestorePage(listOf(orderDoc("o2"), orderDoc("o1")), nextCursor = listOf(1L)),
        FirestorePage(listOf(orderDoc("o0")), nextCursor = null),
      ),
    )
    val model = OrdersListModel("h1", reader, this)
    model.reload()
    advanceUntilIdle()
    assertEquals(listOf("o2", "o1"), (model.rows as Load.Ready).value.map { it.id })
    assertTrue(model.hasMore)
    model.loadMore()
    advanceUntilIdle()
    assertEquals(listOf("o2", "o1", "o0"), (model.rows as Load.Ready).value.map { it.id })
    assertFalse(model.hasMore)
    assertEquals(listOf(1L), reader.asked[1].startAfter)
  }

  @Test
  fun aChipReloadsFromTheFirstPage() = runTest {
    val reader = PagedReader(emptyList())
    val model = OrdersListModel("h1", reader, this)
    model.reload()
    model.pick(OrderFilter.PENDING)
    advanceUntilIdle()
    assertEquals("pending", reader.asked.last().filters.single().value)
    assertNull(reader.asked.last().startAfter)
    assertIs<Load.Ready<*>>(model.rows)
  }

  @Test
  fun aRetryOfTheSameDialogSendsTheSameAttemptKey() = runTest {
    var minted = 0
    val api = RecordingApi(failWith = ConsoleApiError("Stripe is unavailable.", 503, null))
    val model = OrderActionsModel(api, this) { "key-${++minted}" }
    model.open(OrderDialog.REFUND)
    model.run("Refunded") { key -> refund("o1", null, key) }
    advanceUntilIdle()
    assertEquals(OrderDialog.REFUND, model.dialog, "a failure keeps the dialog open")
    assertEquals("Stripe is unavailable.", model.error)

    api.failWith = null
    model.run("Refunded") { key -> refund("o1", null, key) }
    advanceUntilIdle()
    assertEquals(listOf("refund o1 null key-2", "refund o1 null key-2"), api.calls)
    assertNull(model.dialog)
    assertEquals("Refunded", model.done)

    model.open(OrderDialog.REFUND)
    assertEquals("key-3", model.attemptKey, "a new dialog is a new attempt")
  }

  @Test
  fun theReceiptDialogOffersTheChannelsTheRouteNames() = runTest {
    val model = OrderActionsModel(RecordingApi(), this)
    model.open(OrderDialog.RECEIPT)
    advanceUntilIdle()
    assertEquals(setOf(ReceiptChannel.EMAIL, ReceiptChannel.SMS), model.receiptChannels)
  }
}
