package com.aglyn.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.ui.TextButton

/** One entry of the help menu: what it says and what it opens. */
internal data class HelpEntry(val id: String, val label: String, val icon: String, val open: () -> Unit, val divider: Boolean = false)

/**
 * The help "?" menu: Help docs (the docs page of the row or section on screen, else the docs home),
 * What's new, Keyboard shortcuts, Terms and Privacy, Report an issue, Contact support, Report abuse. Pages open in the
 * in-app browser screen, so the side panel stays for AI.
 */
internal fun helpEntries(
  services: ShellServices,
  openWeb: (String) -> Unit,
  openScreen: (String) -> Unit,
  showShortcuts: () -> Unit,
  docsPath: String? = null,
): List<HelpEntry> {
  val links = helpLinks(services.config).associateBy { it.id }
  val docs = docsPath?.takeIf { it.startsWith("/") }?.let { "${services.config.docsOrigin.trimEnd('/')}$it" } ?: links["docs"]?.url
  return listOf(
    HelpEntry("help-docs", "Help docs", "article", { docs?.let(openWeb) }),
    HelpEntry("help-whats-new", "What's new", "auto_awesome", { links["whats-new"]?.let { openWeb(it.url) } }),
    HelpEntry("help-shortcuts", "Keyboard shortcuts", "keyboard", showShortcuts),
    HelpEntry("help-terms", "Terms of Service", "gavel", { links["terms"]?.let { openWeb(it.url) } }, divider = true),
    HelpEntry("help-privacy", "Privacy Policy", "privacy_tip", { links["privacy"]?.let { openWeb(it.url) } }),
    HelpEntry("help-report", "Report an issue", "bug_report", { openScreen("core.support") }, divider = true),
    HelpEntry("help-support", "Contact support", "support", { openScreen("core.support.tickets") }),
    // The public abuse intake (the tenant's `/api/report-abuse` form), on the legal origin.
    HelpEntry("help-abuse", "Report abuse", "flag", { openWeb("${services.config.legalOrigin}/api/report-abuse") }),
  )
}

/** The "?" button and its menu, in the title bar. */
@Composable
internal fun HelpButton(entries: List<HelpEntry>) {
  var open by remember { mutableStateOf(false) }
  Box {
    TitleBarButton("Help", "help_outline", "help-button") { open = true }
    DropdownMenu(open, onDismissRequest = { open = false }, modifier = Modifier.testTag("help-menu")) {
      for (entry in entries) {
        if (entry.divider) HorizontalDivider()
        MenuRow(entry.label, entry.icon, tag = entry.id) { open = false; entry.open() }
      }
    }
  }
}

/** Every keyboard shortcut the app answers, with the platform's command key. */
internal fun keyboardShortcuts(): List<Pair<String, String>> = listOf(
  shortcutText("K") to "Search or jump to",
  shortcutText("1–5") to "Jump to a pinned workspace",
  shortcutText("[") to "Back",
  shortcutText(",") to "Settings for the workspace or site on screen",
  shortcutText("T") to "New tab",
  shortcutText("W") to "Close the tab",
  shortcutText("T", shift = true) to "Reopen the last closed tab",
  shortcutText("\\", shift = true) to "Tab overview",
  (if (isMacPlatform) "⌘-click" else "Ctrl+click") to "Open a sidebar row in a new tab",
  shortcutText("/") to "Keyboard shortcuts",
  shortcutText("S", shift = true) to "Show or hide the sidebar",
  (if (isMacPlatform) "⌃⌘S" else "Ctrl+Alt+S") to "Show or hide the workspace switcher",
  "↑ ↓ ↵" to "Move and open in search and menus",
  "Esc" to "Close a box or a menu",
)

@Composable
internal fun KeyboardShortcutsDialog(onDismiss: () -> Unit) {
  AlertDialog(
    onDismissRequest = onDismiss,
    modifier = Modifier.testTag("keyboard-shortcuts"),
    title = { Text("Keyboard shortcuts", Modifier.semantics { heading() }) },
    text = {
      Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((keys, what) in keyboardShortcuts()) {
          Row(Modifier.fillMaxWidth()) {
            Text(keys, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(end = 16.dp).weight(0.35f))
            Text(what, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(0.65f))
          }
        }
      }
    },
    confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
  )
}
