package com.aglyn.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aglyn.contracts.isSearchableQuery
import com.aglyn.contracts.scoreMatch
import com.aglyn.core.PinAnswer
import com.aglyn.core.WorkspaceOrg
import com.aglyn.core.WorkspaceSite
import com.aglyn.core.WorkspaceState
import com.aglyn.core.mediaPreviewUrl
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.BrandPicture
import com.aglyn.ui.TextButton
import com.aglyn.ui.WorkspaceTile
import kotlinx.coroutines.launch

/** How many workspaces the picker's A–Z list shows before "Show more". */
private const val PICKER_PAGE = 50

/**
 * The scope picker, in two steps: a workspace (search, Pinned, Recent, everyone else A to Z 50 at a time), then one of
 * its sites (recent first, the whole workspace, View all sites, Create site). A dialog on wide windows, the whole screen on
 * a phone. [twoStep]: picking a workspace goes on to its sites (phones); otherwise it opens the workspace at once.
 * [onOpenWorkspace]: a workspace opened whole lands on its Home, as a rail tile does, never on a page that needs a site.
 */
@Composable
internal fun ScopePicker(
  services: ShellServices,
  workspace: WorkspaceState,
  chrome: NavChromeState,
  fullScreen: Boolean,
  twoStep: Boolean,
  onPinFull: (String) -> Unit,
  onOpenWorkspace: () -> Unit,
  onOpenScreen: (String) -> Unit,
) {
  val step = chrome.picker ?: return
  val close = { chrome.picker = null }
  Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = !fullScreen)) {
    Surface(
      shape = if (fullScreen) RoundedCornerShape(0.dp) else MaterialTheme.shapes.large,
      color = MaterialTheme.colorScheme.surfaceContainerLow,
      modifier = (if (fullScreen) Modifier.fillMaxSize() else Modifier.widthIn(min = 420.dp, max = 520.dp).heightIn(max = 640.dp)).testTag("scope-picker"),
    ) {
      Column {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
          if (step == PickerStep.SITE && twoStep) {
            TextButton(onClick = { chrome.picker = PickerStep.WORKSPACE }, modifier = Modifier.testTag("picker-back")) { Text("Back") }
          } else {
            Box(Modifier.size(48.dp))
          }
          Text(
            if (step == PickerStep.WORKSPACE) "Switch" else workspace.org?.name ?: "Sites",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
          )
          TextButton(onClick = close, modifier = Modifier.testTag("picker-done")) { Text("Done") }
        }
        when (step) {
          PickerStep.WORKSPACE -> WorkspaceStep(services, workspace, onPinFull, { screen -> close(); onOpenScreen(screen) }) { org ->
            services.workspace.selectOrg(org.id)
            if (twoStep) chrome.picker = PickerStep.SITE else { close(); onOpenWorkspace() }
          }
          PickerStep.SITE -> SiteStep(services, workspace, close, { close(); onOpenWorkspace() }, onOpenScreen)
        }
      }
    }
  }
}

@Composable
private fun SearchField(value: String, placeholder: String, tag: String, onChange: (String) -> Unit) {
  val focus = remember { FocusRequester() }
  LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
  OutlinedTextField(
    value,
    onValueChange = onChange,
    placeholder = { Text(placeholder) },
    leadingIcon = { Icon(AglynIcons.named("search"), null) },
    singleLine = true,
    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
    shape = RoundedCornerShape(10.dp),
    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).focusRequester(focus).testTag(tag),
  )
}

@Composable
private fun PickerHeading(text: String) {
  Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 20.dp, top = 14.dp, bottom = 4.dp))
}

@Composable
private fun WorkspaceStep(services: ShellServices, workspace: WorkspaceState, onPinFull: (String) -> Unit, onOpenScreen: (String) -> Unit, onPick: (WorkspaceOrg) -> Unit) {
  val prefs by services.accountPrefs.state.collectAsState()
  var query by remember { mutableStateOf("") }
  var shown by remember { mutableIntStateOf(PICKER_PAGE) }
  LaunchedEffect(workspace.orgs.size) { services.workspace.loadLogos(workspace.orgs.map { it.id }) }
  val byId = workspace.orgs.associateBy { it.id }
  val pinned = prefs.pinned.mapNotNull { byId[it] }
  val recent = prefs.recentOrgs.filter { it !in prefs.pinned }.mapNotNull { byId[it] }.take(3)
  val searching = isSearchableQuery(query) || query.length == 1
  val matches = if (searching) {
    workspace.orgs.mapNotNull { org -> scoreMatch(org.name, listOf(org.slug), query)?.let { it to org } }
      .sortedWith { a, b -> com.aglyn.contracts.scoredOrder.compare(a.first to a.second.name, b.first to b.second.name) }.map { it.second }
  } else {
    emptyList()
  }
  SearchField(query, "Find a workspace", "picker-workspace-search") { query = it }
  LazyColumn(Modifier.fillMaxWidth()) {
    if (searching) {
      if (matches.isEmpty()) item { PickerHeading(if (workspace.hasMoreOrgs) "No match in the workspaces loaded. Show more to look further." else "No workspace matches") }
      items(matches, key = { "m-${it.id}" }) { org -> WorkspaceRow(services, workspace, org, prefs.pinned, onPinFull, onPick) }
    } else {
      if (pinned.isNotEmpty()) {
        item { PickerHeading("Pinned ${pinned.size} of ${com.aglyn.contracts.Contracts.pinnedOrgsMax}") }
        items(pinned, key = { "p-${it.id}" }) { org -> WorkspaceRow(services, workspace, org, prefs.pinned, onPinFull, onPick) }
      }
      if (recent.isNotEmpty()) {
        item { PickerHeading("Recent") }
        items(recent, key = { "r-${it.id}" }) { org -> WorkspaceRow(services, workspace, org, prefs.pinned, onPinFull, onPick) }
      }
      val rest = workspace.orgs.filter { it.id !in prefs.pinned && recent.none { r -> r.id == it.id } }
      item { PickerHeading("All workspaces · ${workspace.orgs.size}${if (workspace.hasMoreOrgs) "+" else ""}") }
      items(rest.take(shown), key = { "a-${it.id}" }) { org -> WorkspaceRow(services, workspace, org, prefs.pinned, onPinFull, onPick) }
      if (rest.size > shown || workspace.hasMoreOrgs) {
        item {
          TextButton(
            onClick = { if (rest.size > shown) shown += PICKER_PAGE else services.workspace.loadMoreOrgs() },
            modifier = Modifier.padding(horizontal = 12.dp).testTag("picker-show-more"),
          ) { Text("Show more · ${minOf(shown, rest.size)} of ${rest.size}${if (workspace.hasMoreOrgs) "+" else ""}") }
        }
      }
    }
    item {
      HorizontalDivider(Modifier.padding(vertical = 6.dp))
      AddWorkspaceRow(services)
      // A workspace someone invited the person to is joined from their invitations (the console's pending-invites list).
      PickerRow("Invitations", "Join a workspace you were invited to", false, "picker-invitations", leading = { Icon(AglynIcons.named("mail"), null, Modifier.size(24.dp)) }) {
        onOpenScreen("core.invites.mine")
      }
    }
  }
}

@Composable
private fun WorkspaceRow(
  services: ShellServices,
  workspace: WorkspaceState,
  org: WorkspaceOrg,
  pinned: List<String>,
  onPinFull: (String) -> Unit,
  onPick: (WorkspaceOrg) -> Unit,
) {
  val prefs by services.accountPrefs.state.collectAsState()
  val (light, dark) = orgLogoUrls(workspace, org.id, services.api.origin)
  val (color) = rememberWorkspaceColor(org.id, workspace, prefs, services.api.origin)
  val isPinned = org.id in pinned
  val index = pinned.indexOf(org.id)
  PickerRow(
    title = org.name,
    detail = orgDetail(org, workspace),
    selected = org.id == workspace.org?.id,
    tag = "picker-org-${org.id}",
    leading = { WorkspaceTile(org.name, light, dark, color, size = 36.dp) },
    trailing = {
      TextButton(
        onClick = { if (isPinned) services.accountPrefs.unpin(org.id) else if (services.accountPrefs.pin(org.id) == PinAnswer.FULL) onPinFull(org.id) },
        modifier = Modifier.testTag("picker-pin-${org.id}").semantics { contentDescription = if (isPinned) "Unpin ${org.name}" else "Pin ${org.name}" },
      ) {
        Icon(AglynIcons.named("keep"), null, Modifier.size(16.dp))
        val showKeys = LocalShowShortcuts.current
        Text(if (isPinned) " Pinned" + if (index in 0..4 && showKeys) "  ${shortcutLabel(index + 1)}" else "" else " Pin", style = MaterialTheme.typography.labelMedium)
      }
    },
  ) { onPick(org) }
}

@Composable
private fun SiteStep(services: ShellServices, workspace: WorkspaceState, close: () -> Unit, openWhole: () -> Unit, onOpenScreen: (String) -> Unit) {
  val prefs by services.accountPrefs.state.collectAsState()
  var query by remember { mutableStateOf("") }
  val orgId = workspace.org?.id
  val recentIds = prefs.recents.filter { it.orgId == orgId }.mapNotNull { it.hostId }.distinct()
  val sites = workspace.sites
  val ordered = recentIds.mapNotNull { id -> sites.firstOrNull { it.id == id } } + sites.filter { it.id !in recentIds }
  val shownSites = if (query.isBlank()) ordered.take(PICKER_PAGE) else {
    sites.mapNotNull { site -> scoreMatch(site.name, listOf(site.subdomain), query)?.let { it to site } }
      .sortedWith { a, b -> com.aglyn.contracts.scoredOrder.compare(a.first to a.second.name, b.first to b.second.name) }.map { it.second }
  }
  SearchField(query, "Find a site", "picker-site-search") { query = it }
  LazyColumn(Modifier.fillMaxWidth()) {
    item { PickerHeading(if (query.isBlank()) (if (recentIds.isEmpty()) "Sites" else "Recent") else "Matching sites") }
    if (!workspace.ready) item { com.aglyn.ui.SkeletonList(rows = 2) }
    items(shownSites, key = { it.id }) { site -> SiteRow(services, workspace, site) { services.workspace.selectSite(site.id); close() } }
    if (query.isBlank()) {
      item {
        PickerRow(
          title = "The whole workspace",
          detail = "Sites, CRM, Inbox, Media, Data and more",
          selected = workspace.site == null,
          tag = "picker-whole-workspace",
          leading = { Icon(AglynIcons.named("grid_view"), null, Modifier.size(36.dp).padding(6.dp)) },
        ) { services.workspace.selectWholeWorkspace(); openWhole() }
        HorizontalDivider(Modifier.padding(vertical = 6.dp))
        PickerRow("View all sites", null, false, "picker-all-sites", leading = { Icon(AglynIcons.named("grid_view"), null, Modifier.size(24.dp)) }) {
          services.workspace.selectWholeWorkspace(); close(); onOpenScreen("site.sites")
        }
        PickerRow("Create site", null, false, "picker-create-site", leading = { Icon(AglynIcons.named("add"), null, Modifier.size(24.dp)) }) {
          services.workspace.selectWholeWorkspace(); close(); onOpenScreen("site.sites")
        }
      }
    }
  }
}

@Composable
private fun SiteRow(services: ShellServices, workspace: WorkspaceState, site: WorkspaceSite, onPick: () -> Unit) {
  PickerRow(
    title = site.name,
    detail = site.subdomain.ifEmpty { null },
    selected = site.id == workspace.site?.id,
    tag = "picker-site-${site.id}",
    leading = {
      BrandPicture(mediaPreviewUrl(site.favicon, services.api.origin, site.id, 96), null, 36.dp, RoundedCornerShape(10.dp)) {
        WorkspaceTile(site.name, null, null, null, size = 36.dp)
      }
    },
    onClick = onPick,
  )
}

@Composable
internal fun PickerRow(
  title: String,
  detail: String?,
  selected: Boolean,
  tag: String,
  leading: @Composable () -> Unit,
  trailing: (@Composable () -> Unit)? = null,
  onClick: () -> Unit,
) {
  NavPickerLine(title, detail, selected, tag, leading, trailing, onClick)
}

@Composable
private fun NavPickerLine(
  title: String,
  detail: String?,
  selected: Boolean,
  tag: String,
  leading: @Composable () -> Unit,
  trailing: (@Composable () -> Unit)?,
  onClick: () -> Unit,
) {
  Surface(
    onClick = onClick,
    color = if (selected) com.aglyn.ui.shellColors.selected else androidx.compose.ui.graphics.Color.Transparent,
    shape = RoundedCornerShape(10.dp),
    modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 1.dp).testTag(tag),
  ) {
    Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      leading()
      Column(Modifier.weight(1f)) {
        Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
      }
      trailing?.invoke()
      if (selected) Icon(AglynIcons.named("check"), contentDescription = "On screen", tint = MaterialTheme.colorScheme.primary)
    }
  }
}

/** Add workspace: a name, created as the console's switcher creates one (`/api/orgs/create`), then opened. */
@Composable
private fun AddWorkspaceRow(services: ShellServices) {
  var open by remember { mutableStateOf(false) }
  PickerRow("Add workspace", null, false, "picker-add-workspace", leading = { Icon(AglynIcons.named("add"), null, Modifier.size(24.dp)) }) { open = true }
  if (!open) return
  var name by remember { mutableStateOf("") }
  var error by remember { mutableStateOf<String?>(null) }
  var busy by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  AlertDialog(
    onDismissRequest = { if (!busy) open = false },
    modifier = Modifier.testTag("add-workspace-dialog"),
    title = { Text("Add a workspace") },
    text = {
      OutlinedTextField(
        name,
        onValueChange = { name = it; error = null },
        label = { Text("Workspace name") },
        singleLine = true,
        isError = error != null,
        supportingText = { Text(error ?: "A workspace holds your sites, team and billing.") },
        modifier = Modifier.fillMaxWidth().testTag("add-workspace-name"),
      )
    },
    confirmButton = {
      Button(shape = com.aglyn.ui.controlShape(), 
        enabled = name.isNotBlank() && !busy,
        onClick = {
          busy = true
          scope.launch {
            val outcome = services.signUp.createWorkspace(name)
            busy = false
            val created = outcome.orgId
            if (created != null) {
              services.workspace.select(created, null)
              open = false
            } else {
              error = outcome.error ?: "Could not create the workspace. Try again."
            }
          }
        },
        modifier = Modifier.testTag("add-workspace-create"),
      ) { Text("Create") }
    },
    dismissButton = { TextButton(onClick = { open = false }, enabled = !busy) { Text("Cancel") } },
  )
}
