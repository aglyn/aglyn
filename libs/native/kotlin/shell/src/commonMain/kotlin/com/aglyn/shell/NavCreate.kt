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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.core.WorkspaceState
import com.aglyn.ui.AglynIcons

/**
 * One thing the "+" can create: the console's create action for an area, its plugin (off → shown with why), the native
 * screen whose create form opens (`new=1`), and whether it belongs to a site or the whole workspace.
 */
internal data class CreateEntry(
  val id: String,
  val label: String,
  val icon: String,
  val screen: String,
  val pluginId: String?,
  val inSite: Boolean,
  /** The plugin's name in "Turn on … first". */
  val pluginName: String? = null,
)

/** Every create action, in the console's order: the site's, then the workspace's. */
internal val CREATE_ENTRIES = listOf(
  CreateEntry("page", "Page", "description", "site.pages", null, inSite = true),
  CreateEntry("product", "Product", "sell", "commerce.product", "commerce", inSite = true, pluginName = "Products"),
  CreateEntry("order", "Order", "shopping_basket", "commerce.orders", "commerce", inSite = true, pluginName = "Products"),
  CreateEntry("booking", "Booking", "event_available", "bookings.calendar", "bookings", inSite = true, pluginName = "Bookings"),
  CreateEntry("event", "Event", "event", "events-calendar.events", "events-calendar", inSite = true, pluginName = "Events"),
  CreateEntry("form", "Form", "dynamic_form", "forms.list", "forms", inSite = true, pluginName = "Forms"),
  CreateEntry("text", "Customer text", "sms", "sms.texts", "sms", inSite = true, pluginName = "Customer texts"),
  CreateEntry("site", "Site", "public", "site.sites", null, inSite = false),
  CreateEntry("contact", "Contact", "contact_mail", "crm.contacts", "crm", inSite = false, pluginName = "CRM"),
  CreateEntry("email", "Email", "mail", "email.messages", "email", inSite = false, pluginName = "Emails"),
)

/** What the "+" lists here: entries this build has a screen for, in the scope on screen, each with why when it is blocked. */
internal fun createEntries(services: ShellServices, workspace: WorkspaceState, enabled: Collection<String>): List<Pair<CreateEntry, String?>> {
  val inSite = workspace.site != null
  return CREATE_ENTRIES.mapNotNull { entry ->
    val screen = services.registry.screen(entry.screen) ?: return@mapNotNull null
    if (entry.inSite && !inSite) return@mapNotNull null
    // A workspace-wide entry whose native screen still needs a site waits for that site.
    if (!entry.inSite && screen.requiresSite && !inSite) return@mapNotNull null
    val blocked = entry.pluginId?.takeIf { it !in enabled }?.let { "Turn on ${entry.pluginName ?: it} in ${if (inSite) "Site" else "Workspace"} settings first." }
    entry to blocked
  }
}

/** The Create menu from the rail's "+": the create actions for the scope on screen, the blocked ones disabled with why. */
@Composable
internal fun CreateMenu(services: ShellServices, workspace: WorkspaceState, chrome: NavChromeState, enabled: Collection<String>, actions: ShellActions) {
  DropdownMenu(chrome.createMenu, onDismissRequest = { chrome.createMenu = false }, modifier = Modifier.widthIn(min = 240.dp).testTag("create-menu")) {
    CreateMenuItems(services, workspace, enabled) { entry ->
      chrome.createMenu = false
      actions.openScreen(entry.screen, mapOf("new" to "1"))
    }
  }
}

@Composable
internal fun CreateMenuItems(services: ShellServices, workspace: WorkspaceState, enabled: Collection<String>, onPick: (CreateEntry) -> Unit) {
  val entries = createEntries(services, workspace, enabled)
  val scopeName = workspace.site?.name ?: workspace.org?.name ?: "this workspace"
  Text("In $scopeName", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
  for ((entry, blocked) in entries) {
    DropdownMenuItem(
      text = {
        Column {
          Text(entry.label)
          blocked?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
      },
      leadingIcon = { Icon(AglynIcons.named(entry.icon), null) },
      enabled = blocked == null,
      onClick = { onPick(entry) },
      modifier = Modifier.testTag("create-${entry.id}"),
    )
  }
  if (entries.isEmpty()) {
    HorizontalDivider()
    Text("Pick a site to create pages, products and more.", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(16.dp))
  }
}
