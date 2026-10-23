package com.aglyn.plugins.commerce.orders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.nowMillis
import com.aglyn.hardware.PaperColumns
import com.aglyn.hardware.SystemPrintResult
import com.aglyn.hardware.renderText
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.plugins.commerce.pos.POS_PAYMENT_ROUTE
import com.aglyn.plugins.commerce.pos.ReceiptContext
import com.aglyn.plugins.commerce.pos.ReceiptLayoutOptions
import com.aglyn.plugins.commerce.pos.layoutReceipt
import com.aglyn.plugins.commerce.pos.readPosContext
import com.aglyn.plugins.commerce.pos.receiptDataFromOrder
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.SectionCard
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * A REGISTER SALE'S RECEIPTS FROM THE ORDER SCREEN (the console's
 * `PosReceiptActions` in the order dialog, AGL-3609): the register's 80 mm
 * receipt and its gift receipt on this device's print sheet, laid out as the
 * register lays them out (`receiptDataFromOrder`, `layoutReceipt`), and a
 * reprint on the register's cloud receipt printer when it has one. The Apple
 * plugin's OrderReceiptActions.swift.
 */

/**
 * The store's receipt header for a register sale printed away from the register: the site's name, currency and time
 * zone, and the register rules' address and return policy (`commerce/pos-payment`'s context).
 */
suspend fun orderReceiptContext(context: NativePluginContext, hostId: String, registerName: String?): ReceiptContext {
  val host = try {
    context.firestore.get("hosts/$hostId")
  } catch (error: Throwable) {
    if (error is CancellationException) throw error
    null
  }
  val rules = try {
    readPosContext(context.api.request(POS_PAYMENT_ROUTE, ApiMethod.GET, query = mapOf("hostId" to hostId, "action" to "context"))).ops
  } catch (error: Throwable) {
    if (error is CancellationException) throw error
    null
  }
  return ReceiptContext(
    storeName = listOf("displayName", "name", "title").firstNotNullOfOrNull { (host?.data?.get(it) as? String)?.trim()?.ifEmpty { null } } ?: "Store",
    storeLines = rules?.receiptAddress.orEmpty().lines().map { it.trim() }.filter { it.isNotEmpty() },
    registerName = registerName,
    timeZone = (host?.data?.get("timeZone") as? String)?.ifEmpty { null },
    currency = (host?.data?.get("currency") as? String)?.ifEmpty { null },
    footer = rules?.returnPolicy?.trim()?.ifEmpty { null },
  )
}

/** Print receipt, Gift receipt and, when the register has a cloud printer, Receipt printer. */
@Composable
fun OrderReceiptActions(context: NativePluginContext, orderId: String, raw: Map<String, Any?>, number: String, report: (done: String?, problem: String?) -> Unit) {
  val hostId = context.hostId ?: return
  val scope = rememberCoroutineScope()
  val registerId = (raw["registerId"] as? String)?.ifEmpty { null }
  var hasPrinter by remember(registerId) { mutableStateOf(false) }
  var busy by remember { mutableStateOf<String?>(null) }
  val printer = context.peripherals.systemPrinter
  LaunchedEffect(registerId) {
    if (registerId == null) return@LaunchedEffect
    context.firestore.observe(FirestoreQuery("hosts/$hostId/printers", filters = listOf(FirestoreFilter("registerId", FilterOp.EQ, registerId)), limit = 1))
      .collect { live -> (live as? com.aglyn.core.Live.Ready)?.let { hasPrinter = it.value.isNotEmpty() } }
  }
  fun print(gift: Boolean) {
    val sheet = printer ?: return report(null, "This device has no print sheet.")
    busy = if (gift) "gift" else "receipt"
    scope.launch {
      try {
        val receipt = receiptDataFromOrder(orderId, raw, orderReceiptContext(context, hostId, raw["registerName"] as? String), nowMillis())
        val text = renderText(layoutReceipt(receipt, ReceiptLayoutOptions(PaperColumns.MM80, gift = gift)))
        (sheet.printText(text, "${if (gift) "Gift receipt" else "Receipt"} $number") as? SystemPrintResult.Failed)?.let { report(null, it.message) }
      } finally {
        busy = null
      }
    }
  }
  SectionCard("Register receipt") {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      OutlinedButton(onClick = { print(false) }, enabled = busy == null, modifier = Modifier.testTag("order-pos-receipt")) {
        Text(if (busy == "receipt") "Printing…" else "Print receipt")
      }
      OutlinedButton(onClick = { print(true) }, enabled = busy == null, modifier = Modifier.testTag("order-pos-gift-receipt")) {
        Text(if (busy == "gift") "Printing…" else "Gift receipt")
      }
      if (hasPrinter) {
        OutlinedButton(
          onClick = {
            busy = "cloud"
            scope.launch {
              try {
                context.api.request(
                  "/api/commerce/printers",
                  ApiMethod.POST,
                  JsonObject(mapOf("hostId" to JsonPrimitive(hostId), "orderId" to JsonPrimitive(orderId), "action" to JsonPrimitive("reprint"))),
                )
                report("Sent to the receipt printer", null)
              } catch (error: Throwable) {
                if (error is CancellationException) throw error
                val refused = error as? ConsoleApiError
                report(null, if (refused != null && refused.status > 0) refused.message.ifEmpty { "Could not print" } else "The register is offline. Check the connection and try again.")
              } finally {
                busy = null
              }
            }
          },
          enabled = busy == null,
          modifier = Modifier.testTag("order-pos-cloud-receipt"),
        ) { Text(if (busy == "cloud") "Sending…" else "Receipt printer") }
      }
    }
    Text("The register's receipt for this sale. A gift receipt leaves out every price.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}
