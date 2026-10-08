package com.aglyn.desktop

import androidx.compose.runtime.Composable
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
 * A development tool, not a test: the Automation screens (AGL-3670) rendered
 * offscreen against the seeded emulator stack, wide and narrow.
 *
 *   ./gradlew :desktop:automationSnapshots -Paglyn.snapshotDir=/path -Paglyn.jvmArgs="-Daglyn.firebaseProjectId=…"
 */
fun main() = runBlocking {
  val dir = File(System.getProperty("aglyn.snapshotDir") ?: "build/snapshots").apply { mkdirs() }
  val aglyn = DesktopShell.services(NativeApp.AGLYN, DesktopShell.envFromSystem(), NativePluginManifest.entries)
  aglyn.auth.signInWithEmail(aglyn.debugSignIn!!.first, aglyn.debugSignIn!!.second)
  val navigator = ShellNavigator()
  suspend fun shot(name: String, width: Int = 1280, height: Int = 900, dark: Boolean = false, route: Route.Screen) =
    snap(dir, name, width, height, dark, before = { navigator.select(ShellNavigator.HOME); navigator.push(route) }) { AglynShell(aglyn, navigator, dark = it) }
  fun hub(section: String) = Route.Screen("workflows.automation", mapOf("section" to section))
  for (section in listOf("workflows", "actions", "webhooks", "organization")) shot("automation-$section", route = hub(section))
  shot("automation-actions-dark", dark = true, route = hub("actions"))
  shot("automation-workflow-editor", route = Route.Screen("workflows.workflow", mapOf("id" to "wf-quote")))
  shot("automation-workflow-new", route = Route.Screen("workflows.workflow", mapOf("id" to "new")))
  shot("automation-action-editor", height = 1400, route = Route.Screen("workflows.action", mapOf("id" to "act-pricing")))
  shot("automation-action-welcome", height = 1600, route = Route.Screen("workflows.action", mapOf("id" to "act-welcome")))
  shot("automation-webhook-new", route = Route.Screen("workflows.webhook"))
  shot("automation-runs", route = Route.Screen("workflows.runs", mapOf("targetId" to "act-welcome", "name" to "Welcome new subscribers")))
  shot("automation-org-editor", height = 1300, route = Route.Screen("workflows.org-automation", mapOf("id" to "org-welcome")))
  shot("automation-phone-workflows", width = 412, height = 900, route = hub("workflows"))
  shot("automation-phone-actions", width = 412, height = 900, route = hub("actions"))
  shot("automation-phone-organization", width = 412, height = 1200, route = hub("organization"))
  shot("automation-phone-action-editor", width = 412, height = 1800, route = Route.Screen("workflows.action", mapOf("id" to "act-welcome")))
  shot("automation-phone-runs", width = 412, height = 900, route = Route.Screen("workflows.runs", mapOf("targetId" to "act-welcome", "name" to "Welcome new subscribers")))
  shot("automation-tablet-actions", width = 900, height = 1100, route = hub("actions"))
  System.exit(0)
}

private suspend fun snap(
  dir: File,
  name: String,
  width: Int,
  height: Int,
  dark: Boolean,
  before: () -> Unit,
  content: @Composable (dark: Boolean) -> Unit,
) = withContext(Dispatchers.Main) {
  before()
  ImageComposeScene(width * 2, height * 2, Density(2f), coroutineContext = coroutineContext) { content(dark) }.use { scene ->
    var image = scene.render(0)
    val start = System.nanoTime()
    while (System.nanoTime() - start < 5_000_000_000L) {
      kotlinx.coroutines.delay(100)
      image = scene.render(System.nanoTime() - start)
    }
    File(dir, "$name.png").writeBytes(image.encodeToData(EncodedImageFormat.PNG)!!.bytes)
    println("wrote $name.png")
  }
}
