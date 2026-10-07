package com.aglyn.desktop

import androidx.compose.runtime.remember
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.window.application
import com.aglyn.pluginhost.NativeApp
import com.aglyn.plugins.manifest.NativePlugins
import com.aglyn.shell.AglynShell
import com.aglyn.shell.DesktopShell
import com.aglyn.shell.Route
import com.aglyn.shell.ShellNavigator

/** "Aglyn" on the desktop. */
fun main() {
  val services = DesktopShell.services(NativeApp.AGLYN, DesktopShell.envFromSystem(), NativePlugins.entries)
  val autoSignIn = System.getProperty("aglyn.autoSignIn") == "true"
  application {
    val navigator = remember { ShellNavigator() }
    AglynWindow(
      title = services.config.brandName,
      services = services,
      menus = { signOut ->
        Menu("Go", mnemonic = 'G') {
          Item("Home", shortcut = shortcut(Key.One), onClick = { navigator.select(ShellNavigator.HOME) })
          Item("Notifications", shortcut = shortcut(Key.Two), onClick = { navigator.select(ShellNavigator.NOTIFICATIONS) })
          Item("Console", shortcut = shortcut(Key.Three), onClick = { navigator.select(ShellNavigator.CONSOLE) })
          Item("Settings", shortcut = shortcut(Key.Comma), onClick = { navigator.select(ShellNavigator.SETTINGS) })
          Separator()
          Item("Back", shortcut = shortcut(Key.LeftBracket), onClick = { navigator.back() })
        }
        Menu("Workspace", mnemonic = 'W') {
          Item("Switch site…", shortcut = shortcut(Key.K), onClick = { navigator.push(Route.Switcher) })
        }
        Menu("Account", mnemonic = 'A') {
          Item("Sign out", shortcut = shortcut(Key.Q, shift = true), onClick = signOut)
        }
      },
    ) {
      AglynShell(services, navigator, autoSignIn = autoSignIn)
    }
  }
}
