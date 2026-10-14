package com.aglyn.screens

import com.aglyn.contracts.WeeklyHoursInterval
import com.aglyn.contracts.weeklyHoursFromText
import kotlin.test.Test
import kotlin.test.assertEquals

/** Pickup hours and delivery windows are picked from a week, not typed as `Mo-Fr 09:00-17:00` lines; what is saved is the same text. */
class CommerceHoursSpecsTest : SpecTestBase() {
  @Test
  fun pickupHoursArePickedFromAWeekAndKeepTheirSavedText() {
    val model = screen(
      spec("commerce", "commerce.locations"), emptyMap(),
      """{"locations":{"items":[{"${'$'}id":"L1","name":"Main","pickup":{"enabled":true,"hours":"Mo-Fr 09:00-17:00"}}]},"count":{"items":[],"count":1},"plan":{"quotas":{"inventoryLocations":4}}}""",
    )
    val pickup = model.rowActions("locations").first { it.id == "pickup" }
    val hours = pickup.prompt.first { it.key == "hours" }
    assertEquals("hours", hours.kind)
    assertEquals("Mo-Fr 09:00-17:00", ScreenValues.render(hours.initial!!, model.row("data.locations.items", 0)))
    val week = weeklyHoursFromText("Mo-Fr 09:00-17:00").hours
    assertEquals(listOf(WeeklyHoursInterval(540, 1020)), week[1])
    assertEquals(emptyList(), week[0], "Sunday is closed")
  }

  @Test
  fun deliveryWindowsOpenAtTheConsolesDefaultAndAreCalledWindows() {
    val model = screen(
      spec("commerce", "commerce.localDelivery"), emptyMap(),
      """{"store":{"localDelivery":{"enabled":true,"windows":"Sa 10:00-14:00"}},"locations":{"items":[]},"radius":null}""",
    )
    val windows = model.fieldsShown("settings", """{"enabled":true}""").first { it.key == "windows" }
    assertEquals("hours", windows.kind)
    assertEquals(ScreenValues.number(windows.hours.obj("start")), 540.0, "a newly opened day starts at 9:00 AM")
    assertEquals(ScreenValues.number(windows.hours.obj("end")), 720.0, "and ends at 12:00 PM, the console's default window")
    assertEquals("window", windows.hours.str("noun"))
  }
}
