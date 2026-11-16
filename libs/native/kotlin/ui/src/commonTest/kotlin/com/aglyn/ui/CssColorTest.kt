// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.ui

import androidx.compose.ui.graphics.Color
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** A CSS color as a theme writes it (`parseCssColor`), as the Swift kit's `AglynCSSColor.parse` reads it. */
class CssColorTest {
  @Test
  fun readsHexRgbAndRgba() {
    assertEquals(Color(0x18, 0x18, 0x1b), parseCssColor("#18181b"))
    assertEquals(Color(0xff, 0xff, 0xff), parseCssColor("#FFF"))
    assertEquals(Color(0, 0, 0, 20), parseCssColor("rgba(0, 0, 0, 0.08)"))
    assertEquals(Color(25, 118, 210), parseCssColor(" rgb(25, 118, 210) "))
    assertNull(parseCssColor("var(--x)"))
    assertNull(parseCssColor("rgb(1, 2)"))
    assertNull(parseCssColor(""))
  }
}
