package com.aglyn.plugins.workflows

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import kotlinx.coroutines.delay
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.aglyn.contracts.formatLocalDay
import com.aglyn.contracts.hostEventLabel
import com.aglyn.contracts.hostEventTypes
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import com.aglyn.ui.ListPager
import com.aglyn.ui.SearchField
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.WidthClass
import com.aglyn.ui.currentWidthClass
import com.aglyn.ui.space

/*
 * An automation's run history (host-run-history-card): every run, the ones a
 * condition skipped included, newest first, a page at a time from the query
 * itself, filtered by result and trigger and searched by a word of what
 * happened.
 */

fun resultTone(result: String): StatusTone = when (result) {
  "failed" -> StatusTone.ERROR
  "skipped" -> StatusTone.WARNING
  else -> StatusTone.SUCCESS
}

@Composable
fun RunHistory(context: NativePluginContext, hostId: String, targetId: String, name: String, siteScope: Boolean) {
  var filters by remember(targetId) { mutableStateOf(RunFilters()) }
  var search by remember(targetId) { mutableStateOf("") }
  var page by remember(targetId, filters) { mutableStateOf(0) }
  var pageSize by remember(targetId) { mutableStateOf(PAGE_SIZES.first()) }
  val query = remember(hostId, targetId, filters, page, pageSize) { runHistoryQuery(hostId, targetId, filters, pageSize, page) }
  val live = liveQuery(context, query)
  val filtering = filters != RunFilters()
  val wide = currentWidthClass() >= WidthClass.MEDIUM

  Column(Modifier.fillMaxSize().testTag("run-history")) {
    Column(Modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Text("Runs — $name", Modifier.semantics { heading() }, style = MaterialTheme.typography.titleLarge)
      Text(if (siteScope) "Recent runs on this site" else "Recent runs", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      SearchField(search, { search = it }, placeholder = "Search what happened", onSearch = { filters = filters.copy(search = search) })
      LaunchedEffect(search) {
        delay(350)
        if (filters.search != search) filters = filters.copy(search = search)
      }
      val filterRow: @Composable (Modifier) -> Unit = { modifier ->
        SelectField(
          "Result",
          listOf(SelectOption("", "Any result")) + RUN_RESULT_LABELS.map { (key, label) -> SelectOption(key, label) },
          filters.result ?: "",
          { filters = filters.copy(result = it?.ifEmpty { null }) },
          modifier.testTag("runs-result"),
        )
        SelectField(
          "Trigger",
          listOf(SelectOption("", "Any trigger")) + hostEventTypes.map { SelectOption(it, hostEventLabel(it)) },
          filters.trigger ?: "",
          { filters = filters.copy(trigger = it?.ifEmpty { null }) },
          modifier.testTag("runs-trigger"),
        )
      }
      if (wide) {
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) { filterRow(Modifier.weight(1f)) }
      } else {
        filterRow(Modifier.fillMaxWidth())
      }
    }
    HorizontalDivider()
    when (live) {
      Live.Loading -> SkeletonList(rows = 4)
      is Live.Failed -> EmptyState("Could not load the runs", body = failureMessage(live.error), icon = AglynIcons.named("error"))
      is Live.Ready -> {
        val (rows, more) = pageOf(live.value.map(::runRowOf), pageSize, page)
        if (rows.isEmpty() && page == 0) {
          EmptyState(
            if (filtering) "No runs match these filters" else "No runs yet — every run of this automation is logged here, including the ones a condition skipped.",
            icon = AglynIcons.named("history"),
            modifier = Modifier.testTag(if (filtering) "runs-filtered-empty" else "runs-empty"),
          )
        } else {
          LazyColumn(Modifier.fillMaxSize()) {
            if (wide) {
              item {
                Row(Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1f)), horizontalArrangement = Arrangement.spacedBy(space(1.5f))) {
                  listOf("Time" to 0.9f, "Trigger" to 1f, "Who" to 1.2f, "Result" to 0.8f, "What happened" to 2f).forEach { (label, weight) ->
                    Text(label, Modifier.weight(weight), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                  }
                }
                HorizontalDivider()
              }
            }
            items(rows, key = { it.id }) { run -> RunRowItem(run, wide) }
            item {
              ListPager(
                page = page,
                pageSize = pageSize,
                rowCount = rows.size,
                hasMore = more,
                onPage = { page = it },
                onPageSize = { pageSize = it; page = 0 },
                modifier = Modifier.padding(horizontal = space(1f)),
              )
            }
          }
        }
      }
    }
  }
}

@Composable
private fun RunRowItem(run: RunRow, wide: Boolean) {
  val time = run.createdAtMs?.let { formatLocalDay(it, "MMM d, h:mm a") } ?: "--"
  Column(Modifier.fillMaxWidth().testTag("run-${run.id}")) {
    if (wide) {
      Row(Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1.25f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1.5f))) {
        Text(time, Modifier.weight(0.9f), style = MaterialTheme.typography.bodySmall)
        Text(run.triggerLabel, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
        Text(run.who, Modifier.weight(1.2f), style = MaterialTheme.typography.bodySmall)
        Row(Modifier.weight(0.8f)) { StatusChip(RUN_RESULT_LABELS[run.result] ?: run.result, resultTone(run.result)) }
        Text(run.summaryLine, Modifier.weight(2f), style = MaterialTheme.typography.bodyMedium)
      }
    } else {
      Column(Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1.25f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          StatusChip(RUN_RESULT_LABELS[run.result] ?: run.result, resultTone(run.result))
          Text(run.triggerLabel, Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
          Text(time, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(run.summaryLine, style = MaterialTheme.typography.bodyMedium)
        Text(run.who, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    HorizontalDivider(Modifier.padding(start = space(2f)))
  }
}
