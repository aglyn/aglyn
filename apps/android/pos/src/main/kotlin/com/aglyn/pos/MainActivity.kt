package com.aglyn.pos

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.CompositionLocalProvider
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import com.aglyn.camera.CameraXBarcodeScanner
import com.aglyn.core.AuthState
import com.aglyn.ui.LocalCameraScanner
import com.aglyn.shell.AglynMessagingService
import com.aglyn.pos.terminal.PermissionGate
import com.aglyn.shell.PosShell
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
  private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

  /** The card reader's permission ask: one at a time, answered by this activity. */
  private var pendingReaderAsk: CompletableDeferred<Boolean>? = null
  private val askReaderPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { answers ->
    pendingReaderAsk?.complete(answers.values.all { it })
    pendingReaderAsk = null
  }
  private val readerGate = PermissionGate { permissions ->
    pendingReaderAsk?.complete(false)
    val answer = CompletableDeferred<Boolean>()
    pendingReaderAsk = answer
    askReaderPermissions.launch(permissions.toTypedArray())
    answer.await()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    installSplashScreen()
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    val app = application as AglynPosApplication
    val services = app.services
    app.permissionGate = readerGate
    // Debug builds only: `adb shell am start … --ez autoSignIn true` signs the seeded member in.
    val autoSignIn = BuildConfig.DEBUG && intent.getBooleanExtra("autoSignIn", false)
    AglynMessagingService.ensureChannel(this)
    lifecycleScope.launch {
      services.auth.state.collect { state -> if (state is AuthState.SignedIn) askForNotificationsOnce() }
    }
    setContent {
      // The register's camera button scans with CameraX + ML Kit.
      CompositionLocalProvider(LocalCameraScanner provides CameraXBarcodeScanner) {
        PosShell(services, autoSignIn = autoSignIn)
      }
    }
  }

  override fun onDestroy() {
    val app = application as AglynPosApplication
    if (app.permissionGate === readerGate) app.permissionGate = null
    pendingReaderAsk?.complete(false)
    super.onDestroy()
  }

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
