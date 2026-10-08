package com.aglyn.plugins.crm

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AmountRow
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.space
import kotlin.math.max
import kotlin.math.roundToLong

/*
 * THE CRM'S REPORTS: the pipeline by stage, deals closed in the period,
 * the lead funnel, where leads come from, the contacts mix, the team's
 * activity and the tasks. The figures are the console's own functions
 * (`pipelineTotals`, `leadFunnel`, `crmReportRange`), ported and replayed
 * against its answers, over the same scoped reads.
 */

private const val DAY_MS = 86_400_000L

data class ReportRange(val from: Long, val to: Long)

/** `crmReportRange`: "this month" from the first of the local month; the day periods count back from now. */
fun crmReportRange(period: String, nowMs: Long): ReportRange = when (period) {
  "month" -> ReportRange(startOfLocalMonth(nowMs), nowMs)
  else -> ReportRange(nowMs - (when (period) { "7d" -> 7; "30d" -> 30; else -> 90 }) * DAY_MS, nowMs)
}

/** The first of the local month holding [nowMs]. */
fun startOfLocalMonth(nowMs: Long): Long {
  var day = startOfLocalDay(nowMs)
  // Walk back a day at a time to the 1st: at most 30 steps, and DST-safe.
  while (true) {
    val previous = startOfLocalDay(day - 12 * 3_600_000L)
    if (dayOfMonth(day) == 1) return day
    day = previous
  }
}

private fun dayOfMonth(midnight: Long): Int = com.aglyn.ui.isoDayOf(midnight + 12 * 3_600_000L).substring(8, 10).toInt()

data class StageTotal(val stage: Stage, val count: Int, val amountCents: Long, val weightedCents: Long)

data class PipelineTotals(val count: Int, val amountCents: Long, val weightedCents: Long, val stages: List<StageTotal>, val unplacedCount: Int, val unplacedCents: Long)

private fun dealProbability(deal: Map<String, Any?>, stage: Stage): Long {
  val own = (deal["probability"] as? Number)?.toDouble()
  if (own != null && own.isFinite()) return own.coerceIn(0.0, 100.0).roundToLong()
  return stage.probability.coerceIn(0, 100)
}

/** `pipelineTotals`: open deals only, by the pipeline's open stages, weighted by probability. */
fun pipelineTotals(deals: List<Map<String, Any?>>, pipeline: Pipeline): PipelineTotals {
  val stages = pipeline.stages.filter { it.kind == "open" }.sortedBy { it.order }
  val counts = stages.associate { it.id to longArrayOf(0, 0, 0) }
  var count = 0
  var amount = 0L
  var weighted = 0L
  var unplacedCount = 0
  var unplacedCents = 0L
  for (deal in deals) {
    if ((deal["status"] ?: "open") != "open") continue
    val cents = max(0L, ((deal["amountCents"] as? Number)?.toDouble() ?: 0.0).roundToLong())
    count += 1
    amount += cents
    val row = counts[deal["stageId"]]
    val stage = stages.firstOrNull { it.id == deal["stageId"] }
    if (row == null || stage == null) {
      unplacedCount += 1
      unplacedCents += cents
      continue
    }
    val weight = (cents * dealProbability(deal, stage) / 100.0).roundToLong()
    row[0] += 1
    row[1] += cents
    row[2] += weight
    weighted += weight
  }
  return PipelineTotals(
    count, amount, weighted,
    stages.map { stage -> counts.getValue(stage.id).let { StageTotal(stage, it[0].toInt(), it[1], it[2]) } },
    unplacedCount, unplacedCents,
  )
}

data class LeadFunnel(val total: Int, val byStatus: Map<String, Int>, val open: Int, val reasons: List<Pair<String, Int>>)

/** `leadFunnel`: every lead by status, and why the unqualified ones were closed. */
fun leadFunnel(leads: List<Map<String, Any?>>): LeadFunnel {
  val statuses = Contracts.nativeCrmLeadStatuses
  val byStatus = statuses.associateWith { 0 }.toMutableMap()
  val reasons = linkedMapOf<String, Pair<String, Int>>()
  for (lead in leads) {
    val status = (lead["status"] as? String)?.takeIf { it in statuses } ?: "new"
    byStatus[status] = byStatus.getValue(status) + 1
    if (status != "unqualified") continue
    val label = (lead["unqualifiedReason"] as? String).orEmpty().replace(Regex("\\s+"), " ").trim()
    val key = if (label.isEmpty()) "\$none" else label.lowercase()
    val row = reasons[key]
    reasons[key] = (row?.first ?: label.ifEmpty { "No reason given" }) to ((row?.second ?: 0) + 1)
  }
  return LeadFunnel(
    leads.size,
    byStatus,
    (byStatus["new"] ?: 0) + (byStatus["nurturing"] ?: 0) + (byStatus["working"] ?: 0),
    reasons.values.sortedWith(compareByDescending<Pair<String, Int>> { it.second }.thenBy { it.first }),
  )
}

@Composable
private fun scopedDocs(context: NativePluginContext, key: Any, query: () -> com.aglyn.core.FirestoreQuery): Live<List<FirestoreDoc>> =
  remember(key) { context.firestore.observe(query()) }.collectAsState(Live.Loading).value

/** One labelled bar: a count against the largest in its set. */
@Composable
private fun BarRow(label: String, value: Int, max: Int, caption: String? = null) {
  Column(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = "$label: $value${caption?.let { ", $it" } ?: ""}" }) {
    AmountRow(label, listOfNotNull(value.toString(), caption).joinToString(" · "))
    LinearProgressIndicator(progress = { if (max > 0) value.toFloat() / max else 0f }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp))
  }
}

@Composable
fun ReportsSection(context: NativePluginContext, scope: CrmScope, reference: CrmReference) {
  var period by rememberSaveable { mutableStateOf("30d") }
  val now = remember(period) { nowMillis() }
  val range = crmReportRange(period, now)
  val pipeline = reference.pipeline(null)
  val deals = scopedDocs(context, "deals-${scope.orgId}") { scopedQuery(scope, "deals", limit = 500) }
  val leads = scopedDocs(context, "leads-${scope.orgId}") { scopedQuery(scope, "leads", limit = 500) }
  val contacts = scopedDocs(context, "contacts-${scope.orgId}") { scopedQuery(scope, "contacts", limit = 500) }
  val activity = scopedDocs(context, "activity-${scope.orgId}-$period") {
    scopedQuery(scope, "crmActivities", listOf(FirestoreFilter("atMs", FilterOp.GTE, range.from)), listOf(FirestoreOrder("atMs", true)), 1000)
  }
  val tasks = scopedDocs(context, "tasks-${scope.orgId}") { scopedQuery(scope, "crmTasks", listOf(FirestoreFilter("status", FilterOp.EQ, "open")), limit = 500) }

  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.widthIn(max = 920.dp).fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("crm-reports"),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      ChoiceChipRow(Contracts.nativeCrmReportPeriods.map { ChipOption(it, Contracts.crmReportPeriodLabels[it] ?: it) }, period, { period = it })

      SectionCard("Pipeline · ${pipeline.name}", Modifier.fillMaxWidth()) {
        when (deals) {
          is Live.Ready -> {
            val totals = pipelineTotals(deals.value.map { it.data }, pipeline)
            AmountRow("Open deals", "${totals.count} · ${formatCents(totals.amountCents)}", emphasized = true)
            AmountRow("Weighted", formatCents(totals.weightedCents), muted = true)
            val most = totals.stages.maxOfOrNull { it.count } ?: 0
            totals.stages.forEach { BarRow(it.stage.name, it.count, most, formatCents(it.amountCents)) }
          }
          is Live.Failed -> Text("Could not load deals.", color = MaterialTheme.colorScheme.error)
          Live.Loading -> SkeletonList(rows = 3)
        }
      }

      SectionCard("Deals closed", Modifier.fillMaxWidth()) {
        (deals as? Live.Ready)?.value?.map { it.data }?.let { all ->
          val closed = all.filter { (millisOf(it["closedAtMs"]) ?: 0L) in range.from..range.to }
          val won = closed.filter { it["status"] == "won" }
          val lost = closed.filter { it["status"] == "lost" }
          fun sum(list: List<Map<String, Any?>>) = list.sumOf { (it["amountCents"] as? Number)?.toLong() ?: 0L }
          AmountRow("Won", "${won.size} · ${formatCents(sum(won))}", emphasized = true)
          AmountRow("Lost", "${lost.size} · ${formatCents(sum(lost))}", muted = true)
          val rate = if (closed.isEmpty()) null else won.size * 100 / closed.size
          AmountRow("Win rate", rate?.let { "$it%" } ?: "—", muted = true)
          val byOwner = closed.groupBy { it["ownerUid"] as? String }.map { (uid, rows) -> (reference.memberLabel(uid) ?: "Unassigned") to rows.count { it["status"] == "won" } }
          if (byOwner.isNotEmpty()) {
            Text("Won by owner", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val most = byOwner.maxOf { it.second }
            byOwner.sortedByDescending { it.second }.forEach { BarRow(it.first, it.second, most) }
          }
        } ?: SkeletonList(rows = 2)
      }

      SectionCard("Lead funnel", Modifier.fillMaxWidth()) {
        (leads as? Live.Ready)?.value?.map { it.data }?.let { all ->
          val funnel = leadFunnel(all)
          AmountRow("Leads", funnel.total.toString(), emphasized = true)
          AmountRow("Open", funnel.open.toString(), muted = true)
          val most = funnel.byStatus.values.maxOrNull() ?: 0
          Contracts.nativeCrmLeadStatuses.forEach { BarRow(Contracts.crmLeadStatusLabels[it] ?: it, funnel.byStatus[it] ?: 0, most) }
          if (funnel.reasons.isNotEmpty()) {
            Text("Why leads were unqualified", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            funnel.reasons.take(5).forEach { (label, count) -> AmountRow(label, count.toString(), muted = true) }
          }
          val sources = all.groupBy { (it["leadSource"] as? String)?.takeIf(String::isNotBlank) ?: "No lead source" }.mapValues { it.value.size }
          Text("Lead source", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
          val top = sources.values.maxOrNull() ?: 0
          sources.entries.sortedByDescending { it.value }.take(8).forEach { BarRow(it.key, it.value, top) }
        } ?: SkeletonList(rows = 3)
      }

      SectionCard("Contacts by stage", Modifier.fillMaxWidth()) {
        (contacts as? Live.Ready)?.value?.let { docs ->
          val stages = docs.map { contactView(it.data, scope.groupId)["lifecycleStage"] as? String }
          val counts = Contracts.contactLifecycleStageLabels.map { (stage, label) -> label to stages.count { it == stage } } + ("No stage" to stages.count { it == null })
          val most = counts.maxOfOrNull { it.second } ?: 0
          AmountRow("Contacts", docs.size.toString(), emphasized = true)
          counts.filter { it.second > 0 }.forEach { BarRow(it.first, it.second, most) }
        } ?: SkeletonList(rows = 3)
      }

      SectionCard("Activity", Modifier.fillMaxWidth()) {
        (activity as? Live.Ready)?.value?.let { docs ->
          val kinds = docs.groupBy { it.string("kind") ?: "other" }.mapValues { it.value.size }
          AmountRow("Logged", docs.size.toString(), emphasized = true)
          val most = kinds.values.maxOrNull() ?: 0
          Contracts.crmActivityKindLabels.forEach { (kind, label) -> BarRow(label, kinds[kind] ?: 0, most) }
          val byPerson = docs.groupBy { it.string("byUid") }.map { (uid, rows) -> (reference.memberLabel(uid) ?: "Someone") to rows.size }
          if (byPerson.isNotEmpty()) {
            Text("By person", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val top = byPerson.maxOf { it.second }
            byPerson.sortedByDescending { it.second }.forEach { BarRow(it.first, it.second, top) }
          }
        } ?: SkeletonList(rows = 3)
      }

      SectionCard("Tasks", Modifier.fillMaxWidth()) {
        (tasks as? Live.Ready)?.value?.map(::taskOf)?.let { open ->
          val today = startOfLocalDay(now)
          AmountRow("Open", open.size.toString(), emphasized = true)
          AmountRow("Overdue", open.count { (it.dueAtMs ?: Long.MAX_VALUE) < today }.toString(), muted = true)
          AmountRow("Due today", open.count { it.dueAtMs != null && it.dueAtMs >= today && it.dueAtMs < today + DAY_MS }.toString(), muted = true)
          AmountRow("Unassigned", open.count { it.assigneeUid == null }.toString(), muted = true)
        } ?: SkeletonList(rows = 2)
      }
    }
  }
}
