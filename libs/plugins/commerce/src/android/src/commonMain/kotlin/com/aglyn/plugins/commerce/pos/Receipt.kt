package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.ReceiptData
import com.aglyn.contracts.ReceiptLine
import com.aglyn.contracts.ReceiptTender
import com.aglyn.contracts.formatReceiptMoney
import com.aglyn.contracts.formatReceiptTime
import com.aglyn.hardware.PrintAlign
import com.aglyn.hardware.PrintDocument
import com.aglyn.hardware.PrintOp
import com.aglyn.hardware.code128Printable
import com.aglyn.hardware.toPrintable
import com.aglyn.hardware.twoColumnLines
import com.aglyn.hardware.wrapText

/*
 * THE RECEIPT, ON THIS DEVICE.
 *
 * The same receipt the console prints and emails (`commerce-receipt.ts`,
 * `print-document.ts`): read from the order as stored, laid out once in
 * columns, then shown on screen as text or sent to a direct printer as
 * ESC/POS bytes.
 */

private val PAYMENT_METHOD_LABELS = mapOf(
  "cash" to "Cash",
  "card_present" to "Card",
  "card_keyed" to "Card",
  "card_link" to "Card",
  "gift_card" to "Gift card",
  "folio" to "Charged to room",
)

private fun Any?.wholeCents(): Long = (this as? Number)?.toDouble()?.takeIf { it.isFinite() }?.let(::jsRound)?.takeIf { it > 0 } ?: 0

private fun Any?.mapOrNull(): Map<*, *>? = this as? Map<*, *>

data class ReceiptTenders(val tenders: List<ReceiptTender>, val changeCents: Long, val tipCents: Long)

/** The tenders an order was paid with: the register's ledger when it has one (`receiptTendersFromOrder`). */
fun receiptTendersFromOrder(order: Map<String, Any?>): ReceiptTenders {
  val payments = (order["payments"] as? List<*>)?.mapNotNull { it.mapOrNull() } ?: emptyList()
  if (payments.isNotEmpty()) {
    var change = 0L
    var tip = 0L
    val tenders = payments.filter { it["status"] == "succeeded" }.map { payment ->
      change += payment["changeCents"].wholeCents()
      tip += payment["tipCents"].wholeCents()
      val last4 = payment["last4"] as? String
      val card = listOfNotNull((payment["cardBrand"] as? String)?.ifEmpty { null }, last4?.ifEmpty { null }?.let { "**** $it" }).joinToString(" ")
      val label = card.ifEmpty { null } ?: PAYMENT_METHOD_LABELS[payment["method"] as? String] ?: "Payment"
      val tendered = payment["cashTenderedCents"].wholeCents()
      ReceiptTender(amountCents = (if (tendered > 0) tendered else payment["amountCents"].wholeCents() + payment["tipCents"].wholeCents()).toDouble(), label = label)
    }
    return ReceiptTenders(tenders, change, tip)
  }
  val totalCents = order["totals"].mapOrNull()?.get("totalCents").wholeCents()
  val changeCents = order["changeCents"].wholeCents()
  if (totalCents == 0L) return ReceiptTenders(emptyList(), 0, 0)
  val isCash = order["channel"] == "pos" && order["checkoutSessionId"] == null && order["paymentIntentId"] == null
  val label = if (order["reservationId"] != null) "Charged to room" else if (isCash) "Cash" else "Card"
  return ReceiptTenders(
    listOf(ReceiptTender(amountCents = (totalCents + if (isCash) changeCents else 0).toDouble(), label = label)),
    if (isCash) changeCents else 0,
    0,
  )
}

data class ReceiptContext(
  val storeName: String,
  val storeLines: List<String> = emptyList(),
  val registerName: String? = null,
  val cashierName: String? = null,
  val timeZone: String? = null,
  val currency: String? = null,
  val footer: String? = null,
)

/** The receipt an order prints, from the order as stored (`receiptDataFromOrder`). */
fun receiptDataFromOrder(orderId: String, order: Map<String, Any?>, context: ReceiptContext, nowMs: Long): ReceiptData {
  val lines = ((order["lineItems"] as? List<*>) ?: emptyList<Any?>()).mapNotNull { it.mapOrNull() }.map { line ->
    val quantity = maxOf(1L, (line["quantity"] as? Number)?.toDouble()?.let(::jsRound) ?: 1L)
    val unit = (line["unitAmountCents"] as? Number)?.toDouble()?.let(::jsRound) ?: 0L
    ReceiptLine(
      detail = (line["variantLabel"] as? String)?.ifEmpty { null },
      name = (line["name"] as? String) ?: "Item",
      quantity = quantity.toDouble(),
      totalCents = (unit * quantity).toDouble(),
      unitCents = unit.toDouble(),
    )
  }
  val totals = order["totals"].mapOrNull() ?: emptyMap<String, Any?>()
  val subtotal = (totals["itemsCents"] as? Number)?.toDouble() ?: lines.sumOf { it.totalCents }
  val paid = receiptTendersFromOrder(order)
  val tip = totals["tipCents"].wholeCents().takeIf { it > 0 } ?: paid.tipCents
  val number = (order["number"] as? Number)?.toLong()?.toString() ?: orderId.take(8).uppercase()
  val positive = { key: String -> (totals[key] as? Number)?.toDouble()?.takeIf { it != 0.0 } }
  return ReceiptData(
    storeName = context.storeName,
    storeLines = context.storeLines.ifEmpty { null },
    orderNumber = number,
    orderId = orderId,
    createdAtMs = (order["createdAtMs"] as? Number)?.toDouble()?.takeIf { it > 0 } ?: nowMs.toDouble(),
    timeZone = context.timeZone,
    registerName = context.registerName,
    cashierName = context.cashierName,
    currency = (order["currency"] as? String) ?: context.currency ?: "usd",
    lines = lines,
    subtotalCents = subtotal,
    discountCents = positive("discountCents"),
    shippingCents = positive("shippingCents"),
    taxCents = positive("taxCents"),
    tipCents = tip.takeIf { it > 0 }?.toDouble(),
    totalCents = (totals["totalCents"] as? Number)?.toDouble() ?: subtotal,
    tenders = paid.tenders.ifEmpty { null },
    changeCents = paid.changeCents.takeIf { it > 0 }?.toDouble(),
    refundedCents = order["refundedCents"].wholeCents().takeIf { it > 0 }?.toDouble(),
    footer = context.footer,
    barcode = number,
  )
}

data class ReceiptLayoutOptions(
  val columns: Int,
  /** Print the logo stored in the printer. */
  val logo: Boolean = false,
  /** Kick the cash drawer as the receipt starts printing. */
  val openDrawer: Boolean = false,
)

/** The customer receipt, laid out to the paper (`layoutReceipt`). */
fun layoutReceipt(receipt: ReceiptData, options: ReceiptLayoutOptions): PrintDocument {
  val columns = options.columns
  val money = { cents: Double -> formatReceiptMoney(cents, receipt.currency) }
  val ops = mutableListOf<PrintOp>()
  fun line(left: String, right: String, bold: Boolean = false) {
    for (text in twoColumnLines(left, right, columns)) ops += PrintOp.Text(text, bold = bold)
  }
  val rule = PrintOp.Text("-".repeat(columns))
  // The drawer first: the cashier makes change while the receipt prints.
  if (options.openDrawer) ops += PrintOp.Drawer
  if (options.logo) ops += PrintOp.Logo
  receipt.banner?.ifEmpty { null }?.let { ops += PrintOp.Text(toPrintable(it).take(columns / 2), PrintAlign.CENTER, bold = true, size = 2) }
  for (text in wrapText(receipt.storeName, columns / 2)) ops += PrintOp.Text(text, PrintAlign.CENTER, bold = true, size = 2)
  for (storeLine in receipt.storeLines ?: emptyList()) {
    for (text in wrapText(storeLine, columns)) ops += PrintOp.Text(text, PrintAlign.CENTER)
  }
  ops += PrintOp.Feed(1)
  line("Order #${receipt.orderNumber}", formatReceiptTime(receipt.createdAtMs.toLong(), receipt.timeZone))
  val who = listOfNotNull(receipt.registerName?.ifEmpty { null }, receipt.cashierName?.ifEmpty { null }).joinToString(" - ")
  if (who.isNotEmpty()) for (text in wrapText(who, columns)) ops += PrintOp.Text(text)
  ops += rule
  for (item in receipt.lines) {
    val quantity = item.quantity.toLong()
    line(if (quantity > 1) "$quantity x ${item.name}" else item.name, money(item.totalCents))
    item.detail?.ifEmpty { null }?.let { detail -> for (text in wrapText(detail, columns - 2)) ops += PrintOp.Text("  $text") }
    if (quantity > 1) ops += PrintOp.Text(toPrintable("  @ ${money(item.unitCents)} each").take(columns))
  }
  ops += rule
  line("Subtotal", money(receipt.subtotalCents))
  receipt.discountCents?.takeIf { it != 0.0 }?.let { line("Discount", "-${money(it)}") }
  receipt.shippingCents?.takeIf { it != 0.0 }?.let { line("Shipping", money(it)) }
  receipt.taxCents?.takeIf { it != 0.0 }?.let { line("Tax", money(it)) }
  receipt.tipCents?.takeIf { it != 0.0 }?.let { line("Tip", money(it)) }
  for (text in twoColumnLines("TOTAL", money(receipt.totalCents), columns / 2)) ops += PrintOp.Text(text, bold = true, size = 2)
  val change = receipt.changeCents?.takeIf { it != 0.0 }
  if (!receipt.tenders.isNullOrEmpty() || change != null) ops += PrintOp.Feed(1)
  for (tender in receipt.tenders ?: emptyList()) line(tender.label, money(tender.amountCents))
  change?.let { line("Change", money(it), bold = true) }
  receipt.refundedCents?.takeIf { it != 0.0 }?.let { line("Refunded", "-${money(it)}") }
  val barcode = code128Printable(receipt.barcode ?: receipt.orderNumber)
  if (barcode.isNotEmpty()) {
    ops += PrintOp.Feed(1)
    ops += PrintOp.Barcode(barcode)
  }
  receipt.footer?.ifEmpty { null }?.let { footer ->
    ops += PrintOp.Feed(1)
    for (text in wrapText(footer, columns)) ops += PrintOp.Text(text, PrintAlign.CENTER)
  }
  ops += PrintOp.Feed(2)
  ops += PrintOp.Cut
  return PrintDocument(columns, ops)
}
