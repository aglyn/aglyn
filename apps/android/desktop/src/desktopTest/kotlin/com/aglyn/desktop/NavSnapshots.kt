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
  )
  val only = System.getProperty("aglyn.snapshotOnly")?.split(',')
  for ((name, prepare) in states) {
    if (only != null && name !in only) continue
    for ((size, dims) in sizes) {
      if (name == "phone-menu" && size != "phone") continue
      for (dark in listOf(false, true)) {
        val navigator = ShellNavigator()
        withContext(Dispatchers.Main) { prepare(navigator) }
        delay(1500)
        shootNav(dir, "nav-$name-$size${if (dark) "-dark" else ""}", dims.first, dims.second) {
          CompositionLocalProvider(com.aglyn.shell.LocalTitleBarInset provides androidx.compose.ui.unit.Dp(0f)) {
            AglynShell(aglyn, navigator, dark = dark)
          }
        }
      }
    }
  }
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
