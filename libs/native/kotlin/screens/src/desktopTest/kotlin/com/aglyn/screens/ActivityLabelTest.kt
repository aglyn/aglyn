package com.aglyn.screens

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

/** An Activity row's action reads in words, never as the stored code (`activityActionLabel`). */
class ActivityLabelTest {
  private fun shown(action: String) = ScreenValues.render("{item.action:activity}", Json.parseToJsonElement("""{"item":{"action":"$action"}}"""))

  @Test
  fun anActivityActionReadsInWords() {
    assertEquals("Duplicated a component", shown("component.duplicated"))
    assertEquals("Duplicated an email design", shown("emailDesign.duplicated"))
    assertEquals("Billing: invoice paid", shown("billing.invoice.paid"))
    assertEquals("Site: reattach domain", shown("host.reattach-domain"))
    assertEquals("Saved the screen", shown("Saved the screen"))
  }
}
