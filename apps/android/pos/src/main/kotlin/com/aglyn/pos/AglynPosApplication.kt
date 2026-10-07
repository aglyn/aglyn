package com.aglyn.pos

import android.app.Application
import com.aglyn.core.AglynEnv
import com.aglyn.hardware.SimulatedCardCollector
import com.aglyn.hardware.StaticPeripherals
import com.aglyn.hardware.StripeTerminalSdkCollector
import com.aglyn.pluginhost.NativeApp
import com.aglyn.plugins.manifest.NativePlugins
import com.aglyn.shell.AndroidShell
import com.aglyn.shell.ShellServices

class AglynPosApplication : Application() {
  val services: ShellServices by lazy {
    AndroidShell.services(
      context = this,
      app = NativeApp.POS,
      env = AglynEnv(
        consoleUrl = BuildConfig.CONSOLE_URL,
        firebaseApiKey = BuildConfig.FIREBASE_API_KEY,
        firebaseAuthDomain = BuildConfig.FIREBASE_AUTH_DOMAIN,
        firebaseProjectId = BuildConfig.FIREBASE_PROJECT_ID,
        firebaseAppId = BuildConfig.FIREBASE_APP_ID,
        firebaseMessagingSenderId = BuildConfig.FIREBASE_MESSAGING_SENDER_ID,
        authEmulatorHost = BuildConfig.AUTH_EMULATOR_HOST,
        firestoreEmulatorHost = BuildConfig.FIRESTORE_EMULATOR_HOST,
      ),
      manifest = NativePlugins.entries,
      appVersion = BuildConfig.VERSION_NAME,
      debugSignIn = if (BuildConfig.DEBUG && BuildConfig.DEBUG_EMAIL.isNotEmpty()) {
        BuildConfig.DEBUG_EMAIL to BuildConfig.DEBUG_PASSWORD
      } else {
        null
      },
      // Tap to Pay and Bluetooth readers arrive with the Stripe Terminal SDK;
      // until then a debug build trains on a simulated reader.
      peripherals = StaticPeripherals(
        cardCollector = if (BuildConfig.DEBUG) SimulatedCardCollector() else StripeTerminalSdkCollector(),
      ),
    )
  }
}
