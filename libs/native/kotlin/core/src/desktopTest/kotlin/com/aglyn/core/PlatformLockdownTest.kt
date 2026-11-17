package com.aglyn.core

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The platform lockdown's notice in the console's `PlatformLockdownGate` words. */
class PlatformLockdownTest {
  private fun json(text: String) = Json.parseToJsonElement(text)

  @Test
  fun anOpenOrUnreadAnswerHoldsNobody() {
    assertNull(PlatformLockdownNotice.from(null, "Aglyn"))
    assertNull(PlatformLockdownNotice.from(json("""{"locked":false}"""), "Aglyn"))
  }

  @Test
  fun aLockWithNothingSaidUsesTheConsolesWords() {
    val notice = PlatformLockdownNotice.from(json("""{"locked":true,"title":" ","message":""}"""), "Aglyn")!!
    assertEquals("Temporarily unavailable", notice.title)
    assertEquals("Aglyn is temporarily unavailable. Please check back shortly.", notice.message)
    assertNull(notice.until)
    assertNull(notice.contact)
  }

  @Test
  fun aLockSaysItsOwnWordsItsEndAndWhoToAsk() {
    val notice = PlatformLockdownNotice.from(
      json("""{"locked":true,"title":"Down for maintenance","message":"Back soon.","contact":"help@example.test","untilMs":1794000000000}"""),
      "Aglyn",
      clock = { "2026-11-06" to "14:40" },
    )!!
    assertEquals("Down for maintenance", notice.title)
    assertEquals("Back soon.", notice.message)
    assertEquals("help@example.test", notice.contact)
    assertEquals("Expected back by Nov 6, 2026, 14:40.", notice.until)
  }
}
