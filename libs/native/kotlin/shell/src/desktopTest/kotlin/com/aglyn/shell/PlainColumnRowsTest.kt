package com.aglyn.shell

import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.runDesktopComposeUiTest
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aglyn.ui.AglynTheme
import com.aglyn.ui.AmountRow
import kotlin.test.Test
import kotlin.test.assertEquals

/** A plain detail column's totals row is Figma's 40 (Mac 13:483, iPad 13:2167): 14/20 text with 10 above and below. */
@OptIn(ExperimentalTestApi::class)
class PlainColumnRowsTest {
  @Test
  fun aTotalsRowIsFortyTall() = runDesktopComposeUiTest(width = 600, height = 200) {
    setContent {
      AglynTheme(dark = false) {
        AmountRow("Shipping", "$5.99", Modifier.testTag("row").padding(vertical = 10.dp), size = 14.sp)
      }
    }
    val bounds = onNodeWithTag("row").getBoundsInRoot()
    assertEquals(40f, (bounds.bottom - bounds.top).value, 0.5f)
  }
}
