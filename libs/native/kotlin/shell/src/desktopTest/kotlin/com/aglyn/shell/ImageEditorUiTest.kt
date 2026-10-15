package com.aglyn.shell

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.runComposeUiTest
import com.aglyn.site.media.ImageEditorContent
import com.aglyn.ui.AglynTheme
import com.aglyn.ui.LocalImageTransformer
import com.aglyn.ui.PickedFile
import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import javax.imageio.ImageIO
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class)
class ImageEditorUiTest {
  /** A 40 x 20 picture: red on the left, blue on the right. */
  private fun picture(): ByteArray {
    val image = BufferedImage(40, 20, BufferedImage.TYPE_INT_ARGB)
    for (x in 0 until 40) for (y in 0 until 20) image.setRGB(x, y, if (x < 20) 0xFFFF0000.toInt() else 0xFF0000FF.toInt())
    return ByteArrayOutputStream().also { ImageIO.write(image, "png", it) }.toByteArray()
  }

  @Test
  fun aPersonRotatesThePictureAndReplacesTheOriginal() = runComposeUiTest {
    var saved: Pair<PickedFile, Boolean>? = null
    setContent {
      AglynTheme(dark = false) {
        CompositionLocalProvider(LocalImageTransformer provides DesktopImageTransformer) {
          ImageEditorContent("photo.png", { picture() }, busy = false, error = null, onDismiss = {}, onSave = { file, copy -> saved = file to copy })
        }
      }
    }
    waitUntil(timeoutMillis = 5_000) { onAllNodesWithTagCount("image-edit-replace") > 0 }
    onNodeWithTag("image-edit-replace").assertIsDisplayed().assertIsEnabled()
    onNodeWithTag("image-edit-rotate-right").performClick()
    onNodeWithTag("image-edit-max-width").performTextInput("10")
    onNodeWithTag("image-edit-replace").performClick()
    waitUntil(timeoutMillis = 5_000) { saved != null }
    val (file, copy) = assertNotNull(saved)
    assertEquals(false, copy)
    assertEquals("photo.png", file.name)
    assertEquals("image/png", file.mimeType)
    // Turned a quarter: 20 wide and 40 tall, shrunk to 10 wide, so 10 x 20, red above blue.
    val out = ImageIO.read(ByteArrayInputStream(file.bytes))
    assertEquals(10 to 20, out.width to out.height)
    assertTrue((out.getRGB(5, 3) and 0xFF0000) != 0 && (out.getRGB(5, 3) and 0xFF) == 0, "top is red")
    assertTrue((out.getRGB(5, 16) and 0xFF) != 0 && (out.getRGB(5, 16) and 0xFF0000) == 0, "bottom is blue")
  }

  @Test
  fun aCopyIsNamedAndSavedAsACopy() = runComposeUiTest {
    var saved: Pair<PickedFile, Boolean>? = null
    setContent {
      AglynTheme(dark = false) {
        CompositionLocalProvider(LocalImageTransformer provides DesktopImageTransformer) {
          ImageEditorContent("Team Photo.jpg", { picture() }, busy = false, error = null, onDismiss = {}, onSave = { file, copy -> saved = file to copy })
        }
      }
    }
    waitUntil(timeoutMillis = 5_000) { onAllNodesWithTagCount("image-edit-save-copy") > 0 }
    onNodeWithTag("image-edit-save-copy").performClick()
    waitUntil(timeoutMillis = 5_000) { saved != null }
    assertEquals(true, saved?.second)
    assertEquals("Team Photo (edited).jpg", saved?.first?.name)
    assertEquals("image/jpeg", saved?.first?.mimeType)
  }

  @Test
  fun aFormatTheDeviceCannotReadSaysSoInsteadOfOpeningAnEditor() = runComposeUiTest {
    setContent {
      AglynTheme(dark = false) {
        CompositionLocalProvider(LocalImageTransformer provides DesktopImageTransformer) {
          ImageEditorContent("vector.svg", { "<svg/>".encodeToByteArray() }, busy = false, error = null, onDismiss = {}, onSave = { _, _ -> })
        }
      }
    }
    waitUntil(timeoutMillis = 5_000) { onAllNodesWithTagCount("image-edit-failed") > 0 }
    onNodeWithTag("image-edit-failed").assertIsDisplayed()
    onNodeWithTag("image-edit-cancel").assertIsEnabled()
  }
}

@OptIn(ExperimentalTestApi::class)
private fun androidx.compose.ui.test.ComposeUiTest.onAllNodesWithTagCount(tag: String): Int =
  onAllNodes(androidx.compose.ui.test.hasTestTag(tag)).fetchSemanticsNodes().size
