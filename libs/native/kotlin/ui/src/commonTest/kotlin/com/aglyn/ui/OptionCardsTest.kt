package com.aglyn.ui

import androidx.compose.ui.unit.dp
import kotlin.test.Test
import kotlin.test.assertEquals

class OptionCardsTest {
  @Test
  fun asManyCardsAsFitTakeTheWidth() {
    // An Android phone, inside the sheet's insets.
    assertEquals(2, optionCardColumns(380.dp))
    // The sheet's widest column on a tablet.
    assertEquals(4, optionCardColumns(688.dp))
    // Exactly two cards and the gap between them.
    assertEquals(2, optionCardColumns(312.dp))
    assertEquals(1, optionCardColumns(311.dp))
  }

  @Test
  fun aWidthTooNarrowForOneStillDrawsOne() {
    assertEquals(1, optionCardColumns(100.dp))
  }
}
