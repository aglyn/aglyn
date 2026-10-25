package com.aglyn.shell

import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.runDesktopComposeUiTest
import androidx.compose.ui.unit.dp
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The content area moves (AGL-4013, as Apple's AGL-4009; Figma Motion 121:6714): a push slides the new screen in from the
 * trailing side, going back slides the uncovered one in from the leading side, and another destination, section or tab
 * cross-fades.
 */
@OptIn(ExperimentalTestApi::class)
class ContentMotionTest {
  private fun place(key: String, depth: Int, top: String = "home", tab: String = "tab1/") = ContentPlace(tab, key, depth, top, null)

  @Test
  fun aPushSlidesInAndGoingBackSlidesInFromTheOtherSide() {
    assertEquals(ContentMotion.PUSH, contentMotion(place("home", 0), place("home/1:theme", 1)))
    assertEquals(ContentMotion.POP, contentMotion(place("home/1:theme", 1), place("home", 0)))
  }

  @Test
  fun anotherDestinationSectionOrTabCrossFades() {
    assertEquals(ContentMotion.FADE, contentMotion(place("site.orders", 0, "site.orders"), place("site.products", 0, "site.products")))
    // A destination picked while a screen is pushed is a new place, not a step back.
    assertEquals(ContentMotion.FADE, contentMotion(place("site.orders/1:o", 1, "site.orders"), place("site.products", 0, "site.products")))
    assertEquals(ContentMotion.FADE, contentMotion(place("home", 0, tab = "tab1/"), place("home", 0, tab = "tab2/")))
  }

  private fun ComposeUiTest.signIn() {
    onNodeWithTag("sign-in-email").performTextInput("dana@example.test")
    onNodeWithTag("sign-in-password").performTextInput("right")
    onNodeWithTag("sign-in-submit").performClick()
  }

  @Test
  fun aPushedScreenComesInFromTheTrailingSideAndSettles() = runDesktopComposeUiTest(width = 1280, height = 800) {
    val navigator = ShellNavigator()
    setContent { AglynShell(testServices(userDoc = emptyMap()), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("rail-account") > 0 }
    runOnIdle { navigator.select(ShellNavigator.SETTINGS) }
    waitForIdle()
    mainClock.autoAdvance = false
    runOnIdle { navigator.push(Route.ThemeSettings) }
    mainClock.advanceTimeByFrame()
    mainClock.advanceTimeBy(32)
    val early = onNodeWithTag("theme-settings").getBoundsInRoot().left
    mainClock.advanceTimeBy(800)
    val settled = onNodeWithTag("theme-settings").getBoundsInRoot().left
    mainClock.autoAdvance = true
    assertTrue(early - settled > 8.dp, "the pushed screen starts to the trailing side: early $early, settled $settled")
    assertTrue(early - settled <= 40.dp, "no further than the 40 dp offset: early $early, settled $settled")
  }

  /**
   * The push frame by frame at 60 fps: the pushed screen's leading edge at each 16 ms frame. It starts no further than the
   * 40 dp offset, only ever travels toward its place (the drill's spring barely overshoots), and has settled by 400 ms.
   * Set AGLYN_CONTENT_FRAMES=<file> to keep the table (frame | ms | offset dp).
   */
  @Test
  fun aPushFrameByFrameIsOneSmoothMove() = runDesktopComposeUiTest(width = 1280, height = 800) {
    val navigator = ShellNavigator()
    setContent { AglynShell(testServices(userDoc = emptyMap()), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("rail-account") > 0 }
    runOnIdle { navigator.select(ShellNavigator.SETTINGS) }
    waitForIdle()
    mainClock.autoAdvance = false
    runOnIdle { navigator.push(Route.ThemeSettings) }
    mainClock.advanceTimeByFrame()
    val lefts = (0 until 30).map {
      mainClock.advanceTimeBy(16)
      onNodeWithTag("theme-settings").getBoundsInRoot().left
    }
    mainClock.advanceTimeBy(800)
    val settled = onNodeWithTag("theme-settings").getBoundsInRoot().left
    mainClock.autoAdvance = true
    val offsets = lefts.map { (it - settled).value }
    (System.getProperty("aglyn.contentFrames") ?: System.getenv("AGLYN_CONTENT_FRAMES"))?.let { path ->
      java.io.File(path).writeText(
        "frame | ms | offset dp\n" + offsets.mapIndexed { i, o -> "${i + 1} | ${(i + 1) * 16} | ${"%.2f".format(o)}" }.joinToString("\n") + "\n",
      )
    }
    assertTrue(offsets.first() <= 40f, "starts within the 40 dp offset: $offsets")
    for (i in 1 until offsets.size) assertTrue(offsets[i] <= offsets[i - 1] + 0.5f, "frame ${i + 1} moved back: $offsets")
    assertTrue(offsets.drop(24).all { kotlin.math.abs(it) <= 0.5f }, "settled by 400 ms: $offsets")
  }
}
@OptIn(ExperimentalTestApi::class)
private fun androidx.compose.ui.test.ComposeUiTest.onAllNodesWithTagCount(tag: String): Int =
  onAllNodes(androidx.compose.ui.test.hasTestTag(tag)).fetchSemanticsNodes().size
