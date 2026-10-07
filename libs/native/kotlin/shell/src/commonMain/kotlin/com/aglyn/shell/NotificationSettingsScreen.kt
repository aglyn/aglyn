package com.aglyn.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.NotificationCatalog
import com.aglyn.contracts.Notifications
import com.aglyn.core.Live
import com.aglyn.core.NoPush
import com.aglyn.core.PushSwitchCategory
import com.aglyn.core.pushSwitchCategories
import com.aglyn.core.settlePending
import com.aglyn.core.userDocPath
import com.aglyn.core.writeAccountPush
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.WidthClass
import com.aglyn.ui.currentWidthClass
import com.aglyn.ui.space
import kotlinx.coroutines.launch

/**
 * Which notifications reach the person's phones and tablets as push: a switch
 * per notification type, grouped by the console's categories. Each switch is
 * the account's push answer for its type in `users/{uid}.notificationSettings`,
 * the map the console's notification settings page edits.
 */
@Composable
internal fun NotificationSettingsScreen(
  services: ShellServices,
  uid: String,
  catalog: NotificationCatalog = Notifications,
) {
  val doc by remember(uid) { services.firestore.observeDoc(userDocPath(uid)) }.collectAsState(Live.Loading)
  var pending by remember(uid) { mutableStateOf(emptyMap<String, Boolean>()) }
  var error by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()
  val data = (doc as? Live.Ready)?.value?.data
  LaunchedEffect(doc) { if (doc is Live.Ready) pending = settlePending(pending, data) }

  when (val state = doc) {
    Live.Loading -> SkeletonList(rows = 6, modifier = Modifier.testTag("notification-settings-loading"))
    is Live.Failed -> EmptyState(
      "Could not load your notification settings",
      body = "Check the connection and try again.",
      icon = AglynIcons.named("error"),
      modifier = Modifier.testTag("notification-settings-error"),
    )
    is Live.Ready -> {
      val categories = pushSwitchCategories(catalog, state.value?.data, pending)
      if (categories.isEmpty()) {
        EmptyState("No notifications to set", body = "Update the app to see every notification type.", icon = AglynIcons.named("notifications"))
        return
      }
      NotificationSettingsContent(
        categories = categories,
        pushOnThisDevice = services.push !== NoPush,
        error = error,
        onToggle = { type, value ->
          error = null
          pending = pending + (type to value)
          scope.launch {
            try {
              writeAccountPush(services.writer, uid, type, value)
            } catch (failure: Exception) {
              pending = pending - type
              error = "Could not save that change. Check the connection and try again."
            }
          }
        },
      )
    }
  }
}

@Composable
private fun NotificationSettingsContent(
  categories: List<PushSwitchCategory>,
  pushOnThisDevice: Boolean,
  error: String?,
  onToggle: (type: String, value: Boolean) -> Unit,
) {
  val twoColumns = currentWidthClass() >= WidthClass.EXPANDED
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier
        .widthIn(max = if (twoColumns) 1100.dp else 640.dp)
        .fillMaxWidth()
        .verticalScroll(rememberScrollState())
        .padding(space(2f))
        .testTag("notification-settings"),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      Text(
        "Choose which notifications are sent as push to the Aglyn app on your phones and tablets. " +
          "Every notification still shows in your notifications list.",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      if (!pushOnThisDevice) {
        NoticeBanner(
          "Push goes to phones and tablets only. This computer does not receive push; the switches here still apply to them.",
          StatusTone.INFO,
          Modifier.testTag("notification-settings-no-push"),
        )
      }
      if (error != null) NoticeBanner(error, StatusTone.ERROR, Modifier.testTag("notification-settings-save-error"))
      if (twoColumns) {
        // Two balanced columns: each category goes to the shorter one.
        val left = mutableListOf<PushSwitchCategory>()
        val right = mutableListOf<PushSwitchCategory>()
        for (category in categories) {
          if (left.sumOf { it.rows.size + 1 } <= right.sumOf { it.rows.size + 1 }) left += category else right += category
        }
        Row(horizontalArrangement = Arrangement.spacedBy(space(2f))) {
          for (column in listOf(left, right)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(space(2f))) {
              column.forEach { CategoryCard(it, onToggle) }
            }
          }
        }
      } else {
        categories.forEach { CategoryCard(it, onToggle) }
      }
    }
  }
}

@Composable
private fun CategoryCard(category: PushSwitchCategory, onToggle: (String, Boolean) -> Unit) {
  SectionCard(category.label, Modifier.fillMaxWidth().testTag("notification-category-${category.id}")) {
    Column {
      category.rows.forEachIndexed { index, row ->
        if (index > 0) HorizontalDivider()
        SwitchRow(
          title = row.label,
          checked = row.enabled,
          onCheckedChange = { onToggle(row.type, it) },
          modifier = Modifier.testTag("push-switch-${row.type}"),
        )
      }
    }
  }
}
