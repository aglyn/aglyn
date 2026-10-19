package com.aglyn.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * The ☆ for the place on screen, which the shell binds: a screen with a title row draws it beside its title (and claims
 * it, so the shell does not draw it again).
 */
@Stable
class PageStarSlot(val star: @Composable () -> Unit) {
  var claimed by mutableStateOf(false)
}

val LocalPageStar = staticCompositionLocalOf<PageStarSlot?> { null }

/** One filter choice in a list's Filter menu: a group heading's options, one picked per group. */
data class FilterChoice(val group: String, val key: String, val label: String)

/** The primary action of a list screen: its one filled button. */
data class PrimaryAction(val id: String, val label: String, val icon: String = "add", val enabled: Boolean = true, val run: () -> Unit)

/**
 * The shared list screen (Figma Mac Sites 13:3, Orders 13:483): the title row with ☆ and ONE filled primary button (any
 * other action in ⋯), then the list toolbar (a search field and ONE Filter button), the active filters as chips only
 * once one is set, then the list.
 */
@Composable
fun ListScreenScaffold(
  title: String,
  query: String,
  onQuery: (String) -> Unit,
  placeholder: String,
  modifier: Modifier = Modifier,
  tag: String = "list",
  primary: PrimaryAction? = null,
  more: List<MenuAction> = emptyList(),
  filters: List<FilterChoice> = emptyList(),
  /** The picked key per group; a group whose pick is its first option counts as not filtering. */
  picked: Map<String, String> = emptyMap(),
  onPick: (FilterChoice) -> Unit = {},
  content: @Composable ColumnScope.() -> Unit,
) {
  val star = LocalPageStar.current
  if (star != null) {
    DisposableEffect(star) {
      star.claimed = true
      onDispose { star.claimed = false }
    }
  }
  val metrics = LocalShellMetrics.current
  val groups = filters.groupBy { it.group }
  val active = groups.mapNotNull { (group, options) -> options.firstOrNull { it.key == picked[group] }?.takeIf { it != options.first() } }
  Column(modifier.fillMaxSize().testTag("$tag-screen")) {
    Row(
      Modifier.fillMaxWidth().padding(start = space(3f), end = space(3f), top = space(1f), bottom = space(1.5f)),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(space(1f)),
    ) {
      Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
      star?.star?.invoke()
      Box(Modifier.weight(1f))
      if (more.isNotEmpty()) OverflowMenu(more, contentDescription = "More actions")
      primary?.let { action ->
        Button(onClick = action.run, enabled = action.enabled, shape = controlShape(), modifier = Modifier.testTag(action.id)) {
          Icon(AglynIcons.named(action.icon), contentDescription = null, Modifier.size(18.dp))
          Text(action.label, Modifier.padding(start = space(1f)), maxLines = 1)
        }
      }
    }
    Row(
      Modifier.fillMaxWidth().padding(horizontal = space(3f)).padding(bottom = space(1f)),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(space(1f)),
    ) {
      SearchField(query, onQuery, placeholder = placeholder, modifier = Modifier.weight(1f))
      if (groups.isNotEmpty()) {
        var open by remember { mutableStateOf(false) }
        Box {
          OutlinedButton(
            onClick = { open = true },
            shape = controlShape(),
            modifier = Modifier.testTag("$tag-filter").semantics { contentDescription = if (active.isEmpty()) "Filter" else "Filter, ${active.size} set" },
          ) {
            Icon(AglynIcons.named("filter_list"), contentDescription = null, Modifier.size(18.dp))
            Text(if (active.isEmpty()) "Filter" else "Filter · ${active.size}", Modifier.padding(start = space(0.75f)))
          }
          DropdownMenu(open, onDismissRequest = { open = false }, modifier = Modifier.testTag("$tag-filter-menu")) {
            groups.entries.forEachIndexed { index, (group, options) ->
              if (index > 0) HorizontalDivider()
              Text(group, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
              for (option in options) {
                DropdownMenuItem(
                  text = { Text(option.label) },
                  trailingIcon = { if (picked[group] == option.key || (picked[group] == null && option == options.first())) Icon(AglynIcons.named("check"), null) },
                  onClick = { open = false; onPick(option) },
                  modifier = Modifier.testTag("$tag-filter-${option.key}"),
                )
              }
            }
          }
        }
      }
    }
    // The filters in force, each with × to clear it back to its group's first option.
    if (active.isNotEmpty()) {
      Row(Modifier.fillMaxWidth().padding(horizontal = space(3f)).padding(bottom = space(1f)), horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        for (choice in active) {
          InputChip(
            selected = true,
            onClick = { groups[choice.group]?.firstOrNull()?.let(onPick) },
            label = { Text(choice.label) },
            trailingIcon = { Icon(AglynIcons.named("close"), "Clear ${choice.label}", Modifier.size(14.dp)) },
            shape = if (metrics.compact) androidx.compose.foundation.shape.RoundedCornerShape(metrics.controlRadius) else MaterialTheme.shapes.small,
            modifier = Modifier.testTag("$tag-active-${choice.key}"),
          )
        }
      }
    }
    content()
  }
}
