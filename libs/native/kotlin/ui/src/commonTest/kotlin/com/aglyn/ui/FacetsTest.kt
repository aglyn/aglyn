package com.aglyn.ui

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.round
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The Facets ground against the Figma build spec (53:1638), whose points are fractions of the frame; the twin of Apple's FacetsTests. */
class FacetsTest {
  private fun percent(layout: FacetsLayout, name: String, size: Size) =
    layout.planes.first { it.name == name }.points.map { listOf(round(it.x / size.width * 1000) / 10, round(it.y / size.height * 1000) / 10) }

  @Test
  fun thePhonePlanesMatchTheSpec() {
    val size = Size(440f, 956f)
    val layout = FacetsLayout(size, dark = false)
    assertEquals(listOf(listOf(70f, 0f), listOf(100f, 0f), listOf(100f, 20.1f)), percent(layout, "top", size))
    assertEquals(listOf(listOf(-5f, 88f), listOf(125f, 46.9f), listOf(125f, 60.9f), listOf(-5f, 102f)), percent(layout, "band", size))
    assertEquals(listOf(listOf(40f, 100f), listOf(100f, 81f), listOf(100f, 100f)), percent(layout, "corner", size))
    assertEquals(listOf(listOf(56f, 100f), listOf(100f, 86.1f), listOf(100f, 89.3f), listOf(66.2f, 100f)), percent(layout, "accent", size))
    assertEquals(listOf(0.16f, 0.1f, 0.2f, 0.38f), layout.planes.map { it.opacity })
    assertTrue(abs(layout.softLight.left - 242f) < 0.01f && abs(layout.softLight.top + 286.8f) < 0.01f)
  }

  @Test
  fun theTabletPlanesMatchTheSpec() {
    val size = Size(1376f, 1032f)
    val layout = FacetsLayout(size, dark = true)
    assertEquals(listOf(listOf(56f, 100f), listOf(100f, 59.7f), listOf(100f, 66.7f), listOf(63.6f, 100f)), percent(layout, "accent", size))
    assertEquals(listOf(0.26f, 0.18f, 0.34f, 0.5f), layout.planes.map { it.opacity })
  }

  @Test
  fun theLaunchFrameSitsAStepOutAndFainter() {
    val size = Size(440f, 956f)
    val rest = FacetsLayout(size, dark = false, settle = 1f)
    val launch = FacetsLayout(size, dark = false, settle = 0f)
    rest.planes.zip(launch.planes).forEach { (a, b) ->
      assertEquals(12f, hypot(b.points[0].x - a.points[0].x, b.points[0].y - a.points[0].y), 0.001f)
      assertEquals(a.opacity * 0.9f, b.opacity, 0.0001f)
    }
  }

  @Test
  fun theGradientRunsAsFigmaDrawsIt() {
    val (start, end) = FacetsLayout.gradientLine(Rect(0f, 0f, 1f, 1f))
    assertEquals(0.9415f, start.x, 0.001f)
    assertEquals(0.7345f, start.y, 0.001f)
    assertEquals(0.0585f, end.x, 0.001f)
    assertEquals(0.2655f, end.y, 0.001f)
  }

  @Test
  fun theIntroPlaysOncePerProcess() {
    LaunchIntro.create()
    val second = LaunchIntro.create()
    assertTrue(second.finished && second.revealed && second.settled)
    assertTrue(LaunchIntro.skipped().finished)
  }
}
