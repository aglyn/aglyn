package com.aglyn.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.DeviceSplitEntry
import com.aglyn.contracts.ScreenTrafficRow
import com.aglyn.contracts.aggregateScreenDays
import com.aglyn.contracts.deviceSplit
import com.aglyn.contracts.deviceSplitLabel
import com.aglyn.contracts.deviceSplitValue
import com.aglyn.contracts.recentDayIds
import com.aglyn.contracts.rollUp
import com.aglyn.contracts.topDevice
import com.aglyn.contracts.topReferrer
import com.aglyn.contracts.trafficDeltaPct
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.pluginhost.NativeApp
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.DashboardGrid
import com.aglyn.ui.EmptyState
import com.aglyn.ui.GridSpan
import com.aglyn.ui.MetricCard
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TrendBar
import com.aglyn.ui.TrendBars
import com.aglyn.ui.space
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/*
 * A SITE'S ANALYTICS, as the console's Analytics page shows them: Traffic
 * (page views against the window before, visitors, average a day, the device
 * split, the top page and referrer, a bar a day, and the top pages,
 * referrers, campaign sources and campaigns) over `hosts/{id}/analytics`, a
 * document per UTC day; Pages (the per-page table, a Pro feature) over
 * `hosts/{id}/screenAnalytics`; and whatever plugins put in the page's
 * `hostAnalytics` slot (funnels). The figures are the console's own
 * functions, ported once in the contracts.
 */

/** The Traffic card's ranges, and the Pages table's. */
val TRAFFIC_RANGES = listOf(7, 14, 30, 90)
val PAGES_RANGES = listOf(7, 14, 30)

/** The core page's widget slot, as the console's `PluginWidgetSlot`. */
const val HOST_ANALYTICS_SLOT = "hostAnalytics"

data class TrafficDay(
  val day: String,
  val total: Double,
  val visitors: Double,
  val paths: Map<String, Double>,
  val referrers: Map<String, Double>,
  val devices: Map<String, Double>,
  val utm: Map<String, Map<String, Double>>,
)

private fun counts(value: Any?): Map<String, Double> =
  (value as? Map<*, *>).orEmpty().entries.mapNotNull { (k, v) -> (v as? Number)?.toDouble()?.let { k.toString() to it } }.toMap()

fun trafficDayOf(id: String, data: Map<String, Any?>?): TrafficDay = TrafficDay(
  day = id,
  total = (data?.get("total") as? Number)?.toDouble() ?: 0.0,
  visitors = (data?.get("visitors") as? Number)?.toDouble() ?: 0.0,
  paths = counts(data?.get("paths")),
  referrers = counts(data?.get("referrers")),
  devices = counts(data?.get("devices")),
  utm = (data?.get("utm") as? Map<*, *>).orEmpty().entries.associate { (k, v) -> k.toString() to counts(v) },
)

/**
 * The newest documents of `hosts/{id}/analytics`, by id (a UTC day): a day
 * with no visits has no document, so the newest `2 × range` documents always
 * hold every day of both windows, and the rest are dropped by id.
 */
fun trafficQuery(hostId: String, range: Int) = FirestoreQuery(
  "hosts/$hostId/analytics",
  orderBy = listOf(FirestoreOrder("__name__", descending = true)),
  limit = range * 2,
)

/** Both windows of [range] days, oldest first, a zero day where there was no document. */
fun trafficDays(docs: List<FirestoreDoc>, nowMs: Long, range: Int): List<TrafficDay> {
  val byId = docs.associateBy { it.id }
  return recentDayIds(nowMs, range * 2).reversed().map { id -> trafficDayOf(id, byId[id]?.data) }
}

data class TrafficSummary(
  val current: List<TrafficDay>,
  val total: Double,
  val deltaPct: Double?,
  val visitors: Double,
  val avgPerDay: Long,
  val devices: List<DeviceSplitEntry>,
  val topPaths: List<Pair<String, Double>>,
  val topReferrers: List<Pair<String, Double>>,
  val topUtmSources: List<Pair<String, Double>>,
  val topUtmCampaigns: List<Pair<String, Double>>,
)

/** The Traffic card's figures, as the console computes them from the same days. */
fun trafficSummary(days: List<TrafficDay>, range: Int): TrafficSummary {
  val current = days.takeLast(range)
  val prior = days.dropLast(range).takeLast(range)
  val total = current.sumOf { it.total }
  val deviceTotals = linkedMapOf<String, Double>()
  current.forEach { day -> day.devices.forEach { (k, v) -> deviceTotals[k] = (deviceTotals[k] ?: 0.0) + v } }
  fun utm(param: String) = rollUp(current.map { it.utm[param].orEmpty() }).take(5)
  return TrafficSummary(
    current = current,
    total = total,
    deltaPct = trafficDeltaPct(total, prior.sumOf { it.total }),
    visitors = current.sumOf { it.visitors },
    avgPerDay = kotlin.math.floor(total / maxOf(1, current.size) + 0.5).toLong(),
    devices = deviceSplit(deviceTotals),
    topPaths = rollUp(current.map { it.paths }),
    topReferrers = rollUp(current.map { it.referrers }),
    topUtmSources = utm("source"),
    topUtmCampaigns = utm("campaign"),
  )
}

/** The Pages table's read: every page's day documents from the window's first day. */
fun screenAnalyticsQuery(hostId: String, nowMs: Long, range: Int) = FirestoreQuery(
  "hosts/$hostId/screenAnalytics",
  filters = listOf(FirestoreFilter("day", FilterOp.GTE, recentDayIds(nowMs, range).last())),
  orderBy = listOf(FirestoreOrder("day", descending = true)),
  limit = 1000,
)

private fun count(value: Double): String = value.toLong().toString().reversed().chunked(3).joinToString(",").reversed()

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AnalyticsScreen(services: ShellServices, context: ShellPluginContext) {
  val hostId = context.hostId ?: return EmptyState("Pick a site first", body = "Analytics are one site's.", icon = AglynIcons.named("public"))
  var range by remember { mutableStateOf(14) }
  val now = remember(range) { nowMillis() }
  val traffic by remember(hostId, range) { services.firestore.observe(trafficQuery(hostId, range)) }.collectAsState(Live.Loading)
  val version by services.registry.version.collectAsState()
  val slot = remember(version) { services.registry.widgets(NativeApp.AGLYN, HOST_ANALYTICS_SLOT) }

  Box(Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.TopCenter) {
    Column(
      Modifier.widthIn(max = 1180.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("analytics"),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      SectionCard("Traffic", Modifier.fillMaxWidth().testTag("analytics-traffic")) {
        ChoiceChipRow(
          options = TRAFFIC_RANGES.map { ChipOption(it.toString(), "Last $it days") },
          selected = range.toString(),
          onSelect = { range = it.toInt() },
          modifier = Modifier.testTag("analytics-range"),
        )
        when (val live = traffic) {
          Live.Loading -> SkeletonList(rows = 3)
          is Live.Failed -> NoticeBanner("Traffic could not be loaded. Check the connection and try again.", StatusTone.ERROR)
          is Live.Ready -> {
            val summary = trafficSummary(trafficDays(live.value, now, range), range)
            if (summary.total == 0.0) {
              Text(
                "No pageviews recorded yet — stats appear as visitors browse your published site.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
              )
            } else {
              TrafficTiles(summary, range)
              TrendBars(
                summary.current.map { day -> TrendBar(day.total, "", "${day.day}: ${count(day.total)}") },
                Modifier.fillMaxWidth().testTag("analytics-chart"),
                height = 120.dp,
                highlightLast = false,
              )
              FlowRow(horizontalArrangement = Arrangement.spacedBy(space(3f)), verticalArrangement = Arrangement.spacedBy(space(2f))) {
                TopList("Top pages", summary.topPaths.take(5))
                TopList("Top referrers", summary.topReferrers.take(5))
                TopList("Top campaign sources (UTM)", summary.topUtmSources)
                TopList("Top campaigns (UTM)", summary.topUtmCampaigns)
              }
            }
          }
        }
      }
      PagesTable(services, context, hostId)
      slot.filter { context.hostId != null || !it.requiresSite }.forEach { widget ->
        Box(Modifier.fillMaxWidth().testTag("widget-${widget.id}")) { widget.content(context) }
      }
    }
  }
}

@Composable
private fun TrafficTiles(summary: TrafficSummary, range: Int) {
  val tiles = buildList<Pair<GridSpan, @Composable (Modifier) -> Unit>> {
    add(GridSpan.HALF to { m ->
      MetricCard(
        "Page views", count(summary.total),
        summary.deltaPct?.let { "${if (it > 0) "+" else ""}${it}% vs prior $range days" } ?: "No earlier window to compare",
        "visibility", "Page views", m, onClick = {},
      )
    })
    if (summary.visitors > 0) {
      add(GridSpan.HALF to { m -> MetricCard("Visitors (approx.)", count(summary.visitors), "One per browser tab a day", "person", "Visitors", m, onClick = {}) })
    }
    add(GridSpan.HALF to { m -> MetricCard("Avg / day", count(summary.avgPerDay.toDouble()), "Over $range days", "trending_up", "Average a day", m, onClick = {}) })
    if (summary.devices.isNotEmpty()) {
      add(GridSpan.HALF to { m -> MetricCard(deviceSplitLabel(summary.devices), deviceSplitValue(summary.devices), "Device split", "devices", "Device split", m, onClick = {}) })
    }
    summary.topPaths.firstOrNull()?.let { (path, views) ->
      add(GridSpan.HALF to { m -> MetricCard("Top page · ${count(views)} views", path, null, "description", "Top page", m, onClick = {}) })
    }
    summary.topReferrers.firstOrNull()?.let { (host, views) ->
      add(GridSpan.HALF to { m -> MetricCard("Top referrer · ${count(views)} views", host, null, "link", "Top referrer", m, onClick = {}) })
    }
  }
  DashboardGrid(3, tiles, Modifier.testTag("analytics-tiles"))
}

@Composable
private fun TopList(title: String, rows: List<Pair<String, Double>>) {
  Column(Modifier.widthIn(min = 220.dp, max = 520.dp), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    Text(title, style = MaterialTheme.typography.titleSmall)
    if (rows.isEmpty()) {
      Text("Nothing yet", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    rows.forEach { (key, views) ->
      Row {
        Text(key, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(count(views), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }
}

/** The Pages table: Pro plans; others read the console's upgrade notice. */
@Composable
private fun PagesTable(services: ShellServices, context: ShellPluginContext, hostId: String) {
  var range by remember { mutableStateOf(14) }
  var entitled by remember(hostId) { mutableStateOf<Boolean?>(null) }
  LaunchedEffect(hostId) {
    entitled = runCatching {
      val body = services.api.request("/api/orgs/entitlements", query = mapOf("hostId" to hostId)) as? JsonObject
      ((body?.get("features") as? JsonObject)?.get("screenAnalytics") as? JsonPrimitive)?.booleanOrNull == true
    }.getOrElse { false }
  }
  val now = remember(range) { nowMillis() }
  SectionCard("Pages", Modifier.fillMaxWidth().testTag("analytics-pages")) {
    when (entitled) {
      null -> SkeletonList(rows = 2)
      false -> NoticeBanner("Per-page traffic is part of the Pro plan. Upgrade in Billing to see each page's views, devices and referrers.", StatusTone.INFO, Modifier.testTag("analytics-pages-upgrade"))
      true -> {
        ChoiceChipRow(
          options = PAGES_RANGES.map { ChipOption(it.toString(), "Last $it days") },
          selected = range.toString(),
          onSelect = { range = it.toInt() },
        )
        val docs by remember(hostId, range) { services.firestore.observe(screenAnalyticsQuery(hostId, now, range)) }.collectAsState(Live.Loading)
        val host by remember(hostId) { services.firestore.observeDoc("hosts/$hostId") }.collectAsState(Live.Loading)
        val screens = ((host as? Live.Ready)?.value?.data?.get("screens") as? Map<*, *>).orEmpty()
        when (val live = docs) {
          Live.Loading -> SkeletonList(rows = 3)
          is Live.Failed -> NoticeBanner("Pages could not be loaded.", StatusTone.ERROR)
          is Live.Ready -> {
            val rows = aggregateScreenDays(live.value.map { it.data })
            val sum = rows.sumOf { it.total }.coerceAtLeast(1)
            if (rows.isEmpty()) Text("No page views in this window.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(Modifier.fillMaxWidth()) {
              listOf("Page" to 3f, "Views" to 1f, "Share" to 1f, "Top device" to 1.4f, "Top referrer" to 2f).forEach { (label, weight) ->
                Text(label, Modifier.weight(weight), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
              }
            }
            HorizontalDivider()
            rows.forEach { row -> PageRow(row, screens[row.screenId] as? String ?: row.screenId, sum) }
          }
        }
      }
    }
  }
}

@Composable
private fun PageRow(row: ScreenTrafficRow, path: String, sum: Long) {
  Row(Modifier.fillMaxWidth().padding(vertical = space(0.5f)).testTag("page-${row.screenId}")) {
    Text(path, Modifier.weight(3f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
    Text(count(row.total.toDouble()), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
    Text("${kotlin.math.floor(row.total * 100.0 / sum + 0.5).toLong()}%", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
    Text(topDevice(row).replaceFirstChar { it.uppercaseChar() }, Modifier.weight(1.4f), style = MaterialTheme.typography.bodyMedium)
    Text(topReferrer(row).ifEmpty { "—" }, Modifier.weight(2f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
  }
}

