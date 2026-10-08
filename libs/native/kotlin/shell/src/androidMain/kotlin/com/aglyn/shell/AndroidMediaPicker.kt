package com.aglyn.shell

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
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
 * authority and its `aglyn_camera` path.
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
  return remember(context) {
    object : MediaPicker {
      override val sources = listOf(PickSource.PHOTOS, PickSource.CAMERA, PickSource.FILES)

      override suspend fun pick(source: PickSource, multiple: Boolean): List<PickedFile> {
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
            camera.launch(uri)
          }
        }
        val uris = waiting.await()
        return withContext(Dispatchers.IO) { uris.mapNotNull { read(context, it, source) } }
      }
    }
  }
}

private class PickerBridge {
  private var pending: CompletableDeferred<List<Uri>>? = null
  var cameraUri: Uri? = null

  fun start(): CompletableDeferred<List<Uri>> {
    pending?.complete(emptyList())
    return CompletableDeferred<List<Uri>>().also { pending = it }
  }

  fun finish(uris: List<Uri>) {
    pending?.complete(uris)
    pending = null
  }
}

private fun read(context: Context, uri: Uri, source: PickSource): PickedFile? {
  val resolver = context.contentResolver
  val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
  val type = resolver.getType(uri) ?: if (source == PickSource.CAMERA) "image/jpeg" else "application/octet-stream"
  val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
    if (cursor.moveToFirst()) cursor.getString(0) else null
  } ?: uri.lastPathSegment?.substringAfterLast('/') ?: "file"
  return PickedFile(name, type, bytes)
}
