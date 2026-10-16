package com.aglyn.plugins.commerce.orders

import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.hardware.PrintableDocument
import com.aglyn.hardware.SystemPrintResult
import com.aglyn.hardware.SystemPrinter
import com.aglyn.hardware.isPdf
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * WHAT THE ORDER DIALOG PRINTS (AGL-3841): the packing slip and the invoice,
 * each the console's own page (`commerce/order-print` runs the console's two
 * builders over the stored order), and a shipment's label, the carrier's own
 * PDF. All three go to the device's print sheet, as the console's go to the
 * browser's print dialog. The Apple plugin's OrderPrinting.swift.
 */

/** A page the order dialog prints. */
enum class OrderPrintKind(val raw: String, val title: String, val icon: String) {
  PACKING_SLIP("packing-slip", "Packing slip", "inventory_2"),
  INVOICE("invoice", "Invoice", "description"),
}

private fun JsonObject.text(key: String) = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

/** Prints the order's packing slip or invoice. Returns what to tell the person, or null when it printed or they closed the sheet. */
suspend fun printOrderPage(api: ConsoleApiClient, printer: SystemPrinter?, hostId: String, orderId: String, kind: OrderPrintKind): String? {
  printer ?: return "This device has no print sheet."
  return try {
    val answer = api.request("/api/commerce/order-print", query = mapOf("hostId" to hostId, "orderId" to orderId, "kind" to kind.raw)) as? JsonObject
    val html = answer?.text("html") ?: return "The page did not come back. Try again."
    (printer.printDocument(PrintableDocument.Html(html), answer.text("title") ?: kind.title) as? SystemPrintResult.Failed)?.message
  } catch (error: CancellationException) {
    throw error
  } catch (error: ConsoleApiError) {
    if (error.status > 0) error.message.ifEmpty { "The ${kind.title.lowercase()} could not be made." }
    else "The ${kind.title.lowercase()} could not be loaded. Check the connection and try again."
  }
}

/** What became of a shipping label sent to the print sheet. */
sealed interface LabelPrintOutcome {
  data object Done : LabelPrintOutcome

  /** The carrier's file is not a PDF: it opens where the console's link opens it, in the browser. */
  data object OpenInstead : LabelPrintOutcome

  data class Failed(val message: String) : LabelPrintOutcome
}

/** Prints a shipment's label: the carrier's PDF, fetched from the link the console opens. */
suspend fun printShippingLabel(api: ConsoleApiClient, printer: SystemPrinter?, link: String, number: String): LabelPrintOutcome {
  printer ?: return LabelPrintOutcome.OpenInstead
  return try {
    val file = api.fetchPublic(link)
    if (!isPdf(file.bytes)) return LabelPrintOutcome.OpenInstead
    when (val result = printer.printDocument(PrintableDocument.Pdf(file.bytes), "Shipping label $number")) {
      is SystemPrintResult.Failed -> LabelPrintOutcome.Failed(result.message)
      else -> LabelPrintOutcome.Done
    }
  } catch (error: CancellationException) {
    throw error
  } catch (error: ConsoleApiError) {
    LabelPrintOutcome.Failed(error.message.ifEmpty { "The label could not be downloaded." })
  }
}
