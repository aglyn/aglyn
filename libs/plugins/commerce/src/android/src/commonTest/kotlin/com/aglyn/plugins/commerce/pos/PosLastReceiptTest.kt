package com.aglyn.plugins.commerce.pos

import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.InMemoryKeyValueStore
import com.aglyn.core.Live
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class ScriptedReader : FirestoreReader {
  val orders = mutableMapOf<String, Map<String, Any?>>()
  var printers = emptyList<FirestoreDoc>()
  val queries = mutableListOf<FirestoreQuery>()

  override suspend fun get(path: String): FirestoreDoc? = orders[path.substringAfterLast('/')]?.let { FirestoreDoc(path.substringAfterLast('/'), path, it) }
  override suspend fun page(query: FirestoreQuery): FirestorePage {
    queries += query
    return FirestorePage(printers, null)
  }
  override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
  override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
}

private val order1 = mapOf(
  "number" to 1042L,
  "createdAtMs" to 1_700_000_000_000L,
  "totals" to mapOf("totalCents" to 2750L, "itemsCents" to 2500L, "taxCents" to 250L),
  "lineItems" to listOf(mapOf("name" to "Latte", "variantLabel" to "Large", "quantity" to 2L, "unitAmountCents" to 1250L)),
)

class PosLastReceiptModelTest {
  private fun model(reader: ScriptedReader, api: ScriptedSaleApi, store: RegisterStore, scope: kotlinx.coroutines.CoroutineScope) =
    PosLastReceiptModel(reader, api, store, "h1", scope, { ReceiptContext(storeName = "Corner Cafe") }, now = { 1_700_000_100_000L })

  @Test
  fun nothingIsRememberedUntilASaleFinishes() = runTest {
    val last = model(ScriptedReader(), ScriptedSaleApi(), RegisterStore(InMemoryKeyValueStore(), "h1"), this)
    last.watch("r1")
    advanceUntilIdle()
    assertNull(last.lastSale)
    assertNull(last.summary)
  }

  @Test
  fun aFinishedSaleIsShownByItsNumberAndTotalAndKeptAcrossARestart() = runTest {
    val reader = ScriptedReader().apply { orders["o1"] = order1 }
    val device = InMemoryKeyValueStore()
    val last = model(reader, ScriptedSaleApi(), RegisterStore(device, "h1"), this)
    last.watch("r1")
    last.remember("o1")
    advanceUntilIdle()
    assertEquals(LastSaleSummary("#1042", 2750), last.summary)
    assertEquals("Corner Cafe", last.receipt?.storeName)
    assertEquals("1042", last.receipt?.orderNumber)

    val again = model(reader, ScriptedSaleApi(), RegisterStore(device, "h1"), this)
    again.watch("r1")
    advanceUntilIdle()
    assertEquals("o1", again.lastSale?.orderId)
    val other = model(reader, ScriptedSaleApi(), RegisterStore(device, "h1"), this)
    other.watch("r2")
    advanceUntilIdle()
    assertNull(other.lastSale, "another till has its own last sale")
  }

  @Test
  fun anOrderWithNoNumberYetIsNamedByItsId() {
    assertEquals("#abcdefgh", lastSaleLabel(null, "abcdefghijk"))
    assertEquals("#abcdefgh", lastSaleLabel(0, "abcdefghijk"))
    assertEquals("#7", lastSaleLabel(7, "x"))
  }

  @Test
  fun aSaleOlderThanAWeekIsNotTheLastReceipt() {
    val store = RegisterStore(InMemoryKeyValueStore(), "h1")
    store.saveLastSale("r1", LastSale("o1", 1_000))
    assertNotNull(store.lastSale("r1", 1_000 + LAST_SALE_MAX_AGE_MS))
    assertNull(store.lastSale("r1", 1_001 + LAST_SALE_MAX_AGE_MS))
  }

  @Test
  fun theCloudPrinterIsOfferedOnlyForARegisterWithOne() = runTest {
    val reader = ScriptedReader()
    val last = model(reader, ScriptedSaleApi(), RegisterStore(InMemoryKeyValueStore(), "h1"), this)
    last.watch("r1")
    advanceUntilIdle()
    assertFalse(last.hasPrinter)
    assertEquals("hosts/h1/printers", reader.queries.last().collectionPath)
    assertEquals("registerId", reader.queries.last().filters.single().field)
    reader.printers = listOf(FirestoreDoc("pr1", "hosts/h1/printers/pr1", emptyMap()))
    last.watch("r1")
    advanceUntilIdle()
    assertTrue(last.hasPrinter)
  }

  @Test
  fun sendingAsksThePaymentRouteToPrintTheLastSale() = runTest {
    val api = ScriptedSaleApi()
    val last = model(ScriptedReader(), api, RegisterStore(InMemoryKeyValueStore(), "h1"), this)
    last.watch("r1")
    last.remember("o1")
    last.sendToPrinter()
    advanceUntilIdle()
    assertEquals(listOf("receipt"), api.actions)
    assertEquals(SaleStep.Receipt("print", null), api.calls.single().step)
    assertEquals("Sent to the receipt printer", last.notice)
    assertNull(last.error)
  }

  @Test
  fun aRefusalShowsItsWords() = runTest {
    val api = ScriptedSaleApi().apply { answer("receipt", refused("No printer for this register", 404)) }
    val last = model(ScriptedReader(), api, RegisterStore(InMemoryKeyValueStore(), "h1"), this)
    last.watch("r1")
    last.remember("o1")
    last.sendToPrinter()
    advanceUntilIdle()
    assertEquals("No printer for this register", last.error)
    assertNull(last.notice)
  }

  @Test
  fun aReprintIsBannerednAndAGiftReceiptSaysSo() = runTest {
    val reader = ScriptedReader().apply { orders["o1"] = order1 }
    val last = model(reader, ScriptedSaleApi(), RegisterStore(InMemoryKeyValueStore(), "h1"), this)
    last.watch("r1")
    last.remember("o1")
    advanceUntilIdle()
    val printed = mutableListOf<Pair<String?, Boolean>>()
    last.printHere(gift = false) { receipt, gift -> printed += receipt.banner to gift; null }
    advanceUntilIdle()
    last.printHere(gift = true) { receipt, gift -> printed += receipt.banner to gift; null }
    advanceUntilIdle()
    assertEquals(listOf<Pair<String?, Boolean>>("REPRINT" to false, "GIFT RECEIPT" to true), printed)
    assertEquals("Gift receipt printed", last.notice)
  }

  @Test
  fun aPrinterThatFailsShowsWhy() = runTest {
    val reader = ScriptedReader().apply { orders["o1"] = order1 }
    val last = model(reader, ScriptedSaleApi(), RegisterStore(InMemoryKeyValueStore(), "h1"), this)
    last.watch("r1")
    last.remember("o1")
    advanceUntilIdle()
    last.printHere(gift = false) { _, _ -> "Printer is out of paper" }
    advanceUntilIdle()
    assertEquals("Printer is out of paper", last.error)
    assertNull(last.notice)
  }
}

class GiftReceiptLayoutTest {
  private val receipt = receiptDataFromOrder("o1", order1, ReceiptContext(storeName = "Corner Cafe"), 0)

  private fun texts(gift: Boolean) = layoutReceipt(receipt, ReceiptLayoutOptions(columns = 48, gift = gift)).ops
    .filterIsInstance<com.aglyn.hardware.PrintOp.Text>().map { it.text }

  @Test
  fun aGiftReceiptKeepsTheItemsAndTheBarcodeAndDropsEveryPrice() {
    val gift = texts(gift = true)
    assertTrue(gift.any { it.contains("2 x Latte") })
    assertTrue(gift.none { it.contains("$") || it.contains("Subtotal") || it.contains("TOTAL") || it.contains("each") })
    assertTrue(layoutReceipt(receipt, ReceiptLayoutOptions(columns = 48, gift = true)).ops.any { it is com.aglyn.hardware.PrintOp.Barcode })
  }

  @Test
  fun aCustomerReceiptStillPrintsThePrices() {
    val customer = texts(gift = false)
    assertTrue(customer.any { it.contains("Subtotal") })
    assertTrue(customer.any { it.contains("$") })
  }
}
