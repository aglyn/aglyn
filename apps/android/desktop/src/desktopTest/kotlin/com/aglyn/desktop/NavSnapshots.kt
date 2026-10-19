package com.aglyn.desktop

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.unit.Density
import androidx.compose.ui.use
import com.aglyn.pluginhost.NativeApp
import com.aglyn.plugins.manifest.NativePluginManifest
import com.aglyn.shell.AglynShell
import com.aglyn.shell.DesktopShell
import com.aglyn.shell.NavKeys
import com.aglyn.shell.ShellCommand
import com.aglyn.shell.ShellNavigator
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.jetbrains.skia.EncodedImageFormat
import java.io.File

/**
 * A development tool, not a test: renders the navigation shell (AGL-3946) offscreen at phone, tablet and desktop widths,
 * light and dark, against the emulator stack named by -Daglyn.*: the site and the whole workspace, a settings mode, and
 * the scope picker's two steps.
 *
 *   ./gradlew :desktop:navSnapshots -Paglyn.snapshotDir=/path -Paglyn.jvmArgs="-Daglyn.firebaseProjectId=… -Daglyn.snapshotSite=…"
 */
fun main() = runBlocking {
  val dir = File(System.getProperty("aglyn.snapshotDir") ?: "build/snapshots").apply { mkdirs() }
  val aglyn = DesktopShell.services(NativeApp.AGLYN, DesktopShell.envFromSystem(), NativePluginManifest.entries)
  aglyn.auth.signInWithEmail(aglyn.debugSignIn!!.first, aglyn.debugSignIn!!.second)
  delay(3000)
  val site = System.getProperty("aglyn.snapshotSite")
  // A theme state shoots on this device's own copy, so the seeded account's theme is never changed.
  val original = aglyn.accountPrefs.state.value.theme
  fun theme(change: (com.aglyn.contracts.AppThemePrefs) -> com.aglyn.contracts.AppThemePrefs) = aglyn.accountPrefs.setTheme(change(original), deviceOnly = true)
  val sizes = mapOf("phone" to (412 to 892), "tablet" to (1024 to 768), "desktop" to (1440 to 900))
    .filterKeys { it in (System.getProperty("aglyn.snapshotSizes") ?: "phone,tablet,desktop").split(',') }
  val states: List<Pair<String, suspend (ShellNavigator) -> Unit>> = listOf(
    "site-home" to { nav -> site?.let { aglyn.workspace.selectSite(it) }; nav.select(ShellNavigator.HOME) },
    "site-orders" to { nav -> site?.let { aglyn.workspace.selectSite(it) }; nav.select(NavKeys.of("commerce.orders")) },
    "site-pages" to { nav -> site?.let { aglyn.workspace.selectSite(it) }; nav.select(NavKeys.of("site.pages")) },
    "site-settings" to { nav -> site?.let { aglyn.workspace.selectSite(it) }; nav.select(ShellNavigator.HOME); nav.command = ShellCommand.SETTINGS },
    "workspace-sites" to { nav -> aglyn.workspace.selectWholeWorkspace(); nav.select(NavKeys.of("site.sites")) },
    "workspace-crm" to { nav -> aglyn.workspace.selectWholeWorkspace(); nav.select(NavKeys.of("crm.contacts")) },
    "workspace-inbox" to { nav -> aglyn.workspace.selectWholeWorkspace(); nav.select(NavKeys.of("inbox.submissions")) },
    "picker-workspace" to { nav -> site?.let { aglyn.workspace.selectSite(it) }; nav.select(ShellNavigator.HOME); nav.command = ShellCommand.FIND },
    "picker-site" to { nav -> site?.let { aglyn.workspace.selectSite(it) }; nav.select(ShellNavigator.HOME); nav.command = ShellCommand.SWITCH_SITE },
    "phone-menu" to { nav -> site?.let { aglyn.workspace.selectSite(it) }; nav.select(ShellNavigator.MENU) },
    // Phase 3: a second tab, the AI panel and the shortcuts list.
    "tabs" to { nav -> site?.let { aglyn.workspace.selectSite(it) }; nav.select(NavKeys.of("commerce.orders")); nav.command = ShellCommand.NEW_TAB },
    "ai-panel" to { nav -> site?.let { aglyn.workspace.selectSite(it) }; nav.select(ShellNavigator.HOME); nav.command = ShellCommand.AI_PANEL },
    "shortcuts" to { nav -> site?.let { aglyn.workspace.selectSite(it) }; nav.select(ShellNavigator.HOME); nav.command = ShellCommand.SHORTCUTS },
    // Phase 4: Theme settings, the marketplace home, and the app in Night, Ocean and Compact.
    "theme-settings" to { nav -> nav.select(ShellNavigator.SETTINGS); nav.push(com.aglyn.shell.Route.ThemeSettings) },
    "marketplace" to { nav -> site?.let { aglyn.workspace.selectSite(it) }; nav.select(NavKeys.of("marketplace.browse")) },
    "theme-night" to { nav -> theme { it.copy(theme = com.aglyn.contracts.AppThemeName.NIGHT) }; site?.let { aglyn.workspace.selectSite(it) }; nav.select(NavKeys.of("commerce.orders")) },
    "theme-ocean" to { nav -> theme { it.copy(theme = com.aglyn.contracts.AppThemeName.OCEAN) }; site?.let { aglyn.workspace.selectSite(it) }; nav.select(NavKeys.of("commerce.orders")) },
    // The fidelity round: Sites, an order, the one box open, and the workspace switcher hidden.
    "workspace-sites-list" to { nav -> aglyn.workspace.selectWholeWorkspace(); nav.select(NavKeys.of("site.sites")) },
    "site-order" to { nav -> site?.let { aglyn.workspace.selectSite(it) }; nav.select(NavKeys.of("commerce.orders", System.getProperty("aglyn.snapshotOrder")?.let { mapOf("order" to it) } ?: emptyMap())) },
    "onebox" to { nav -> site?.let { aglyn.workspace.selectSite(it) }; nav.select(ShellNavigator.HOME); nav.command = ShellCommand.FIND },
    "rail-hidden" to { nav -> aglyn.prefs.set("aglyn.nav.railHidden", "1"); site?.let { aglyn.workspace.selectSite(it) }; nav.select(NavKeys.of("commerce.orders")) },
    "theme-compact" to { nav -> theme { it.copy(density = com.aglyn.contracts.AppDensity.COMPACT, accent = "#7A5CF0") }; site?.let { aglyn.workspace.selectSite(it) }; nav.select(NavKeys.of("commerce.orders")) },
  )
  val only = System.getProperty("aglyn.snapshotOnly")?.split(',')
  for ((name, prepare) in states) {
    if (only != null && name !in only) continue
    for ((size, dims) in sizes) {
      if (name == "phone-menu" && size != "phone") continue
      for (dark in listOf(false, true)) {
        val navigator = ShellNavigator()
        withContext(Dispatchers.Main) {
          if (aglyn.accountPrefs.state.value.deviceTheme != null && !name.startsWith("theme-")) aglyn.accountPrefs.setTheme(original, deviceOnly = true)
          if (name != "rail-hidden") aglyn.prefs.set("aglyn.nav.railHidden", null)
          prepare(navigator)
        }
        delay(1500)
        shootNav(dir, "nav-$name-$size${if (dark) "-dark" else ""}", dims.first, dims.second) {
          CompositionLocalProvider(com.aglyn.shell.LocalTitleBarInset provides androidx.compose.ui.unit.Dp(0f)) {
            AglynShell(aglyn, navigator, dark = dark)
          }
        }
      }
    }
  }
  // Back to the account's own theme on this device.
  if (aglyn.accountPrefs.state.value.deviceTheme != null) withContext(Dispatchers.Main) { aglyn.accountPrefs.setTheme(original, deviceOnly = false) }
  delay(1000)
  System.exit(0)
}

private suspend fun shootNav(dir: File, name: String, width: Int, height: Int, content: @androidx.compose.runtime.Composable () -> Unit) =
  withContext(Dispatchers.Main) {
    ImageComposeScene(width * 2, height * 2, Density(2f), coroutineContext = coroutineContext) { content() }.use { scene ->
      var image = scene.render(0)
      val start = System.nanoTime()
      while (System.nanoTime() - start < 5_000_000_000L) {
        delay(100)
        image = scene.render(System.nanoTime() - start)
      }
      File(dir, "$name.png").writeBytes(image.encodeToData(EncodedImageFormat.PNG)!!.bytes)
      println("wrote $name.png")
    }
  }
