package com.aglyn.screens

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** How a spec screen draws its toolbar's first action, and a fields row's value. */
class SpecToolbarAndValuesTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }
  private val specs = File(root, "libs/native/screens").listFiles { f -> f.name.endsWith(".screens.json") }!!
    .flatMap { ScreenSpec.parseFile(it.readText()) }
  private fun spec(id: String) = specs.first { it.id == id }

  @Test
  fun aFilterOrASettingEditIsNeverTheFilledPrimary() {
    // Each reopens its own screen with new params, or PUTs one setting.
    val quiet = mapOf(
      "core.staff.marketplaceReports" to "Show another state",
      "core.staff.pluginReviews" to "Search or filter",
      "core.staff.audit" to "Filter the log",
      "core.staff.alerts" to "Change the digest hour",
    )
    for ((id, label) in quiet) {
      val screen = spec(id)
      val first = screen.actions.first()
      assertEquals(label, first.label)
      assertTrue(first.quietOn(screen.id), "$id: \"$label\" should be quiet")
    }
  }

  @Test
  fun aScreensMainActStaysPrimary() {
    // Every first toolbar action outside the staff area creates or runs something, so it keeps the filled button.
    val loud = specs.filter { !it.id.startsWith("core.staff.") && it.actions.isNotEmpty() }
    assertTrue(loud.isNotEmpty())
    for (screen in loud) assertFalse(screen.actions.first().quietOn(screen.id), "${screen.id}: ${screen.actions.first().label}")
  }

  @Test
  fun oneWordValuesStayOnOneLine() {
    assertTrue(singleToken("mobile-owner@example.test"))
    assertTrue(singleToken("aAN7y9FpduMwuYKg337ARCyAQNKY"))
    assertFalse(singleToken("Sign in with your email and password"))
    assertFalse(singleToken(""))
  }
}
