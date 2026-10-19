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
import com.aglyn.shell.handOver
import com.aglyn.shell.handOverToIntro
import androidx.lifecycle.lifecycleScope
import com.aglyn.shell.handleConsoleHandoffReturn
import com.aglyn.core.AuthState
import com.aglyn.shell.AglynMessagingService
import com.aglyn.shell.EXTRA_LINK
import com.aglyn.shell.EXTRA_UID
import com.aglyn.shell.showAccountOfPush
import com.aglyn.shell.AglynShell
import kotlinx.coroutines.launch
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
  /** A link to open once signed in: a tapped notification's, or an aglyn:// / App Link URL. */
  private var pendingLink by mutableStateOf<String?>(null)

  /** The platform splash has gone, so the launch intro under it may move (P14). */
  private var splashGone by mutableStateOf(false)

  private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

  override fun onCreate(savedInstanceState: Bundle?) {
    val splash = installSplashScreen()
    super.onCreate(savedInstanceState)
    // The window under the app is the splash's own ground (light, or dark at night, resolved now), so nothing else (the
    // launcher behind a not-yet-drawn window) shows between the splash leaving and the first frame (P14).
    window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(getColor(R.color.aglyn_splash_ground)))
    enableEdgeToEdge()
    val services = (application as AglynApplication).services
    // A first launch hands the splash straight to the launch intro, whose first frame is the splash's own picture (P14); a
    // warm start keeps the splash up until the auth state is known, then exits with the spec's motion (AGL-3934).
    val playIntro = !com.aglyn.ui.LaunchIntro.hasPlayed
    // Removing the splash restores the post-splash theme's system bars, which undoes edge to edge for a frame (a black status
    // bar, the window laid out under it, the mark shifted): edge to edge goes back on in the same step, before that frame.
    if (playIntro) splash.handOverToIntro { enableEdgeToEdge(); splashGone = true } else splash.handOver(services)
    // Single sign-on's console page handing the code back finishes the sign-in here; anything else opens in the shell.
    openLink(intent, linkOf(intent)?.takeUnless { services.handleConsoleHandoffReturn(it, lifecycleScope) })
    // Debug builds only: `adb shell am start … --ez autoSignIn true` signs the seeded member in.
    val autoSignIn = BuildConfig.DEBUG && intent.getBooleanExtra("autoSignIn", false)
    AglynMessagingService.ensureChannel(this)
    lifecycleScope.launch {
      services.auth.state.collect { state -> if (state is AuthState.SignedIn) askForNotificationsOnce() }
    }
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
      // Scan stock reads barcodes with CameraX + ML Kit.
      CompositionLocalProvider(
        LocalCameraScanner provides CameraXBarcodeScanner,
        // Media uploads: the photo picker, the camera app and the document picker.
        com.aglyn.ui.LocalMediaPicker provides com.aglyn.shell.rememberAndroidMediaPicker(),
        // Exports (form submissions, records) go out through the share sheet.
        com.aglyn.ui.LocalFileExporter provides com.aglyn.shell.rememberAndroidFileExporter(),
        // Passkeys: the Credential Manager.
        com.aglyn.screens.LocalPasskeyCreator provides com.aglyn.shell.rememberAndroidPasskeyCreator(),
        // Signing in with a passkey: the same Credential Manager.
        com.aglyn.screens.LocalPasskeyAsserter provides com.aglyn.shell.rememberAndroidPasskeyAsserter(),
        // "Connect Google": the Credential Manager's Google ID token.
        com.aglyn.screens.LocalGoogleCredentialSource provides com.aglyn.shell.rememberAndroidGoogleCredentialSource(BuildConfig.GOOGLE_WEB_CLIENT_ID),
      ) {
        AglynShell(
          services, autoSignIn = autoSignIn, pendingLink = pendingLink, onLinkOpened = { pendingLink = null },
          playIntro = playIntro, launchMark = SPLASH_MARK, launchScreenGone = { splashGone },
        )
      }
    }
  }

  /** A new home-screen icon (Theme ▸ App icon) goes on as the app leaves the screen, so switching never closes it. */
  override fun onStop() {
    super.onStop()
    (application as AglynApplication).services.appIcons?.flush()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    val services = (application as AglynApplication).services
    linkOf(intent)?.takeUnless { services.handleConsoleHandoffReturn(it, lifecycleScope) }?.let { openLink(intent, it) }
  }

  /** A tapped push sent to another signed-in account brings that account on screen first; its link then opens there. */
  private fun openLink(intent: Intent?, link: String?) {
    val uid = intent?.getStringExtra(EXTRA_UID)
    if (uid == null) {
      pendingLink = link
      return
    }
    val services = (application as AglynApplication).services
    lifecycleScope.launch {
      services.showAccountOfPush(uid)
      pendingLink = link
    }
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

    /** The splash icon's mark (res/drawable-v31/splash_icon: 112 on the 288 canvas, Figma "Android / Splash"). */
    val SPLASH_MARK = 112.dp
  }
}
