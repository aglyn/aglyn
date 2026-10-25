package com.aglyn.shell

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.Button
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.AppAppearance
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.NativeNavListId
import com.aglyn.core.AuthUser
import com.aglyn.core.WorkspaceState
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.TextButton
import com.aglyn.ui.WorkspaceTile
import com.aglyn.ui.colorOfHex
import com.aglyn.ui.shellColors
import com.aglyn.ui.toHex

/** What the shell's menus do, bound once by the shell. */
internal class ShellActions(
  val openScreen: (screen: String, params: Map<String, String>) -> Unit,
  val enterSettings: (NativeNavListId) -> Unit,
  val openWeb: (String) -> Unit,
  val accountSettings: () -> Unit,
  val themeSettings: () -> Unit,
  val addAccount: () -> Unit,
  val switchAccount: (slot: String) -> Unit,
  val signOut: () -> Unit,
)

/** The workspace menu (its name ▾): who it is, then Invite people, Workspace settings, Billing and usage, Workspace color. */
@Composable
internal fun WorkspaceMenu(services: ShellServices, workspace: WorkspaceState, chrome: NavChromeState) {
  val org = workspace.org ?: return
  val actions = LocalShellActions.current ?: return
  val prefs = services.accountPrefs.state.collectAsState().value
  DropdownMenu(chrome.workspaceMenu, onDismissRequest = { chrome.workspaceMenu = false }, modifier = Modifier.widthIn(min = 260.dp).testTag("workspace-menu")) {
    val (light, dark) = orgLogoUrls(workspace, org.id, services.api.origin)
    val (color) = rememberWorkspaceColor(org.id, workspace, prefs, services.api.origin)
    Row(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      WorkspaceTile(org.name, light, dark, color, size = 40.dp)
      Column(Modifier.weight(1f)) {
        Text(org.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(workspaceAddress(services, org.slug), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        workspace.orgLogo?.plan?.let { PlanChip(it) }
      }
    }
    HorizontalDivider()
    MenuRow("Invite people", "person_add", tag = "workspace-menu-invite") { chrome.workspaceMenu = false; actions.openScreen("core.team", emptyMap()) }
    MenuRow("Workspace settings", "settings", trailing = shortcutText(",").takeIf { LocalShowShortcuts.current }, tag = "workspace-menu-settings") {
      chrome.workspaceMenu = false
      actions.enterSettings(NativeNavListId.WORKSPACE_SETTINGS)
    }
    MenuRow("Billing and usage", "credit_card", tag = "workspace-menu-billing") { chrome.workspaceMenu = false; actions.openScreen("core.billing", emptyMap()) }
    // The console's "Upgrade plan" (its user menu): once the plan is known, below the top plans, to an owner or admin.
    val logo = workspace.orgLogo
    if (logo?.plan != null && logo.plan !in setOf("agency", "enterprise") && !logo.enterprise && org.role in setOf("owner", "admin")) {
      androidx.compose.material3.Button(
        onClick = { chrome.workspaceMenu = false; actions.openScreen("core.billing", emptyMap()) },
        shape = com.aglyn.ui.controlShape(),
        colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.onSurface, contentColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).testTag("workspace-menu-upgrade"),
      ) { Text("Upgrade plan") }
    }
    HorizontalDivider()
    MenuRow("Workspace color", "palette", trailing = "›", tag = "workspace-menu-color") { chrome.workspaceMenu = false; chrome.colorFor = org.id }
  }
}

/** A workspace's console address, as the console's own switcher shows it. */
internal fun workspaceAddress(services: ShellServices, slug: String): String =
  services.config.consoleOrigin.removePrefix("https://").removePrefix("http://").trimEnd('/') + "/" + slug

internal val LocalShellActions = androidx.compose.runtime.staticCompositionLocalOf<ShellActions?> { null }

/**
 * The account menu (your photo): who you are, Theme, Settings, Marketplace, Documentation, Report an issue, then the
 * accounts signed in on this device with Add account, and Sign out (of the account on screen only).
 */
@Composable
internal fun AccountMenuItems(services: ShellServices, user: AuthUser?, close: () -> Unit) {
  val actions = LocalShellActions.current ?: return
  val prefs by services.accountPrefs.state.collectAsState()
  val accounts = services.accounts
  val signedIn = accounts?.accounts?.value.orEmpty()
  val active = accounts?.active?.value
  var themeOpen by remember { mutableStateOf(false) }
  Row(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
    AccountAvatar(user, size = 40, onClick = null)
    Column(Modifier.weight(1f)) {
      Text(user?.displayName?.takeIf { it.isNotBlank() } ?: user?.email ?: "Signed in", style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
      user?.email?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    }
  }
  HorizontalDivider()
  MenuRow("Appearance", "contrast", trailing = appearanceLabel(prefs.theme.appearance) + "  ›", tag = "account-menu-appearance") { themeOpen = !themeOpen }
  if (themeOpen) {
    for (appearance in Contracts.appAppearances) {
      MenuRow(
        appearanceLabel(appearance),
        if (prefs.theme.appearance == appearance) "check" else null,
        tag = "account-menu-appearance-${appearance.raw}",
      ) {
        services.accountPrefs.setTheme(prefs.theme.copy(appearance = appearance), deviceOnly = prefs.deviceTheme != null)
      }
    }
  }
  MenuRow("Theme", "palette", trailing = themeLabel(prefs.theme.theme, services.config.brandName), tag = "account-menu-theme") { close(); actions.themeSettings() }
  MenuRow("Settings", "settings", tag = "account-menu-settings") { close(); actions.accountSettings() }
  MenuRow("Marketplace", "storefront", tag = "account-menu-marketplace") { close(); actions.openScreen("marketplace.sell", emptyMap()) }
  MenuRow("Documentation", "article", tag = "account-menu-docs") { close(); actions.openWeb(helpLinks(services.config).first { it.id == "docs" }.url) }
  MenuRow("Report an issue", "bug_report", tag = "account-menu-report") { close(); actions.openScreen("core.support", emptyMap()) }
  if (accounts != null) {
    HorizontalDivider()
    Text("Accounts", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
    for (account in signedIn) {
      val current = account.slot == active
      androidx.compose.material3.DropdownMenuItem(
        text = {
          Column {
            Text(account.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
            account.email?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1) }
          }
        },
        leadingIcon = { AccountAvatar(AuthUser(account.uid, account.email, account.displayName), size = 28, onClick = null) },
        trailingIcon = if (current) ({ Icon(AglynIcons.named("check"), contentDescription = "On screen", tint = MaterialTheme.colorScheme.primary) }) else null,
        onClick = { close(); if (!current) actions.switchAccount(account.slot) },
        modifier = Modifier.testTag("account-menu-account-${account.slot}").semantics { selected = current },
      )
    }
    MenuRow("Add account", "person_add", enabled = accounts.canAdd, tag = "account-menu-add") { close(); actions.addAccount() }
  }
  HorizontalDivider()
  MenuRow("Sign out", "logout", tag = "sign-out") { close(); actions.signOut() }
}

/** The account menu as a dropdown from the rail's photo. */
@Composable
internal fun AccountMenu(services: ShellServices, user: AuthUser?, chrome: NavChromeState) {
  DropdownMenu(chrome.accountMenu, onDismissRequest = { chrome.accountMenu = false }, modifier = Modifier.widthIn(min = 280.dp).testTag("account-menu")) {
    AccountMenuItems(services, user) { chrome.accountMenu = false }
  }
}

internal fun appearanceLabel(appearance: AppAppearance): String = when (appearance) {
  AppAppearance.LIGHT -> "Light"
  AppAppearance.DARK -> "Dark"
  else -> "Match system"
}

/** "Pinned is full. Replace one?": the five pins, one to swap for the new one. Nothing is dropped quietly. */
@Composable
internal fun PinnedFullDialog(services: ShellServices, workspace: WorkspaceState, orgId: String, onDone: () -> Unit) {
  val prefs = services.accountPrefs.state.collectAsState().value
  val names = workspace.orgs.associate { it.id to it.name }
  val newName = names[orgId] ?: "this workspace"
  var replacing by remember { mutableStateOf<String?>(null) }
  AlertDialog(
    onDismissRequest = onDone,
    modifier = Modifier.testTag("pinned-full-dialog"),
    title = { Text("Pinned is full. Replace one?") },
    text = {
      Column {
        Text("You can pin five workspaces. Pick one to make room for $newName.", style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(12.dp))
        for ((index, id) in prefs.pinned.withIndex()) {
          Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
              .background(if (replacing == id) shellColors.selected else Color.Transparent)
              .clickable { replacing = id }.padding(vertical = 4.dp).testTag("pinned-full-$id")
              .semantics { role = Role.RadioButton; selected = replacing == id },
            verticalAlignment = Alignment.CenterVertically,
          ) {
            RadioButton(replacing == id, onClick = null, modifier = Modifier.padding(horizontal = 8.dp))
            Text(names[id] ?: id, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (LocalShowShortcuts.current) Text(shortcutLabel(index + 1), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 8.dp))
          }
        }
      }
    },
    confirmButton = {
      Button(shape = com.aglyn.ui.controlShape(), 
        onClick = { replacing?.let { services.accountPrefs.replacePin(it, orgId) }; onDone() },
        enabled = replacing != null,
        modifier = Modifier.testTag("pinned-full-replace"),
      ) { Text(replacing?.let { "Replace ${names[it] ?: "it"}" } ?: "Replace") }
    },
    dismissButton = { TextButton(onClick = onDone) { Text("Cancel") } },
  )
}

/**
 * "Keep which 5 pins?", asked once of an account that pinned more than five before the cap (Zach, 2026-10-18): until it
 * is answered the first five stay pinned, and the ones left out stay in All workspaces.
 */
@Composable
internal fun KeepPinsDialog(services: ShellServices, workspace: WorkspaceState, onLater: () -> Unit) {
  val prefs = services.accountPrefs.state.collectAsState().value
  val names = workspace.orgs.associate { it.id to it.name }
  val max = Contracts.pinnedOrgsMax.toInt()
  val kept = remember { mutableStateListOf<String>().apply { addAll(prefs.pinned) } }
  AlertDialog(
    onDismissRequest = onLater,
    modifier = Modifier.testTag("keep-pins-dialog"),
    title = { Text("Keep which $max pins?") },
    text = {
      Column {
        Text(
          "Pins are now limited to $max, here and in the console. You have ${prefs.stored.size} pinned workspaces. The ones you leave out stay in All workspaces.",
          style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(12.dp))
        LazyColumn(Modifier.heightIn(max = 320.dp)) {
          items(prefs.stored, key = { it }) { id ->
            val on = id in kept
            Row(
              Modifier.fillMaxWidth().clickable(enabled = on || kept.size < max) { if (on) kept.remove(id) else kept.add(id) }
                .padding(vertical = 2.dp).testTag("keep-pin-$id"),
              verticalAlignment = Alignment.CenterVertically,
            ) {
              Checkbox(on, onCheckedChange = null, enabled = on || kept.size < max, modifier = Modifier.padding(horizontal = 8.dp))
              Text(names[id] ?: "A workspace you left", maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
          }
        }
        Text("${kept.size} of $max chosen", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
      }
    },
    confirmButton = {
      Button(shape = com.aglyn.ui.controlShape(), onClick = { services.accountPrefs.keepPins(kept.toList()); onLater() }, enabled = kept.isNotEmpty(), modifier = Modifier.testTag("keep-pins-confirm")) {
        Text("Keep these ${kept.size}")
      }
    },
    dismissButton = { TextButton(onClick = onLater) { Text("Later") } },
  )
}

/**
 * Workspace colors: the pick for one workspace, saved on the account. Automatic uses the brand color, then a color taken
 * from the logo; a pick shows on the rail tile and as a light tint while you are in it. Only you see your pick.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun WorkspaceColorDialog(services: ShellServices, workspace: WorkspaceState, orgId: String, onDone: () -> Unit) {
  val prefs = services.accountPrefs.state.collectAsState().value
  val org = workspace.orgs.firstOrNull { it.id == orgId } ?: return onDone()
  val picked = colorOfHex(prefs.workspaceColors[orgId])
  val (current) = rememberWorkspaceColor(orgId, workspace, prefs, services.api.origin)
  var custom by remember { mutableStateOf(prefs.workspaceColors[orgId].orEmpty()) }
  val (light, dark) = orgLogoUrls(workspace, orgId, services.api.origin)
  AlertDialog(
    onDismissRequest = onDone,
    modifier = Modifier.testTag("workspace-color-dialog"),
    title = { Text("Workspace color") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          WorkspaceTile(org.name, light, dark, current, size = 40.dp)
          Column {
            Text(org.name, style = MaterialTheme.typography.titleSmall)
            Text(
              when {
                picked != null -> "Your color"
                workspace.orgLogos[orgId]?.brandColor != null -> "Brand color (white-label)"
                current != null -> "From its logo"
                else -> "No color yet"
              },
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
          Swatch(null, selected = picked == null, label = "Automatic") { services.accountPrefs.setWorkspaceColor(orgId, null); custom = "" }
          for (color in shellColors.picks) {
            Swatch(color, selected = picked?.toHex() == color.toHex(), label = color.toHex()) {
              services.accountPrefs.setWorkspaceColor(orgId, color.toHex())
              custom = color.toHex()
            }
          }
        }
        OutlinedTextField(
          custom,
          onValueChange = { value ->
            custom = value.trim().let { if (it.startsWith("#")) it else "#$it" }.take(7)
            if (colorOfHex(custom) != null) services.accountPrefs.setWorkspaceColor(orgId, custom.uppercase())
          },
          label = { Text("Any color (#RRGGBB)") },
          singleLine = true,
          isError = custom.isNotEmpty() && colorOfHex(custom) == null,
          modifier = Modifier.fillMaxWidth().testTag("workspace-color-hex"),
        )
        Text(
          "Automatic uses the workspace's brand color, else a color from its logo. Saved on your account; only you see it.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    },
    confirmButton = { TextButton(onClick = onDone, modifier = Modifier.testTag("workspace-color-done")) { Text("Done") } },
  )
}

@Composable
private fun Swatch(color: Color?, selected: Boolean, label: String, onClick: () -> Unit) {
  Box(
    Modifier.size(32.dp).clip(CircleShape)
      .then(if (color == null) Modifier.border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), CircleShape) else Modifier.background(color))
      .then(if (selected) Modifier.border(3.dp, MaterialTheme.colorScheme.onSurface, CircleShape) else Modifier)
      .clickable(onClick = onClick)
      .semantics { role = Role.RadioButton; this.selected = selected; contentDescription = label }
      .testTag("swatch-${if (color == null) "auto" else color.toHex().drop(1)}"),
    contentAlignment = Alignment.Center,
  ) {
    if (color == null) Icon(AglynIcons.named("autorenew"), null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    else if (selected) Icon(AglynIcons.named("check"), null, Modifier.size(16.dp), tint = com.aglyn.ui.readableOn(color))
  }
}
