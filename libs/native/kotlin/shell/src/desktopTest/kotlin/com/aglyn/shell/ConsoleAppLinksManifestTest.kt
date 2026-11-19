package com.aglyn.shell

import com.aglyn.pluginhost.DeepLinks
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The Android manifest's App Link filter refuses exactly what [DeepLinks.opensInApp] hands back to the browser
 * (AGL-4059): the framework and route-handler paths, `/.well-known`, each web-only section and the pages under an auth
 * page. The console's spec (`native-app-association.spec.ts`) holds the same list to its apple-app-site-association.
 */
class ConsoleAppLinksManifestTest {
  private val manifest = File(System.getProperty("aglyn.contractsDir"), "../../../apps/android/app/src/main/AndroidManifest.xml").readText()

  @Test
  fun theManifestRefusesWhatTheAppHandsBack() {
    val refused = Regex("""<uri-relative-filter-group android:allow="false"><data android:(path|pathPrefix)="([^"]+)" /></uri-relative-filter-group>""")
      .findAll(manifest).map { "${it.groupValues[1]} ${it.groupValues[2]}" }.toList()
    val expected = listOf("pathPrefix /_", "path /api", "pathPrefix /api/", "pathPrefix /.well-known/") +
      DeepLinks.WEB_ONLY_TOP_LEVEL.flatMap { listOf("path /$it", "pathPrefix /$it/") } +
      DeepLinks.AUTH_LINK_TOP_LEVEL.map { "pathPrefix /$it/" }
    assertEquals(expected, refused)
    // Each refusal is a link the app hands back: the exact page, or a page under the prefix.
    for (rule in refused) {
      val (kind, path) = rule.split(' ')
      val sample = if (kind == "path") path else path + "x"
      assertTrue(!DeepLinks.opensInApp("https://app.aglyn.com$sample"), rule)
    }
  }

  @Test
  fun theConsoleFilterClaimsEveryOtherPage() {
    // One https filter for the console's host, verified, with no path of its own: every page but the refused ones.
    val filter = manifest.substringAfter("<data android:host=\"\${consoleHost}\" />").substringBefore("</intent-filter>")
    assertTrue(manifest.contains("<intent-filter android:autoVerify=\"true\">"))
    assertTrue(Regex("""<data android:(path|pathPrefix|pathPattern)=""").findAll(filter).all { match ->
      filter.substring(0, match.range.first).trimEnd().endsWith("<uri-relative-filter-group android:allow=\"false\">")
    })
  }
}
