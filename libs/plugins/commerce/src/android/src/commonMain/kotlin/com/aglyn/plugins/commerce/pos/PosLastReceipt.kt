package com.aglyn.plugins.commerce.pos

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.ReceiptData
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/*
 * THE LAST RECEIPT (AGL-3609, AGL-3651, AGL-3652): the register keeps the sale
 * it finished last, shows it ("Last sale #1042"), and prints its receipt again:
 * on the register's direct printer under a REPRINT banner, as a gift receipt
 * (the items and the barcode a recipient returns with, no prices), or on the
 * register's cloud receipt printer. The Apple app's `PosLastReceipt.swift`.
 *
 * The cloud print asks the SAME door the console's `PosLastReceipt` asks:
 * `commerce/pos-payment` `receipt` with channel `print`, which prints under
 * the sale's own key (so a receipt that already printed is never printed
 * twice). The receipt is read from the stored order, so the printout carries
 * the tenders, tip and change the server recorded, not the basket the register
 * remembers.
 */

/** The sale a register finished last, as remembered across a restart. */
@Serializable
data class LastSale(val orderId: String, val atMs: Long)

/** A last sale older than a week is no longer "the last receipt" to reprint at the till. */
const val LAST_SALE_MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000

/** A sale as the last-receipt row shows it. */
data class LastSaleSummary(val label: String, val totalCents: Long)

/** "#1042", or the first characters of the id for an order with no number yet. */
fun lastSaleLabel(number: Long?, orderId: String): String = if (number != null && number > 0) "#$number" else "#${orderId.take(8)}"

class PosLastReceiptModel(
  private val firestore: FirestoreReader,
  private val api: PosSaleApi,
  private val store: RegisterStore,
  private val hostId: String,
  private val scope: CoroutineScope,
  /** The store's receipt header, address and footer as the register prints them. */
  private val receiptContext: () -> ReceiptContext,
  private val now: () -> Long = ::nowMs,
) {
  var lastSale by mutableStateOf<LastSale?>(null)
    private set
  var summary by mutableStateOf<LastSaleSummary?>(null)
    private set

  /** The last sale's receipt as the server recorded it, once read. */
  var receipt by mutableStateOf<ReceiptData?>(null)
    private set

  /** This register has a cloud receipt printer to send to. */
  var hasPrinter by mutableStateOf(false)
    private set
  var busy by mutableStateOf(false)
    private set
  var notice by mutableStateOf<String?>(null)
  var error by mutableStateOf<String?>(null)
    private set

  private var registerId: String? = null

  /** The register in front of the cashier changed (or was first chosen): read its last sale and printer. */
  fun watch(next: String?) {
    registerId = next
    notice = null
    error = null
    hasPrinter = false
    lastSale = next?.let { store.lastSale(it, now()) }
    read()
    if (next != null) {
      scope.launch {
        hasPrinter = runCatching {
          firestore.page(FirestoreQuery("hosts/$hostId/printers", filters = listOf(FirestoreFilter("registerId", FilterOp.EQ, next)), limit = 1)).docs.isNotEmpty()
        }.getOrElse { if (it is CancellationException) throw it else false }
      }
    }
  }

  /** A sale was paid and the receipt chosen: it is now the last sale. */
  fun remember(orderId: String) {
    val register = registerId ?: return
    val sale = LastSale(orderId, now())
    store.saveLastSale(register, sale)
    lastSale = sale
    notice = null
    error = null
    read()
  }

  private fun read() {
    summary = null
    receipt = null
    val sale = lastSale ?: return
    scope.launch {
      val order = runCatching { firestore.get("hosts/$hostId/orders/${sale.orderId}") }.getOrElse { if (it is CancellationException) throw it else null } ?: return@launch
      if (lastSale != sale) return@launch
      val totals = order.data["totals"] as? Map<*, *>
      val total = (totals?.get("totalCents") as? Number)?.toLong() ?: (order.data["amountCents"] as? Number)?.toLong() ?: 0L
      summary = LastSaleSummary(lastSaleLabel((order.data["number"] as? Number)?.toLong(), sale.orderId), total)
      receipt = receiptDataFromOrder(sale.orderId, order.data, receiptContext(), now())
    }
  }

  /** Sends the last sale's receipt to the register's cloud receipt printer. */
  fun sendToPrinter() {
    val sale = lastSale ?: return
    if (busy) return
    busy = true
    notice = null
    error = null
    scope.launch {
      try {
        api.payment(sale.orderId, SaleStep.Receipt("print", null), null)
        notice = "Sent to the receipt printer"
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        error = (failure as? ConsoleApiError)?.message ?: "Could not print"
      } finally {
        busy = false
      }
    }
  }

  /** Prints the last sale on the register's direct printer: a REPRINT copy, or the gift receipt. */
  fun printHere(gift: Boolean, print: suspend (ReceiptData, Boolean) -> String?) {
    val data = receipt ?: return
    if (busy) return
    busy = true
    notice = null
    error = null
    scope.launch {
      try {
        val problem = print(data.copy(banner = if (gift) "GIFT RECEIPT" else "REPRINT"), gift)
        if (problem == null) notice = if (gift) "Gift receipt printed" else "Receipt printed" else error = problem
      } finally {
        busy = false
      }
    }
  }
}
