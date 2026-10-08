package com.aglyn.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.Live
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * A live list a window at a time: the query is observed with a limit that
 * grows a page per [loadMore], so the rows stay current (a new row arrives,
 * a changed one updates) and the list never re-reads what it already shows.
 * [hasMore] is true while a probe row past the window came back.
 *
 * [show] swaps the query (a chip, a search); the window starts over. A null
 * query (nothing to read yet) reads as an empty list.
 */
class LiveQueryList<T>(
  private val reader: FirestoreReader,
  private val scope: CoroutineScope,
  private val pageSize: Int = 25,
  private val map: (FirestoreDoc) -> T,
) {
  var rows: Live<List<T>> by mutableStateOf(Live.Loading)
    private set
  var hasMore by mutableStateOf(false)
    private set
  private var make: ((Int) -> FirestoreQuery?)? = null
  private var limit = pageSize
  private var job: Job? = null

  fun show(query: (limit: Int) -> FirestoreQuery?) {
    make = query
    limit = pageSize
    rows = Live.Loading
    observe()
  }

  fun loadMore() {
    if (!hasMore) return
    limit += pageSize
    observe()
  }

  fun retry() {
    rows = Live.Loading
    observe()
  }

  private fun observe() {
    job?.cancel()
    // One probe row past the window tells whether another window exists.
    val window = limit
    val query = make?.invoke(window + 1)
    if (query == null) {
      rows = Live.Ready(emptyList())
      hasMore = false
      return
    }
    job = scope.launch {
      try {
        reader.observe(query).collect { live ->
          when (live) {
            Live.Loading -> if (rows !is Live.Ready) rows = Live.Loading
            is Live.Failed -> rows = live
            is Live.Ready -> {
              rows = Live.Ready(live.value.take(window).map(map))
              hasMore = live.value.size > window
            }
          }
        }
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        rows = Live.Failed(error)
      }
    }
  }
}

/**
 * A [LiveQueryList] drawn: skeletons while it loads, the failure with a
 * retry, [empty] when there are no rows, else the rows a window at a time,
 * reading the next window as the end comes into view.
 */
@Composable
fun <T> LiveListPane(
  list: LiveQueryList<T>,
  key: (T) -> String,
  modifier: Modifier = Modifier,
  failed: String = "Could not load this list",
  empty: @Composable () -> Unit,
  header: (LazyListScope.() -> Unit)? = null,
  row: @Composable (T) -> Unit,
) {
  when (val rows = list.rows) {
    Live.Loading -> SkeletonList(rows = 6, modifier = modifier)
    is Live.Failed -> EmptyState(
      failed,
      modifier = modifier,
      body = rows.error.message ?: "Check the connection and try again.",
      icon = AglynIcons.named("error"),
      action = { OutlinedButton(onClick = list::retry) { Text("Try again") } },
    )
    is Live.Ready -> if (rows.value.isEmpty()) {
      empty()
    } else {
      val state = rememberLazyListState()
      val nearEnd by remember {
        derivedStateOf {
          val info = state.layoutInfo
          info.totalItemsCount > 0 && (info.visibleItemsInfo.lastOrNull()?.index ?: 0) >= info.totalItemsCount - 4
        }
      }
      LaunchedEffect(nearEnd, list.hasMore) { if (nearEnd && list.hasMore) list.loadMore() }
      LazyColumn(modifier.fillMaxSize().testTag("live-list"), state = state) {
        header?.invoke(this)
        items(rows.value.size, key = { key(rows.value[it]) }) { row(rows.value[it]) }
        if (list.hasMore) item { SkeletonList(rows = 2) }
      }
    }
  }
}
