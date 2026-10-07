package com.aglyn.pos

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import com.aglyn.core.AuthState
import com.aglyn.shell.AglynMessagingService
import com.aglyn.shell.PosShell
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
  private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

  override fun onCreate(savedInstanceState: Bundle?) {
    installSplashScreen()
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    val services = (application as AglynPosApplication).services
    // Debug builds only: `adb shell am start … --ez autoSignIn true` signs the seeded member in.
    val autoSignIn = BuildConfig.DEBUG && intent.getBooleanExtra("autoSignIn", false)
    AglynMessagingService.ensureChannel(this)
    lifecycleScope.launch {
      services.auth.state.collect { state -> if (state is AuthState.SignedIn) askForNotificationsOnce() }
    }
    setContent { PosShell(services, autoSignIn = autoSignIn) }
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
