package com.aglyn.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performMouseInput
import androidx.compose.ui.test.click
import androidx.compose.ui.test.runDesktopComposeUiTest
import androidx.compose.ui.unit.dp
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynTheme
import com.aglyn.ui.CompactShellMetrics
import com.aglyn.ui.ListScreenScaffold
import com.aglyn.ui.LocalShellMetrics
import com.aglyn.ui.PrimaryAction
import com.aglyn.ui.ScaffoldListRow
import com.aglyn.ui.ScaffoldRowKind
import com.aglyn.ui.ScaffoldRowTile
import com.aglyn.ui.SectionCard
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * A list beside its detail on the desktop (AGL-4012; Figma Mac Orders 13:483, Apple's AGL-4007): both columns stand on the
 * surface, never the grey canvas; the list column's head is 20 above its 28 title row, 12 to the toolbar and 12 to the
 * rows; a selected row fills square across the column's whole width with its content on E; the detail's sections are
 * plain. Set AGLYN_COLUMNS_SHOT=<file> to keep the capture.
 */
@OptIn(ExperimentalTestApi::class)
class ContentColumnsTest {
  @Test
  fun aListBesideItsDetailMeasuresAsFigma() = runDesktopComposeUiTest(width = 1136, height = 821) {
    var picked by mutableStateOf<String?>(null)
    setContent {
      AglynTheme(dark = false) {
        // As the shell's content area stands (ContentGround): every column on the surface.
        CompositionLocalProvider(LocalShellMetrics provides CompactShellMetrics) { com.aglyn.ui.ContentGround {
          androidx.compose.foundation.layout.Box(Modifier.background(androidx.compose.material3.MaterialTheme.colorScheme.background)) {
          AglynListDetail(
            list = { selected, onSelect ->
              picked = selected
              ListScreenScaffold(
                "Orders", "", {}, "Search orders", tag = "orders", inListColumn = true,
                primary = PrimaryAction("orders-new", "Draft order") {},
              ) {
                Column {
                  for (n in listOf("1042", "1041", "1040")) {
                    ScaffoldListRow(
                      "#$n", "Jordan Lee", ScaffoldRowKind.ORDER, Modifier.testTag("row-$n"), selected = selected == n,
                      leading = { ScaffoldRowTile("receipt_long") }, figure = "$57.50",
                    ) { onSelect(n) }
                  }
                }
              }
            },
            detail = { selected ->
              if (selected != null) SectionCard("Items") { Text("Birthday Cake, 8 inch", Modifier.testTag("detail-item")) }
            },
          )
          }
        } }
      }
    }
    onNodeWithTag("row-1041").performClick()
    waitForIdle()
    assertEquals("1041", picked)
    val column = onNodeWithTag("list-column").getBoundsInRoot()
    val title = onNodeWithTag("orders-title-row").getBoundsInRoot()
    val toolbar = onNodeWithTag("orders-toolbar").getBoundsInRoot()
    val row = onNodeWithTag("row-1042").getBoundsInRoot()
    val selected = onNodeWithTag("row-1041").getBoundsInRoot()
    // Figma 13:483: title row 20 from the top, 28 tall; the toolbar at 60; the rows at 100.
    assertEquals(20.dp, title.top - column.top, "title row top")
    assertEquals(60.dp, toolbar.top - column.top, "toolbar top")
    assertEquals(100.dp, row.top - column.top, "first row top")
    // The selected row spans the column, edge to edge (square, no inset).
    assertEquals(column.left, selected.left, "the selection starts at the column's edge")
    assertEquals(column.right, selected.right, "the selection ends at the column's edge")
    val image = onRoot().captureToImage().toPixelMap()
    val density = this.density.density
    fun px(dp: Float) = (dp * density).toInt()
    val y = px(((selected.top + selected.bottom) / 2).value)
    // The fill reaches the column's first pixel; the ground beside the rows is the surface (white), never the canvas.
    val fill = image[px(column.left.value) + 1, y]
    val ground = image[px(column.left.value) + 1, px(row.top.value) - 4]
    assertTrue(fill.blue > fill.red, "the accent fill at the column's edge: $fill")
    assertTrue(ground.red > 0.99f && ground.green > 0.99f && ground.blue > 0.99f, "the list column's ground is the surface: $ground")
    val detailGround = image[image.width - 4, image.height - 4]
    assertTrue(detailGround.red > 0.99f && detailGround.green > 0.99f && detailGround.blue > 0.99f, "the detail column's ground is the surface: $detailGround")
    onNodeWithTag("plain-section", useUnmergedTree = true).assertExistsCompat()
    // A click in the row's reach past the column's inset still lands on the row.
    onNodeWithTag("row-1040").performMouseInput { click(androidx.compose.ui.geometry.Offset(2f, centerY)) }
    waitForIdle()
    assertEquals("1040", picked, "the row's full width is its target")
    (System.getProperty("aglyn.columnsShot") ?: System.getenv("AGLYN_COLUMNS_SHOT"))?.let { path ->
      val awt = java.awt.image.BufferedImage(image.width, image.height, java.awt.image.BufferedImage.TYPE_INT_ARGB)
      for (x in 0 until image.width) for (yy in 0 until image.height) {
        val c = image[x, yy]
        awt.setRGB(x, yy, ((c.alpha * 255).toInt() shl 24) or ((c.red * 255).toInt() shl 16) or ((c.green * 255).toInt() shl 8) or (c.blue * 255).toInt())
      }
      javax.imageio.ImageIO.write(awt, "png", java.io.File(path))
    }
  }
}

private fun androidx.compose.ui.test.SemanticsNodeInteraction.assertExistsCompat() = assertExists()

@OptIn(ExperimentalTestApi::class)
class ListColumnHeadTest {
  @Test
  fun aListBesideItsDetailTakesTheAreasHeadAndChipsIntoItsColumn() = runDesktopComposeUiTest(width = 1136, height = 821) {
    val slot = com.aglyn.ui.PageSectionsSlot()
    setContent {
      AglynTheme(dark = false) {
        CompositionLocalProvider(LocalShellMetrics provides CompactShellMetrics, com.aglyn.ui.LocalPageSections provides slot) {
          androidx.compose.runtime.SideEffect { slot.sections = { Text("Submissions · Members", Modifier.testTag("chips")) } }
          AglynListDetail(
            list = { _, _ ->
              Column {
                com.aglyn.ui.ListHeader("Inbox") { Text("Export", Modifier.testTag("export")) }
                Text("Search messages", Modifier.testTag("search"))
              }
            },
            detail = { Text("detail") },
          )
        }
      }
    }
    waitForIdle()
    assertTrue(slot.claimed, "the list column took the section chips")
    val column = onNodeWithTag("list-column").getBoundsInRoot()
    val head = onNodeWithTag("list-column-head").getBoundsInRoot()
    val chips = onNodeWithTag("chips").getBoundsInRoot()
    val search = onNodeWithTag("search").getBoundsInRoot()
    // 20 above the 28 title row, 12 below it; then the chips; then the toolbar.
    assertEquals(20.dp, head.top - column.top, "head top")
    assertEquals(48.dp, head.bottom - column.top, "head bottom (20 + 28)")
    assertEquals(60.dp, chips.top - column.top, "chips at 60")
    assertTrue(search.top >= chips.bottom, "the toolbar under the chips")
  }
}
