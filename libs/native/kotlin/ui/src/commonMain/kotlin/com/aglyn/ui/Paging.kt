package com.aglyn.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag

/**
 * A list's pages, as the console's pagination reads: rows per page, the
 * range on screen ("11–20 of 34", or "11–20" when the total is not known),
 * and previous / next. [count] is the whole list when it is in hand; a
 * server-paged list passes [hasMore] instead.
 */
@Composable
fun ListPager(
  page: Int,
  pageSize: Int,
  rowCount: Int,
  onPage: (Int) -> Unit,
  onPageSize: (Int) -> Unit,
  modifier: Modifier = Modifier,
  count: Int? = null,
  hasMore: Boolean = false,
  pageSizes: List<Int> = listOf(10, 25, 50),
) {
  var choosing by remember { mutableStateOf(false) }
  val first = if (rowCount == 0) 0 else page * pageSize + 1
  val last = page * pageSize + rowCount
  val next = if (count != null) last < count else hasMore
  Row(
    modifier.fillMaxWidth().testTag("list-pager"),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(space(0.5f), Alignment.End),
  ) {
    Text("Rows per page:", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    androidx.compose.foundation.layout.Box {
      TextButton(onClick = { choosing = true }, modifier = Modifier.testTag("page-size")) { Text("$pageSize") }
      DropdownMenu(expanded = choosing, onDismissRequest = { choosing = false }) {
        for (size in pageSizes) {
          DropdownMenuItem(text = { Text("$size") }, onClick = { choosing = false; onPageSize(size) })
        }
      }
    }
    Text(
      if (count != null) "$first–$last of $count" else "$first–$last",
      Modifier.padding(horizontal = space(1f)),
      style = MaterialTheme.typography.bodySmall,
    )
    IconButton(onClick = { onPage(page - 1) }, enabled = page > 0, modifier = Modifier.testTag("page-previous")) {
      Icon(AglynIcons.named("chevron_left"), contentDescription = "Previous page")
    }
    IconButton(onClick = { onPage(page + 1) }, enabled = next, modifier = Modifier.testTag("page-next")) {
      Icon(AglynIcons.named("chevron_right"), contentDescription = "Next page")
    }
  }
}
