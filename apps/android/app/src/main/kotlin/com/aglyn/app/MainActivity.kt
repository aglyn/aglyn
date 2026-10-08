package com.aglyn.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import com.aglyn.camera.CameraXBarcodeScanner
import com.aglyn.ui.LocalCameraScanner
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import com.aglyn.core.AuthState
import com.aglyn.shell.AglynMessagingService
import com.aglyn.shell.EXTRA_LINK
import com.aglyn.shell.AglynShell
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
  /** A link to open once signed in: a tapped notification's, or an aglyn:// / App Link URL. */
  private var pendingLink by mutableStateOf<String?>(null)

  private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

  override fun onCreate(savedInstanceState: Bundle?) {
    installSplashScreen()
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    val services = (application as AglynApplication).services
    pendingLink = linkOf(intent)
    // Debug builds only: `adb shell am start … --ez autoSignIn true` signs the seeded member in.
    val autoSignIn = BuildConfig.DEBUG && intent.getBooleanExtra("autoSignIn", false)
    AglynMessagingService.ensureChannel(this)
    lifecycleScope.launch {
      services.auth.state.collect { state -> if (state is AuthState.SignedIn) askForNotificationsOnce() }
    }
    setContent {
      // Scan stock reads barcodes with CameraX + ML Kit.
      CompositionLocalProvider(
        LocalCameraScanner provides CameraXBarcodeScanner,
        // Media uploads: the photo picker, the camera app and the document picker.
        com.aglyn.ui.LocalMediaPicker provides com.aglyn.shell.rememberAndroidMediaPicker(),
        // Exports (form submissions, records) go out through the share sheet.
        com.aglyn.ui.LocalFileExporter provides com.aglyn.shell.rememberAndroidFileExporter(),
      ) {
        AglynShell(services, autoSignIn = autoSignIn, pendingLink = pendingLink, onLinkOpened = { pendingLink = null })
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    linkOf(intent)?.let { pendingLink = it }
  }

  private fun linkOf(intent: Intent?): String? = intent?.getStringExtra(EXTRA_LINK) ?: intent?.dataString

  /** Android 13+ asks before the first notification; once, after sign-in. */
  private fun askForNotificationsOnce() {
    if (Build.VERSION.SDK_INT < 33) return
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
    val prefs = getSharedPreferences("aglyn", MODE_PRIVATE)
    if (prefs.getBoolean(ASKED, false)) return
    prefs.edit().putBoolean(ASKED, true).apply()
    askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
  }

  private companion object {
    const val ASKED = "aglyn.notifications.asked"
  }
}
