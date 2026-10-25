package com.aglyn.plugins.crm

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import com.aglyn.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.LocalAglynPalette
import com.aglyn.ui.StatFigure
import com.aglyn.ui.StatFigures
import com.aglyn.ui.StatsCard
import com.aglyn.ui.UpgradeKind
import com.aglyn.ui.UpgradeNotice
import com.aglyn.ui.space
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/*
 * The CRM's dashboard cards (AGL-4011), the console's `CrmGlanceCard` and `CrmTasksDueCard`: on a site's Home they read
 * the site's group, on the workspace's Home (the console's `orgDashboard` row) they total every site. The Apple twin is
 * CrmGlance.swift.
 */

/** The console's `orgDashboard` slot: the workspace Home's row of cards that total every site. */
const val CRM_ORG_DASHBOARD_SLOT = "orgDashboard"

private data class GlanceFigures(val contacts: Long, val newThisWeek: Long, val pipelineCents: Double, val tasksDue: Long, val leadsToWork: Long)

private const val DAY_MS = 86_400_000L

/** The CRM's scope here: the site's, or the workspace's (no site) at the organization level. */
@Composable
private fun crmScopeLive(context: NativePluginContext, orgLevel: Boolean): Live<CrmScope>? {
  val orgId = context.orgId ?: return null
  val hostId = if (orgLevel) null else context.hostId ?: return null
  return remember(orgId, hostId) { observeCrmScope(context.firestore, orgId, hostId, context.uid) }.collectAsState(Live.Loading).value
}

private fun money(cents: Double): String {
  val dollars = cents / 100
  val whole = kotlin.math.floor(dollars).toLong().toString().reversed().chunked(3).joinToString(",").reversed()
  val fraction = kotlin.math.round((dollars - kotlin.math.floor(dollars)) * 100).toLong()
  return if (fraction == 0L) "$$whole" else "$$whole.${fraction.toString().padStart(2, '0')}"
}

/**
 * "CRM at a glance": contacts, new this week, the open pipeline, tasks due today or overdue, and leads still to work,
 * each a server count or sum over the same scope the hub's sections read, each opening its section.
 */
@Composable
fun CrmAtAGlanceCard(context: NativePluginContext, orgLevel: Boolean) {
  val scopeLive = crmScopeLive(context, orgLevel) ?: return
  val scope = (scopeLive as? Live.Ready)?.value
  var figures by remember(scope?.readTokens) { mutableStateOf<GlanceFigures?>(null) }
  var failed by remember(scope?.readTokens) { mutableStateOf(false) }
  LaunchedEffect(scope?.readTokens, scope?.suite) {
    val current = scope ?: return@LaunchedEffect
    if (!current.suite) return@LaunchedEffect
    // An array-contains-any over nothing is a query Firestore refuses: a member who reaches no site sees zeros.
    if (current.readTokens?.isEmpty() == true) {
      figures = GlanceFigures(0, 0, 0.0, 0, 0)
      return@LaunchedEffect
    }
    val now = nowMillis()
    val reader = context.firestore
    runCatching {
      coroutineScope {
        val contacts = async { reader.count(scopedQuery(current, "contacts", limit = 1)) ?: 0 }
        val week = async {
          reader.count(scopedQuery(current, "contacts", listOf(FirestoreFilter("createdAt", FilterOp.GTE, FirestoreTimestamp((now - 7 * DAY_MS) / 1000))), limit = 1)) ?: 0
        }
        val pipeline = async { reader.sum(scopedQuery(current, "deals", listOf(FirestoreFilter("status", FilterOp.EQ, "open")), limit = 1), "amountCents") ?: 0.0 }
        val tasks = async {
          reader.count(
            scopedQuery(current, "crmTasks", listOf(FirestoreFilter("status", FilterOp.EQ, "open"), FirestoreFilter("dueAtMs", FilterOp.LT, startOfLocalDay(now) + DAY_MS)), limit = 1),
          ) ?: 0
        }
        val leads = async { reader.count(scopedQuery(current, "leads", limit = 1)) ?: 0 }
        val closed = async {
          reader.count(scopedQuery(current, "leads", listOf(FirestoreFilter("status", FilterOp.IN, com.aglyn.contracts.Contracts.crmLeadClosedStatuses.map { it.raw })), limit = 1)) ?: 0
        }
        // Every lead less the closed ones: an untouched lead carries no status (`openLeadsFromCounts`).
        GlanceFigures(contacts.await(), week.await(), pipeline.await(), tasks.await(), maxOf(0, leads.await() - closed.await()))
      }
    }.onSuccess { figures = it; failed = false }.onFailure { failed = true }
  }
  StatsCard(Modifier.testTag(if (orgLevel) "crm-org-glance" else "crm-glance")) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text("CRM at a glance", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
      TextButton(onClick = { context.navigate(CrmSection.CONTACTS.screen) }, modifier = Modifier.testTag("crm-glance-open")) { Text("Open CRM") }
    }
    if (scope != null && !scope.suite) {
      UpgradeNotice(com.aglyn.core.upgradeNoticeMessage("CRM", "crm"), UpgradeKind.PLAN) { context.navigate("core.billing.plans") }
    } else {
      val f = figures
      fun value(text: String?) = if (failed) "—" else text
      StatFigures {
        val tile = Modifier.widthIn(min = space(14f))
        StatFigure(value(f?.contacts?.toString()), "Contacts", tile.clickable { context.navigate(CrmSection.CONTACTS.screen) })
        StatFigure(value(f?.newThisWeek?.toString()), "New this week", tile.clickable { context.navigate(CrmSection.CONTACTS.screen) })
        StatFigure(value(f?.let { money(it.pipelineCents) }), "Open pipeline", tile.clickable { context.navigate(CrmSection.DEALS.screen) })
        StatFigure(value(f?.tasksDue?.toString()), "Tasks due", tile.clickable { context.navigate(CrmSection.TASKS.screen) }, note = "today or overdue")
        StatFigure(
          value(f?.leadsToWork?.toString()), "Leads to work", tile.clickable { context.navigate(CrmSection.LEADS.screen) },
          note = if (orgLevel) "open across every site" else "open on this site",
        )
      }
      if (failed) {
        Text("The CRM figures could not be read. Open the CRM for the full picture.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }
}

/**
 * "Tasks due": the member's own overdue and due-today counts and the next five of their open tasks. Nothing at all on a
 * workspace that has never made a task (the console's probe), so the card never flashes in and out.
 */
@Composable
fun CrmTasksDueCard(context: NativePluginContext, orgLevel: Boolean) {
  val scope = (crmScopeLive(context, orgLevel) as? Live.Ready)?.value ?: return
  if (!scope.suite) return
  val probe by remember(scope.readTokens) {
    context.firestore.observe(scopedQuery(scope, "crmTasks", listOf(FirestoreFilter("status", FilterOp.EQ, "open")), limit = 1))
  }.collectAsState(Live.Loading)
  if ((probe as? Live.Ready)?.value.isNullOrEmpty()) return
  val mine by remember(scope.readTokens, scope.uid) {
    context.firestore.observe(tasksQuery(scope, taskViewPlan(TaskView.MINE, nowMillis(), scope.uid), "", 100))
  }.collectAsState(Live.Loading)
  val tasks = (mine as? Live.Ready)?.value?.map(::taskOf)
  val today = startOfLocalDay(nowMillis())
  val overdue = tasks?.count { (it.dueAtMs ?: Long.MAX_VALUE) < today }
  val dueToday = tasks?.count { (it.dueAtMs ?: -1) >= today && (it.dueAtMs ?: Long.MAX_VALUE) < today + DAY_MS }
  val palette = LocalAglynPalette.current
  StatsCard(Modifier.testTag(if (orgLevel) "crm-org-tasks-due" else "crm-tasks-due")) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text("Tasks due", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
      TextButton(onClick = { context.navigate(CrmSection.TASKS.screen) }, modifier = Modifier.testTag("crm-tasks-due-view-all")) { Text("View all") }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(space(3f))) {
      StatFigure(
        overdue?.let { if ((tasks.size) >= 100) "$it+" else it.toString() }, "Overdue",
        valueColor = if ((overdue ?: 0) > 0) palette.error.text else null,
      )
      StatFigure(dueToday?.toString(), "Due today", valueColor = if ((dueToday ?: 0) > 0) palette.warning.text else null)
    }
    when {
      tasks == null -> Unit
      tasks.isEmpty() -> Text("Nothing is assigned to you.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      else -> Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
        tasks.take(5).forEach { task ->
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            Icon(AglynIcons.named("task"), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(task.title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
            task.dueAtMs?.let { due ->
              Text(
                com.aglyn.contracts.formatLocalDay(due, "MMM d"),
                style = MaterialTheme.typography.bodySmall,
                color = if (due < today) palette.error.text else MaterialTheme.colorScheme.onSurfaceVariant,
              )
            }
          }
        }
      }
    }
  }
}
