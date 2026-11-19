package com.aglyn.shell

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.aglyn.ui.MediaPicker
import com.aglyn.ui.PickSource
import com.aglyn.ui.PickedFile
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * The Android system pickers as the kit's [MediaPicker]: the photo picker
 * (no storage permission), the camera app through a FileProvider file, and
 * the document picker. The app's manifest declares the `…fileprovider`
 * authority and its `aglyn_camera` path. Both apps declare the camera
 * permission (the barcode scanner), so "Take a photo" asks for it first and a
 * refusal, a revoked grant or a device with no camera app ends in the
 * [CameraAccess] message, never a crash; Photos and Files stay usable.
 */
@Composable
fun rememberAndroidMediaPicker(): MediaPicker {
  val context = LocalContext.current
  val bridge = remember { PickerBridge() }
  val photos = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { uris -> bridge.finish(uris) }
  val photo = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> bridge.finish(listOfNotNull(uri)) }
  val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> bridge.finish(uris) }
  val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { taken ->
    bridge.finish(if (taken) listOfNotNull(bridge.cameraUri) else emptyList())
  }
  val askCamera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> bridge.answer(granted) }
  return remember(context) {
    object : MediaPicker {
      override val sources = listOf(PickSource.PHOTOS, PickSource.CAMERA, PickSource.FILES)

      override suspend fun pick(source: PickSource, multiple: Boolean): List<PickedFile> {
        if (source == PickSource.CAMERA && !cameraAllowed()) {
          tell(CameraAccess.Failure.NOT_ALLOWED)
          return emptyList()
        }
        val waiting = bridge.start()
        when (source) {
          PickSource.PHOTOS -> {
            val request = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)
            if (multiple) photos.launch(request) else photo.launch(request)
          }
          PickSource.FILES -> files.launch(arrayOf("*/*"))
          PickSource.CAMERA -> {
            val dir = File(context.cacheDir, "aglyn_camera").apply { mkdirs() }
            val shot = File(dir, "photo-${System.currentTimeMillis()}.jpg")
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", shot)
            bridge.cameraUri = uri
            val failure = CameraAccess.start({ camera.launch(uri) }) { error ->
              when (error) {
                is SecurityException -> CameraAccess.Failure.NOT_ALLOWED
                is ActivityNotFoundException -> CameraAccess.Failure.NO_CAMERA_APP
                else -> null
              }
            }
            if (failure != null) {
              bridge.finish(emptyList())
              tell(failure)
            }
          }
        }
        val uris = waiting.await()
        return withContext(Dispatchers.IO) { uris.mapNotNull { read(context, it, source) } }
      }

      /** Asks for the camera when the app declares it and does not hold it yet; once per tap. */
      private suspend fun cameraAllowed(): Boolean {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        return when (CameraAccess.before(declaresCamera(context), granted)) {
          CameraAccess.Step.LAUNCH -> true
          CameraAccess.Step.REFUSE -> false
          CameraAccess.Step.ASK -> CameraAccess.afterAsk(bridge.ask { askCamera.launch(Manifest.permission.CAMERA) }) == CameraAccess.Step.LAUNCH
        }
      }

      private fun tell(failure: CameraAccess.Failure) {
        Toast.makeText(context, CameraAccess.message(failure), Toast.LENGTH_LONG).show()
      }
    }
  }
}

private class PickerBridge {
  private var pending: CompletableDeferred<List<Uri>>? = null
  private var asking: CompletableDeferred<Boolean>? = null
  var cameraUri: Uri? = null

  /** One permission ask at a time; an earlier one still open counts as refused. */
  suspend fun ask(launch: () -> Unit): Boolean {
    asking?.complete(false)
    val answer = CompletableDeferred<Boolean>().also { asking = it }
    launch()
    return answer.await()
  }

  fun answer(granted: Boolean) {
    asking?.complete(granted)
    asking = null
  }

  fun start(): CompletableDeferred<List<Uri>> {
    pending?.complete(emptyList())
    return CompletableDeferred<List<Uri>>().also { pending = it }
  }

  fun finish(uris: List<Uri>) {
    pending?.complete(uris)
    pending = null
  }
}

/** Whether this app's manifest asks for the camera; only then must it hold the grant before starting the camera app. */
private fun declaresCamera(context: Context): Boolean = runCatching {
  @Suppress("DEPRECATION")
  context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
    .requestedPermissions.orEmpty().contains(Manifest.permission.CAMERA)
}.getOrDefault(true)

private fun read(context: Context, uri: Uri, source: PickSource): PickedFile? {
  val resolver = context.contentResolver
  val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
  val type = resolver.getType(uri) ?: if (source == PickSource.CAMERA) "image/jpeg" else "application/octet-stream"
  val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
    if (cursor.moveToFirst()) cursor.getString(0) else null
  } ?: uri.lastPathSegment?.substringAfterLast('/') ?: "file"
  return PickedFile(name, type, bytes)
}
