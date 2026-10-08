package com.aglyn.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow

/**
 * A list that refreshes when pulled (and from a refresh key on desktop, where
 * the shell's menu asks the same). [refreshing] shows the spinner until the
 * new rows land.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RefreshableBox(
  refreshing: Boolean,
  onRefresh: () -> Unit,
  modifier: Modifier = Modifier,
  content: @Composable () -> Unit,
) {
  PullToRefreshBox(isRefreshing = refreshing, onRefresh = onRefresh, modifier = modifier.fillMaxSize()) { content() }
}

/** Asks for the next page once the list nears its end and more rows are left. */
@Composable
fun LoadMoreEffect(state: LazyListState, hasMore: Boolean, threshold: Int = 4, onLoadMore: () -> Unit) {
  val nearEnd by remember(state) {
    derivedStateOf {
      val info = state.layoutInfo
      info.totalItemsCount > 0 && (info.visibleItemsInfo.lastOrNull()?.index ?: 0) >= info.totalItemsCount - threshold
    }
  }
  LaunchedEffect(nearEnd, hasMore) { if (nearEnd && hasMore) onLoadMore() }
}

/** A label above its value, as a detail pane lists a record's fields. */
@Composable
fun DetailRow(label: String, value: String?, modifier: Modifier = Modifier, placeholder: String = "—") {
  Column(modifier.fillMaxWidth().padding(vertical = space(0.5f)), verticalArrangement = Arrangement.spacedBy(space(0.25f))) {
    Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Text(
      value?.ifBlank { null } ?: placeholder,
      style = MaterialTheme.typography.bodyLarge,
      color = if (value.isNullOrBlank()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
    )
  }
}

/** One entry of an [OverflowMenu]. */
data class MenuAction(
  val key: String,
  val label: String,
  val icon: String? = null,
  val destructive: Boolean = false,
  val enabled: Boolean = true,
  val onClick: () -> Unit,
)

/** The ⋮ button and its menu: a row's or a detail pane's less common actions. */
@Composable
fun OverflowMenu(actions: List<MenuAction>, modifier: Modifier = Modifier, contentDescription: String = "More actions") {
  if (actions.isEmpty()) return
  var open by remember { mutableStateOf(false) }
  Box(modifier) {
    IconButton(onClick = { open = true }, Modifier.testTag("overflow-menu")) {
      Icon(AglynIcons.named("more_vert"), contentDescription = contentDescription)
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      for (action in actions) {
        val color = if (action.destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
        DropdownMenuItem(
          text = { Text(action.label, color = color) },
          leadingIcon = action.icon?.let { name -> { Icon(AglynIcons.named(name), null, tint = color) } },
          enabled = action.enabled,
          onClick = {
            open = false
            action.onClick()
          },
          modifier = Modifier.testTag("menu-${action.key}"),
        )
      }
    }
  }
}

/** A list pane's header: its title (or count) on the left and its actions on the right. */
@Composable
fun ListHeader(title: String, modifier: Modifier = Modifier, actions: @Composable () -> Unit = {}) {
  Row(
    modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1f)),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(space(1f)),
  ) {
    Text(
      title,
      Modifier.weight(1f).semantics { heading() },
      style = MaterialTheme.typography.titleSmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
    actions()
  }
}

/** The usual three-way state of something read once and refreshed on demand. */
sealed interface Load<out T> {
  data object Loading : Load<Nothing>
  data class Ready<T>(val value: T) : Load<T>
  data class Failed(val message: String) : Load<Nothing>
}

/** Fills the space while [content] is not ready: skeleton rows, or the failure with a retry. */
@Composable
fun <T> LoadContent(
  load: Load<T>,
  onRetry: () -> Unit,
  modifier: Modifier = Modifier,
  failedTitle: String = "Could not load this",
  skeleton: @Composable () -> Unit = { SkeletonList(rows = 6) },
  content: @Composable (T) -> Unit,
) {
  Box(modifier.fillMaxSize()) {
    when (load) {
      Load.Loading -> skeleton()
      is Load.Failed -> EmptyState(
        failedTitle,
        body = load.message,
        icon = AglynIcons.named("error"),
        action = { androidx.compose.material3.OutlinedButton(onClick = onRetry) { Text("Try again") } },
      )
      is Load.Ready -> content(load.value)
    }
  }
}

/** A figure in a detail pane: what it counts, the number, and a line under it. Not a link. */
@Composable
fun StatTile(label: String, value: String, modifier: Modifier = Modifier, caption: String? = null) {
  androidx.compose.material3.Surface(
    modifier.semantics(mergeDescendants = true) {},
    shape = MaterialTheme.shapes.large,
    color = MaterialTheme.colorScheme.surfaceContainerLow,
  ) {
    Column(Modifier.padding(space(1.5f)), verticalArrangement = Arrangement.spacedBy(space(0.25f))) {
      Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(value, style = MaterialTheme.typography.headlineSmall)
      if (caption != null) Text(caption, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
  }
}
