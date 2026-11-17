package com.aglyn.site.analytics

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreReader
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatFigure
import com.aglyn.ui.StatFigures
import com.aglyn.ui.StatsSection
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TrendBar
import com.aglyn.ui.TrendBars
import com.aglyn.ui.UpgradeNotice
import com.aglyn.ui.space

/*
 * One content entry's traffic (the console's `EntryAnalyticsCard`,
 * AGL-2498): the entry's public path counted in the site's day documents
 * (`hosts/{id}/analytics/{day}.paths`), never the template screen's numbers,
 * which are the whole collection's. Devices and referrers are counted for the
 * site, not per path, so the card shows neither. The Apple kit's
 * EntryTraffic.swift.
 */

private const val ENTRY_TRAFFIC_DAYS = 14
private val PATH_KEY_FOLD = Regex("""[.$#\[\]]""")

/**
 * The key a path is counted under in a day document's `paths` (`analyticsPathKey`): `.`, `$`, `#`, `[` and `]` folded
 * to `_`, capped at 200 characters, an empty path counted as `/`.
 */
fun analyticsPathKey(path: String): String = path.ifEmpty { "/" }.take(200).replace(PATH_KEY_FOLD, "_")

/** The card's figures over the days given (oldest first). */
data class EntryTrafficSummary(val counts: List<Pair<String, Double>>, val total: Double, val best: Pair<String, Double>?) {
  companion object {
    fun of(days: List<TrafficDay>, path: String): EntryTrafficSummary {
      val key = analyticsPathKey(path)
      val counts = days.map { it.day to (it.paths[key] ?: 0.0) }
      // The busiest day, the first of equals as the console's reduce keeps it.
      var top: Pair<String, Double>? = null
      for (entry in counts) if (top == null || entry.second > top.second) top = entry
      return EntryTrafficSummary(counts, counts.sumOf { it.second }, top?.takeIf { it.second > 0 })
    }
  }
}

/** "Entry traffic (14 days)": page views, the best day, the path it is counted against, a bar per day. */
@Composable
fun EntryTrafficCard(
  firestore: FirestoreReader,
  api: ConsoleApiClient,
  hostId: String,
  path: String?,
  upgrade: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val (entitled, failed) = rememberScreenAnalyticsEntitlement(api, hostId, 0)
  StatsSection(if (entitled == true) "Entry traffic (14 days)" else "Entry traffic", modifier.testTag("entry-traffic")) {
    when (entitled) {
      null -> if (failed) {
        NoticeBanner("Your plan could not be checked. Check the connection and try again.", StatusTone.ERROR)
      } else {
        Text("Checking your plan…", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      false -> UpgradeNotice(
        "Per-page traffic — how many people read this entry, day by day — is a Pro feature. Data is already being collected, so history is waiting the moment you upgrade.",
        action = upgrade,
      )
      true -> if (path == null) {
        Text(
          "This entry has no public address yet — save it to give it one, and views will be counted from the moment it is published.",
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      } else {
        val now = remember(hostId) { nowMillis() }
        // trafficQuery reads both windows of a range, so half the days is this card's fourteen.
        val docs by remember(hostId) { firestore.observe(trafficQuery(hostId, ENTRY_TRAFFIC_DAYS / 2, now)) }.collectAsState(Live.Loading)
        when (val live = docs) {
          Live.Loading -> SkeletonList(rows = 2)
          is Live.Failed -> NoticeBanner("Traffic could not be loaded. Check the connection and try again.", StatusTone.ERROR)
          is Live.Ready -> {
            val summary = EntryTrafficSummary.of(trafficDays(live.value, now, ENTRY_TRAFFIC_DAYS / 2), path)
            StatFigures {
              StatFigure(analyticsCount(summary.total), "Page views", Modifier.widthIn(min = space(14f)))
              StatFigure(
                summary.best?.let { analyticsCount(it.second) } ?: "—",
                summary.best?.let { "Best day · ${it.first}" } ?: "Best day",
                Modifier.widthIn(min = space(14f)),
              )
              StatFigure(path, "Counted against this path", Modifier.widthIn(min = space(14f)))
            }
            if (summary.total == 0.0) {
              Text(
                "No page views recorded for this entry yet. Only the published address is counted — a draft is not reachable, so it cannot be read.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
              )
            } else {
              TrendBars(
                summary.counts.map { (day, total) -> TrendBar(total, "", "$day · ${total.toLong()} view${if (total == 1.0) "" else "s"}") },
                Modifier.fillMaxWidth(),
                height = space(12f),
                highlightLast = false,
              )
            }
          }
        }
      }
    }
  }
}
