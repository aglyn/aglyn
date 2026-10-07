package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.ReceiptData
import com.aglyn.contracts.ReceiptLine
import com.aglyn.contracts.ReceiptTender
import com.aglyn.hardware.EscPosEncoder
import com.aglyn.hardware.PrintOp
import com.aglyn.hardware.renderText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The console's own receipt spec fixture (`printing.spec.ts`). */
private val RECEIPT = ReceiptData(
  storeName = "Corner Café",
  storeLines = listOf("12 Main St, Springfield"),
  orderNumber = "1042",
  orderId = "order1",
  createdAtMs = 1791317040000.0,
  timeZone = "America/Chicago",
  registerName = "Front counter",
  currency = "usd",
  lines = listOf(
    ReceiptLine(detail = "Oat milk", name = "Latte", quantity = 2.0, totalCents = 900.0, unitCents = 450.0),
    ReceiptLine(name = "Crème brûlée with a very long name that wraps", quantity = 1.0, totalCents = 725.0, unitCents = 725.0),
  ),
  subtotalCents = 1625.0,
  discountCents = 100.0,
  taxCents = 126.0,
  totalCents = 1651.0,
  tenders = listOf(ReceiptTender(amountCents = 2000.0, label = "Cash")),
  changeCents = 349.0,
  barcode = "1042",
  footer = "Thank you — returns within 30 days.",
)

class ReceiptTest {
  @Test
  fun laysTheReceiptOutAsTheConsoleDoesOn80mmPaper() {
    val text = renderText(layoutReceipt(RECEIPT, ReceiptLayoutOptions(columns = 48)))
    assertEquals(
      """
      |                  Corner Cafe
      |            12 Main St, Springfield
      |
      |Order #1042                 Oct 6, 2026, 3:04 PM
      |Front counter
      |------------------------------------------------
      |2 x Latte                                  $9.00
      |  Oat milk
      |  @ $4.50 each
      |Creme brulee with a very long name that
      |wraps                                      $7.25
      |------------------------------------------------
      |Subtotal                                  $16.25
      |Discount                                  -$1.00
      |Tax                                        $1.26
      |TOTAL             $16.51
      |
      |Cash                                      $20.00
      |Change                                     $3.49
      |
      |                     [1042]
      |
      |      Thank you - returns within 30 days.
      |
      |
      |""".trimMargin(),
      text,
    )
    assertTrue(text.split('\n').all { it.length <= 48 })
  }

  @Test
  fun fits58mmPaperToo() {
    val text = renderText(layoutReceipt(RECEIPT, ReceiptLayoutOptions(columns = 32)))
    assertTrue(text.split('\n').all { it.length <= 32 })
    assertTrue(text.contains("TOTAL     $16.51"))
  }

  @Test
  fun opensTheDrawerFirstOnACashReceipt() {
    val ops = layoutReceipt(RECEIPT, ReceiptLayoutOptions(columns = 48, openDrawer = true, logo = true)).ops
    assertEquals(PrintOp.Drawer, ops[0])
    assertEquals(PrintOp.Logo, ops[1])
    assertEquals(PrintOp.Cut, ops.last())
    // The ESC/POS bytes start with the reset and then the ESC p kick.
    val bytes = EscPosEncoder().encode(layoutReceipt(RECEIPT, ReceiptLayoutOptions(columns = 48, openDrawer = true)))
    assertEquals(listOf(0x1b, 0x40, 0x1b, 0x74, 0x00, 0x1b, 0x70, 0x00, 0x19, 0xfa), bytes.take(10).map { it.toInt() and 0xff })
  }

  @Test
  fun readsTheReceiptFromTheOrderAsStored() {
    val order = mapOf<String, Any?>(
      "number" to 1042L,
      "createdAtMs" to 1791317040000L,
      "currency" to "usd",
      "channel" to "pos",
      "lineItems" to listOf(
        mapOf("name" to "Latte", "variantLabel" to "Large / Oat milk", "quantity" to 2L, "unitAmountCents" to 600L),
        mapOf("name" to "Croissant", "quantity" to 1L, "unitAmountCents" to 395L),
      ),
      "totals" to mapOf("itemsCents" to 1595L, "discountCents" to 0L, "taxCents" to 128L, "tipCents" to 239L, "totalCents" to 1962L),
      "payments" to listOf(
        mapOf("method" to "cash", "status" to "succeeded", "amountCents" to 1000L, "cashTenderedCents" to 2000L, "changeCents" to 1000L),
        mapOf("method" to "card_present", "status" to "succeeded", "amountCents" to 723L, "tipCents" to 239L, "cardBrand" to "Visa", "last4" to "4242"),
        mapOf("method" to "card_present", "status" to "failed", "amountCents" to 723L),
      ),
    )
    val receipt = receiptDataFromOrder("o1", order, ReceiptContext(storeName = "Corner Café", registerName = "Front counter"), nowMs = 0)
    assertEquals("1042", receipt.orderNumber)
    assertEquals(listOf(1200.0, 395.0), receipt.lines.map { it.totalCents })
    assertEquals("Large / Oat milk", receipt.lines[0].detail)
    assertEquals(listOf(ReceiptTender(2000.0, "Cash"), ReceiptTender(962.0, "Visa **** 4242")), receipt.tenders)
    assertEquals(1000.0, receipt.changeCents)
    assertEquals(239.0, receipt.tipCents)
    assertEquals(null, receipt.discountCents)
    assertEquals(1962.0, receipt.totalCents)
  }

  @Test
  fun readsASingleTenderFromAnOrderWithoutALedger() {
    val order = mapOf<String, Any?>("channel" to "pos", "totals" to mapOf("totalCents" to 1500L), "changeCents" to 500L)
    val tenders = receiptTendersFromOrder(order)
    assertEquals(listOf(ReceiptTender(2000.0, "Cash")), tenders.tenders)
    assertEquals(500L, tenders.changeCents)
    assertEquals("ABCDEFGH", receiptDataFromOrder("abcdefgh123", emptyMap(), ReceiptContext("Store"), nowMs = 5).orderNumber)
  }
}
