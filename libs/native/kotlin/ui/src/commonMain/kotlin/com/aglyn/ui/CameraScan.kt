package com.aglyn.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalIconToggleButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * A camera that reads barcodes. The kit draws the scan sheet; an app that
 * carries a camera implementation (CameraX + ML Kit in `native-camera`)
 * provides it through [LocalCameraScanner]. Where none is provided (the
 * desktop, or an app without the camera module) [LocalCameraScanner] is null
 * and screens leave the camera button out.
 */
interface CameraScanner {
  /**
   * The live viewfinder. Asks for the camera permission itself, and calls
   * [onCode] with every barcode it reads (the same code many times while it
   * stays in view; the caller filters).
   */
  @Composable
  fun Viewfinder(onCode: (String) -> Unit, torch: Boolean, modifier: Modifier)
}

val LocalCameraScanner = staticCompositionLocalOf<CameraScanner?> { null }

/**
 * Scans barcodes with the camera into [onCode], one after another, until the
 * cashier is done. [accept] filters the camera's repeated reads (a
 * `CameraScanFilter`); each accepted code buzzes, and [status] is the line
 * the caller shows for the last one ("Added Cold brew", "No product has this
 * code").
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BarcodeScanSheet(
  scanner: CameraScanner,
  onCode: (String) -> Unit,
  onDismiss: () -> Unit,
  status: String?,
  title: String = "Scan barcodes",
  accept: (String) -> String? = { it },
) {
  val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
  val haptics = LocalHapticFeedback.current
  var torch by remember { mutableStateOf(false) }
  ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, modifier = Modifier.testTag("barcode-scan-sheet")) {
    Column(
      Modifier.fillMaxWidth().padding(horizontal = space(3f)).navigationBarsPadding().padding(bottom = space(2f)),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f).semantics { heading() })
        FilledTonalIconToggleButton(checked = torch, onCheckedChange = { torch = it }) {
          Icon(AglynIcons.named(if (torch) "flashlight_off" else "flashlight_on"), if (torch) "Turn the light off" else "Turn the light on")
        }
      }
      Box(
        Modifier.widthIn(max = 560.dp).fillMaxWidth().aspectRatio(4f / 3f)
          .clip(RoundedCornerShape(AglynTokens.RADIUS.dp * 2))
          .background(Color.Black),
        contentAlignment = Alignment.Center,
      ) {
        scanner.Viewfinder(
          onCode = { raw ->
            val code = accept(raw) ?: return@Viewfinder
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            onCode(code)
          },
          torch = torch,
          modifier = Modifier.matchParentSize(),
        )
        // The aiming frame: where the barcode reads best.
        Box(
          Modifier.fillMaxWidth(0.72f).aspectRatio(2.4f)
            .border(2.dp, Color.White.copy(alpha = 0.85f), RoundedCornerShape(AglynTokens.RADIUS.dp)),
        )
      }
      Text(
        status ?: "Point the camera at a barcode. Scanned items are added one after another.",
        style = if (status == null) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.titleMedium,
        color = if (status == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("barcode-scan-last"),
      )
      TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.End)) { Text("Done") }
    }
  }
}
