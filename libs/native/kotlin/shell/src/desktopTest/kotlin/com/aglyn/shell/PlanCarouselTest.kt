package com.aglyn.shell

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performMouseInput
import androidx.compose.ui.test.runDesktopComposeUiTest
import com.aglyn.ui.AglynTheme
import com.aglyn.ui.PlanMeterCarousel
import com.aglyn.ui.PlanMeterLine
import kotlin.test.Test
import kotlin.test.assertEquals

/** The plan card's carousel (AGL-3992): slow, held while hovered, by hand with animations off; its month keys and figures. */
@OptIn(ExperimentalTestApi::class)
class PlanCarouselTest {
  private val meters = listOf(
    PlanMeterLine("storage", "Storage", "400 / 1000 MB", 0.4f),
    PlanMeterLine("bandwidth", "Bandwidth (this month)", "9 / 10 GB", 0.9f),
  )

  @Test
  fun itMovesOnSlowlyAndHoldsWhileHovered() = runDesktopComposeUiTest(width = 320, height = 200) {
    mainClock.autoAdvance = false
    setContent { AglynTheme(dark = false) { PlanMeterCarousel("Bakery · Pro plan", meters, 8000, 0.8f, onUpgrade = {}, onOpenUsage = {}, onHide = {}) } }
    mainClock.advanceTimeBy(500)
    onNodeWithTag("plan-card-meter-storage", useUnmergedTree = true).assertExists()
    mainClock.advanceTimeBy(8_200)
    mainClock.advanceTimeBy(600)
    onNodeWithTag("plan-card-meter-bandwidth", useUnmergedTree = true).assertExists()
    // Hovered, it holds.
    onNodeWithTag("plan-card").performMouseInput { moveTo(center) }
    mainClock.advanceTimeBy(20_000)
    onNodeWithTag("plan-card-meter-bandwidth", useUnmergedTree = true).assertExists()
    // A dot steps to its meter.
    onNodeWithTag("plan-card-dot-storage", useUnmergedTree = true).performClick()
    mainClock.advanceTimeBy(600)
    onNodeWithTag("plan-card-meter-storage", useUnmergedTree = true).assertExists()
  }

  @Test
  fun withAnimationsOffItWaitsForTheDots() = runDesktopComposeUiTest(width = 320, height = 200) {
    System.setProperty("aglyn.reduceMotion", "true")
    try {
      mainClock.autoAdvance = false
      setContent { AglynTheme(dark = false) { PlanMeterCarousel("Bakery · Pro plan", meters, 8000, 0.8f, onUpgrade = null, onOpenUsage = {}, onHide = {}) } }
      mainClock.advanceTimeBy(30_000)
      onNodeWithTag("plan-card-meter-storage", useUnmergedTree = true).assertExists()
      onNodeWithTag("plan-card-dot-bandwidth", useUnmergedTree = true).performClick()
      mainClock.advanceTimeBy(600)
      onNodeWithTag("plan-card-meter-bandwidth", useUnmergedTree = true).assertExists()
    } finally {
      System.clearProperty("aglyn.reduceMotion")
    }
  }

  @Test
  fun monthKeysAreTheConsolesUtcMonths() {
    val oct19 = 1_792_439_000_000L // 2026-10-19
    assertEquals("2026-10", utcMonthKey(oct19))
    assertEquals("2026-09", utcMonthKey(oct19, 1))
    assertEquals("2025-12", utcMonthKey(1_767_225_600_000L + 86_400_000L * 5, 1)) // 2026-01-06 → December
  }

  @Test
  fun figuresReadAsTheUsagePageWritesThem() {
    assertEquals("84 / 100", planMeterFigures("pages", 84.0, 100.0))
    assertEquals("1.25 / 5 GB", planMeterFigures("bandwidth", 1.25, 5.0))
    assertEquals("120.5 / 1024 MB", planMeterFigures("storage", 120.5, 1024.0))
  }
}
