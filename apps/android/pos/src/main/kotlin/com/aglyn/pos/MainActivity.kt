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
import com.aglyn.shell.handOverToIntro
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.aglyn.camera.CameraXBarcodeScanner
import com.aglyn.ui.LocalCameraScanner
import com.aglyn.shell.AglynMessagingService
import com.aglyn.shell.handleConsoleHandoffReturn
import com.aglyn.pos.terminal.PermissionGate
import com.aglyn.shell.PosShell
import kotlinx.coroutines.CompletableDeferred

class MainActivity : ComponentActivity() {
  /** The platform splash has gone, so the launch intro under it may move (P14). */
  private var splashGone by mutableStateOf(false)

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
    // A first launch hands the splash straight to the launch intro, whose first frame is the splash's own picture (P14); a
    // warm start keeps the splash up until the auth state is known, then exits with the spec's motion (AGL-3934).
    val playIntro = !com.aglyn.ui.LaunchIntro.hasPlayed
    // Removing the splash restores the post-splash theme's system bars, which undoes edge to edge for a frame (a black status
    // bar, the window laid out under it, the mark shifted): edge to edge goes back on in the same step, before that frame.
    if (playIntro) splash.handOverToIntro { enableEdgeToEdge(); splashGone = true } else splash.handOver(services)
    app.permissionGate = readerGate
    // Stripe's card form registers for its result now, before this activity starts.
    app.keyedCards.attach(this)
    // Debug builds only: `adb shell am start … --ez autoSignIn true` signs the seeded member in.
    val autoSignIn = BuildConfig.DEBUG && intent.getBooleanExtra("autoSignIn", false)
    AglynMessagingService.ensureChannel(this)
    // Single sign-on's console page hands its code back to `aglyn-pos://auth/handoff`.
    services.handleConsoleHandoffReturn(intent?.dataString, lifecycleScope)
    setContent {
      // The intro moves once the splash has gone; if the system removed it without telling the app, it moves anyway shortly
      // after the first frame (SPLASH_HAND_OVER_LIMIT_MS).
      if (playIntro) {
        androidx.compose.runtime.LaunchedEffect(Unit) {
          androidx.compose.runtime.withFrameNanos { }
          kotlinx.coroutines.delay(com.aglyn.shell.SPLASH_HAND_OVER_LIMIT_MS)
          splashGone = true
        }
      }
      // The register's camera button scans with CameraX + ML Kit.
      CompositionLocalProvider(
        LocalCameraScanner provides CameraXBarcodeScanner,
        // "Continue with Google": the Credential Manager's Google ID token.
        com.aglyn.screens.LocalGoogleCredentialSource provides com.aglyn.shell.rememberAndroidGoogleCredentialSource(BuildConfig.GOOGLE_WEB_CLIENT_ID),
      ) {
        // The splash icon's mark is 112 on its 288 canvas (res/drawable-v31/splash_icon, Figma "Android / Splash").
        PosShell(services, autoSignIn = autoSignIn, playIntro = playIntro, launchMark = 112.dp, launchScreenGone = { splashGone })
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
