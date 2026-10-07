package com.aglyn.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.aglyn.shell.AglynShell

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    installSplashScreen()
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    val services = (application as AglynApplication).services
    // Debug builds only: `adb shell am start … --ez autoSignIn true` signs the seeded member in.
    val autoSignIn = BuildConfig.DEBUG && intent.getBooleanExtra("autoSignIn", false)
    setContent { AglynShell(services, autoSignIn = autoSignIn) }
  }
}
