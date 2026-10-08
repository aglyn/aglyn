package com.aglyn.desktop

import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.unit.Density
import androidx.compose.ui.use
import com.aglyn.pluginhost.NativeApp
import com.aglyn.plugins.manifest.NativePluginManifest
import com.aglyn.shell.AglynShell
import com.aglyn.shell.DesktopShell
import com.aglyn.shell.Route
import com.aglyn.shell.ShellNavigator
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.jetbrains.skia.EncodedImageFormat
import java.io.File

/**
 * A development tool, not a test: renders named plugin screens offscreen at
 * phone, tablet and desktop widths against the emulator stack named by
 * -Daglyn.*, so a lane can see every screen it adds without a device.
 *
 *   ./gradlew :desktop:laneSnapshots -Paglyn.snapshotDir=/path \
 *     -Paglyn.jvmArgs="-Daglyn.firebaseProjectId=demo-aglyn-native … -Daglyn.snapshotSite=mobile-demo-site \
 *       -Daglyn.snapshotScreens=inbox.submissions,crm.deals:deal=deal-1"
 *
 * Each `-Daglyn.snapshotScreens` entry is a screen id, optionally followed by
 * `:key=value&key=value` route parameters; `-Daglyn.snapshotSizes` narrows
 * the sizes (`phone,tablet,desktop`) and `-Daglyn.snapshotDark=true` adds dark shots.
 */
fun main() = runBlocking {
  val dir = File(System.getProperty("aglyn.snapshotDir") ?: "build/snapshots").apply { mkdirs() }
  val env = DesktopShell.envFromSystem()
  val aglyn = DesktopShell.services(NativeApp.AGLYN, env, NativePluginManifest.entries)
  aglyn.auth.signInWithEmail(aglyn.debugSignIn!!.first, aglyn.debugSignIn!!.second)
  System.getProperty("aglyn.snapshotSite")?.let { site ->
    kotlinx.coroutines.delay(3000)
    aglyn.workspace.selectSite(site)
  }
  val sizes = mapOf("phone" to (412 to 892), "tablet" to (1024 to 768), "desktop" to (1440 to 900))
    .filterKeys { it in (System.getProperty("aglyn.snapshotSizes") ?: "phone,tablet,desktop").split(',') }
  val darkToo = System.getProperty("aglyn.snapshotDark") == "true"
  val screens = (System.getProperty("aglyn.snapshotScreens") ?: "").split(',').map { it.trim() }.filter { it.isNotEmpty() }
  for (entry in screens) {
    val screenId = entry.substringBefore(':')
    val params = entry.substringAfter(':', "").split('&').filter { '=' in it }.associate { it.substringBefore('=') to it.substringAfter('=') }
    val name = entry.replace(Regex("[^A-Za-z0-9.-]+"), "_")
    for ((size, dims) in sizes) {
      for (dark in if (darkToo) listOf(false, true) else listOf(false)) {
        val navigator = ShellNavigator()
        withContext(Dispatchers.Main) {
          navigator.select(ShellNavigator.HOME)
          navigator.push(Route.Screen(screenId, params))
        }
        shoot(dir, "$name-$size${if (dark) "-dark" else ""}", dims.first, dims.second) { AglynShell(aglyn, navigator, dark = dark) }
      }
    }
  }
  System.exit(0)
}

private suspend fun shoot(dir: File, name: String, width: Int, height: Int, content: @androidx.compose.runtime.Composable () -> Unit) =
  withContext(Dispatchers.Main) {
    ImageComposeScene(width * 2, height * 2, Density(2f), coroutineContext = coroutineContext) { content() }.use { scene ->
      var image = scene.render(0)
      val start = System.nanoTime()
      while (System.nanoTime() - start < 7_000_000_000L) {
        kotlinx.coroutines.delay(100)
        image = scene.render(System.nanoTime() - start)
      }
      File(dir, "$name.png").writeBytes(image.encodeToData(EncodedImageFormat.PNG)!!.bytes)
      println("wrote $name.png")
    }
  }
