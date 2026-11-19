package com.aglyn.core

/**
 * The workspace picker's filters (the console's `WORKSPACE_FILTER_FIELDS`, apps/console/utils/workspace-list.ts): the
 * workspace's plan, the person's role in it, and whether they pinned it, each an exact match over the workspaces loaded.
 */
data class WorkspacePickerFilter(val plan: String? = null, val role: String? = null, val pinned: Boolean? = null) {
  /** How many filters are on. */
  val count: Int get() = listOf(plan != null, role != null, pinned != null).count { it }
  val isOn: Boolean get() = count > 0

  /** Whether a workspace passes: [orgPlan] is its resolved plan (null until read, which no Plan filter admits). */
  fun admits(org: WorkspaceOrg, orgPlan: String?, isPinned: Boolean): Boolean =
    (plan == null || orgPlan == plan) && (role == null || org.role == role) && (pinned == null || isPinned == pinned)

  companion object {
    /** The headers the console's panel uses. */
    val HEADERS = mapOf("plan" to "Plan", "role" to "Your role", "pinned" to "Pinned")

    /** The plans in the console's order (`PLAN_LABELS`), by their labels. */
    val PLANS: List<Pair<String, String>> get() =
      listOf("free", "starter", "pro", "business", "scale", "advanced", "agency", "enterprise").map { it to (BundleWords.planLabels[it] ?: it.replaceFirstChar(Char::uppercase)) }

    val ROLES = listOf("owner" to "Owner", "admin" to "Admin", "editor" to "Editor", "viewer" to "Viewer")
  }
}
