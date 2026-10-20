package com.aglyn.plugins.commerce.sales

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import com.aglyn.contracts.formatOrderMoney
import com.aglyn.contracts.isLowStock
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.plugins.commerce.orders.COMMERCE_ORDERS_SCREEN
import com.aglyn.plugins.commerce.orders.OrderRow
import com.aglyn.plugins.commerce.orders.orderRow
import com.aglyn.plugins.commerce.orders.ordersPath
import com.aglyn.plugins.commerce.orders.statusTone
import com.aglyn.plugins.commerce.products.hostProductFrom
import com.aglyn.plugins.commerce.products.productsPath
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusChip
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException

/*
 * THE STORE AT A GLANCE (the console's Commerce card on the dashboard): how many products are at or under their low-stock alert,
 * and the five latest orders. Like every sales figure it waits for a plan that sells commerce analytics, and like the console's
 * card it says nothing for a site with no products and no orders.
 */

/** The most products the low-stock count reads; past it the count is a floor. */
const val GLANCE_PRODUCT_CEILING = 250

/** The latest orders the card lists. */
const val GLANCE_LATEST_ORDERS = 5

/** Products at or under their alert among the first [GLANCE_PRODUCT_CEILING] stored (a deleted one is not a product). */
fun glanceLowStock(docs: List<FirestoreDoc>): Int =
  docs.take(GLANCE_PRODUCT_CEILING).count { it.data["deletedAt"] == null && isLowStock(hostProductFrom(it)) }

fun glanceProductsQuery(hostId: String) = FirestoreQuery(productsPath(hostId), limit = GLANCE_PRODUCT_CEILING + 1)

fun glanceOrdersQuery(hostId: String) = FirestoreQuery(ordersPath(hostId), orderBy = listOf(FirestoreOrder("createdAtMs", descending = true)), limit = GLANCE_LATEST_ORDERS)

/** What the card shows: the plan's access, and when the plan has it, the low-stock count and the latest orders. */
class Glance(val access: SalesAccess, val lowStock: Int, val capped: Boolean, val hasProducts: Boolean, val latest: List<OrderRow>)

suspend fun readGlance(firestore: FirestoreReader, orgId: String, hostId: String): Glance {
  val access = salesAccess(firestore, orgId)
  if (!access.carried) return Glance(access, 0, false, false, emptyList())
  val products = firestore.page(glanceProductsQuery(hostId)).docs
  val orders = firestore.page(glanceOrdersQuery(hostId)).docs
  return Glance(access, glanceLowStock(products), products.size > GLANCE_PRODUCT_CEILING, products.isNotEmpty(), orders.map(::orderRow))
}

/** Home's "At a glance" card. */
@Composable
fun GlanceWidget(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  var glance by remember(hostId) { mutableStateOf<Glance?>(null) }
  LaunchedEffect(hostId) {
    glance = try {
      readGlance(context.firestore, context.orgId.orEmpty(), hostId)
    } catch (error: CancellationException) {
      throw error
    } catch (_: Throwable) {
      null
    }
  }
  val read = glance ?: return
  if (!read.access.carried) {
    SectionCard("At a glance", Modifier.fillMaxWidth().testTag("glance")) {
      Text("Included from ${read.access.plan ?: "a higher plan"}.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    return
  }
  if (!read.hasProducts && read.latest.isEmpty()) return
  SectionCard("At a glance", Modifier.fillMaxWidth().testTag("glance")) {
    if (read.lowStock > 0) {
      SectionRow("Low stock", if (read.capped) "${read.lowStock}+" else "${read.lowStock}", Modifier.testTag("glance-low-stock")) { context.navigate("commerce.products") }
    }
    read.latest.forEach { order ->
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
        Text("${order.label} · ${order.customer}", Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
        Text(formatOrderMoney(order.netCents), style = MaterialTheme.typography.bodySmall)
        StatusChip(order.statusLabel, statusTone(order.status))
      }
    }
  }
}

@Composable
private fun SectionRow(label: String, value: String, modifier: Modifier, onClick: () -> Unit) {
  androidx.compose.foundation.layout.Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
    com.aglyn.ui.TextButton(onClick = onClick) { Text(label) }
    Text(value, Modifier.padding(top = space(1f)), style = MaterialTheme.typography.titleMedium)
  }
}
