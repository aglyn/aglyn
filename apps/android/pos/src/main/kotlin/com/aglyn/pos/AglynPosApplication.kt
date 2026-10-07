package com.aglyn.pos

import android.app.Application
import com.aglyn.core.AglynEnv
import com.aglyn.hardware.StaticPeripherals
import com.aglyn.pluginhost.NativeApp
import com.aglyn.plugins.manifest.NativePlugins
import com.aglyn.shell.AndroidShell
import com.aglyn.pos.terminal.PermissionGate
import com.aglyn.pos.terminal.StripeTerminalCollector
import com.aglyn.shell.ShellServices
import com.stripe.stripeterminal.TerminalApplicationDelegate
import com.stripe.stripeterminal.taptopay.TapToPay

class AglynPosApplication : Application() {
  /** The activity on screen, which asks for the card reader's permissions. */
  @Volatile var permissionGate: PermissionGate? = null

  override fun onCreate() {
    super.onCreate()
    // Tap to Pay runs its PIN and card screens in its own process; nothing
    // of the app's belongs there.
    if (TapToPay.isInTapToPayProcess()) return
    TerminalApplicationDelegate.onCreate(this)
  }

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
      // Tap to Pay and Bluetooth readers through the Stripe Terminal SDK.
      // Only the SDK's simulated readers run until live readers are switched
      // on for a build (TERMINAL_LIVE_READERS), which needs Stripe live mode.
      peripherals = StaticPeripherals(
        cardCollector = StripeTerminalCollector(this, simulated = !BuildConfig.TERMINAL_LIVE_READERS, permissions = { permissionGate }),
      ),
    )
  }
}
