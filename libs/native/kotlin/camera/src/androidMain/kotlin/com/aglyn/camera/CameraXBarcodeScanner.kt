package com.aglyn.camera

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.ImageAnalysis
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.CameraController
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.aglyn.ui.CameraScanner
import com.aglyn.ui.space
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode

/**
 * CameraX's preview with ML Kit reading every frame for the retail and
 * inventory symbologies (EAN/UPC, Code 128/39/93, ITF, Codabar, QR and Data
 * Matrix). The model is bundled, so scanning works offline and without Play
 * services.
 */
object CameraXBarcodeScanner : CameraScanner {
  private val FORMATS = intArrayOf(
    Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E, Barcode.FORMAT_CODE_128,
    Barcode.FORMAT_CODE_39, Barcode.FORMAT_CODE_93, Barcode.FORMAT_ITF, Barcode.FORMAT_CODABAR,
    Barcode.FORMAT_QR_CODE, Barcode.FORMAT_DATA_MATRIX,
  )

  @Composable
  override fun Viewfinder(onCode: (String) -> Unit, torch: Boolean, modifier: Modifier) {
    val context = LocalContext.current
    var granted by remember {
      mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    var asked by remember { mutableStateOf(false) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
      granted = it
      asked = true
    }
    LaunchedEffect(Unit) { if (!granted) ask.launch(Manifest.permission.CAMERA) }
    if (!granted) {
      Column(
        modifier.padding(space(3f)).testTag("camera-permission"),
        verticalArrangement = Arrangement.spacedBy(space(2f), Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
      ) {
        Text(
          if (asked) "Allow the camera in Settings to scan barcodes." else "Aglyn POS uses the camera to read barcodes.",
          color = Color.White,
          textAlign = TextAlign.Center,
        )
        Button(onClick = { ask.launch(Manifest.permission.CAMERA) }) { Text("Allow camera") }
      }
      return
    }

    val lifecycle = LocalLifecycleOwner.current
    val latest by rememberUpdatedState(onCode)
    val controller = remember { LifecycleCameraController(context) }
    DisposableEffect(lifecycle) {
      val barcodes = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_EAN_13, *FORMATS).build(),
      )
      val executor = ContextCompat.getMainExecutor(context)
      controller.setEnabledUseCases(CameraController.IMAGE_ANALYSIS)
      controller.imageAnalysisBackpressureStrategy = ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST
      controller.setImageAnalysisAnalyzer(
        executor,
        MlKitAnalyzer(listOf(barcodes), ImageAnalysis.COORDINATE_SYSTEM_VIEW_REFERENCED, executor) { result ->
          result.getValue(barcodes)?.firstNotNullOfOrNull { it.rawValue }?.let { latest(it) }
        },
      )
      controller.bindToLifecycle(lifecycle)
      onDispose {
        controller.clearImageAnalysisAnalyzer()
        controller.unbind()
        barcodes.close()
      }
    }
    LaunchedEffect(torch) { controller.enableTorch(torch) }
    Box(modifier) {
      AndroidView(
        factory = { PreviewView(it).apply { this.controller = controller; scaleType = PreviewView.ScaleType.FILL_CENTER } },
        modifier = Modifier.matchParentSize().testTag("camera-viewfinder"),
      )
    }
  }
}
