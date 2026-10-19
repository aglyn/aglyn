package com.aglyn.shell

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.NativeNavCreateScope
import com.aglyn.contracts.ResolvedCreateItem
import com.aglyn.contracts.resolveCreateList
import com.aglyn.core.Live
import com.aglyn.core.WorkspaceState
import com.aglyn.core.planFeatureCarried
import com.aglyn.ui.AglynIcons

/** What the "+" is checked against: the member's permissions, the workspace's plan features and the site role. */
internal data class CreateGates(val permissions: Map<String, Boolean>, val features: Map<String, Boolean>, val hostRole: String?)

private fun layerOf(value: Any?): com.aglyn.contracts.OrgPermissionLayer? =
  (value as? Map<*, *>)?.mapNotNull { (k, v) -> (v as? Boolean)?.let { k.toString() to it } }?.toMap()
    ?.let { com.aglyn.contracts.OrgPermissionLayer(permissions = it) }

/**
 * The member's permissions as the console resolves them (the contract's `rolePermissions` over ORG_ROLE_GRANTS): their
 * role's grants, then their custom role's values, then their own overrides.
 */
internal fun memberPermissions(member: Map<String, Any?>?, orgRole: String?, customRole: Map<String, Any?>? = null): Map<String, Boolean> {
  if (member == null && orgRole == null) return emptyMap()
  val role = member?.get("role") as? String ?: orgRole
  val custom = if (member?.get("roleId") != null) layerOf(customRole?.get("permissions")) else null
  return com.aglyn.contracts.rolePermissions(role, custom, layerOf(member?.get("permissions")))
}

/** The site role the "+" checks: the workspace's owners and admins administer every site. */
internal fun createHostRole(siteRole: String?, orgRole: String?): String? =
  if (orgRole == "owner" || orgRole == "admin") "admin" else siteRole

@Composable
internal fun rememberCreateGates(services: ShellServices, workspace: WorkspaceState, uid: String): CreateGates {
  val orgId = workspace.org?.id
  val member by remember(orgId, uid) { orgId?.let { services.firestore.observeDoc("orgs/$it/members/$uid") } ?: kotlinx.coroutines.flow.flowOf(Live.Loading) }
    .collectAsState(Live.Loading)
  val org by remember(orgId) { orgId?.let { services.firestore.observeDoc("orgs/$it") } ?: kotlinx.coroutines.flow.flowOf(Live.Loading) }
    .collectAsState(Live.Loading)
  val memberData = (member as? Live.Ready)?.value?.data
  val roleId = memberData?.get("roleId") as? String
  val customRole by remember(orgId, roleId) { if (orgId != null && roleId != null) services.firestore.observeDoc("orgs/$orgId/roles/$roleId") else kotlinx.coroutines.flow.flowOf(Live.Loading) }
    .collectAsState(Live.Loading)
  val orgData = (org as? Live.Ready)?.value?.data
  val features = remember(orgData) {
    val asked = com.aglyn.contracts.NativeNavManifestValue.create.orEmpty().flatMap { it.items }.mapNotNull { it.planFeature }.toSet()
    asked.associateWith { planFeatureCarried(orgData, it) }
  }
  return CreateGates(
    permissions = memberPermissions(memberData, workspace.org?.role, (customRole as? Live.Ready)?.value?.data),
    features = features,
    hostRole = createHostRole(workspace.site?.role, workspace.org?.role),
  )
}

/**
 * What the "+" lists for one scope, from the manifest (`resolveCreateList`): a plugin that is off hides its item, a
 * missing permission, role or plan shows it with why. An item whose screen this build does not carry is left out.
 */
internal fun createEntries(services: ShellServices, scope: NativeNavCreateScope, enabled: Collection<String>, gates: CreateGates): List<ResolvedCreateItem> =
  resolveCreateList(scope, enabled, gates.permissions, gates.features, gates.hostRole)
    .filter { services.registry.screen(it.screen) != null }
    .sortedBy { it.order ?: Double.MAX_VALUE }

/** The Create menu from the rail's "+": the create actions for the scope on screen, the blocked ones disabled with why. */
@Composable
internal fun CreateMenu(services: ShellServices, workspace: WorkspaceState, chrome: NavChromeState, enabled: Collection<String>, uid: String, actions: ShellActions) {
  DropdownMenu(chrome.createMenu, onDismissRequest = { chrome.createMenu = false }, modifier = Modifier.widthIn(min = 240.dp).testTag("create-menu")) {
    CreateMenuItems(services, workspace, enabled, uid) { item ->
      chrome.createMenu = false
      actions.openScreen(item.screen, item.params ?: mapOf("new" to "1"))
    }
  }
}

/**
 * The "+" menu's items, as the design lays them out: inside a site, the site's items under its name, then the
 * workspace's under the workspace's name; in the whole workspace, the workspace's alone.
 */
@Composable
internal fun CreateMenuItems(services: ShellServices, workspace: WorkspaceState, enabled: Collection<String>, uid: String, onPick: (ResolvedCreateItem) -> Unit) {
  val gates = rememberCreateGates(services, workspace, uid)
  val orgEnabled = enabledPluginsFor(workspace.orgLogo?.enabledPlugins, null, false)
  val sections = buildList {
    workspace.site?.let { add(it.name to createEntries(services, NativeNavCreateScope.SITE, enabled, gates)) }
    add((workspace.org?.name ?: "this workspace") to createEntries(services, NativeNavCreateScope.WORKSPACE, if (workspace.site != null) orgEnabled else enabled, gates))
  }
  sections.forEachIndexed { index, (scopeName, entries) ->
    if (index > 0) HorizontalDivider()
    Text("In $scopeName", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
    for (item in entries) {
      DropdownMenuItem(
        text = {
          Column {
            Text(item.label)
            item.reason?.takeIf { item.blocked }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
          }
        },
        leadingIcon = { Icon(AglynIcons.named(item.icon.android), null) },
        enabled = !item.blocked,
        onClick = { onPick(item) },
        modifier = Modifier.testTag(if (index == 0 && workspace.site != null) "create-${item.id}" else "create-workspace-${item.id}"),
      )
    }
  }
}
