package com.aglyn.site.analytics

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import com.aglyn.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import com.aglyn.contracts.ActivityEntryFields
import com.aglyn.contracts.DeviceSplitEntry
import com.aglyn.contracts.ScreenTrafficDay
import com.aglyn.contracts.activityActorLabel
import com.aglyn.contracts.activityRowText
import com.aglyn.contracts.aggregateScreenDays
import com.aglyn.contracts.deviceSplit
import com.aglyn.contracts.deviceSplitLabel
import com.aglyn.contracts.deviceSplitValue
import com.aglyn.contracts.formatDwell
import com.aglyn.contracts.recentDayIds
import com.aglyn.contracts.referrerLabel
import com.aglyn.contracts.rollUp
import com.aglyn.contracts.summarizeScreenTraffic
import com.aglyn.contracts.topDevice
import com.aglyn.contracts.topReferrer
import com.aglyn.contracts.trafficDeltaPct
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.core.siteListAddress
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.DeltaTone
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.RangePicker
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatFigure
import com.aglyn.ui.StatFigures
import com.aglyn.ui.StatsCard
import com.aglyn.ui.StatsSection
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TopList
import com.aglyn.ui.TrendBar
import com.aglyn.ui.TrendBars
import com.aglyn.ui.UpgradeNotice
import com.aglyn.ui.space
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/*
 * A SITE'S NUMBERS, as the console's cards read them (AGL-4011): the Traffic card over `hosts/{id}/analytics` (a
 * document per UTC day), the Pages table (a Pro feature) over the same days' per-path counts (AGL-4253), each path named by
 * `SitePageTraffic.kt`, with a page's device and referrer from `hosts/{id}/screenAnalytics`, a page's own traffic over its
 * `screenAnalytics/{screenId}:{day}` documents, and the activity log `hosts/{id}/activity`. The figures are the
 * console's own functions, ported once in the contracts. Home, Analytics and a page's detail draw these parts, and a
 * phone's Home can host them too. The Apple twin is AglynSite/SiteAnalytics.swift.
 */

/** The Traffic card's ranges, and the Pages table's. */
val TRAFFIC_RANGES = listOf(7, 14, 30, 90)
val PAGES_RANGES = listOf(7, 14, 30)

/** How many days a page's own traffic covers. */
const val PAGE_TRAFFIC_DAYS = 14

/** The activity window the console's card reads. */
const val ACTIVITY_WINDOW = 200

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
 * Both windows' documents of `hosts/{id}/analytics`, by id (a UTC day) from the oldest day of the two on, ascending,
 * which the Firestore emulator answers too (it refuses a descending scan of ids).
 */
fun trafficQuery(hostId: String, range: Int, nowMs: Long) = FirestoreQuery(
  "hosts/$hostId/analytics",
  filters = listOf(FirestoreFilter("__name__", FilterOp.GTE, "hosts/$hostId/analytics/${recentDayIds(nowMs, range * 2).last()}")),
  orderBy = listOf(FirestoreOrder("__name__")),
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
    topReferrers = rollUp(current.map { it.referrers }).map { (key, views) -> referrerLabel(key) to views },
    topUtmSources = utm("source"),
    topUtmCampaigns = utm("campaign"),
  )
}

/** The Pages table's read: every page's day documents from the window's first day, newest first. */
fun screenAnalyticsQuery(hostId: String, nowMs: Long, range: Int) = FirestoreQuery(
  "hosts/$hostId/screenAnalytics",
  filters = listOf(FirestoreFilter("day", FilterOp.GTE, recentDayIds(nowMs, range).last())),
  orderBy = listOf(FirestoreOrder("day", descending = true)),
  limit = 1000,
)

/** The Pages table's day read: the window's documents of `hosts/{id}/analytics`, by id from its oldest day on. */
fun pagesDaysQuery(hostId: String, range: Int, nowMs: Long) = FirestoreQuery(
  "hosts/$hostId/analytics",
  filters = listOf(FirestoreFilter("__name__", FilterOp.GTE, "hosts/$hostId/analytics/${recentDayIds(nowMs, range).last()}")),
  orderBy = listOf(FirestoreOrder("__name__")),
  limit = range,
)

/** How many values one Firestore `in` filter takes. */
const val IN_QUERY_MAX = 30

/**
 * The Pages table's rows (AGL-4253). [failed]: the days could not be read, so nothing is shown as zero. [labelsFailed]:
 * the names could not be read, so rows show their addresses. [screensFailed]: the per-page device and referrer could not.
 */
data class SitePagesLoad(
  val rows: List<SitePageRow>,
  val failed: Boolean = false,
  val labelsFailed: Boolean = false,
  val screensFailed: Boolean = false,
)

/**
 * Every visited path over [range] days by its day documents' `paths` counts, each named for what it is, with device and
 * referrer only where counted per page (`screenAnalytics`, a routed page that is not a template). Read once per open,
 * range or refresh, as the console's table does.
 */
suspend fun loadSitePages(firestore: FirestoreReader, hostId: String, range: Int, nowMs: Long): SitePagesLoad {
  val days = runCatching { firestore.page(pagesDaysQuery(hostId, range, nowMs)).docs }.getOrElse { return SitePagesLoad(emptyList(), failed = true) }
  val views = rollUpPathViews(days.map { trafficDayOf(it.id, it.data).paths })
  val screens = runCatching { aggregateScreenDays(firestore.page(screenAnalyticsQuery(hostId, nowMs, range)).docs.map { it.data }) }.getOrNull()
  val screenById = screens.orEmpty().associateBy { it.screenId }
  val labels = runCatching { labelSitePaths(firestore, hostId, views.map { it.first }) }.getOrNull()
  val rows = views.map { (path, count) ->
    val label = labels?.get(path) ?: SitePageLabel.unlabeled(path)
    SitePageRow(path, count, label, label.screenId?.let { screenById[it] })
  }
  return SitePagesLoad(rows, labelsFailed = labels == null && views.isNotEmpty(), screensFailed = screens == null)
}

/**
 * Names every path (`labelSitePaths`): the host doc and its collections once, each visited page's screen, then one `in`
 * query per thirty records or entries. A read that fails throws: the rows then show their addresses and the card says
 * so, rather than filing a product under Other addresses because its lookup was refused.
 */
suspend fun labelSitePaths(firestore: FirestoreReader, hostId: String, paths: List<String>): Map<String, SitePageLabel> {
  if (paths.isEmpty()) return emptyMap()
  val host = firestore.get("hosts/$hostId")?.data.orEmpty()
  val collections = firestore.page(FirestoreQuery("hosts/$hostId/collections", limit = 500)).docs
  val facts = SitePageFacts(
    routes = (host["screens"] as? Map<*, *>).orEmpty().entries.mapNotNull { (k, v) -> (v as? String)?.let { k.toString() to it } }.toMap(),
    origin = sitePublicOrigin(host),
    collections = collections.map { it.id to it.data },
  )
  val context = facts.context
  val classes = paths.map { classifyPagePath(it, context) }
  val wanted = SitePageReads.of(classes)
  val screens = wanted.screenIds.mapNotNull { id -> firestore.get("hosts/$hostId/screens/$id")?.let { id to it.data } }.toMap()
  suspend fun bySlug(collection: String, slugs: List<String>, accepts: (Map<String, Any?>) -> Boolean = { true }): Map<String, Pair<String, Map<String, Any?>>> {
    val found = linkedMapOf<String, Pair<String, Map<String, Any?>>>()
    slugs.chunked(IN_QUERY_MAX).forEach { chunk ->
      firestore.page(FirestoreQuery(collection, filters = listOf(FirestoreFilter("slug", FilterOp.IN, chunk)), limit = chunk.size * 2)).docs.forEach { doc ->
        val slug = doc.data["slug"] as? String
        if (slug != null && accepts(doc.data) && slug !in found) found[slug] = doc.id to doc.data
      }
    }
    return found
  }
  val records = wanted.recordSlugs.mapNotNull { (segment, slugs) ->
    SitePathKind.ALL.firstOrNull { it.segment == segment }?.let { kind -> segment to bySlug("hosts/$hostId/${kind.collection}", slugs, kind::accepts) }
  }.toMap()
  val entries = wanted.entrySlugs.mapNotNull { (slug, entrySlugs) ->
    facts.contentBySlug[slug]?.first?.let { owner -> slug to bySlug("hosts/$hostId/collections/$owner/entries", entrySlugs) }
  }.toMap()
  val read = SitePageFound(screens, records, entries)
  return paths.zip(classes).associate { (path, found) -> path to sitePageLabel(path, found, facts, read) }
}

/** The site's public origin (`hostPublicOrigin`): its custom domain, else its address on the platform domain. */
fun sitePublicOrigin(host: Map<String, Any?>): String? =
  siteListAddress(host["cname"] as? String, host["subdomain"] as? String)?.let { "https://$it" }

/** One page's last [PAGE_TRAFFIC_DAYS] days by document id (`{screenId}:{day}`), so no index is owed. */
fun pageTrafficQuery(hostId: String, screenId: String, nowMs: Long): FirestoreQuery {
  val ids = recentDayIds(nowMs, PAGE_TRAFFIC_DAYS)
  val base = "hosts/$hostId/screenAnalytics"
  return FirestoreQuery(
    base,
    filters = listOf(
      FirestoreFilter("__name__", FilterOp.GTE, "$base/$screenId:${ids.last()}"),
      FirestoreFilter("__name__", FilterOp.LTE, "$base/$screenId:${ids.first()}"),
    ),
    orderBy = listOf(FirestoreOrder("__name__")),
    limit = PAGE_TRAFFIC_DAYS,
  )
}

/** A page's days, oldest first, a zero day where nothing was written. */
fun pageTrafficDays(docs: List<FirestoreDoc>, screenId: String, nowMs: Long): List<Pair<String, ScreenTrafficDay>> {
  val byId = docs.associateBy { it.id }
  return recentDayIds(nowMs, PAGE_TRAFFIC_DAYS).reversed().map { day -> day to ScreenTrafficDay.of(byId["$screenId:$day"]?.data) }
}

/** The site's whole log (newest first), or one page's (filtered on the server, sorted here: no composite index). */
fun activityQuery(hostId: String, targetId: String?) = if (targetId != null) {
  FirestoreQuery("hosts/$hostId/activity", filters = listOf(FirestoreFilter("target.id", FilterOp.EQ, targetId)), limit = ACTIVITY_WINDOW + 1)
} else {
  FirestoreQuery("hosts/$hostId/activity", orderBy = listOf(FirestoreOrder("createdAt", descending = true)), limit = ACTIVITY_WINDOW + 1)
}

/** One row of a site's activity log, in the console's words. */
data class SiteActivityRow(val id: String, val text: String, val actor: String, val atMs: Long?)

/**
 * The rows in the console's words, newest first; a row that recorded a person's uid and no address is named by [resolved]
 * (the address that account holds today, from `/api/hosts/activity-actors`), else the console's `Account <uid>`.
 */
fun siteActivityRows(docs: List<FirestoreDoc>, resolved: Map<String, String> = emptyMap()): List<SiteActivityRow> = docs.take(ACTIVITY_WINDOW).map { doc ->
  val fields = ActivityEntryFields.of(doc.data).let { fields -> unaddressedUid(fields)?.let { resolved[it] }?.let { fields.copy(actorEmailNow = it) } ?: fields }
  SiteActivityRow(doc.id, activityRowText(fields), activityActorLabel(fields), (doc.data["createdAt"] as? FirestoreTimestamp)?.epochMillis)
}.sortedByDescending { it.atMs ?: Long.MIN_VALUE }

/** The uid a row names with no address: a person's (never an API key's or the platform's), `useResolvedActivityActors`. */
fun unaddressedUid(fields: ActivityEntryFields): String? {
  if (!fields.actorEmail.isNullOrEmpty()) return null
  val uid = fields.actorId?.trim().orEmpty()
  return if (uid.isEmpty() || uid == "api" || uid.startsWith("system:")) null else uid
}

/** How many uids one `/api/hosts/activity-actors` request names. */
const val ACTORS_PER_REQUEST = 50

/** The addresses the console's actors route resolves for [uids], fifty at a time; a refused batch is left out. */
suspend fun resolveActivityActors(api: ConsoleApiClient, hostId: String, uids: List<String>): Map<String, String> {
  val resolved = mutableMapOf<String, String>()
  for (batch in uids.chunked(ACTORS_PER_REQUEST)) {
    runCatching {
      val body = api.request("/api/hosts/activity-actors", query = mapOf("hostId" to hostId, "uids" to batch.joinToString(","))) as? JsonObject
      (body?.get("actors") as? JsonObject)?.forEach { (uid, value) -> (value as? JsonPrimitive)?.takeIf { it.isString }?.let { resolved[uid] = it.content } }
    }
  }
  return resolved
}

/** A count as the console prints it: `1,284`. */
fun analyticsCount(value: Double): String = value.toLong().toString().reversed().chunked(3).joinToString(",").reversed()

/** Whether the plan shows per-page traffic (`screenAnalytics`): null while asked or when the lookup failed. */
@Composable
fun rememberScreenAnalyticsEntitlement(api: ConsoleApiClient, hostId: String, refresh: Int): Pair<Boolean?, Boolean> {
  var entitled by remember(hostId) { mutableStateOf<Boolean?>(null) }
  var failed by remember(hostId) { mutableStateOf(false) }
  LaunchedEffect(hostId, refresh) {
    failed = false
    runCatching {
      val body = api.request("/api/orgs/entitlements", query = mapOf("hostId" to hostId)) as? JsonObject
      ((body?.get("features") as? JsonObject)?.get("screenAnalytics") as? JsonPrimitive)?.booleanOrNull == true
    }.onSuccess { entitled = it }.onFailure { failed = true }
  }
  return entitled to failed
}

// MARK: Cards

/**
 * The console's Traffic card (`HostAnalyticsCard`): a range, the figures, a bar per day. On Home it is the summary with
 * View details; on Analytics ([detail]) it adds the four ranked lists and the per-page note.
 */
@Composable
fun SiteTrafficCard(
  firestore: FirestoreReader,
  hostId: String,
  modifier: Modifier = Modifier,
  detail: Boolean = false,
  viewDetails: (() -> Unit)? = null,
) {
  var range by remember { mutableStateOf(14) }
  val now = remember(range) { nowMillis() }
  val traffic by remember(hostId, range) { firestore.observe(trafficQuery(hostId, range, now)) }.collectAsState(Live.Loading)
  StatsSection(
    "Traffic",
    modifier.testTag("analytics-traffic"),
    accessory = { RangePicker(range, TRAFFIC_RANGES, { range = it }, Modifier.testTag("analytics-range")) },
    // View details ends the title row, on one line (Figma 344:44710); the range goes under it when they do not all fit.
    link = viewDetails?.let { open ->
      { TextButton(onClick = open, modifier = Modifier.testTag("traffic-view-details")) { Text("View details", maxLines = 1, softWrap = false) } }
    },
  ) {
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
          TrafficFigures(summary)
          TrendBars(
            summary.current.map { day -> TrendBar(day.total, "", "${day.day}: ${analyticsCount(day.total)}") },
            Modifier.fillMaxWidth().testTag("analytics-chart"),
            height = space(if (detail) 20f else 15f),
            highlightLast = false,
          )
          if (detail) TrafficLists(summary)
        }
      }
    }
  }
}

@Composable
private fun TrafficFigures(summary: TrafficSummary) {
  StatFigures(Modifier.testTag("analytics-tiles")) {
    val tile = Modifier.widthIn(min = space(14f), max = space(28f))
    StatFigure(
      analyticsCount(summary.total), "Page views", tile,
      delta = summary.deltaPct?.let { "${if (it > 0) "+" else ""}${it}% vs prior" },
      deltaTone = when {
        (summary.deltaPct ?: 0.0) > 0 -> DeltaTone.UP
        (summary.deltaPct ?: 0.0) < 0 -> DeltaTone.DOWN
        else -> DeltaTone.FLAT
      },
    )
    if (summary.visitors > 0) StatFigure(analyticsCount(summary.visitors), "Visitors (approx.)", tile)
    StatFigure(analyticsCount(summary.avgPerDay.toDouble()), "Avg / day", tile)
    if (summary.devices.isNotEmpty()) StatFigure(deviceSplitValue(summary.devices), deviceSplitLabel(summary.devices), tile)
    summary.topPaths.firstOrNull()?.let { (path, views) -> StatFigure(path, "Top page · ${analyticsCount(views)} views", tile) }
    summary.topReferrers.firstOrNull()?.let { (host, views) -> StatFigure(host, "Top referrer · ${analyticsCount(views)} views", tile) }
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TrafficLists(summary: TrafficSummary) {
  fun rows(list: List<Pair<String, Double>>) = list.map { (key, views) -> key to analyticsCount(views) }
  FlowRow(horizontalArrangement = Arrangement.spacedBy(space(3f)), verticalArrangement = Arrangement.spacedBy(space(2f))) {
    val box = Modifier.widthIn(min = space(27.5f), max = space(60f))
    TopList("Top pages", rows(summary.topPaths.take(5)), box)
    TopList("Top referrers", rows(summary.topReferrers.take(5)), box)
    TopList("Top campaign sources (UTM)", rows(summary.topUtmSources), box)
    TopList("Top campaigns (UTM)", rows(summary.topUtmCampaigns), box)
  }
  Text(
    "Per-page breakdowns live in the Pages table in Analytics and in each page’s detail view (Pro plans).",
    style = MaterialTheme.typography.bodySmall,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
  )
}

/**
 * The console's Pages table (`PagesTrafficTable`, AGL-4253): every visited product, store collection, post and page of
 * the site by its own name, the address beneath, filtered by kind, a Pro feature. A row opens what it names ([open]): a
 * page's traffic, a product's editor, or the live page.
 */
@Composable
fun SitePagesTrafficCard(
  firestore: FirestoreReader,
  api: ConsoleApiClient,
  hostId: String,
  upgrade: () -> Unit,
  open: (SitePageLabel) -> Unit,
  modifier: Modifier = Modifier,
) {
  var range by remember { mutableStateOf(14) }
  var kind by remember(hostId, range) { mutableStateOf(ALL_KINDS) }
  var attempt by remember(hostId) { mutableStateOf(0) }
  val (entitled, failed) = rememberScreenAnalyticsEntitlement(api, hostId, attempt)
  StatsSection(
    "Pages",
    modifier.testTag("analytics-pages"),
    accessory = if (entitled == true) ({ RangePicker(range, PAGES_RANGES, { range = it }) }) else null,
  ) {
    when (entitled) {
      null -> if (failed) {
        NoticeBanner("Your plan could not be checked. Check the connection and try again.", StatusTone.ERROR, Modifier.testTag("analytics-pages-failed")) {
          TextButton(onClick = { attempt += 1 }) { Text("Try again") }
        }
      } else {
        Text("Checking your plan…", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      false -> UpgradeNotice(
        "Seeing which pages, products and posts get visited is a Pro feature. Data is already being collected, so history is waiting the moment you upgrade.",
        modifier = Modifier.testTag("analytics-pages-upgrade"),
        action = upgrade,
      )
      true -> {
        var load by remember(hostId, range) { mutableStateOf<SitePagesLoad?>(null) }
        LaunchedEffect(hostId, range, attempt) { load = loadSitePages(firestore, hostId, range, nowMillis()) }
        when (val loaded = load) {
          null -> SkeletonList(rows = 3)
          else -> if (loaded.failed) {
            NoticeBanner("Pages could not be loaded. Check the connection and try again.", StatusTone.ERROR, Modifier.testTag("analytics-pages-load-failed")) {
              TextButton(onClick = { attempt += 1 }) { Text("Try again") }
            }
          } else if (loaded.rows.isEmpty()) {
            Text("No pageviews recorded in this range yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          } else {
            if (loaded.labelsFailed) NoticeBanner("The names of these pages could not be read, so they show by address.", StatusTone.WARNING)
            PagesTable(loaded, kind, { kind = it }, open)
          }
        }
      }
    }
  }
}

private const val ALL_KINDS = "all"

/** Under the table: why template-drawn rows say Site-wide. */
const val PAGES_SHARED_TEMPLATE_NOTE =
  "Views are counted per address, so each product, post and collection is its own row. Device and referrer are counted per page design: rows drawn from a shared template show “Site-wide”, and the site’s split is in Traffic."

@Composable
private fun PagesTable(loaded: SitePagesLoad, kind: String, onKind: (String) -> Unit, open: (SitePageLabel) -> Unit) {
  val groups = sitePageGroups(loaded.rows)
  val shown = if (kind == ALL_KINDS) loaded.rows else loaded.rows.filter { it.label.group.id == kind }
  val sum = loaded.rows.sumOf { it.views }
  Column {
    ChoiceChipRow(
      listOf(ChipOption(ALL_KINDS, "All · ${loaded.rows.size}")) +
        groups.map { ChipOption(it.group.id, "${it.group.label} · ${it.count} · ${analyticsCount(it.views)} views") },
      kind,
      onKind,
      Modifier.fillMaxWidth().padding(bottom = space(1f)).testTag("analytics-pages-kinds"),
    )
    PagesHeader()
    shown.forEach { row ->
      HorizontalDivider()
      PageRow(row, sum, showKind = kind == ALL_KINDS, screensFailed = loaded.screensFailed) { open(row.label) }
    }
    Text(
      PAGES_SHARED_TEMPLATE_NOTE,
      Modifier.padding(top = space(2f)),
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
  }
}

private val PAGE_COLUMNS = listOf("Page" to 3f, "Views" to 1f, "Share" to 1f, "Top device" to 1.4f, "Top referrer" to 2f)

@Composable
private fun PagesHeader() {
  Row(Modifier.fillMaxWidth().padding(bottom = space(1f))) {
    PAGE_COLUMNS.forEachIndexed { index, (label, weight) ->
      Text(
        label, Modifier.weight(weight),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = if (index == 1 || index == 2) TextAlign.End else TextAlign.Start,
      )
    }
  }
}

/** A row's own device or referrer; "Site-wide" where it is drawn from a shared template and not counted per page. */
private fun perPage(label: SitePageLabel, screensFailed: Boolean, value: String?): String = when {
  label.screenId == null -> "Site-wide"
  screensFailed -> "Could not read"
  else -> value?.ifEmpty { null } ?: "--"
}

@Composable
private fun PageRow(row: SitePageRow, sum: Double, showKind: Boolean, screensFailed: Boolean, onClick: () -> Unit) {
  val label = row.label
  val opens = label.screenId != null || label.productId != null || label.liveUrl != null
  Row(
    Modifier.fillMaxWidth().clickable(enabled = opens, onClick = onClick).padding(vertical = space(1.5f)).testTag("analytics-page-${row.path}"),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    val style = MaterialTheme.typography.bodyMedium
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(Modifier.weight(3f)) {
      Text(label.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = style)
      Text(
        listOfNotNull(if (showKind) label.group.label else null, label.path, label.note).joinToString(" · "),
        maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = muted,
      )
    }
    Text(analyticsCount(row.views), Modifier.weight(1f), style = style, textAlign = TextAlign.End)
    Text(if (sum > 0) "${kotlin.math.floor(row.views * 100.0 / sum + 0.5).toLong()}%" else "--", Modifier.weight(1f), style = style, color = muted, textAlign = TextAlign.End)
    Text(
      perPage(label, screensFailed, row.screen?.let { topDevice(it).replaceFirstChar { c -> c.uppercaseChar() } }),
      Modifier.weight(1.4f).padding(start = space(2f)), maxLines = 1, overflow = TextOverflow.Ellipsis, style = style, color = muted,
    )
    Text(perPage(label, screensFailed, row.screen?.let { referrerLabel(topReferrer(it)) }), Modifier.weight(2f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = style, color = muted)
  }
}

/** The console's "Page traffic" card (`ScreenAnalyticsCard`): one page's last 14 days, a Pro feature collected on every plan. */
@Composable
fun PageTrafficCard(
  firestore: FirestoreReader,
  api: ConsoleApiClient,
  hostId: String,
  screenId: String,
  upgrade: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val (entitled, failed) = rememberScreenAnalyticsEntitlement(api, hostId, 0)
  StatsSection(if (entitled == true) "Page traffic (14 days)" else "Page traffic", modifier.testTag("page-traffic")) {
    when (entitled) {
      null -> if (failed) {
        NoticeBanner("Your plan could not be checked. Check the connection and try again.", StatusTone.ERROR)
      } else {
        Text("Checking your plan…", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      false -> UpgradeNotice(
        "Per-page traffic — the views, devices and referrers of each page — is a Pro feature. Data is already being collected, so history is waiting the moment you upgrade.",
        modifier = Modifier.testTag("page-traffic-upgrade"),
        action = upgrade,
      )
      true -> {
        val now = remember(screenId) { nowMillis() }
        val docs by remember(hostId, screenId) { firestore.observe(pageTrafficQuery(hostId, screenId, now)) }.collectAsState(Live.Loading)
        when (val live = docs) {
          Live.Loading -> SkeletonList(rows = 2)
          is Live.Failed -> NoticeBanner("Traffic could not be loaded. Check the connection and try again.", StatusTone.ERROR)
          is Live.Ready -> {
            val days = pageTrafficDays(live.value, screenId, now)
            val summary = summarizeScreenTraffic(days.map { it.second })
            if (summary.total == 0.0) {
              Text("No pageviews recorded for this page yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
              StatFigures {
                StatFigure(analyticsCount(summary.total), "Page views", Modifier.widthIn(min = space(14f)))
                summary.avgDwellMs?.let { StatFigure(formatDwell(it), "Avg. time on this page", Modifier.widthIn(min = space(14f))) }
              }
              TrendBars(
                days.map { (day, stat) -> TrendBar(stat.total, "", "$day: ${analyticsCount(stat.total)}") },
                Modifier.fillMaxWidth(),
                height = space(12f),
                highlightLast = false,
              )
              if (summary.deviceLine.isNotEmpty()) {
                Text(summary.deviceLine, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
              }
              TopList("Top referrers", summary.topReferrers.map { referrerLabel(it.referrer) to analyticsCount(it.count) })
            }
          }
        }
      }
    }
  }
}

/**
 * The console's activity card (`HostActivityCard`): Recent activity for the whole site, or a page's "Page Activity".
 * [limit] shows only the newest rows (Home's five); null shows the whole window.
 */
@Composable
fun SiteActivityCard(
  firestore: FirestoreReader,
  api: ConsoleApiClient,
  hostId: String,
  modifier: Modifier = Modifier,
  targetId: String? = null,
  title: String = "Recent activity",
  limit: Int? = null,
  viewAll: (() -> Unit)? = null,
) {
  val docs by remember(hostId, targetId) { firestore.observe(activityQuery(hostId, targetId)) }.collectAsState(Live.Loading)
  Column(modifier.fillMaxWidth().testTag(if (targetId == null) "site-activity" else "page-activity"), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
      if (viewAll != null) TextButton(onClick = viewAll, modifier = Modifier.testTag("activity-view-all")) { Text("View all") }
    }
    when (val live = docs) {
      Live.Loading -> SkeletonList(rows = 3)
      // A read that never happened is not an empty history.
      is Live.Failed -> NoticeBanner(
        "Could not read the activity log. This is NOT the same as nothing having happened — do not treat this as a record that the page is unchanged.",
        StatusTone.WARNING,
      )
      is Live.Ready -> {
        var resolved by remember(hostId) { mutableStateOf<Map<String, String>>(emptyMap()) }
        val unaddressed = remember(live.value) { live.value.mapNotNull { unaddressedUid(ActivityEntryFields.of(it.data)) }.distinct() }
        LaunchedEffect(hostId, unaddressed) {
          val fresh = unaddressed.filter { it !in resolved }
          if (fresh.isNotEmpty()) resolved = resolved + resolveActivityActors(api, hostId, fresh)
        }
        val rows = siteActivityRows(live.value, resolved)
        if (rows.isEmpty()) {
          Text("No activity yet — changes made in the console appear here.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
          val now = remember(rows.size) { nowMillis() }
          StatsCard {
            (limit?.let { rows.take(it) } ?: rows).forEachIndexed { index, row ->
              if (index > 0) HorizontalDivider()
              AglynListItem(
                title = row.text,
                supporting = listOfNotNull(row.actor, row.atMs?.let { relativeTime(it, now) }).joinToString(" · "),
                icon = AglynIcons.named("history"),
                modifier = Modifier.testTag("activity-${row.id}"),
              )
            }
          }
          if (limit == null && live.value.size > ACTIVITY_WINDOW) {
            Text("Showing the newest $ACTIVITY_WINDOW entries.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
    }
  }
}
