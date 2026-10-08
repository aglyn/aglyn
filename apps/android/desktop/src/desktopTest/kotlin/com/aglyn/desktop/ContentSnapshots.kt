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
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.jetbrains.skia.EncodedImageFormat
import java.io.File

/**
 * A development tool, not a test: the content areas (sites, pages, media,
 * components, layouts, templates, setup, content, forms and submissions, data) rendered offscreen against the seeded
 * emulator stack named by -Daglyn.*, at phone (420), tablet (900) and
 * desktop (1280) widths, light and dark. `-Daglyn.snapshotOnly=media` keeps
 * the shots whose name contains it.
 *
 *   ./gradlew :desktop:contentSnapshots -Paglyn.snapshotDir=/path -Paglyn.jvmArgs="-Daglyn.firebaseProjectId=…"
 */
private class Shot(val name: String, val screen: String, val params: Map<String, String> = emptyMap())

private val SIZES = listOf(Triple("phone", 420, 880), Triple("tablet", 900, 1180), Triple("desktop", 1280, 840))

fun main() = runBlocking {
  val dir = File(System.getProperty("aglyn.snapshotDir") ?: "build/content-snapshots").apply { mkdirs() }
  val only = System.getProperty("aglyn.snapshotOnly")
  val site = System.getProperty("aglyn.snapshotSite") ?: "mobile-demo-site"
  val services = DesktopShell.services(NativeApp.AGLYN, DesktopShell.envFromSystem(), NativePluginManifest.entries)
  services.auth.signInWithEmail(services.debugSignIn!!.first, services.debugSignIn!!.second)
  // Let the workspace arrive, then work on the seeded site.
  repeat(50) { if (services.workspace.state.value.sites.any { it.id == site }) return@repeat; delay(200) }
  services.workspace.selectSite(site)
  delay(1500)
  val shots = listOf(
    Shot("sites", "site.sites", mapOf("site" to site)),
    Shot("site-overview", "site.site"),
    Shot("pages", "site.pages", mapOf("page" to "page-about")),
    Shot("media", "site.media", mapOf("media" to "seed-media-storefront")),
    Shot("media-workspace", "site.media", mapOf("tab" to "org", "media" to "seed-media-brand-mark")),
    Shot("components", "site.components", mapOf("id" to "cmp-hero")),
    Shot("layouts", "site.layouts", mapOf("id" to "lay-main")),
    Shot("templates", "site.templates", mapOf("id" to "tpl-service")),
    Shot("setup-details", "site.setup", mapOf("section" to "details")),
    Shot("setup-seo", "site.setup", mapOf("section" to "seo")),
    Shot("setup-tracking", "site.setup", mapOf("section" to "tracking")),
    Shot("setup-theme", "site.theme"),
    Shot("setup-emails", "site.setup", mapOf("section" to "emails")),
    Shot("content", "site.content", mapOf("collectionSlug" to "blog", "entryId" to "post-spring")),
    Shot("forms", "forms.list", mapOf("form" to "contact")),
    Shot("submissions", "inbox.submissions", mapOf("formId" to "contact", "formName" to "Contact us", "submission" to "sub-priya")),
  ).filter { only == null || it.name.contains(only) }
  for (shot in shots) {
    for ((size, width, height) in SIZES) {
      for (dark in if (size == "desktop") listOf(false, true) else listOf(false)) {
        val navigator = ShellNavigator()
        navigator.push(Route.Screen(shot.screen, shot.params))
        shoot(dir, "content-${shot.name}-$size${if (dark) "-dark" else ""}", width, height) { AglynShell(services, navigator, dark = dark) }
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
      while (System.nanoTime() - start < 5_000_000_000L) {
        delay(100)
        image = scene.render(System.nanoTime() - start)
      }
      File(dir, "$name.png").writeBytes(image.encodeToData(EncodedImageFormat.PNG)!!.bytes)
      println("wrote $name.png")
    }
  }
