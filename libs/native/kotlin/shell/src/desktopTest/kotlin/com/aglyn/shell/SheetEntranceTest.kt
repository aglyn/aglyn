package com.aglyn.shell

import androidx.compose.material3.Text
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.runDesktopComposeUiTest
import androidx.compose.ui.unit.dp
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.FormSheet
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * On the desktop a sheet or dialog moves in when it opens (AGL-4013): Compose shows a dialog's window at once, where the
 * Mac and Android move theirs. A sheet rises 16 dp into place on the drill's spring; a dialog grows from 96%.
 */
@OptIn(ExperimentalTestApi::class)
class SheetEntranceTest {
  @Test
  fun aSheetRisesIntoPlace() = runDesktopComposeUiTest(width = 1280, height = 800) {
    mainClock.autoAdvance = false
    setContent { FormSheet("Rename", busy = false, error = null, onDismiss = {}, onConfirm = {}) { Text("Name") } }
    mainClock.advanceTimeByFrame()
    mainClock.advanceTimeBy(16)
    val early = onNodeWithTag("form-sheet", useUnmergedTree = true).getBoundsInRoot().top
    mainClock.advanceTimeBy(800)
    val settled = onNodeWithTag("form-sheet", useUnmergedTree = true).getBoundsInRoot().top
    mainClock.autoAdvance = true
    assertTrue(early - settled > 4.dp, "the sheet starts below its place: early $early, settled $settled")
    assertTrue(early - settled <= 16.dp, "no further than the 16 dp rise: early $early, settled $settled")
  }

  @Test
  fun aDialogGrowsIntoPlace() = runDesktopComposeUiTest(width = 1280, height = 800) {
    mainClock.autoAdvance = false
    setContent { ActionDialog("Remove this tab?", "Remove", onConfirm = {}, onDismiss = {}) }
    mainClock.advanceTimeByFrame()
    mainClock.advanceTimeBy(16)
    val early = onNodeWithTag("action-dialog", useUnmergedTree = true).getBoundsInRoot().let { it.right - it.left }
    mainClock.advanceTimeBy(400)
    val settled = onNodeWithTag("action-dialog", useUnmergedTree = true).getBoundsInRoot().let { it.right - it.left }
    mainClock.autoAdvance = true
    assertTrue(early < settled, "the dialog starts a little smaller: early $early, settled $settled")
    assertTrue(early >= settled * 0.95f, "from 96%, never smaller: early $early, settled $settled")
  }
}
