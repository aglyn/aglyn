package com.aglyn.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import com.aglyn.ui.LaunchIntro
import com.aglyn.ui.LaunchMark
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * The launch intro frame by frame at 60 fps (P14, Zach: "the splash logo animation to lockup flashes a lot"): the mark is
 * there from the first frame, the wordmark only ever grows in, and nothing vanishes and comes back. Set
 * AGLYN_INTRO_FRAMES=<dir> to keep the frames.
 */
@OptIn(ExperimentalTestApi::class)
class LaunchIntroFramesTest {
  @Test
  fun theIntroIsOneMotionWithNoFlash() = runComposeUiTest {
    mainClock.autoAdvance = false
    val intro = LaunchIntro.unplayed()
    var ready = false
    setContent {
      Box(Modifier.size(480.dp, 320.dp).background(Color(0xFF808080))) {
        LaunchMark(intro, "Aglyn", compact = true, Modifier.fillMaxSize())
      }
      LaunchedEffect(Unit) { intro.run(reduceMotion = false) { ready } }
    }
    val out = (System.getProperty("aglyn.introFrames") ?: System.getenv("AGLYN_INTRO_FRAMES"))?.let { java.io.File(it).apply { mkdirs() } }
    val ink = mutableListOf<Int>()
    for (frame in 0 until 75) {
      if (frame == 50) ready = true
      mainClock.advanceTimeBy(16)
      val pixels = onRoot().captureToImage().toPixelMap()
      var count = 0
      for (x in 0 until pixels.width step 2) for (y in 0 until pixels.height step 2) {
        val c = pixels[x, y]
        if (kotlin.math.abs(c.red - 0.5f) + kotlin.math.abs(c.green - 0.5f) + kotlin.math.abs(c.blue - 0.5f) > 0.15f) count++
      }
      ink += count
      out?.let { dir ->
        val image = onRoot().captureToImage()
        val awt = java.awt.image.BufferedImage(image.width, image.height, java.awt.image.BufferedImage.TYPE_INT_ARGB)
        val map = image.toPixelMap()
        for (x in 0 until image.width) for (y in 0 until image.height) {
          val c = map[x, y]
          awt.setRGB(x, y, ((c.alpha * 255).toInt() shl 24) or ((c.red * 255).toInt() shl 16) or ((c.green * 255).toInt() shl 8) or (c.blue * 255).toInt())
        }
        javax.imageio.ImageIO.write(awt, "png", java.io.File(dir, "frame-%03d.png".format(frame)))
      }
    }
    // The mark holds from the first frame.
    assertTrue(ink.first() > 0, "the first frame shows the mark: $ink")
    // Until the hand-over the lockup only grows (the wipe); never a frame where it drops away and returns.
    val handOver = 50
    val before = ink.take(handOver)
    for (i in 1 until before.size) assertTrue(before[i] >= before[i - 1] * 0.98, "frame $i shrank: $ink")
    assertTrue(before.last() > before.first() * 2, "the wordmark wiped in: $ink")
    // The hand-over only fades out: no frame comes back up once it starts falling.
    val after = ink.drop(handOver)
    for (i in 1 until after.size) assertTrue(after[i] <= after[i - 1] * 1.02 + 1, "frame ${handOver + i} flashed back: $ink")
  }
}
