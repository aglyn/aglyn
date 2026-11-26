// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site

import com.aglyn.site.setup.ThemePreviewAccent
import com.aglyn.site.setup.themePreviewAnswerOf
import com.aglyn.site.setup.themePreviewLead
import com.aglyn.site.setup.themePreviewNotice
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The theme picker's preview (AGL-3668): the route's answer read as the kit draws it, and the console's words. The Swift ThemePreviewTests. */
class ThemePreviewTest {
  private val answer = """
    {"name":"Minimal","edited":true,
     "light":{"scheme":"light","fontFamily":"Inter","background":{"default":"#ffffff","paper":"#fdfdfd"},
       "text":{"primary":"rgba(0, 0, 0, 0.87)","secondary":"#6b6b74","disabled":"#a1a1aa"},"divider":"#e4e4e7",
       "primary":{"main":"#18181b","contrastText":"#fafafa","dark":"#000000"},
       "secondary":{"main":"#52525b","contrastText":"#fafafa"},
       "surface":{"main":"#f4f4f5","contrastText":"#18181b"},"tint":{"primary":"#f4f4f5","secondary":"#f4f4f5","tertiary":"#fafafa"},
       "selected":"rgba(0, 0, 0, 0.08)","radius":8,
       "typography":[{"key":"h1","sizePx":36,"raw":"2.25rem","weight":800},{"key":"body1","sizePx":16,"raw":"1rem","weight":null},{"key":"bad"}]},
     "dark":{"primary":{"main":"#fafafa","contrastText":"#18181b"},"background":{"default":"#09090b","paper":"#09090b"}}}
  """.trimIndent()

  @Test
  fun theAnswerReadsAsTheKitDrawsIt() {
    val read = themePreviewAnswerOf(Json.parseToJsonElement(answer))
    assertEquals("Minimal", read.name)
    assertTrue(read.edited)
    val light = read.kit(dark = false)
    assertEquals(ThemePreviewAccent("#18181b", "#fafafa", "#000000"), light.primary)
    // A colour with no darker shade of its own draws its main.
    assertEquals("#52525b", light.secondary.dark)
    assertEquals("#fdfdfd", light.backgroundPaper)
    assertEquals("rgba(0, 0, 0, 0.08)", light.selected)
    assertEquals(8.0, light.radius)
    // A rung without a size is left out; a rung without a weight keeps its size.
    assertEquals(listOf("h1", "body1"), light.typography.map { it.key })
    assertEquals(800, light.typography.first().weight)
    assertNull(light.typography.last().weight)
    val dark = read.kit(dark = true)
    assertEquals("#fafafa", dark.primary.main)
    assertEquals("#09090b", dark.backgroundDefault)
    assertEquals("", dark.divider)
  }

  @Test
  fun theConsoleWordsAroundThePreview() {
    assertEquals("Previewing Minimal.", themePreviewLead("Minimal", false))
    assertEquals("Previewing Minimal with the edits you made to it.", themePreviewLead("Minimal", true))
    assertEquals(
      "Using Minimal repaints the live site now. Spring stays in this list with your edits to it, so you can switch back. " +
        "Unsaved changes in the editor below are discarded.",
      themePreviewNotice("Minimal", "Spring", true),
    )
    assertEquals(
      "Using Minimal repaints the live site now. The current theme stays in this list, so you can switch back. " +
        "Unsaved changes in the editor below are discarded.",
      themePreviewNotice("Minimal", null, false),
    )
  }
}
