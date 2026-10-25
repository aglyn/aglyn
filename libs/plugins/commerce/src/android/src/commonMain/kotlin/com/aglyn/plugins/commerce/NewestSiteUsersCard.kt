package com.aglyn.plugins.commerce

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import com.aglyn.contracts.formatLocalDay
import com.aglyn.contracts.resolveHostEnabledPlugins
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.StatsCard
import com.aglyn.ui.space

/**
 * The console's "Newest site users" card on a site's dashboard (newest-site-users-card.component.tsx, AGL-4011): the five
 * newest visitor accounts (`hosts/{id}/siteMembers`, newest first), each its name or address and the day it joined; View
 * all opens the site's users. Drawn only while the site has visitor accounts on (the `accounts` switch the console
 * registers the card under). The Apple twin is NewestSiteUsersCard.swift.
 */
@Composable
fun NewestSiteUsersCard(context: NativePluginContext) {
  val orgId = context.orgId ?: return
  val hostId = context.hostId ?: return
  val org by remember(orgId) { context.firestore.observeDoc("orgs/$orgId") }.collectAsState(Live.Loading)
  val host by remember(hostId) { context.firestore.observeDoc("hosts/$hostId") }.collectAsState(Live.Loading)
  val orgData = (org as? Live.Ready)?.value?.data ?: return
  val hostData = (host as? Live.Ready)?.value?.data ?: return
  fun ids(data: Map<String, Any?>, key: String) = (data[key] as? List<*>)?.filterIsInstance<String>()
  if ("accounts" !in resolveHostEnabledPlugins(ids(orgData, "enabledPlugins"), ids(hostData, "disabledPlugins"), ids(hostData, "enabledPlugins"))) return
  val members by remember(hostId) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/siteMembers", orderBy = listOf(FirestoreOrder("createdAt", descending = true)), limit = 5))
  }.collectAsState(Live.Loading)
  StatsCard(Modifier.testTag("newest-site-users")) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text("Newest site users", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
      TextButton(onClick = { context.navigate("core.site.users") }, modifier = Modifier.testTag("newest-site-users-all")) { Text("View all") }
    }
    val rows = (members as? Live.Ready)?.value
    if (rows != null && rows.isEmpty()) {
      Text(
        "No site accounts yet — they appear when visitors sign up on your site.",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    } else {
      Column(verticalArrangement = Arrangement.spacedBy(space(0.75f))) {
        rows.orEmpty().forEach { member ->
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            Text(
              member.string("displayName") ?: member.string("name") ?: member.string("email") ?: member.id,
              Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium,
            )
            (member.data["createdAt"] as? FirestoreTimestamp)?.let {
              Text(formatLocalDay(it.epochMillis, "M/d/yyyy"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }
        }
      }
    }
  }
}
