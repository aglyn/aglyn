package com.aglyn.plugins.crm

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.ScreenLayout
import com.aglyn.pluginhost.WidgetSize
import com.aglyn.ui.MetricCard

/**
 * The CRM plugin's native registration: the same ids its
 * `mobile.contributes` declares in plugins.config.json.
 *
 * Every section of the console's CRM hub is a screen (contacts, leads,
 * companies, deals with the pipeline board, tasks, reports, fields and
 * settings), each record kind has a screen a link or a notification opens,
 * the Home cards are the console's CRM glance and tasks-due cards, and the
 * console's CRM links resolve to the same screens.
 */
fun registerCrmNative(r: NativePluginRegistrar) {
  for (section in CrmSection.entries) {
    r.screen(section.screen, title = if (section == CrmSection.CONTACTS) "CRM" else section.label, requiresSite = true, icon = section.icon, layout = ScreenLayout.LIST_DETAIL) { context, params ->
      CrmHubScreen(context, section, params)
    }
  }
  for (kind in CrmKind.entries) {
    r.screen(kind.detailScreen, title = kind.singular, requiresSite = true, icon = kind.icon) { context, params ->
      val id = params[kind.param] ?: params["${kind.param}Id"] ?: params["id"]
      if (id == null) {
        CrmHubScreen(context, CrmSection.entries.first { it.screen == kind.listScreen })
      } else {
        CrmGate(context) { scope, api, reference -> RecordDetail(context, kind, id, scope, api, reference) }
      }
    }
  }
  r.widget("crm.glance", title = "CRM", order = 70, size = WidgetSize.HALF, requiresSite = true) { context -> CrmGlanceWidget(context) }
  r.widget("crm.tasks-due", title = "Tasks due", order = 72, size = WidgetSize.HALF, requiresSite = true) { context -> TasksDueWidget(context) }
  r.quickAction("crm.open", "CRM", "group", 70, requiresSite = true, screen = CrmSection.CONTACTS.screen)
  r.quickAction("crm.deals-action", "Deals", "handshake", 72, requiresSite = true, screen = CrmSection.DEALS.screen)
  r.quickAction("crm.tasks-action", "Tasks", "task", 74, requiresSite = true, screen = CrmSection.TASKS.screen)
  r.deepLink("crm.page", path = "/crm", screen = CrmSection.CONTACTS.screen)
  r.deepLink("crm.legacy-contacts", path = "/contacts", screen = CrmSection.CONTACTS.screen)
  for (section in CrmSection.entries) r.deepLink("crm.${section.key}-page", path = "/crm/${section.key}", screen = section.screen)
  for (kind in CrmKind.entries) r.deepLink("crm.${kind.param}-page", path = "/crm/${kind.collection}/:${kind.param}", screen = kind.detailScreen)
}

@Composable
private fun <T> scopedCount(context: NativePluginContext, key: String, read: (CrmScope) -> com.aglyn.core.FirestoreQuery, map: (List<com.aglyn.core.FirestoreDoc>) -> T): Live<T>? {
  val orgId = context.orgId ?: return null
  val hostId = context.hostId ?: return null
  val scopeLive = remember(orgId, hostId) { observeCrmScope(context.firestore, orgId, hostId, context.uid) }.collectAsState(Live.Loading).value
  val scope = (scopeLive as? Live.Ready)?.value ?: return if (scopeLive is Live.Failed) scopeLive else Live.Loading
  if (!scope.suite) return Live.Failed(IllegalStateException("The CRM is included from Starter."))
  val docs = remember(key, scope.readTokens) { context.firestore.observe(read(scope)) }.collectAsState(Live.Loading).value
  return when (docs) {
    Live.Loading -> Live.Loading
    is Live.Failed -> docs
    is Live.Ready -> Live.Ready(map(docs.value))
  }
}

/** Home's CRM card: the open leads this site may see, as the console's glance card counts them. */
@Composable
fun CrmGlanceWidget(context: NativePluginContext) {
  val open = scopedCount(context, "glance", { scope ->
    scopedQuery(scope, "leads", listOf(FirestoreFilter("status", FilterOp.IN, com.aglyn.contracts.Contracts.nativeCrmLeadOpenStatuses)), limit = 100)
  }) { it.size }
  MetricCard(
    title = "Open leads",
    value = (open as? Live.Ready)?.value?.let { if (it >= 100) "100+" else it.toString() },
    caption = (open as? Live.Ready)?.value?.let { if (it == 1) "lead to work" else "leads to work" },
    icon = "person_add",
    actionLabel = "Open leads",
    modifier = Modifier.fillMaxSize().testTag("crm-glance"),
    loading = open is Live.Loading,
    error = (open as? Live.Failed)?.error?.message,
    onClick = { context.navigate(CrmSection.LEADS.screen) },
  )
}

/** Home's tasks card: the member's open tasks due by the end of today. */
@Composable
fun TasksDueWidget(context: NativePluginContext) {
  val due = scopedCount(context, "due", { scope ->
    val plan = taskViewPlan(TaskView.MINE, nowMillis(), scope.uid)
    tasksQuery(scope, plan, "", 100)
  }) { docs -> val end = startOfLocalDay(nowMillis()) + 86_400_000L; docs.map(::taskOf).count { (it.dueAtMs ?: Long.MAX_VALUE) < end } }
  MetricCard(
    title = "Tasks due",
    value = (due as? Live.Ready)?.value?.toString(),
    caption = (due as? Live.Ready)?.value?.let { if (it == 1) "task due today or overdue" else "tasks due today or overdue" },
    icon = "task",
    actionLabel = "Open tasks",
    modifier = Modifier.fillMaxSize().testTag("crm-tasks-due"),
    loading = due is Live.Loading,
    error = (due as? Live.Failed)?.error?.message,
    onClick = { context.navigate(CrmSection.TASKS.screen) },
  )
}
