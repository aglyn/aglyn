package com.aglyn.shell

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynTheme
import kotlin.test.Test

/** A screen's error from before a dialog opened is not the dialog's to show; the dialog's own failure is (AGL-3903). */
@OptIn(ExperimentalTestApi::class)
class ActionDialogUiTest {
  @Test
  fun anErrorFromBeforeTheDialogOpenedStaysOutOfIt() = runComposeUiTest {
    var error by mutableStateOf<String?>("Add an author before publishing")
    setContent {
      AglynTheme(dark = false) {
        ActionDialog(
          title = "Delete this entry?",
          confirmLabel = "Delete",
          onConfirm = { error = "That entry could not be deleted." },
          onDismiss = {},
          error = error,
        )
      }
    }
    onNodeWithTag("action-dialog").assertIsDisplayed()
    onNodeWithTag("action-dialog-error").assertDoesNotExist()
    onNodeWithTag("action-dialog-confirm").performClick()
    waitForIdle()
    onNodeWithTag("action-dialog-error").assertIsDisplayed()
  }

  @Test
  fun theDialogsOwnFailureShowsEvenWhenItRepeatsTheEarlierOne() = runComposeUiTest {
    var error by mutableStateOf<String?>("That did not go through. Check the connection and try again.")
    setContent {
      AglynTheme(dark = false) {
        ActionDialog(
          title = "Delete this entry?",
          confirmLabel = "Delete",
          // The runner clears the error as a run starts and sets it again when the run fails with the same words.
          onConfirm = { error = null; error = "That did not go through. Check the connection and try again." },
          onDismiss = {},
          error = error,
        )
      }
    }
    onNodeWithTag("action-dialog-error").assertDoesNotExist()
    onNodeWithTag("action-dialog-confirm").performClick()
    waitForIdle()
    onNodeWithTag("action-dialog-error").assertIsDisplayed()
  }
}
