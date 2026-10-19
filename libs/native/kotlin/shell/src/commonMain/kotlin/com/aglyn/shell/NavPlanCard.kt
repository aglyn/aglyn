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

@Composable
internal fun PlanCard(notice: FeedNotification, onOpen: () -> Unit, onDismiss: () -> Unit) {
  val palette = LocalAglynPalette.current
  val reached = notice.level == "error" || notice.level == "critical"
  val tint = if (reached) palette.error.text else palette.warning.text
  Surface(
    shape = MaterialTheme.shapes.medium,
    color = MaterialTheme.colorScheme.surfaceContainerLowest,
    modifier = Modifier.fillMaxWidth().padding(12.dp).testTag("plan-card"),
  ) {
    Row(Modifier.clickable(onClick = onOpen).padding(start = 12.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      Icon(AglynIcons.named(if (reached) "error" else "data_usage"), null, Modifier.size(20.dp), tint = tint)
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(notice.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 3, overflow = TextOverflow.Ellipsis)
        Text("See plans and usage", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
      }
      IconButton(onClick = onDismiss, modifier = Modifier.size(32.dp).testTag("plan-card-dismiss").semantics { contentDescription = "Dismiss" }) {
        Icon(AglynIcons.named("close"), null, Modifier.size(16.dp))
      }
    }
  }
}
