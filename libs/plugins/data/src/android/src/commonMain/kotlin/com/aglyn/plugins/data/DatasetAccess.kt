package com.aglyn.plugins.data

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import com.aglyn.contracts.permissionRefusalText
import com.aglyn.contracts.sitePermissions
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.rememberMemberPermissions
import com.aglyn.pluginhost.rememberOrgAccess
import kotlinx.coroutines.flow.flowOf

/** The one site `visibleTo` places a dataset on, or null for every site, several or none (`oneSitePlacement`). */
fun oneSitePlacement(visibleTo: List<String>?): String? =
  visibleTo?.singleOrNull()?.takeIf { Regex("^host:[^:/]+$").matches(it) }?.removePrefix("host:")

/** What the signed-in member can do with one dataset, and what a refused press says (`datasetAccessBlocked`). */
data class DatasetAccess(
  val canWrite: Boolean,
  val writeRefusal: String,
  /** Writes are off, and who it is shared with stays theirs: a site narrows a holder of "Manage data". */
  val sharingOnly: Boolean,
  val canDelete: Boolean,
  val deleteRefusal: String,
  val canRead: Boolean,
  val canExport: Boolean,
)

private val SITE_ROLE_RANK = mapOf("viewer" to 0, "author" to 1, "editor" to 2, "admin" to 3, "owner" to 3)

/**
 * The verdict for a dataset, as the rule `canWriteDatasetOn` and the routes give it. The workspace key admits, unless a
 * site narrows the member on the one site the dataset sits on; else, on that one site, the site key. Placed on every site
 * or several, the workspace key alone. For what to show only: the rules and routes decide.
 */
fun datasetAccess(
  workspace: Map<String, Boolean>,
  orgWide: Boolean,
  orgRole: String?,
  visibleTo: List<String>?,
  site: Map<String, Any?>?,
  uid: String,
): DatasetAccess {
  val host = oneSitePlacement(visibleTo)
  val onSite = sitePermissions(workspace, site, uid)
  val siteRole = (site?.get("memberRoles") as? Map<*, *>)?.get(uid) as? String
  val narrowed = orgWide && host != null && siteRole != null &&
    (SITE_ROLE_RANK[siteRole] ?: 0) < (SITE_ROLE_RANK[orgRole] ?: 0)
  fun verdict(workspaceKey: String, siteKey: String): Boolean {
    val held = workspace[workspaceKey] == true
    if (host == null) return held
    return (held && !narrowed) || onSite[siteKey] == true
  }
  val canWrite = verdict("data.manage", "data.siteManage")
  val beyond = !orgWide && host == null
  return DatasetAccess(
    canWrite = canWrite,
    writeRefusal = permissionRefusalText(if (host != null) "data.siteManage" else "data.manage"),
    sharingOnly = !canWrite && workspace["data.manage"] == true && orgWide,
    canDelete = !beyond && verdict("org.eraseRecords", "data.siteDelete"),
    deleteRefusal = when {
      beyond -> "This dataset is shared beyond one site, so deleting it takes access to every site in the workspace."
      host != null -> permissionRefusalText("data.siteDelete")
      else -> permissionRefusalText("org.eraseRecords")
    },
    canRead = workspace["data.viewRecords"] == true,
    canExport = workspace["data.export"] == true,
  )
}

/** [datasetAccess], live, for a dataset at [visibleTo]. */
@Composable
fun rememberDatasetAccess(context: NativePluginContext, orgId: String, visibleTo: List<String>?): DatasetAccess {
  val workspace = rememberMemberPermissions(context).workspace
  val member = rememberOrgAccess(context, orgId)
  val host = oneSitePlacement(visibleTo)
  val site by remember(host, context.firestore) {
    if (host != null) context.firestore.observeDoc("hosts/$host") else flowOf(Live.Loading)
  }.collectAsState(Live.Loading)
  val data = (site as? Live.Ready)?.value?.data
  return datasetAccess(workspace, (member as? Live.Ready)?.value?.orgWide == true, context.orgRole, visibleTo, data, context.uid)
}
