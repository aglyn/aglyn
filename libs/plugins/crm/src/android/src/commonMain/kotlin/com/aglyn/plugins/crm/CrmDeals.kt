package com.aglyn.plugins.crm

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.Board
import com.aglyn.ui.BoardColumn
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.LiveQueryList
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusTone
import com.aglyn.ui.WidthClass
import com.aglyn.ui.currentWidthClass
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/*
 * DEALS: the pipeline as a board on tablets and desktops (a column per
 * stage, a card per deal, Move to… on each card), and as the list beside
 * the picked deal everywhere. A move posts to `crm/deal-stage`, the
 * console's own route, so automations hear it and the stage clock restarts.
 */

/** The board's columns: every stage of the pipeline in order, its open deals, and the stage's total. */
fun boardColumns(pipeline: Pipeline, deals: List<CrmRow>): List<BoardColumn<CrmRow>> = pipeline.stages.map { stage ->
  val inStage = deals.filter { deal ->
    val status = deal.data["status"] as? String ?: "open"
    when (stage.kind) {
      "won" -> status == "won"
      "lost" -> status == "lost"
      else -> status == "open" && deal.data["stageId"] == stage.id
    }
  }
  val total = inStage.sumOf { (it.data["amountCents"] as? Number)?.toLong() ?: 0L }
  BoardColumn(stage.id, stage.name, if (inStage.isEmpty()) null else formatCents(total), inStage)
}

@Composable
fun DealsSection(context: NativePluginContext, scope: CrmScope, api: CrmApi, reference: CrmReference, initial: String?) {
  val wide = currentWidthClass() != WidthClass.COMPACT
  var view by rememberSaveable { mutableStateOf(if (wide && initial == null) "board" else "list") }
  Column(Modifier.fillMaxSize()) {
    ChoiceChipRow(
      listOf(ChipOption("board", "Pipeline", "view_kanban"), ChipOption("list", "List", "list")),
      view,
      { view = it },
      modifier = Modifier.padding(horizontal = space(2f)).testTag("deals-view"),
    )
    if (view == "board") DealsBoard(context, scope, api, reference) else RecordsSection(context, CrmKind.DEAL, scope, api, reference, initial)
  }
}

@Composable
fun DealsBoard(context: NativePluginContext, scope: CrmScope, api: CrmApi, reference: CrmReference) {
  val coroutines = rememberCoroutineScope()
  var pipelineId by rememberSaveable { mutableStateOf(reference.pipeline(null).id) }
  val pipeline = reference.pipeline(pipelineId)
  val list = remember(scope, context.firestore) { LiveQueryList(context.firestore, coroutines, 300) { crmRow(CrmKind.DEAL, it, scope) } }
  LaunchedEffect(list, pipeline.id) {
    list.show { limit ->
      scopedQuery(scope, "deals", listOf(FirestoreFilter("pipelineId", FilterOp.EQ, pipeline.id)), listOf(FirestoreOrder("updatedAt", descending = true)), limit)
    }
  }
  var error by remember { mutableStateOf<String?>(null) }
  Column(Modifier.fillMaxSize()) {
    if (reference.activePipelines.size > 1) {
      ChoiceChipRow(reference.activePipelines.map { ChipOption(it.id, it.name) }, pipeline.id, { pipelineId = it }, modifier = Modifier.padding(horizontal = space(2f), vertical = space(0.5f)))
    }
    error?.let { NoticeBanner(it, StatusTone.ERROR, Modifier.padding(horizontal = space(2f))) }
    when (val rows = list.rows) {
      Live.Loading -> SkeletonList(rows = 6)
      is Live.Failed -> EmptyState("Could not load the pipeline", body = rows.error.message, icon = AglynIcons.named("error"))
      is Live.Ready -> if (rows.value.isEmpty()) {
        EmptyState("No deals in ${pipeline.name} yet", body = "Add a deal from the list, or convert a lead with one.", icon = AglynIcons.named("handshake"))
      } else {
        Board(boardColumns(pipeline, rows.value), itemKey = { it.id }, emptyColumn = "No deals") { column, deal ->
          DealCard(deal, pipeline, column.key, canMove = scope.canWrite, onOpen = { context.navigate(CrmKind.DEAL.detailScreen, mapOf("deal" to deal.id)) }) { stageId ->
            error = null
            coroutines.launch {
              try {
                val target = pipeline.stages.first { it.id == stageId }
                when (target.kind) {
                  "won" -> api.closeDeal(deal.id, true)
                  "lost" -> api.closeDeal(deal.id, false)
                  else -> api.moveDeal(deal.id, stageId)
                }
              } catch (failure: Throwable) {
                if (failure is CancellationException) throw failure
                error = problemText(failure)
              }
            }
          }
        }
      }
    }
  }
}

@Composable
private fun DealCard(deal: CrmRow, pipeline: Pipeline, columnKey: String, canMove: Boolean, onOpen: () -> Unit, onMove: (String) -> Unit) {
  var menu by remember { mutableStateOf(false) }
  Surface(
    onClick = onOpen,
    modifier = Modifier.fillMaxWidth().testTag("deal-card-${deal.id}"),
    shape = RoundedCornerShape(12.dp),
    color = MaterialTheme.colorScheme.surfaceContainerLowest,
    shadowElevation = 1.dp,
  ) {
    Row(Modifier.padding(start = space(1.5f), top = space(1f), bottom = space(1f)), verticalAlignment = Alignment.Top) {
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(deal.title, style = MaterialTheme.typography.titleSmall, maxLines = 2)
        (deal.data["amountCents"] as? Number)?.let { Text(formatCents(it.toLong(), deal.data["currency"] as? String), style = MaterialTheme.typography.bodyMedium) }
        (deal.data["expectedCloseAtMs"] as? Number)?.let {
          Text("Closes ${com.aglyn.ui.isoDayOf(it.toLong())}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      if (canMove) {
        Box {
          IconButton(onClick = { menu = true }, modifier = Modifier.semantics { contentDescription = "Move ${deal.title}" }.testTag("deal-move-${deal.id}")) {
            Icon(AglynIcons.named("more_vert"), contentDescription = null, Modifier.size(20.dp))
          }
          DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            pipeline.stages.filter { it.id != columnKey }.forEach { stage ->
              DropdownMenuItem(text = { Text("Move to ${stage.name}") }, onClick = { menu = false; onMove(stage.id) })
            }
          }
        }
      }
    }
  }
}
