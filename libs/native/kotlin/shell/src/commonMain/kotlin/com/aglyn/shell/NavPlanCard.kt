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

/** The console's meter warns from 80% (`USAGE_METER_WARNING_PCT`). */
internal const val PLAN_WARNING_SHARE = 0.8

/** One of the console's usage meters that is close to its limit: its own label ("Pages"), the count, the limit, the plan. */
internal data class PlanNear(val label: String, val used: Long, val limit: Long, val plan: String) {
  val share: Double get() = used.toDouble() / limit
}

/** The dismissal's key: this workspace, this meter, at this limit (a new limit shows the card again). */
internal fun planNearDismissedKey(orgId: String, near: PlanNear) = "aglyn.planCard.$orgId.${near.label}.${near.limit}"

/**
 * The meter closest to its limit where the window stands, from the console's own figures, as its Usage page draws them
 * (the twin of Apple's PlanLimits): the site's pages, then the workspace's sites, team seats and datasets, against
 * `/api/orgs/entitlements`. Null when none is at 80% or more. An unlimited quota (a very large number) or a zero (a feature
 * the plan lacks) is not a meter.
 */
internal suspend fun loadPlanNear(services: ShellServices, orgId: String, hostId: String?, sites: Int): PlanNear? {
  services.entitlements.load(orgId)
  val ent = services.entitlements.state(orgId).value ?: return null
  val plan = ent.plan?.let { com.aglyn.core.OnboardingPlanIntent.PLAN_LABELS[it] ?: it.replaceFirstChar { c -> c.uppercase() } } ?: "Free"
  val meters = mutableListOf<PlanNear>()
  if (hostId != null) {
    val limit = ent.limit("screensPerHost")
    val used = runCatching { services.api.request("/api/hosts/usage", query = mapOf("hostId" to hostId)) }.getOrNull().numberField("screens")
    if (limit != null && used != null) meters += PlanNear("Pages", used.toLong(), limit, plan)
  }
  ent.limit("hostLimit")?.let { meters += PlanNear("Sites", sites.toLong(), it, plan) }
  ent.limit("managersPerOrg")?.let { limit ->
    runCatching { services.api.request("/api/orgs/members", query = mapOf("orgId" to orgId, "counts" to "1")) }.getOrNull().numberField("managerSeats")
      ?.let { meters += PlanNear("Team seats (incl. you)", it.toLong(), limit, plan) }
  }
  ent.limit("datasetsPerOrg")?.let { limit ->
    runCatching { services.firestore.count(com.aglyn.core.FirestoreQuery("orgs/$orgId/datasets")) }.getOrNull()
      ?.let { meters += PlanNear("Datasets", it, limit, plan) }
  }
  return meters.filter { it.limit in 1 until 100_000 && it.share >= PLAN_WARNING_SHARE }.maxByOrNull { it.share }
}
