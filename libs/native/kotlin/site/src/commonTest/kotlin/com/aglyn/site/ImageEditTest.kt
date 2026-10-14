package com.aglyn.site

import com.aglyn.contracts.ImageEditRect
import com.aglyn.site.media.ImageEditSettings
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ImageEditTest {
  @Test
  fun aQuarterTurnSwapsTheSidesAndForgetsTheCrop() {
    var settings = ImageEditSettings(crop = ImageEditRect(10.0, 10.0, 50.0, 50.0))
    assertEquals(4000 to 3000, settings.worked(4000, 3000))
    settings = settings.turned(clockwise = true)
    assertEquals(90, settings.rotation)
    assertNull(settings.crop)
    assertEquals(3000 to 4000, settings.worked(4000, 3000))
    settings = settings.turned(clockwise = false).turned(clockwise = false)
    assertEquals(270, settings.rotation)
    assertEquals(0, settings.turned(clockwise = true).rotation)
  }

  @Test
  fun thePreviewFitsAndIsNeverEnlarged() {
    assertEquals(480 to 360, ImageEditSettings().previewSize(4000, 3000))
    assertEquals(360 to 480, ImageEditSettings(rotation = 90).previewSize(4000, 3000))
    assertEquals(100 to 80, ImageEditSettings().previewSize(100, 80))
    val plan = ImageEditSettings(rotation = 90, flipH = true).previewPlan(4000, 3000)
    assertEquals(listOf(90, 0, 0, 3000, 4000, 360, 480), listOf(plan.rotation, plan.cropX, plan.cropY, plan.cropW, plan.cropH, plan.width, plan.height))
    assertTrue(plan.flipH)
    assertTrue(plan.png)
  }

  @Test
  fun aDragDrawsACropInsideThePreviewAndAnAspectLocksIt() {
    var settings = ImageEditSettings().dragged(10.0, 20.0, 110.0, 90.0, 480, 360)
    assertEquals(ImageEditRect(10.0, 20.0, 100.0, 70.0), settings.crop)
    // Past the edge the pointer is held at it.
    settings = ImageEditSettings().dragged(400.0, 300.0, 700.0, 500.0, 480, 360)
    assertEquals(ImageEditRect(400.0, 300.0, 80.0, 60.0), settings.crop)
    settings = ImageEditSettings().withAspect(16.0 / 9).dragged(0.0, 0.0, 160.0, 10.0, 480, 360)
    assertEquals(ImageEditRect(0.0, 0.0, 160.0, 90.0), settings.crop)
    // A new ratio starts the crop over.
    assertNull(settings.withAspect(1.0).crop)
  }

  @Test
  fun savingCutsAndShrinksAsTheConsoleDoes() {
    // A 4000 x 3000 photo, a crop of 100 x 50 preview pixels at (10, 20), shrunk to 400 wide.
    val settings = ImageEditSettings(crop = ImageEditRect(10.0, 20.0, 100.0, 50.0)).withMaxWidth("400")
    val plan = settings.savePlan(4000, 3000, "photo.jpg")
    // The preview is 0.12 of the photo, so the crop is 8.33 times larger on it.
    assertEquals(listOf(83, 167, 833, 417, 400, 200), listOf(plan.cropX, plan.cropY, plan.cropW, plan.cropH, plan.width, plan.height))
    assertFalse(plan.png)
    assertTrue(settings.savePlan(4000, 3000, "Logo.PNG").png)
    // No crop and no width keeps the whole picture at its size.
    val whole = ImageEditSettings().savePlan(4000, 3000, "photo.jpg")
    assertEquals(listOf(0, 0, 4000, 3000, 4000, 3000), listOf(whole.cropX, whole.cropY, whole.cropW, whole.cropH, whole.width, whole.height))
  }

  @Test
  fun theMaxWidthTakesDigitsOnly() {
    assertEquals("1200", ImageEditSettings().withMaxWidth("12a0 0").maxWidth)
    assertEquals("12345", ImageEditSettings().withMaxWidth("1234567").maxWidth)
    assertEquals("", ImageEditSettings().withMaxWidth("abc").maxWidth)
  }

  @Test
  fun anEditIsAskedForOnlyWhenSomethingChanged() {
    assertFalse(ImageEditSettings().changed)
    assertTrue(ImageEditSettings(flipV = true).changed)
    assertTrue(ImageEditSettings().withMaxWidth("800").changed)
    assertNotNull(ImageEditSettings().dragged(0.0, 0.0, 10.0, 10.0, 100, 100).crop)
  }
}
