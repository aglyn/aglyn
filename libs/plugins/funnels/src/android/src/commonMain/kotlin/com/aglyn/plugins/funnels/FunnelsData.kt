package com.aglyn.plugins.funnels

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.FunnelDefinition
import com.aglyn.contracts.FunnelStep
import com.aglyn.contracts.FunnelStepInput
import com.aglyn.contracts.normalizeFunnelDefinition
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.decode
import com.aglyn.core.planFeatureCarried
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.isoDayOf

/** The ranges the card offers, in days. */
val FUNNEL_RANGES = listOf(7, 14, 30, 90)

private const val DAY_MS = 86_400_000L

/** The last [days] UTC days, ending today, as the results door reads a range. */
fun recentRange(days: Int, nowMs: Long): Pair<String, String> =
  isoDayOf(nowMs - (days - 1) * DAY_MS) to isoDayOf(nowMs)

/** A funnel as the console stores it, with its id; a draft is one an AI build made for review. */
data class FunnelRow(val id: String, val definition: FunnelDefinition, val draft: Boolean, val version: String = "") {
  val name: String get() = definition.name
  val steps: List<FunnelStep> get() = definition.steps

  companion object {
    /** Null for a document that is not a valid funnel, as the card drops it. */
    fun from(doc: FirestoreDoc): FunnelRow? {
      val definition = doc.decode(FunnelDefinition.serializer()) ?: return null
      val inputs = definition.steps.map { FunnelStepInput(it.type.raw, it.key, it.match?.raw, it.label) }
      if (normalizeFunnelDefinition(definition.name, inputs).funnel == null) return null
      return FunnelRow(doc.id, definition, doc.data["status"] == "draft", doc.data["updatedAt"]?.toString().orEmpty())
    }
  }
}

/** By name, as the card lists them. */
fun inListOrder(rows: List<FunnelRow>): List<FunnelRow> = rows.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })

/** What the signed-in person may do here: the paid analytics tier gates everything, the role gates changes. */
data class FunnelsAccess(val canManage: Boolean, val entitled: Boolean, val ready: Boolean)

fun funnelsAccess(role: Any?, org: Map<String, Any?>?, orgReady: Boolean): FunnelsAccess =
  FunnelsAccess(
    canManage = role == "admin" || role == "editor",
    entitled = orgReady && planFeatureCarried(org, Contracts.funnelFeature),
    ready = orgReady,
  )

@Composable
fun rememberFunnelsAccess(context: NativePluginContext): FunnelsAccess {
  val hostId = context.hostId
  val orgId = context.orgId
  val host = remember(hostId) { context.firestore.observeDoc("hosts/$hostId") }.collectAsState(Live.Loading).value
  val org = remember(orgId) { context.firestore.observeDoc("orgs/$orgId") }.collectAsState(Live.Loading).value
  @Suppress("UNCHECKED_CAST")
  val role = ((host as? Live.Ready)?.value?.data?.get("memberRoles") as? Map<String, Any?>)?.get(context.uid) ?: context.siteRole
  return funnelsAccess(role, (org as? Live.Ready)?.value?.data, org is Live.Ready)
}

/** A site's funnels, live: `hosts/{hostId}/funnels`, the collection the Funnels card reads. */
@Composable
fun hostFunnels(context: NativePluginContext, enabled: Boolean): Live<List<FunnelRow>> {
  val hostId = context.hostId ?: return Live.Loading
  if (!enabled) return Live.Loading
  val flow = remember(hostId, context.firestore) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/funnels", limit = Contracts.funnelsMaxPerSite.toInt()))
  }
  val live by flow.collectAsState(Live.Loading)
  return when (val value = live) {
    is Live.Ready -> Live.Ready(inListOrder(value.value.mapNotNull(FunnelRow::from)))
    is Live.Failed -> value
    Live.Loading -> Live.Loading
  }
}
