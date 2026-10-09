package com.aglyn.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** One column of a board: its key, its heading, a figure under it (a total), and its cards. */
data class BoardColumn<T>(val key: String, val title: String, val caption: String?, val items: List<T>)

/**
 * A board of columns side by side that scrolls sideways (a pipeline's
 * stages), each column its own scrolling list of cards. Columns widen with
 * the font scale so large type still fits a card.
 */
@Composable
fun <T> Board(
  columns: List<BoardColumn<T>>,
  itemKey: (T) -> String,
  modifier: Modifier = Modifier,
  columnWidth: Dp = 288.dp,
  emptyColumn: String = "Nothing here",
  card: @Composable (column: BoardColumn<T>, item: T) -> Unit,
) {
  val width = columnWidth * LocalDensity.current.fontScale.coerceIn(1f, 1.6f)
  Row(
    modifier.fillMaxSize().horizontalScroll(rememberScrollState()).padding(space(1.5f)).testTag("board"),
    horizontalArrangement = Arrangement.spacedBy(space(1.5f)),
  ) {
    for (column in columns) {
      Surface(
        Modifier.width(width).fillMaxHeight().testTag("board-column-${column.key}"),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
      ) {
        Column(Modifier.fillMaxSize()) {
          Column(Modifier.fillMaxWidth().padding(horizontal = space(1.5f), vertical = space(1f))) {
            Row(verticalAlignment = Alignment.CenterVertically) {
              Text(
                column.title,
                Modifier.weight(1f).semantics { heading() },
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
              )
              StatusChip(column.items.size.toString())
            }
            if (column.caption != null) {
              Text(column.caption, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }
          if (column.items.isEmpty()) {
            Text(
              emptyColumn,
              Modifier.padding(space(1.5f)),
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          } else {
            LazyColumn(
              Modifier.fillMaxSize().padding(horizontal = space(1f)),
              verticalArrangement = Arrangement.spacedBy(space(1f)),
            ) {
              items(column.items, key = itemKey) { item -> card(column, item) }
              item { Text("", Modifier.padding(bottom = space(1f))) }
            }
          }
        }
      }
    }
  }
}
