package com.aglyn.core

import com.aglyn.contracts.Contracts

/**
 * Which cards a person keeps on a site's Home and in what order, per workspace: the console's Customize dashboard
 * (`users/{uid}.dashboardWidgets.{orgId}` = `{hidden, order}`). A preference, never a limit: it only removes cards the
 * plugins already put there and reorders what remains, and an id naming no card is matched against nothing.
 */
data class DashboardWidgetPrefs(val hidden: List<String> = emptyList(), val order: List<String> = emptyList()) {
  /** What a save writes under the workspace's key: both lists, always (a merge keeps an omitted key's stored value). */
  val stored: Map<String, Any?> get() = mapOf("hidden" to hidden, "order" to order)

  companion object {
    val EMPTY = DashboardWidgetPrefs()
  }
}

/**
 * The ports of the console's dashboard-widget rules (`libs/aglyn/src/lib/app-utils/dashboard-widget-prefs.ts`),
 * replayed from function-cases.generated.json. The Apple core's DashboardWidgets.swift.
 */
object DashboardWidgets {
  /** The `users/{uid}` field that keeps every workspace's arrangement. */
  val field: String get() = Contracts.dashboardWidgetsField

  /** The Traffic card's id, which the console renders itself. */
  val trafficId: String get() = Contracts.hostAnalyticsWidgetId

  /**
   * The console's id for each native Home card that is one of its dashboard cards, so a card hidden or moved on the
   * web is hidden or moved here and the other way round. A card the console does not draw keeps its own id, which the
   * console matches against nothing.
   */
  val consoleIds: Map<String, String> = mapOf(
    "commerce.glance" to "commerce-glance",
    "commerce.newest-site-users" to "accounts-newest-site-users",
    "inbox.glance" to "inbox-glance",
    "crm.glance" to "crm-glance",
    "crm.tasks-due" to "crm-tasks-due",
    "ai.insight-ask" to "ai-insight-ask",
  )

  /** The Recent activity card: the console's `hostActivity` slot card. */
  const val ACTIVITY_ID = "workflows-host-activity"

  /** The id a native Home card is stored under. */
  fun storedId(nativeId: String): String = consoleIds[nativeId] ?: nativeId

  /** `readDashboardWidgetPrefs`: the workspace's arrangement from the stored field, or none. */
  fun read(stored: Any?, orgId: String?): DashboardWidgetPrefs {
    if (orgId.isNullOrEmpty()) return DashboardWidgetPrefs.EMPTY
    val entry = (stored as? Map<*, *>)?.get(orgId) as? Map<*, *> ?: return DashboardWidgetPrefs.EMPTY
    return DashboardWidgetPrefs(idList(entry["hidden"]), idList(entry["order"]))
  }

  /** `isDashboardWidgetHidden`. */
  fun isHidden(prefs: DashboardWidgetPrefs, widgetId: String): Boolean = widgetId in prefs.hidden

  /** `orderDashboardWidgets`: the ranked ids first in their rank, the rest after in the order they came. */
  fun <T> ordered(widgets: List<T>, order: List<String>, id: (T) -> String): List<T> {
    val rank = HashMap<String, Int>()
    order.forEachIndexed { index, widgetId -> rank[widgetId] = index }
    return widgets.withIndex()
      .sortedWith(compareBy<IndexedValue<T>>({ rank[id(it.value)] ?: Int.MAX_VALUE }, { it.index }))
      .map { it.value }
  }

  /** `setDashboardWidgetHidden`: a hidden id goes to the end of the list, a shown one leaves it. */
  fun setHidden(prefs: DashboardWidgetPrefs, widgetId: String, hidden: Boolean): DashboardWidgetPrefs {
    val without = prefs.hidden.filter { it != widgetId }
    return prefs.copy(hidden = if (hidden) without + widgetId else without)
  }

  /** `moveDashboardWidget`: moves [widgetId] by [delta] within its group, whose ranks are rewritten after every other. */
  fun move(prefs: DashboardWidgetPrefs, groupIds: List<String>, widgetId: String, delta: Int): DashboardWidgetPrefs {
    val from = groupIds.indexOf(widgetId)
    val to = from + delta
    if (from < 0 || to < 0 || to >= groupIds.size) return prefs
    val moved = groupIds.toMutableList().apply { removeAt(from); add(to, widgetId) }
    val group = groupIds.toSet()
    return prefs.copy(order = prefs.order.filter { it !in group } + moved)
  }

  private fun idList(value: Any?): List<String> = (value as? List<*>)?.filterIsInstance<String>().orEmpty()
}
