package com.aglyn.desktop

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.unit.Density
import androidx.compose.ui.use
import com.aglyn.pluginhost.NativeApp
import com.aglyn.plugins.manifest.NativePluginManifest
import com.aglyn.shell.AglynShell
import com.aglyn.shell.DesktopShell
import com.aglyn.shell.PosShell
import com.aglyn.shell.Route
import com.aglyn.shell.ShellNavigator
import com.aglyn.shell.ShellServices
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.jetbrains.skia.EncodedImageFormat
import java.io.File

/**
 * A development tool, not a test: renders the desktop shells offscreen
 * against the live emulator stack named by -Daglyn.* and writes PNGs of each
 * screen, so desktop screenshots need no screen-recording permission.
 *
 *   ./gradlew :desktop:snapshots -Paglyn.snapshotDir=/path -Paglyn.jvmArgs="-Daglyn.firebaseProjectId=…"
 */
fun main() = runBlocking {
  val dir = File(System.getProperty("aglyn.snapshotDir") ?: "build/snapshots").apply { mkdirs() }
  val env = DesktopShell.envFromSystem()

  val aglyn = DesktopShell.services(NativeApp.AGLYN, env, NativePluginManifest.entries)
  aglyn.auth.signInWithEmail(aglyn.debugSignIn!!.first, aglyn.debugSignIn!!.second)
  val navigator = ShellNavigator()
  for (dark in listOf(false, true)) {
    val suffix = if (dark) "-dark" else ""
    shoot(dir, "aglyn-desktop-home$suffix", dark) { AglynShell(aglyn, navigator, dark = it) }
    if (dark) continue
    shoot(dir, "aglyn-desktop-redirects", dark, before = { navigator.select(ShellNavigator.screenKey("redirects.list")) }) { AglynShell(aglyn, navigator, dark = it) }
    shoot(dir, "aglyn-desktop-notifications", dark, before = { navigator.select(ShellNavigator.NOTIFICATIONS) }) { AglynShell(aglyn, navigator, dark = it) }
    shoot(dir, "aglyn-desktop-settings", dark, before = { navigator.select(ShellNavigator.SETTINGS) }) { AglynShell(aglyn, navigator, dark = it) }
    shoot(dir, "aglyn-desktop-switcher", dark, before = { navigator.select(ShellNavigator.HOME); navigator.push(Route.Switcher) }) { AglynShell(aglyn, navigator, dark = it) }
    navigator.select(ShellNavigator.HOME)
  }
  // The store's orders live on the seeded store site (-Daglyn.snapshotStoreSite).
  System.getProperty("aglyn.snapshotStoreSite")?.let { site ->
    aglyn.workspace.selectSite(site)
    for (dark in listOf(false, true)) {
      val suffix = if (dark) "-dark" else ""
      shoot(dir, "aglyn-desktop-orders$suffix", dark, before = { navigator.select(ShellNavigator.screenKey("commerce.orders")) }) { AglynShell(aglyn, navigator, dark = it) }
      shoot(dir, "aglyn-desktop-order$suffix", dark, before = { navigator.push(Route.Screen("commerce.order", mapOf("order" to "o-1043"))) }) { AglynShell(aglyn, navigator, dark = it) }
    }
    shoot(dir, "aglyn-desktop-sales", false, before = { navigator.select(ShellNavigator.HOME); navigator.push(Route.Screen("commerce.sales")) }) { AglynShell(aglyn, navigator, dark = it) }
    shoot(dir, "aglyn-desktop-products", false, before = { navigator.select(ShellNavigator.HOME); navigator.push(Route.Screen("commerce.product", mapOf("product" to (System.getProperty("aglyn.snapshotProduct") ?: "")))) }) { AglynShell(aglyn, navigator, dark = it) }
    shoot(dir, "aglyn-desktop-pages", false, before = { navigator.select(ShellNavigator.HOME); navigator.push(Route.Pages) }) { AglynShell(aglyn, navigator, dark = it) }
    shoot(dir, "aglyn-desktop-orders-narrow", false, width = 420, height = 860, before = { navigator.select(ShellNavigator.screenKey("commerce.orders")) }) { AglynShell(aglyn, navigator, dark = it) }
    shoot(dir, "aglyn-desktop-home-store", false, before = { navigator.select(ShellNavigator.HOME) }) { AglynShell(aglyn, navigator, dark = it) }
  }
  aglyn.auth.signOut()
  shoot(dir, "aglyn-desktop-sign-in", false) { AglynShell(aglyn, ShellNavigator(), dark = it) }

  val pos = DesktopShell.services(NativeApp.POS, env, NativePluginManifest.entries)
  shoot(dir, "pos-desktop-sign-in", false) { PosShell(pos, dark = it) }
  pos.auth.signInWithEmail(pos.debugSignIn!!.first, pos.debugSignIn!!.second)
  shoot(dir, "pos-desktop-register", false) { PosShell(pos, dark = it) }
  System.exit(0)
}

private suspend fun shoot(
  dir: File,
  name: String,
  dark: Boolean,
  width: Int = 1280,
  height: Int = 840,
  before: () -> Unit = {},
  content: @Composable (dark: Boolean) -> Unit,
) = withContext(Dispatchers.Main) {
  before()
  ImageComposeScene(width * 2, height * 2, Density(2f), coroutineContext = coroutineContext) {
    content(dark)
  }.use { scene ->
    // Let the reads arrive: render frames for a few seconds of wall time.
    var image = scene.render(0)
    val start = System.nanoTime()
    while (System.nanoTime() - start < 6_000_000_000L) {
      kotlinx.coroutines.delay(100)
      image = scene.render(System.nanoTime() - start)
    }
    File(dir, "$name.png").writeBytes(image.encodeToData(EncodedImageFormat.PNG)!!.bytes)
    println("wrote $name.png")
  }
}
