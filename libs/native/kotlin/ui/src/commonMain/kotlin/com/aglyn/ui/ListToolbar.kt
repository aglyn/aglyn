package com.aglyn.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

/** How a list draws its items: rows, or a grid of cards or tiles. */
enum class ListView { LIST, GRID }

/** One way a list can be ordered: its key and its words ("Newest"). */
data class SortOption(val key: String, val label: String)

/**
 * The one list toolbar (the redesign's screen patterns): search, then Filters (with how many are set), Sort, and the
 * grid/list switch, each only where the list has it. [tag] prefixes each control's test tag.
 */
@Composable
fun ListToolbar(
  query: String,
  onQuery: (String) -> Unit,
  placeholder: String,
  modifier: Modifier = Modifier,
  tag: String = "list",
  filterCount: Int? = null,
  onFilters: (() -> Unit)? = null,
  sorts: List<SortOption> = emptyList(),
  sort: String? = null,
  onSort: (String) -> Unit = {},
  view: ListView? = null,
  onView: (ListView) -> Unit = {},
) {
  Row(modifier.fillMaxWidth().testTag("$tag-toolbar"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
    SearchField(query, onQuery, placeholder = placeholder, modifier = Modifier.weight(1f))
    if (onFilters != null) {
      val count = filterCount ?: 0
      OutlinedButton(shape = controlShape(), onClick = onFilters, modifier = Modifier.testTag("$tag-filters").semantics { contentDescription = if (count == 0) "Filters" else "Filters, $count set" }) {
        Icon(AglynIcons.named("filter_list"), contentDescription = null)
        if (count > 0) Text("$count", Modifier.padding(start = space(0.5f)))
      }
    }
    if (sorts.isNotEmpty()) {
      var open by remember { mutableStateOf(false) }
      val current = sorts.firstOrNull { it.key == sort }
      Box {
        OutlinedButton(shape = controlShape(), onClick = { open = true }, modifier = Modifier.testTag("$tag-sort").semantics { contentDescription = "Sort: ${current?.label ?: ""}" }) {
          Icon(AglynIcons.named("sort"), contentDescription = null)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
          for (option in sorts) {
            DropdownMenuItem(
              text = { Text(option.label) },
              trailingIcon = { if (option.key == sort) Icon(AglynIcons.named("check"), null) },
              onClick = { open = false; onSort(option.key) },
              modifier = Modifier.testTag("$tag-sort-${option.key}"),
            )
          }
        }
      }
    }
    if (view != null) {
      // One button that switches to the other view, so a narrow list pane keeps its room for search.
      val next = if (view == ListView.GRID) ListView.LIST else ListView.GRID
      OutlinedButton(shape = controlShape(), 
        onClick = { onView(next) },
        modifier = Modifier.testTag("$tag-view-${next.name.lowercase()}").semantics { contentDescription = if (next == ListView.GRID) "Show as a grid" else "Show as a list" },
      ) {
        Icon(AglynIcons.named(if (next == ListView.GRID) "grid_view" else "view_list"), contentDescription = null)
      }
    }
  }
}
