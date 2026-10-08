package com.aglyn.plugins.marketing

import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryFilter
import com.aglyn.contracts.ListQueryOp
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDelete
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.firestoreJson
import com.aglyn.core.firestoreNow
import com.aglyn.core.listquery.nameSearchFields
import com.aglyn.core.listquery.nameSearchKey
import com.aglyn.core.listquery.nameSearchTokens
import com.aglyn.core.listquery.newResourceId
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import com.aglyn.core.nowMillis
import com.aglyn.core.publishSiteWideChange
import com.aglyn.core.replacementMerge
import com.aglyn.pluginhost.NativePluginContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.sqrt

/*
 * A SITE'S MARKETING, AS THE CONSOLE READS AND WRITES IT (the Apple plugin's
 * `Marketing.swift`). Campaigns are `orgs/{orgId}/emailCampaigns`, the site's
 * by the `visibleTo` scope the rules read; their sends are
 * `orgs/{orgId}/campaigns`. Overlays and A/B tests are the site's own
 * `overlays` and `experiments`, and every write to them re-renders the site
 * (`publishSiteWideChange`), as the console's `writeSiteWideChange` does.
 */

enum class MarketingSection(val key: String, val label: String, val icon: String) {
  OVERVIEW("overview", "Overview", "insights"),
  CAMPAIGNS("campaigns", "Campaigns", "campaign"),
  CONVERSIONS("conversions", "Conversions", "filter_alt"),
  OVERLAYS("overlays", "Overlays", "web_asset"),
  EXPERIMENTS("experiments", "A/B testing", "science");

  val screen: String get() = "marketing.$key"
}

const val CAMPAIGN_MANAGE_ROUTE = "/api/campaigns/manage"

fun siteScopeTokens(hostId: String) = listOf("org", "host:$hostId")

/** `campaignContainerSearchFields`: the name's key and word prefixes (no reversed key). */
fun campaignSearchFields(name: String): Map<String, Any?> = mapOf("name" to name, "nameLower" to nameSearchKey(name), "nameTokens" to nameSearchTokens(name))

fun campaignsQuery(orgId: String, hostId: String, search: String, limit: Int): FirestoreQuery {
  val typed = search.trim()
  return planListQuery(
    Contracts.nativeSiteCampaignsQuery,
    ListQueryRequest(
      base = listOf(ListQueryFilter(ListQueryOp.ARRAY_CONTAINS_ANY, "visibleTo", JsonArray(siteScopeTokens(hostId).map(::JsonPrimitive)))),
      clauses = if (typed.isEmpty()) emptyList() else listOf(ListFilterRequest("name", "startsWith", typed)),
    ),
  ).toFirestoreQuery("orgs/$orgId/emailCampaigns", limit)
}

fun campaignEmailsQuery(orgId: String, hostId: String, campaignId: String, limit: Int): FirestoreQuery = planListQuery(
  Contracts.campaignEmailsQuery,
  ListQueryRequest(
    base = listOf(ListQueryFilter(ListQueryOp.EQUAL, "emailCampaignId", JsonPrimitive(campaignId)), ListQueryFilter(ListQueryOp.EQUAL, "hostId", JsonPrimitive(hostId))),
    clauses = emptyList(),
  ),
).toFirestoreQuery("orgs/$orgId/campaigns", limit)

fun experimentsQuery(hostId: String, search: String, limit: Int): FirestoreQuery =
  planListQuery(Contracts.experimentListQuery, ListQueryRequest(clauses = emptyList(), search = search.trim().ifEmpty { null }?.let { listOf(it) }))
    .toFirestoreQuery("hosts/$hostId/experiments", limit)

fun millisOf(raw: Any?): Long? = when (raw) {
  is Number -> raw.toLong()
  is FirestoreTimestamp -> raw.seconds * 1000 + raw.nanos / 1_000_000
  else -> null
}

/*---------- campaigns ----------*/

enum class CampaignWindow(val label: String) { UNDATED("No dates"), UPCOMING("Upcoming"), RUNNING("Running"), ENDED("Ended") }

/** `campaignWindowState`, the console's rule. */
fun campaignWindowState(startAtMs: Long?, endAtMs: Long?, nowMs: Long): CampaignWindow = when {
  startAtMs == null && endAtMs == null -> CampaignWindow.UNDATED
  startAtMs != null && nowMs < startAtMs -> CampaignWindow.UPCOMING
  endAtMs != null && nowMs > endAtMs -> CampaignWindow.ENDED
  else -> CampaignWindow.RUNNING
}

data class CampaignRow(
  val id: String,
  val name: String,
  val startAtMs: Long?,
  val endAtMs: Long?,
  val listIds: List<String>,
  val topicId: String?,
  val listUnsubscribe: Boolean,
) {
  val window: CampaignWindow get() = campaignWindowState(startAtMs, endAtMs, nowMillis())
}

@Suppress("UNCHECKED_CAST")
fun campaignRowOf(doc: FirestoreDoc) = CampaignRow(
  doc.id, doc.string("name")?.takeIf { it.isNotEmpty() } ?: doc.id, millisOf(doc.data["startAtMs"]), millisOf(doc.data["endAtMs"]),
  (doc.data["listIds"] as? List<String>).orEmpty(), doc.string("topicId"), doc.bool("listUnsubscribe") ?: true,
)

data class CampaignRollup(val emails: Int = 0, val sending: Int = 0, val scheduled: Int = 0, val sent: Long = 0, val opens: Long = 0, val clicks: Long = 0)

/** What each campaign's sends add up to (`campaignRollup`): only sends that went out count. */
@Suppress("UNCHECKED_CAST")
fun campaignRollups(sends: List<FirestoreDoc>): Map<String, CampaignRollup> {
  val out = mutableMapOf<String, CampaignRollup>()
  for (send in sends) {
    val campaign = send.string("emailCampaignId") ?: continue
    var r = out[campaign] ?: CampaignRollup()
    val status = send.string("status")
    val stats = send.data["stats"] as? Map<String, Any?>
    val sent = (stats?.get("sent") as? Number)?.toLong() ?: 0L
    r = r.copy(
      emails = r.emails + 1,
      sending = r.sending + if (status == "sending") 1 else 0,
      scheduled = r.scheduled + if (status == "scheduled") 1 else 0,
    )
    if (sent > 0) {
      r = r.copy(sent = r.sent + sent, opens = r.opens + ((stats?.get("opens") as? Number)?.toLong() ?: 0), clicks = r.clicks + ((stats?.get("clicks") as? Number)?.toLong() ?: 0))
    }
    out[campaign] = r
  }
  return out
}

/*---------- overlays ----------*/

data class OverlayRow(
  val id: String,
  val kind: String,
  val name: String?,
  val enabled: Boolean,
  val order: Long,
  val startAtMs: Long?,
  val endAtMs: Long?,
  val impressions: Long,
  val clicks: Long,
  val data: Map<String, Any?>,
) {
  @Suppress("UNCHECKED_CAST")
  val title: String get() = name?.takeIf { it.isNotEmpty() } ?: if (kind == "bar") {
    ((data["bar"] as? Map<String, Any?>)?.get("text") as? String) ?: "Announcement bar"
  } else {
    ((data["popup"] as? Map<String, Any?>)?.get("headline") as? String) ?: "Popup"
  }
}

@Suppress("UNCHECKED_CAST")
fun overlayRowOf(doc: FirestoreDoc): OverlayRow {
  val stats = doc.data["stats"] as? Map<String, Any?>
  return OverlayRow(
    doc.id, doc.string("kind") ?: "bar", doc.string("name"), doc.bool("enabled") != false, doc.long("order") ?: 0L,
    millisOf(doc.data["startAtMs"]), millisOf(doc.data["endAtMs"]),
    (stats?.get("impressions") as? Number)?.toLong() ?: 0L, (stats?.get("clicks") as? Number)?.toLong() ?: 0L, doc.data,
  )
}

/** `overlayStatus`, the console's rule: off, else live inside its window, else scheduled. */
fun overlayStatus(enabled: Boolean, startAtMs: Long?, endAtMs: Long?, nowMs: Long): String {
  if (!enabled) return "off"
  val before = startAtMs?.let { nowMs < it } ?: false
  val after = endAtMs?.let { nowMs > it } ?: false
  return if (!before && !after) "live" else "scheduled"
}

/*---------- experiments ----------*/

data class VariantRow(val id: String, val name: String?, val weight: Double?)

data class ExperimentRow(
  val id: String,
  val name: String,
  val status: String,
  val target: String,
  val screenId: String?,
  val variants: List<VariantRow>,
  val winnerVariantId: String?,
  val goalEvent: String?,
)

@Suppress("UNCHECKED_CAST")
fun experimentRowOf(doc: FirestoreDoc) = ExperimentRow(
  doc.id, doc.string("name") ?: doc.id, doc.string("status") ?: "draft", doc.string("target") ?: "screen", doc.string("screenId"),
  (doc.data["variants"] as? List<Map<String, Any?>>).orEmpty().mapNotNull { v ->
    val id = v["id"] as? String ?: return@mapNotNull null
    VariantRow(id, v["name"] as? String, (v["weight"] as? Number)?.toDouble())
  },
  doc.string("winnerVariantId"), ((doc.data["goal"] as? Map<String, Any?>)?.get("event")) as? String,
)

fun experimentStatusLabel(status: String) = when (status) {
  "running" -> "Running"
  "paused" -> "Paused"
  "done" -> "Done"
  else -> "Draft"
}

/** `validateExperiment`, the console's rule, over the fields the native editor sets. */
fun validateExperiment(name: String, target: String, screenId: String?, nodeId: String?, variantIds: List<String>, autoWinner: Pair<Double, Double>? = null): String? {
  if (name.isBlank()) return "Name the experiment"
  if (target !in listOf("screen", "section", "email")) return "Pick what the experiment tests"
  if (variantIds.size < 2) return "Add at least two variants"
  if (variantIds.size > 4) return "Experiments are capped at 4 variants"
  if (variantIds.toSet().size != variantIds.size) return "Variant ids must be unique"
  if (target == "section" && nodeId.isNullOrBlank()) return "Section experiments need the canvas element id"
  if ((target == "screen" || target == "section") && screenId.isNullOrBlank()) return "Pick the page under test"
  if (autoWinner != null) {
    val (minExposures, confidence) = autoWinner
    if (!minExposures.isFinite() || minExposures < 1) return "Auto-winner needs a minimum exposure count of at least 1"
    if (!confidence.isFinite() || confidence <= 0.5 || confidence >= 1) return "Auto-winner confidence must be between 0.5 and 1"
  }
  return null
}

data class VariantSummary(val exposures: Double, val conversions: Double, val rate: Double)
data class VariantComparison(val lift: Double?, val confidence: Double?)
data class ExperimentResult(val variant: VariantRow, val summary: VariantSummary, val comparison: VariantComparison?, val leader: Boolean, val winner: Boolean)

fun summarizeVariantStats(stats: Map<String, Any?>?): VariantSummary {
  val exposures = max(0.0, (stats?.get("exposures") as? Number)?.toDouble() ?: 0.0)
  val conversions = max(0.0, (stats?.get("conversions") as? Number)?.toDouble() ?: 0.0)
  return VariantSummary(exposures, conversions, if (exposures > 0) conversions / exposures else 0.0)
}

private fun erf(x: Double): Double {
  val sign = if (x < 0) -1.0 else 1.0
  val t = 1 / (1 + 0.3275911 * abs(x))
  val y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x)
  return sign * y
}

fun compareVariants(control: Map<String, Any?>?, challenger: Map<String, Any?>?): VariantComparison {
  val a = summarizeVariantStats(control)
  val b = summarizeVariantStats(challenger)
  val lift = if (a.rate > 0) (b.rate - a.rate) / a.rate else null
  if (a.exposures < 1 || b.exposures < 1 || a.conversions + b.conversions < 1) return VariantComparison(lift, null)
  val pooled = (a.conversions + b.conversions) / (a.exposures + b.exposures)
  val standardError = sqrt(pooled * (1 - pooled) * (1 / a.exposures + 1 / b.exposures))
  if (!standardError.isFinite() || standardError == 0.0) return VariantComparison(lift, null)
  val z = (b.rate - a.rate) / standardError
  return VariantComparison(lift, 0.5 * (1 + erf(z / sqrt(2.0))))
}

/** `experimentResultRows`: each variant's figures, its comparison with the control, and whether it leads or won. */
fun experimentResultRows(variants: List<VariantRow>, winnerVariantId: String?, stats: Map<String, Map<String, Any?>>): List<ExperimentResult> {
  val summaries = variants.map { summarizeVariantStats(stats[it.id]) }
  val control = variants.firstOrNull()
  return variants.mapIndexed { index, variant ->
    val summary = summaries[index]
    ExperimentResult(
      variant, summary,
      if (index > 0 && control != null) compareVariants(stats[control.id], stats[variant.id]) else null,
      summary.exposures > 0 && summaries.all { summary.rate >= it.rate },
      winnerVariantId == variant.id,
    )
  }
}

/** `Number.prototype.toFixed(0)`: half away from zero. */
fun jsFixed0(value: Double): String {
  val rounded = floor(abs(value) + 0.5) * (if (value < 0) -1 else 1)
  return if (rounded == 0.0) "0" else rounded.toLong().toString()
}

/** `describeVariantComparison`: `+12% · 97% conf.`, `—`, `needs data`, `control`. */
fun describeVariantComparison(comparison: VariantComparison?): String {
  if (comparison == null) return "control"
  val lift = comparison.lift?.let { "${if (it >= 0) "+" else ""}${jsFixed0(it * 100)}%" } ?: "—"
  val confidence = comparison.confidence?.let { " · ${jsFixed0(it * 100)}% conf." } ?: " · needs data"
  return "$lift$confidence"
}

/*---------- writes ----------*/

/** The Marketing writes, as the console makes them. */
class MarketingActions(val context: NativePluginContext, val orgId: String, val hostId: String) {
  private suspend fun siteWide() = publishSiteWideChange(context.api, context.writer, hostId)

  suspend fun createCampaign(name: String, startAtMs: Long?, endAtMs: Long?, listIds: List<String>, topicId: String) {
    val fields = campaignSearchFields(name) + buildMap {
      startAtMs?.let { put("startAtMs", it) }
      endAtMs?.let { put("endAtMs", it) }
      put("listIds", listIds)
      if (topicId.isNotEmpty()) put("topicId", topicId)
      put("visibleTo", listOf("host:$hostId"))
      put("createdAtMs", nowMillis())
      put("createdBy", context.uid)
    }
    context.writer.merge("orgs/$orgId/emailCampaigns/${newResourceId()}", fields)
  }

  suspend fun updateCampaign(id: String, name: String, startAtMs: Long?, endAtMs: Long?, listIds: List<String>, topicId: String, listUnsubscribe: Boolean) {
    context.writer.merge(
      "orgs/$orgId/emailCampaigns/$id",
      campaignSearchFields(name) + mapOf(
        "startAtMs" to startAtMs, "endAtMs" to endAtMs, "listIds" to listIds,
        "topicId" to (topicId.ifEmpty { null } ?: FirestoreDelete), "listUnsubscribe" to listUnsubscribe,
      ),
    )
  }

  suspend fun deleteCampaign(id: String) {
    context.api.request(CAMPAIGN_MANAGE_ROUTE, ApiMethod.POST, firestoreJson(mapOf("action" to "deleteCampaign", "campaignId" to id, "hostId" to hostId)))
  }

  /** A save replaces the overlay whole, as the console's `set` does. */
  suspend fun saveOverlay(existing: OverlayRow?, fields: Map<String, Any?>) {
    val next = fields + ("updatedAt" to firestoreNow()) + if (existing == null) mapOf("createdAt" to firestoreNow()) else emptyMap()
    context.writer.merge("hosts/$hostId/overlays/${existing?.id ?: newResourceId()}", replacementMerge(existing?.data, next))
    siteWide()
  }

  suspend fun toggleOverlay(row: OverlayRow) {
    context.writer.merge("hosts/$hostId/overlays/${row.id}", mapOf("enabled" to !row.enabled))
    siteWide()
  }

  suspend fun swapOverlays(a: OverlayRow, b: OverlayRow) {
    context.writer.merge("hosts/$hostId/overlays/${a.id}", mapOf("order" to b.order))
    context.writer.merge("hosts/$hostId/overlays/${b.id}", mapOf("order" to a.order))
    siteWide()
  }

  suspend fun deleteOverlay(id: String) {
    context.writer.delete("hosts/$hostId/overlays/$id")
    siteWide()
  }

  suspend fun saveExperiment(id: String?, fields: Map<String, Any?>) {
    val all = fields + nameSearchFields(fields["name"] as? String ?: "") + ("updatedAt" to firestoreNow()) +
      if (id == null) mapOf("createdAt" to firestoreNow()) else emptyMap()
    context.writer.merge("hosts/$hostId/experiments/${id ?: newResourceId()}", all)
    siteWide()
  }

  /** Starting refuses when another experiment already runs on the same page, as the console checks. */
  suspend fun setExperimentStatus(row: ExperimentRow, status: String, winner: String? = null) {
    if (status == "running" && row.target != "email" && row.screenId != null) {
      val others = context.firestore.page(
        FirestoreQuery("hosts/$hostId/experiments", listOf(FirestoreFilter("status", FilterOp.EQ, "running"), FirestoreFilter("screenId", FilterOp.EQ, row.screenId)), limit = 2),
      ).docs
      if (others.any { it.id != row.id }) throw ConsoleApiError("Another experiment is already running on this page. Pause it first.", 409, null)
    }
    context.writer.merge("hosts/$hostId/experiments/${row.id}", buildMap {
      put("status", status)
      put("updatedAt", firestoreNow())
      winner?.let { put("winnerVariantId", it) }
    })
    siteWide()
  }

  suspend fun deleteExperiment(id: String) {
    context.writer.delete("hosts/$hostId/experiments/$id")
    siteWide()
  }
}
