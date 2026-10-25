package com.aglyn.plugins.marketing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import com.aglyn.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.StatFigure
import com.aglyn.ui.StatsCard
import com.aglyn.ui.space

/** How many sends the card searches for the last SENT one (`SEARCH_CEILING`). */
private const val SEARCH_CEILING = 30

/**
 * The console's "Last campaign" card on a site's dashboard (campaign-glance-card.component.tsx, AGL-4011): the site's
 * most recent sent campaign, its subject, and sent, opens and clicks; Campaigns opens the history. It reads the newest
 * thirty of the workspace's sends that this site sent (`orgs/{orgId}/campaigns`, `visibleTo` the site's token) and draws
 * nothing when none has been sent, as the console's card does. The Apple twin is LastCampaignCard.swift.
 */
@Composable
fun LastCampaignCard(context: NativePluginContext) {
  val orgId = context.orgId ?: return
  val hostId = context.hostId ?: return
  val sends by remember(orgId, hostId) {
    context.firestore.observe(
      FirestoreQuery(
        "orgs/$orgId/campaigns",
        filters = listOf(FirestoreFilter("visibleTo", FilterOp.ARRAY_CONTAINS_ANY, listOf("host:$hostId"))),
        limit = SEARCH_CEILING,
      ),
    )
  }.collectAsState(Live.Loading)
  val last = (sends as? Live.Ready)?.value
    ?.filter { it.string("status") == "sent" }
    ?.maxByOrNull { (it.data["sentAt"] as? FirestoreTimestamp)?.epochMillis ?: 0L }
    ?: return
  val stats = last.data["stats"] as? Map<*, *>
  fun figure(key: String) = ((stats?.get(key) as? Number)?.toLong() ?: 0L).toString()
  StatsCard(Modifier.testTag("last-campaign")) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text("Last campaign", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
      TextButton(onClick = { context.navigate(MarketingSection.CAMPAIGNS.screen) }, modifier = Modifier.testTag("last-campaign-open")) { Text("Campaigns") }
    }
    Text(last.string("subject").orEmpty(), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    Row(horizontalArrangement = Arrangement.spacedBy(space(3f))) {
      StatFigure(figure("sent"), "Sent")
      StatFigure(figure("opens"), "Opens")
      StatFigure(figure("clicks"), "Clicks")
    }
  }
}
