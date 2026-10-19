package com.aglyn.desktop

import androidx.compose.runtime.remember
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.window.application
import androidx.compose.ui.unit.dp
import com.aglyn.pluginhost.NativeApp
import com.aglyn.plugins.manifest.NativePluginManifest
import com.aglyn.shell.AglynShell
import com.aglyn.shell.DesktopShell
import com.aglyn.shell.ShellCommand
import com.aglyn.shell.ShellNavigator

/** "Aglyn" on the desktop. */
fun main(args: Array<String>) {
  val services = DesktopShell.services(NativeApp.AGLYN, DesktopShell.envFromSystem(), NativePluginManifest.entries, DesktopShell.appPeripherals())
  if (LAUNCH_CHECK_ARG in args) launchCheck("Aglyn") { AglynShell(services) }
  val autoSignIn = System.getProperty("aglyn.autoSignIn") == "true"
  // "Connect Google": the system browser, once the desktop OAuth client is configured.
  val google = DesktopShell.googleSource(services.config)
  application {
    val navigator = remember { ShellNavigator() }
    AglynWindow(
      title = services.config.brandName,
      services = services,
      menus = { signOut ->
        // Ctrl/⌘1–5 belong to the pinned workspaces (Zach, 2026-10-18), so Go has no number shortcuts.
        Menu("Go", mnemonic = 'G') {
          Item("Home", onClick = { navigator.command = ShellCommand.HOME })
          Item("Notifications", onClick = { navigator.command = ShellCommand.NOTIFICATIONS })
          Item("Search or jump to…", shortcut = shortcut(Key.K), onClick = { navigator.command = ShellCommand.FIND })
          Separator()
          Item("Back", shortcut = shortcut(Key.LeftBracket), onClick = { navigator.command = ShellCommand.BACK })
        }
        Menu("Workspace", mnemonic = 'W') {
          val pins = listOf(ShellCommand.PIN_1, ShellCommand.PIN_2, ShellCommand.PIN_3, ShellCommand.PIN_4, ShellCommand.PIN_5)
          val keys = listOf(Key.One, Key.Two, Key.Three, Key.Four, Key.Five)
          pins.forEachIndexed { i, pin -> Item("Pinned workspace ${i + 1}", shortcut = shortcut(keys[i]), onClick = { navigator.command = pin }) }
          Separator()
          Item("Switch workspace…", onClick = { navigator.command = ShellCommand.SWITCH_WORKSPACE })
          Item("Switch site…", onClick = { navigator.command = ShellCommand.SWITCH_SITE })
          Item("Settings", shortcut = shortcut(Key.Comma), onClick = { navigator.command = ShellCommand.SETTINGS })
        }
        Menu("View", mnemonic = 'V') {
          Item("Show or hide the sidebar", shortcut = shortcut(Key.S, shift = true), onClick = { navigator.command = ShellCommand.TOGGLE_SIDEBAR })
          Item("Show or hide the workspace rail", shortcut = shortcut(Key.R, shift = true), onClick = { navigator.command = ShellCommand.TOGGLE_RAIL })
          Item("Show or hide the AI panel", onClick = { navigator.command = ShellCommand.AI_PANEL })
        }
        // Each tab keeps its own workspace, site and place; the first, Home, stays pinned.
        Menu("Tab", mnemonic = 'T') {
          Item("New tab", shortcut = shortcut(Key.T), onClick = { navigator.command = ShellCommand.NEW_TAB })
          Item("Close tab", shortcut = shortcut(Key.W), onClick = { navigator.command = ShellCommand.CLOSE_TAB })
          Item("Reopen closed tab", shortcut = shortcut(Key.T, shift = true), onClick = { navigator.command = ShellCommand.REOPEN_TAB })
          Separator()
          Item("Show all tabs", shortcut = shortcut(Key.Backslash, shift = true), onClick = { navigator.command = ShellCommand.TAB_OVERVIEW })
        }
        Menu("Account", mnemonic = 'A') {
          Item("Add account…", onClick = { navigator.command = ShellCommand.ADD_ACCOUNT })
          Item("Sign out", shortcut = shortcut(Key.Q, shift = true), onClick = signOut)
        }
        Menu("Help", mnemonic = 'H') {
          Item("Help and docs", onClick = { navigator.command = ShellCommand.HELP_DOCS })
          Item("Keyboard shortcuts", shortcut = shortcut(Key.Slash), onClick = { navigator.command = ShellCommand.SHORTCUTS })
        }
      },
    ) { onIntroRevealed ->
      androidx.compose.runtime.CompositionLocalProvider(
        com.aglyn.screens.LocalGoogleCredentialSource provides google,
      ) {
        // The Mac's traffic lights sit over the transparent title bar: the rail and the title bar start below them.
        androidx.compose.runtime.CompositionLocalProvider(com.aglyn.shell.LocalTitleBarInset provides if (isMacOs) 28.dp else 0.dp) {
          AglynShell(services, navigator, autoSignIn = autoSignIn, playIntro = true, onIntroRevealed = onIntroRevealed)
        }
      }
    }
  }
}

private val isMacOs = System.getProperty("os.name").orEmpty().startsWith("Mac")
