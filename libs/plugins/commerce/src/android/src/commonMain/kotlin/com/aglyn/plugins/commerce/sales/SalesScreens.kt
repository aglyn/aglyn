package com.aglyn.plugins.commerce.sales

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.formatLocalDay
import com.aglyn.contracts.formatOrderMoney
import com.aglyn.core.nowMillis
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.plugins.commerce.pos.Load
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AmountRow
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.MetricCard
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TrendBar
import com.aglyn.ui.TrendBars
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException

const val COMMERCE_SALES_SCREEN = "commerce.sales"

private fun money(cents: Double) = formatOrderMoney(cents)

private fun change(pct: Double?): String? = pct?.let { (if (it > 0) "+" else "") + it.toString().removeSuffix(".0") + "% vs the period before" }

/** Loads [read] once per [key], and again on [refresh]. */
@Composable
private fun <T> loaded(vararg key: Any?, refresh: Int, read: suspend () -> T): Load<T> {
  var value by remember(*key) { mutableStateOf<Load<T>>(Load.Loading) }
  LaunchedEffect(*key, refresh) {
    value = Load.Loading
    value = try {
      Load.Ready(read())
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      Load.Failed("Sales could not be loaded. Check the connection and try again.")
    }
  }
  return value
}

/** The store's sales: the last 7 or 30 days against the window before, by day, by channel, and the best sellers. */
@Composable
fun SalesScreen(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  var range by rememberSaveable { mutableIntStateOf(7) }
  var refresh by remember { mutableIntStateOf(0) }
  val report = loaded(hostId, range, refresh = refresh) {
    val now = nowMillis()
    val (orders, capped) = ordersSince(context.firestore, hostId, reportSinceMs(now, range))
    salesReport(orders, range, now, capped)
  }
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.widthIn(max = 840.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("sales"),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      ChoiceChipRow(
        options = listOf(ChipOption("7", "Last 7 days"), ChipOption("30", "Last 30 days")),
        selected = range.toString(),
        onSelect = { range = it.toInt() },
      )
      when (report) {
        Load.Loading -> SkeletonList(rows = 6)
        is Load.Failed -> EmptyState(
          "Could not load sales",
          body = report.message,
          icon = AglynIcons.named("error"),
          action = { OutlinedButton(onClick = { refresh++ }) { Text("Try again") } },
        )
        is Load.Ready -> SalesReportView(report.value)
      }
    }
  }
}

@Composable
private fun SalesReportView(report: SalesReport) {
  if (report.capped) {
    NoticeBanner("This store had more than $SALES_ORDER_CEILING orders in the period; the oldest are left out, so there is no comparison.", StatusTone.WARNING)
  }
  Row(horizontalArrangement = Arrangement.spacedBy(space(2f))) {
    SectionCard("Revenue", Modifier.weight(1f).testTag("sales-revenue")) {
      Text(money(report.current.revenueCents), style = MaterialTheme.typography.headlineMedium)
      change(report.revenueDeltaPct)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
    SectionCard("Orders", Modifier.weight(1f).testTag("sales-orders")) {
      Text(report.current.orders.toString(), style = MaterialTheme.typography.headlineMedium)
      change(report.ordersDeltaPct)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
  }
  SectionCard("By day") {
    val labelEvery = if (report.range > 7) 5 else 1
    TrendBars(
      report.days.mapIndexed { index, day ->
        TrendBar(
          value = day.revenueCents,
          label = if ((report.days.lastIndex - index) % labelEvery == 0) formatLocalDay(day.startMs, if (report.range > 7) "MMM d" else "EEE") else "",
          spoken = "${formatLocalDay(day.startMs, "EEEE, MMMM d")}: ${money(day.revenueCents)} from ${day.orders} ${if (day.orders == 1) "order" else "orders"}",
        )
      },
      modifier = Modifier.fillMaxWidth().testTag("sales-days"),
      height = 140.dp,
    )
    AmountRow("Average order", money(report.current.averageCents), muted = true)
  }
  SectionCard("By channel") {
    if (report.channels.isEmpty()) Text("No sales in this period.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    report.channels.forEach { AmountRow(it.label, money(it.revenueCents)) }
  }
  SectionCard("Best sellers") {
    if (report.topProducts.isEmpty()) Text("No sales in this period.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    report.topProducts.forEach { product ->
      val units = product.units.let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() }
      AmountRow("${product.name} · $units sold", money(product.cents))
    }
  }
}

/** The Home card: today's sales so far, and what is waiting to ship. */
@Composable
fun TodaySalesWidget(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val today = loaded(hostId, refresh = 0) {
    val now = nowMillis()
    val (orders, capped) = ordersSince(context.firestore, hostId, com.aglyn.contracts.startOfLocalDay(now))
    todaySales(orders, now, capped)
  }
  val ready = (today as? Load.Ready)?.value
  MetricCard(
    title = "Today",
    value = ready?.let { money(it.figures.revenueCents) },
    caption = ready?.let { "${it.figures.orders} ${if (it.figures.orders == 1L) "order" else "orders"}" + if (it.toFulfill > 0) " · ${it.toFulfill} to ship" else "" },
    icon = "payments",
    actionLabel = "Open sales",
    modifier = Modifier.fillMaxSize().testTag("sales-today"),
    loading = today is Load.Loading,
    error = (today as? Load.Failed)?.message,
    onClick = { context.navigate(COMMERCE_SALES_SCREEN) },
  )
}

/** The Home card: the last 7 days by day. */
@Composable
fun SalesTrendWidget(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val report = loaded(hostId, refresh = 0) {
    val now = nowMillis()
    val (orders, capped) = ordersSince(context.firestore, hostId, reportSinceMs(now, 7))
    salesReport(orders, 7, now, capped)
  }
  SectionCard("Last 7 days", Modifier.fillMaxWidth().testTag("sales-trend"), onClick = { context.navigate(COMMERCE_SALES_SCREEN) }) {
    when (report) {
      Load.Loading -> SkeletonList(rows = 2)
      is Load.Failed -> Text(report.message, color = MaterialTheme.colorScheme.error)
      is Load.Ready -> {
        Text(money(report.value.current.revenueCents), style = MaterialTheme.typography.headlineSmall)
        change(report.value.revenueDeltaPct)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        TrendBars(
          report.value.days.map { day ->
            TrendBar(day.revenueCents, formatLocalDay(day.startMs, "EEE"), "${formatLocalDay(day.startMs, "EEEE")}: ${money(day.revenueCents)}")
          },
          modifier = Modifier.fillMaxWidth(),
          height = 80.dp,
        )
      }
    }
  }
}
