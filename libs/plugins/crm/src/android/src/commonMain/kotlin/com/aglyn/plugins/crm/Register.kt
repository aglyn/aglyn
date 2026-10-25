package com.aglyn.plugins.crm

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.ScreenLayout
import com.aglyn.pluginhost.WidgetSize

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
    r.screen(section.screen, title = if (section == CrmSection.CONTACTS) "CRM" else section.label, requiresSite = false, icon = section.icon, layout = ScreenLayout.LIST_DETAIL) { context, params ->
      CrmHubScreen(context, section, params)
    }
  }
  for (kind in CrmKind.entries) {
    r.screen(kind.detailScreen, title = kind.singular, requiresSite = false, icon = kind.icon) { context, params ->
      val id = params[kind.param] ?: params["${kind.param}Id"] ?: params["id"]
      if (id == null) {
        CrmHubScreen(context, CrmSection.entries.first { it.screen == kind.listScreen })
      } else {
        CrmGate(context) { scope, api, reference -> RecordDetail(context, kind, id, scope, api, reference) }
      }
    }
  }
  r.widget("crm.glance", title = "CRM at a glance", order = 70, size = WidgetSize.FULL, requiresSite = true) { context -> CrmAtAGlanceCard(context, orgLevel = false) }
  r.widget("crm.tasks-due", title = "Tasks due", order = 72, size = WidgetSize.HALF, requiresSite = true) { context -> CrmTasksDueCard(context, orgLevel = false) }
  // The same two cards on the workspace's Home, totaling every site (the console's `orgDashboard` row).
  r.widget("crm.org-glance", title = "CRM at a glance", order = 70, size = WidgetSize.FULL, slot = CRM_ORG_DASHBOARD_SLOT) { context -> CrmAtAGlanceCard(context, orgLevel = true) }
  r.widget("crm.org-tasks-due", title = "Tasks due", order = 72, size = WidgetSize.HALF, slot = CRM_ORG_DASHBOARD_SLOT) { context -> CrmTasksDueCard(context, orgLevel = true) }
  r.quickAction("crm.open", "CRM", "group", 70, requiresSite = true, screen = CrmSection.CONTACTS.screen)
  r.quickAction("crm.deals-action", "Deals", "handshake", 72, requiresSite = true, screen = CrmSection.DEALS.screen)
  r.quickAction("crm.tasks-action", "Tasks", "task", 74, requiresSite = true, screen = CrmSection.TASKS.screen)
  r.deepLink("crm.page", path = "/crm", screen = CrmSection.CONTACTS.screen)
  r.deepLink("crm.legacy-contacts", path = "/contacts", screen = CrmSection.CONTACTS.screen)
  for (section in CrmSection.entries) r.deepLink("crm.${section.key}-page", path = "/crm/${section.key}", screen = section.screen)
  for (kind in CrmKind.entries) r.deepLink("crm.${kind.param}-page", path = "/crm/${kind.collection}/:${kind.param}", screen = kind.detailScreen)
}
