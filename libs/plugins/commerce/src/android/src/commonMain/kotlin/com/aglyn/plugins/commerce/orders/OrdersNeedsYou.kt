package com.aglyn.plugins.commerce.orders

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.NeedsYouLine
import com.aglyn.ui.StatusTone

/** The list filter Home's lines open the orders with (`filter=`), by its chip. */
fun orderFilterOf(param: String?): OrderFilter? = when (param) {
  "unfulfilled" -> OrderFilter.UNFULFILLED
  "disputes" -> OrderFilter.DISPUTES
  "unpaid" -> OrderFilter.PENDING
  "fulfilled" -> OrderFilter.FULFILLED
  "returns" -> OrderFilter.RETURNS
  else -> null
}

/**
 * Home's "Needs you" lines for a store (`commerce.needs-you`): paid orders still to get ready, and disputes waiting on
 * an answer, each opening Orders on its chip. Nothing is drawn for nothing.
 */
@Composable
fun OrdersNeedsYouWidget(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val toFulfill by remember(hostId, context.firestore) { context.firestore.observe(ordersQuery(hostId, OrderFilter.UNFULFILLED)) }.collectAsState(Live.Loading)
  val disputes by remember(hostId, context.firestore) { context.firestore.observe(ordersQuery(hostId, OrderFilter.DISPUTES)) }.collectAsState(Live.Loading)
  (toFulfill as? Live.Ready)?.value?.size?.takeIf { it > 0 }?.let { count ->
    val shown = if (count >= ORDERS_PAGE_SIZE) "$ORDERS_PAGE_SIZE+" else count.toString()
    NeedsYouLine(
      "orders-to-fulfill", "shopping_bag", "$shown ${if (count == 1) "order" else "orders"} to get ready", "Orders",
      onClick = { context.navigate(COMMERCE_ORDERS_SCREEN, mapOf("filter" to "unfulfilled")) },
    )
  }
  (disputes as? Live.Ready)?.value?.size?.takeIf { it > 0 }?.let { count ->
    NeedsYouLine(
      "orders-disputed", "gavel", "$count ${if (count == 1) "dispute needs" else "disputes need"} an answer", "Orders",
      onClick = { context.navigate(COMMERCE_ORDERS_SCREEN, mapOf("filter" to "disputes")) },
      tone = StatusTone.ERROR,
    )
  }
}
