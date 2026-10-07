package com.aglyn.plugins.redirects

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.core.Live
import com.aglyn.pluginhost.ConsoleScope
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.EmptyState
import com.aglyn.ui.MetricCard
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space

private fun matchLabel(kind: String?) = "${kind ?: "exact"} match"

/**
 * The site's redirect rules. Read-only here; the rule beside the list on
 * wide windows. Editing opens the console's own Redirects page, which owns
 * the validation and the publish role a rule needs.
 */
@Composable
fun RedirectsListScreen(context: NativePluginContext) {
  val live = hostRedirects(context)
  AglynListDetail(
    list = { selected, onSelect ->
      when (live) {
        Live.Loading -> SkeletonList(rows = 4)
        is Live.Failed -> EmptyState(
          "Could not load this site's redirects",
          body = "Check the connection and try again.",
          icon = AglynIcons.named("error"),
        )
        is Live.Ready -> LazyColumn(Modifier.fillMaxSize().testTag("redirects-list")) {
          if (live.value.isEmpty()) {
            item {
              EmptyState("No redirects yet", body = "Rules you add in the console show up here.", icon = AglynIcons.named("alt_route"))
            }
          }
          items(live.value, key = { it.id }) { row ->
            AglynListItem(
              title = row.source,
              supporting = "${row.statusCode} → ${row.destination}",
              icon = AglynIcons.named(if (row.enabled) "alt_route" else "pause_circle"),
              selected = row.id == selected,
              trailing = { if (!row.enabled) StatusChip("Off") },
              onClick = { onSelect(row.id) },
              modifier = Modifier.testTag("redirect-${row.id}"),
            )
          }
          item {
            Column(Modifier.padding(space(2f))) {
              OutlinedButton(onClick = { context.openConsolePath("/redirects", ConsoleScope.SITE) }, Modifier.fillMaxWidth()) {
                Text("Manage in the console")
              }
            }
          }
        }
      }
    },
    detail = { selected ->
      val row = (live as? Live.Ready)?.value?.firstOrNull { it.id == selected }
      if (row == null) {
        EmptyState("Pick a redirect to see it here", icon = AglynIcons.named("alt_route"))
      } else {
        RedirectDetail(row)
      }
    },
  )
}

@Composable
private fun RedirectDetail(row: RedirectRow) {
  Column(Modifier.fillMaxSize().padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(2f))) {
    SectionCard(null, Modifier.fillMaxWidth().testTag("redirect-detail")) {
      Text(row.source, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
      HorizontalDivider()
      Text("Sends visitors to", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Text(row.destination, style = MaterialTheme.typography.bodyLarge)
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        StatusChip(row.statusCode.toString(), StatusTone.INFO)
        StatusChip(matchLabel(row.kind))
        StatusChip(if (row.enabled) "On" else "Off", if (row.enabled) StatusTone.SUCCESS else StatusTone.NEUTRAL)
      }
    }
  }
}

/**
 * The Redirects card on the dashboard: how many rules the site serves and
 * how many are switched off. The whole card opens the Redirects screen.
 */
@Composable
fun RedirectsSummaryWidget(context: NativePluginContext) {
  val live = hostRedirects(context)
  val rows = (live as? Live.Ready)?.value
  val off = rows?.count { !it.enabled } ?: 0
  val on = rows?.let { it.size - off }
  MetricCard(
    title = "Redirects",
    value = on?.toString(),
    caption = on?.let { (if (it == 1) "redirect is on" else "redirects are on") + if (off > 0) " · $off off" else "" },
    icon = "alt_route",
    actionLabel = "Open redirects",
    modifier = Modifier.fillMaxSize().testTag("redirects-summary"),
    loading = live is Live.Loading,
    error = if (live is Live.Failed) "Could not load redirects." else null,
    onClick = { context.navigate(REDIRECTS_LIST_SCREEN) },
  )
}
