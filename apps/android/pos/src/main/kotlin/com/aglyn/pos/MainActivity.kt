package com.aglyn.pos

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.CompositionLocalProvider
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.aglyn.shell.handOver
import androidx.lifecycle.lifecycleScope
import com.aglyn.camera.CameraXBarcodeScanner
import com.aglyn.ui.LocalCameraScanner
import com.aglyn.shell.AglynMessagingService
import com.aglyn.shell.handleConsoleHandoffReturn
import com.aglyn.pos.terminal.PermissionGate
import com.aglyn.shell.PosShell
import kotlinx.coroutines.CompletableDeferred

class MainActivity : ComponentActivity() {
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
    val splash = installSplashScreen()
    super.onCreate(savedInstanceState)
    // The window under the app is the splash's own ground (light, or dark at night, resolved now), so nothing else (the
    // launcher behind a not-yet-drawn window) shows between the splash leaving and the first frame (P14).
    window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(getColor(R.color.aglyn_splash_ground)))
    enableEdgeToEdge()
    val app = application as AglynPosApplication
    val services = app.services
    // The splash stays up until the auth state is known, then hands over with the spec's exit (AGL-3934).
    splash.handOver(services)
    app.permissionGate = readerGate
    // Stripe's card form registers for its result now, before this activity starts.
    app.keyedCards.attach(this)
    // Debug builds only: `adb shell am start … --ez autoSignIn true` signs the seeded member in.
    val autoSignIn = BuildConfig.DEBUG && intent.getBooleanExtra("autoSignIn", false)
    AglynMessagingService.ensureChannel(this)
    // Single sign-on's console page hands its code back to `aglyn-pos://auth/handoff`.
    services.handleConsoleHandoffReturn(intent?.dataString, lifecycleScope)
    setContent {
      // The register's camera button scans with CameraX + ML Kit.
      CompositionLocalProvider(
        LocalCameraScanner provides CameraXBarcodeScanner,
        // "Continue with Google": the Credential Manager's Google ID token.
        com.aglyn.screens.LocalGoogleCredentialSource provides com.aglyn.shell.rememberAndroidGoogleCredentialSource(BuildConfig.GOOGLE_WEB_CLIENT_ID),
      ) {
        PosShell(services, autoSignIn = autoSignIn)
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    (application as AglynPosApplication).services.handleConsoleHandoffReturn(intent.dataString, lifecycleScope)
  }

  override fun onDestroy() {
    val app = application as AglynPosApplication
    if (app.permissionGate === readerGate) app.permissionGate = null
    app.keyedCards.detach()
    pendingReaderAsk?.complete(false)
    super.onDestroy()
  }
}
