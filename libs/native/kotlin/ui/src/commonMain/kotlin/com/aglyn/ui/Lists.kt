package com.aglyn.ui

import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.size
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight

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
fun OverflowMenu(
  actions: List<MenuAction>,
  modifier: Modifier = Modifier,
  contentDescription: String = "More actions",
  /** Figma's list head "More" (Mac 13:483, iPad 13:2167): a horizontal ⋯ in a bordered 28 square after the primary. */
  boxed: Boolean = false,
  /** The boxed square's side: 28 beside a list head's buttons, 36 beside a record head's standard button. */
  boxSize: androidx.compose.ui.unit.Dp = 28.dp,
) {
  if (actions.isEmpty()) return
  var open by remember { mutableStateOf(false) }
  Box(modifier) {
    WithTooltip(contentDescription) {
      if (boxed) {
        val shape = androidx.compose.foundation.shape.RoundedCornerShape(LocalShellMetrics.current.controlRadius)
        Box(
          Modifier.size(boxSize).clip(shape).background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline, shape)
            .clickable(role = androidx.compose.ui.semantics.Role.Button, onClick = { open = true })
            .testTag("overflow-menu").semantics { this.contentDescription = contentDescription },
          contentAlignment = Alignment.Center,
        ) {
          Icon(AglynIcons.named("more_horiz"), contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurface)
        }
      } else {
        IconButton(onClick = { open = true }, Modifier.testTag("overflow-menu")) {
          Icon(AglynIcons.named("more_vert"), contentDescription = contentDescription)
        }
      }
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

/**
 * A list pane's header: its title (or count) on the left and its actions on the right. When they do not fit one line
 * (a phone, or a narrow list pane, with a plugin's action beside the list's own), the actions that do not fit wrap onto
 * the next line, right-aligned, instead of running off the edge or squeezing the title out.
 */
@Composable
fun ListHeader(title: String, modifier: Modifier = Modifier, actions: @Composable () -> Unit = {}) {
  // A list beside its detail (tablet, desktop) heads its own column as the area's head (Figma Orders 13:483, AGL-4012):
  // 20 above a 28 title row in the list title's type, its ☆ and actions, 12 below, then the area's section chips.
  if (LocalListColumn.current != null) {
    ListColumnHead(title, modifier, actions)
    return
  }
  FlowRow(
    modifier.fillMaxWidth().padding(horizontal = LocalContentInset.current ?: space(2f), vertical = space(1f)),
    horizontalArrangement = Arrangement.spacedBy(space(1f), Alignment.End),
    verticalArrangement = Arrangement.spacedBy(space(1f)),
    // A Compact 28 action sits centered beside the ⋯ button's taller touch box.
    itemVerticalAlignment = Alignment.CenterVertically,
  ) {
    // The title keeps its whole width: actions that do not fit beside it wrap to the next line rather than squeezing it to "…".
    val style = MaterialTheme.typography.titleSmall
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val titleWidth = remember(title, style, density) { with(density) { measurer.measure(title, style, maxLines = 1).size.width.toDp() } }
    Text(
      title,
      Modifier.widthIn(min = titleWidth).weight(1f).align(Alignment.CenterVertically).semantics { heading() },
      style = style,
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
        icon = AglynIcons.named("error"), tone = EmptyTone.ERROR,
        action = { OutlinedButton(shape = controlShape(), onClick = onRetry) { Text("Try again") } },
      )
      is Load.Ready -> content(load.value)
    }
  }
}

/** A row of [StatTile]s, every tile as tall as the tallest one so a wrapped caption never leaves its neighbors short. */
@Composable
fun StatRow(modifier: Modifier = Modifier, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
  Row(modifier.fillMaxWidth().height(androidx.compose.foundation.layout.IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(space(1f)), content = content)
}

/** A figure in a detail pane: what it counts, the number, and a line under it. Not a link. Sits in a [StatRow]. */
@Composable
fun StatTile(label: String, value: String, modifier: Modifier = Modifier, caption: String? = null) {
  androidx.compose.material3.Surface(
    modifier.fillMaxHeight().semantics(mergeDescendants = true) {},
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

/** [ListHeader] atop a list column beside its detail: the area's head, then its section chips. */
@Composable
private fun ListColumnHead(title: String, modifier: Modifier, actions: @Composable () -> Unit) {
  val star = LocalPageStar.current
  if (star != null) {
    androidx.compose.runtime.DisposableEffect(star) {
      star.claim()
      onDispose { star.release() }
    }
  }
  val edge = LocalContentInset.current ?: contentInset()
  androidx.compose.foundation.layout.Column(modifier.fillMaxWidth()) {
    androidx.compose.foundation.layout.Row(
      Modifier.fillMaxWidth().padding(start = edge, end = edge, top = HeadMetrics.listColumnTop, bottom = HeadMetrics.listColumnGap)
        .heightIn(min = HeadMetrics.listColumnTitleRow).testTag("list-column-head"),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(space(1f)),
    ) {
      Text(
        title,
        Modifier.weight(1f, fill = false).semantics { heading() },
        style = MaterialTheme.typography.headlineSmall.copy(fontSize = ListColumnTitle.size, lineHeight = ListColumnTitle.line),
        fontWeight = FontWeight.Bold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
      star?.star?.invoke()
      androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
      actions()
    }
    ListColumnSections()
  }
}

/** The list column title's type (Figma 13:483: 22/28 bold), shared by [ListScreenScaffold] and [ListHeader]. */
object ListColumnTitle {
  val size = 22.sp
  val line = 28.sp
}
