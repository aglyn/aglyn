package com.aglyn.shell

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.core.KeyValueStore
import com.aglyn.core.numberField
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.LocalAglynPalette

/** The console's usage notice (`billing.usage`, written by the usage-alerts cron from the console's own counts). */
internal const val PLAN_USAGE_TYPE = "billing.usage"

/** How long a usage notice keeps its card: a crossing a month old is the past. */
private const val PLAN_CARD_DAYS = 30L

internal fun planCardDismissedKey(uid: String, notificationId: String) = "aglyn.planCard.dismissed.$uid.$notificationId"

/**
 * The plan card at the sidebar's foot: shown only while a limit is close (or reached), as the console's usage notice for
 * the workspace on screen says, and gone once dismissed on this device.
 */
internal fun planNoticeFor(feed: List<FeedNotification>, orgId: String?, uid: String, prefs: KeyValueStore, nowMs: Long): FeedNotification? {
  if (orgId == null) return null
  return feed.firstOrNull { it.type == PLAN_USAGE_TYPE && it.orgId == orgId }
    ?.takeIf { notice -> notice.createdAt?.let { nowMs - it.seconds * 1000 <= PLAN_CARD_DAYS * 86_400_000 } ?: false }
    ?.takeIf { prefs.get(planCardDismissedKey(uid, it.id)) == null }
}

/** The plan card's readings for one workspace (AGL-3992): its plan's name, and every meter the card can rotate through. */
internal data class PlanReadings(val plan: String, val readings: List<com.aglyn.contracts.PlanCardReading>)

/** The hide on this device: this workspace on this plan (a new plan shows the card again). */
internal fun planCardHiddenKey(orgId: String, plan: String) = "aglyn.planCard.hidden.$orgId.$plan"

/** "2026-10" for the month [monthsBack] before now, in UTC, as the console keys its monthly counters. */
internal fun utcMonthKey(nowMs: Long, monthsBack: Int = 0): String {
  // Days since 1970-01-01 to a civil date (Howard Hinnant's days_from_civil, inverted).
  val z = nowMs.floorDiv(86_400_000L) + 719_468
  val era = z.floorDiv(146_097L)
  val doe = z - era * 146_097
  val yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
  val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
  val mp = (5 * doy + 2) / 153
  var month = (if (mp < 10) mp + 3 else mp - 9).toInt()
  var year = (yoe + era * 400 + if (month <= 2) 1 else 0).toInt()
  month -= monthsBack
  while (month < 1) { month += 12; year -= 1 }
  return "$year-${month.toString().padStart(2, '0')}"
}

/**
 * Every meter the plan card can rotate through, read from the console's own sources against `/api/orgs/entitlements`
 * quotas (null = unlimited), as the Usage page reads them (plan-card-meters.ts names each source). A read that fails is a
 * null `used`, so the meter is left out rather than shown low; Pages and Saved forms are a site's, read only in a site.
 */
internal suspend fun loadPlanReadings(services: ShellServices, orgId: String, hostId: String?, siteIds: List<String>): PlanReadings? {
  services.entitlements.load(orgId)
  val ent = services.entitlements.state(orgId).value ?: return null
  val plan = ent.plan?.let { com.aglyn.core.OnboardingPlanIntent.PLAN_LABELS[it] ?: it.replaceFirstChar { c -> c.uppercase() } } ?: "Free"
  fun quota(key: String) = ent.limit(key)?.toDouble()
  suspend fun api(path: String, query: Map<String, Any?>) = runCatching { services.api.request(path, query = query) }.getOrNull()
  val now = com.aglyn.core.nowMillis()
  val month = utcMonthKey(now)
  val out = mutableListOf<com.aglyn.contracts.PlanCardReading>()
  fun add(meter: String, used: Double?, limit: Double?) { out += com.aglyn.contracts.PlanCardReading(meter, used, limit) }

  // Storage: the media library's band (its own allowance; null = unlimited), in MB to one decimal, as the Usage page.
  api("/api/media/storage", mapOf("orgId" to orgId)).let { body ->
    val bytes = body.numberField("usedBytes")
    add("storage", bytes?.let { kotlin.math.round(it / (1024.0 * 1024.0) * 10) / 10.0 }, body.numberField("allowanceMb"))
  }
  // Bandwidth: every site's month plus the org library's, summed (a missing site would understate it, so none is shown).
  run {
    val scopes = siteIds.map { "hostId" to it } + ("orgId" to orgId)
    val each = scopes.map { (key, id) -> api("/api/billing/host-usage", mapOf(key to id)).numberField("bandwidthGb") }
    val used = if (siteIds.isEmpty() || each.any { it == null }) null else kotlin.math.round(each.sumOf { it!! } * 100) / 100.0
    add("bandwidth", used, quota("bandwidthGb"))
  }
  // Campaign emails this month, shown only once the plan carries any.
  quota("emailSendsPerMonth")?.takeIf { it > 0 }?.let { limit ->
    val counter = runCatching { services.firestore.get("orgs/$orgId/counters/campaignEmailSends") }
    val used = counter.getOrNull()?.let { (it.data[month] as? Number)?.toDouble() ?: 0.0 } ?: if (counter.isSuccess) 0.0 else null
    add("emailSends", used, limit)
  }
  // AI credits this month: the credits door's own used and limit (null = not capped).
  api("/api/ai/billing/credits", mapOf("orgId" to orgId)).let { body ->
    val credits = (body as? kotlinx.serialization.json.JsonObject)?.get("credits")
    add("aiCredits", credits.numberField("used"), credits.numberField("limit"))
  }
  // Data storage: this month's rollup, else last month's.
  run {
    var mb: Double? = null
    for (key in listOf(month, utcMonthKey(now, 1))) {
      if (mb != null) break
      mb = runCatching { services.firestore.get("orgs/$orgId/usage/$key") }.getOrNull()?.data?.get("dataStorageMb")?.let { (it as? Number)?.toDouble() }
    }
    add("dataStorage", mb, quota("dataStorageMbPerOrg"))
  }
  // Team seats (incl. you).
  add("seats", api("/api/orgs/members", mapOf("orgId" to orgId, "counts" to "1")).numberField("managerSeats"), quota("managersPerOrg"))
  if (hostId != null) {
    add("pages", api("/api/hosts/usage", mapOf("hostId" to hostId)).numberField("screens"), quota("screensPerHost"))
    add("forms", runCatching { services.firestore.count(com.aglyn.core.FirestoreQuery("hosts/$hostId/forms")) }.getOrNull()?.toDouble(), quota("formsPerHost"))
  }
  add("sites", siteIds.size.toDouble(), quota("hostLimit"))
  return PlanReadings(plan, out)
}

/** A meter's figures as the Usage page writes them: "84 / 100", "1.2 / 5 GB". */
internal fun planMeterFigures(meter: String, used: Double, limit: Double): String {
  fun n(v: Double) = if (v == kotlin.math.floor(v)) v.toLong().toString() else (kotlin.math.round(v * 100) / 100.0).toString()
  val unit = com.aglyn.contracts.Contracts.planCardMeterUnits[meter].orEmpty()
  return "${n(used)} / ${n(limit)}" + if (unit.isEmpty()) "" else " $unit"
}
