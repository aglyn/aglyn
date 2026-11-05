package com.aglyn.plugins.commerce.orders

import com.aglyn.contracts.Contracts
import com.aglyn.contracts.HostOrder
import com.aglyn.contracts.OrderInvoiceSendRecord
import com.aglyn.contracts.OrderStatus
import com.aglyn.contracts.PosOfflineFlag
import com.aglyn.contracts.QuoteEmailThread
import com.aglyn.contracts.deviceTimeZone
import com.aglyn.contracts.formatOrderNumber
import com.aglyn.contracts.formatReceiptTime
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.DownloadedFile

/*
 * An order's invoice, as the console's Invoice menu has it: the PDF the console downloads, and the
 * email with that PDF attached. The route decides what can be sent; these are the words and the
 * prefill the console's form uses (`commerce-invoices.ts`, `invoice-send.component.tsx`).
 */

const val ORDER_INVOICE_SEND_ROUTE = "/api/commerce/order-invoice-send"
const val INVOICE_SEND_PERMISSION = "commerce.quotes.send"
const val INVOICE_SUBJECT_LIMIT = 200
const val INVOICE_MESSAGE_LIMIT = 5000

private val ADDRESS = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")

/** `Invoice #1042`: the order's own number, which a paid quote keeps too. */
fun formatInvoiceNumber(order: HostOrder, orderId: String): String = "Invoice ${formatOrderNumber(order, orderId)}"

/** The order is paid (and not refunded or canceled): its invoice is the record. */
fun invoiceIsPaid(order: HostOrder): Boolean =
  order.status in setOf(OrderStatus.PAID, OrderStatus.PARTIALLY_FULFILLED, OrderStatus.FULFILLED, OrderStatus.DELIVERED)

/** The last time the order's invoice was emailed. */
fun lastInvoiceSend(order: HostOrder): OrderInvoiceSendRecord? = order.invoiceSends?.lastOrNull()

/** Who the form addresses first: the order's customer, a quote's, or whoever the last send went to. */
fun invoiceSendPrefill(order: HostOrder): String =
  listOf(order.customerEmail, order.quote?.customer?.email, lastInvoiceSend(order)?.to, order.quote?.sends?.lastOrNull()?.to)
    .firstNotNullOfOrNull { it?.trim()?.ifEmpty { null } }
    .orEmpty()

/** The email conversation the invoice joins: a quote's, else the order's own. */
fun invoiceEmailThread(order: HostOrder): QuoteEmailThread? =
  if (order.quote != null) order.quote?.emailThread else order.emailThread

/** The subject the form starts with: the conversation's, so the email joins it, else the invoice and the business. */
fun invoiceEmailDefaultSubject(order: HostOrder, businessName: String, orderId: String): String {
  val thread = invoiceEmailThread(order)?.subject?.trim().orEmpty()
  if (thread.isNotEmpty()) return thread
  val name = businessName.trim()
  val number = formatInvoiceNumber(order, orderId)
  return if (name.isEmpty()) number else "$number from $name"
}

/** `Invoice sent Oct 29, 2026, 3:04 PM to jordan@example.com.`, in this device's time. Null when none was sent. */
fun invoiceSentLine(order: HostOrder, timeZone: String = deviceTimeZone()): String? {
  val last = lastInvoiceSend(order) ?: return null
  val to = last.to.ifEmpty { "the customer" }
  return "${if (last.paid) "Paid invoice" else "Invoice"} sent ${formatReceiptTime(last.atMs.toLong(), timeZone)} to $to."
}

/** What [orderOfflineNotice] says, and whether it asks the merchant to check something. */
data class OrderOfflineNotice(val text: String, val needsCheck: Boolean)

/**
 * A register sale rung offline, said on its order: when it was rung and synced, and what the sync found to check.
 * Null on any other order (the console's `OrderOfflineNotice`).
 */
fun orderOfflineNotice(order: HostOrder, timeZone: String = deviceTimeZone()): OrderOfflineNotice? {
  val stamp = order.offline ?: return null
  fun at(ms: Double) = formatReceiptTime(ms.toLong(), timeZone)
  val checks = stamp.stockConflicts.orEmpty().map { "${it.shortUnits.toLong()} of ${it.requested.toLong()}× ${it.name} not in stock" } +
    stamp.flags.filter { it != PosOfflineFlag.STOCK_SHORT }.map { Contracts.posOfflineFlagLabels[it.raw] ?: it.raw }
  val lines = listOf("Rung while the register was offline", "Rung ${at(stamp.soldAtMs)}, synced ${at(stamp.syncedAtMs)}.") + checks
  return OrderOfflineNotice(lines.joinToString("\n"), checks.isNotEmpty())
}

/** What the form's small print says about the email, and where replies go. */
fun invoiceSendNote(paid: Boolean, contact: String?): String {
  val what = if (paid) {
    "The email shows the invoice as paid, with the date it was paid, for your customer’s records. "
  } else {
    "The email shows the invoice number, date, total and what is due, with a button to pay it by card on your site. " +
      "The button keeps working until it is paid. "
  }
  return "${what}The invoice is attached as a PDF. Replies go to ${contact ?: "your email"}."
}

/** The name the business goes by, and the address its customers write to. */
data class InvoiceSite(val businessName: String = "", val contact: String? = null)

/** [InvoiceSite] off the site's document. */
fun invoiceSiteDetails(data: Map<String, Any?>?): InvoiceSite {
  fun text(value: Any?) = (value as? String)?.trim().orEmpty()
  val entity = (data?.get("seo") as? Map<*, *>)?.get("entity") as? Map<*, *>
  val listed = text(entity?.get("email")).ifEmpty { text((data?.get("business") as? Map<*, *>)?.get("supportEmail")) }
  return InvoiceSite(
    businessName = text(entity?.get("name")).ifEmpty { text(data?.get("displayName")) },
    contact = listed.takeIf { ADDRESS.matches(it) },
  )
}

/** The invoice's PDF, for the share sheet. */
suspend fun downloadOrderInvoicePdf(api: ConsoleApiClient, hostId: String, orderId: String): DownloadedFile =
  api.download(
    "/api/commerce/order-print",
    method = ApiMethod.GET,
    query = mapOf("hostId" to hostId, "orderId" to orderId, "kind" to "invoice-pdf"),
  )
