package com.aglyn.shell

import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.runDesktopComposeUiTest
import kotlin.test.Test

/**
 * A development tool riding the test run, not a check: with AGLYN_SHOTS=<dir> set it shoots the desktop shell at Figma's
 * 1440 × 900 (1x, so a capture lines up with a Figma frame export) over the test fakes, light and dark: the site's
 * drilled-in sidebar with a group open, the site switcher, the search dropdown typing, and the workspace scope. Without
 * the variable it does nothing.
 */
@OptIn(ExperimentalTestApi::class)
class NavFakeShots {
  private val dir = System.getenv("AGLYN_SHOTS")?.let { java.io.File(it).apply { mkdirs() } }

  private fun ComposeUiTest.signIn() {
    waitUntil(timeoutMillis = 5_000) { onAllNodesWithTagCount("sign-in-email") > 0 }
    onNodeWithTag("sign-in-email").performTextInput("dana@example.test")
    onNodeWithTag("sign-in-password").performTextInput("right")
    onNodeWithTag("sign-in-submit").performClick()
  }

  private fun ComposeUiTest.onAllNodesWithTagCount(tag: String) = onAllNodes(androidx.compose.ui.test.hasTestTag(tag)).fetchSemanticsNodes().size

  private fun ComposeUiTest.shoot(name: String) {
    val out = dir ?: return
    waitForIdle()
    // A popup (the switcher, the search dropdown) is a second root over the window; the last root draws the whole scene.
    val image = onAllNodes(androidx.compose.ui.test.isRoot()).onLast().captureToImage()
    val map = image.toPixelMap()
    val awt = java.awt.image.BufferedImage(image.width, image.height, java.awt.image.BufferedImage.TYPE_INT_ARGB)
    for (x in 0 until image.width) for (y in 0 until image.height) {
      val c = map[x, y]
      awt.setRGB(x, y, ((c.alpha * 255).toInt() shl 24) or ((c.red * 255).toInt() shl 16) or ((c.green * 255).toInt() shl 8) or (c.blue * 255).toInt())
    }
    javax.imageio.ImageIO.write(awt, "png", java.io.File(out, "$name.png"))
  }

  @Test
  fun shoot() {
    if (dir == null) return
    for (dark in listOf(false, true)) {
      val suffix = if (dark) "-dark" else ""
      runDesktopComposeUiTest(width = 1440, height = 900) {
        setContent { AglynShell(testServices(userDoc = emptyMap()), dark = dark) }
        signIn()
        waitUntil(timeoutMillis = 5_000) { onAllNodesWithTagCount("nav-group-website") > 0 }
        onNodeWithTag("nav-group-website").performClick()
        waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("nav-site-pages") > 0 }
        onNodeWithTag("nav-site-pages").performClick()
        mainClock.advanceTimeBy(600)
        shoot("fake-site-pages$suffix")
        onNodeWithTag("site-picker-button").performClick()
        mainClock.advanceTimeBy(300)
        shoot("fake-site-switcher$suffix")
      }
      runDesktopComposeUiTest(width = 1440, height = 900) {
        setContent { AglynShell(testServices(userDoc = emptyMap()), dark = dark) }
        signIn()
        waitUntil(timeoutMillis = 5_000) { onAllNodesWithTagCount("search-or-jump-field") > 0 }
        onNodeWithTag("search-or-jump-field").performClick()
        mainClock.advanceTimeBy(300)
        shoot("fake-search-empty$suffix")
        onNodeWithTag("search-or-jump-field").performTextInput("pa")
        mainClock.advanceTimeBy(600)
        shoot("fake-search-typing$suffix")
      }
      runDesktopComposeUiTest(width = 1440, height = 900) {
        setContent { AglynShell(testServices(userDoc = emptyMap()), dark = dark) }
        signIn()
        waitUntil(timeoutMillis = 5_000) { onAllNodesWithTagCount("scope-back-to-workspace") > 0 }
        onNodeWithTag("scope-back-to-workspace").performClick()
        mainClock.advanceTimeBy(600)
        shoot("fake-workspace$suffix")
      }
    }
  }
}
