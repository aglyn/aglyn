package com.aglyn.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.site.analytics.PageTrafficCard
import com.aglyn.site.analytics.SitePagesTrafficCard
import com.aglyn.site.analytics.SiteTrafficCard
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.EmptyState
import com.aglyn.ui.ListHeader
import com.aglyn.ui.SelectionPlaceholder
import com.aglyn.ui.TextButton
import com.aglyn.ui.paneInset
import com.aglyn.ui.space

/*
 * A SITE'S ANALYTICS, as the console's Analytics page shows them, as a list of sections beside the one picked
 * (AGL-4011): Traffic, Pages (Pro; a row opens that page's traffic), Funnels when the plugin is on, and At a glance. The
 * cards are the site module's (site/analytics/SiteAnalytics.kt); this screen only lays them out. The Apple app's
 * AnalyticsView.swift is the same screen.
 */

/** The core page's widget slot, as the console's `PluginWidgetSlot`: a whole section a plugin computes (funnels). */
const val HOST_ANALYTICS_SLOT = "hostAnalytics"

private const val FUNNELS_SCREEN = "funnels.list"

/** One section of the Analytics list. */
internal enum class AnalyticsSection(val id: String, val title: String, val supporting: String, val icon: String) {
  TRAFFIC("traffic", "Traffic", "Page views, visitors and where they came from", "bar_chart"),
  PAGES("pages", "Pages", "Each page’s views, side by side", "description"),
  FUNNELS("funnels", "Funnels", "Where visitors drop off", "filter_alt"),
  GLANCE("glance", "At a glance", "Sales, leads and tasks", "dashboard"),
}

@Composable
internal fun AnalyticsScreen(services: ShellServices, context: NativePluginContext) {
  val hostId = context.hostId ?: return EmptyState("Pick a site first", body = "Analytics are one site's.", icon = AglynIcons.named("public"))
  val version by services.registry.version.collectAsState()
  val funnelWidgets = remember(version) { services.registry.widgets(NativeApp.AGLYN, HOST_ANALYTICS_SLOT) }
  val glance = remember(version) { services.registry.widgets(NativeApp.AGLYN, null) }
  val sections = AnalyticsSection.entries.filter {
    when (it) {
      AnalyticsSection.FUNNELS -> funnelWidgets.isNotEmpty() || services.registry.screen(FUNNELS_SCREEN) != null
      AnalyticsSection.GLANCE -> glance.isNotEmpty()
      else -> true
    }
  }
  var drill by remember(hostId) { mutableStateOf<Pair<String, String>?>(null) }
  val upgrade = { context.navigate("core.billing.plans") }
  AglynListDetail(
    modifier = Modifier.testTag("analytics"),
    initialSelected = AnalyticsSection.TRAFFIC.id,
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ListHeader("Analytics")
        sections.forEach { section ->
          AglynListItem(
            title = section.title,
            supporting = section.supporting,
            icon = AglynIcons.named(section.icon),
            selected = section.id == selected,
            onClick = {
              drill = null
              onSelect(section.id)
            },
            modifier = Modifier.testTag("analytics-section-${section.id}"),
          )
        }
      }
    },
    detail = { selected ->
      val section = sections.firstOrNull { it.id == selected }
      if (section == null) {
        SelectionPlaceholder("Pick a section", icon = AglynIcons.named("bar_chart"))
      } else {
        Column(
          Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = paneInset(), vertical = space(3f))
            .testTag("analytics-detail-${section.id}"),
          verticalArrangement = Arrangement.spacedBy(space(3f)),
        ) {
          when (section) {
            AnalyticsSection.TRAFFIC -> SiteTrafficCard(services.firestore, hostId, detail = true)
            AnalyticsSection.PAGES -> {
              val open = drill
              if (open != null) {
                TextButton(onClick = { drill = null }, modifier = Modifier.testTag("analytics-page-back")) { Text("‹ Pages") }
                Text(open.second, style = MaterialTheme.typography.headlineSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                PageTrafficCard(services.firestore, services.api, hostId, open.first, upgrade)
              } else {
                SitePagesTrafficCard(services.firestore, services.api, hostId, upgrade, open = { id, path -> drill = id to path })
              }
            }
            AnalyticsSection.FUNNELS -> if (funnelWidgets.isNotEmpty()) {
              funnelWidgets.forEach { widget -> Box(Modifier.fillMaxWidth().testTag("widget-${widget.id}")) { widget.content(context) } }
            } else {
              services.registry.screen(FUNNELS_SCREEN)?.content?.invoke(context, emptyMap())
            }
            AnalyticsSection.GLANCE -> HomeGlanceGrid(services, context, title = null)
          }
        }
      }
    },
  )
}
