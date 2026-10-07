package com.aglyn.desktop

import androidx.compose.ui.input.key.Key
import androidx.compose.ui.window.application
import com.aglyn.pluginhost.NativeApp
import com.aglyn.plugins.manifest.NativePlugins
import com.aglyn.shell.DesktopShell
import com.aglyn.shell.PosShell

/** "Aglyn POS" on the desktop: smart readers only (AGL-3607's server-driven flow). */
fun main() {
  val services = DesktopShell.services(NativeApp.POS, DesktopShell.envFromSystem(), NativePlugins.entries, DesktopShell.posPeripherals())
  val autoSignIn = System.getProperty("aglyn.autoSignIn") == "true"
  application {
    AglynWindow(
      title = "${services.config.brandName} POS",
      services = services,
      menus = { signOut ->
        Menu("Account", mnemonic = 'A') {
          Item("Sign out", shortcut = shortcut(Key.Q, shift = true), onClick = signOut)
        }
      },
    ) {
      PosShell(services, autoSignIn = autoSignIn)
    }
  }
}
