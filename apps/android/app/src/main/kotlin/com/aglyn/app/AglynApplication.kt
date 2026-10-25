package com.aglyn.app

import android.app.Application
import android.webkit.WebView
import com.aglyn.core.AglynEnv
import com.aglyn.hardware.AndroidSystemPrinter
import com.aglyn.hardware.StaticPeripherals
import com.aglyn.pluginhost.NativeApp
import com.aglyn.plugins.manifest.NativePluginManifest
import com.aglyn.shell.AndroidShell
import com.aglyn.shell.ShellServices

class AglynApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    // Debug builds expose their web views (the Besigner) to chrome://inspect, as the console tab is in a desktop browser. It
    // loads the WebView provider (about a second on an emulator), so it waits until the launch has drawn.
    if (BuildConfig.DEBUG) {
      android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ WebView.setWebContentsDebuggingEnabled(true) }, 3_000)
    }
  }

  val services: ShellServices by lazy {
    AndroidShell.services(
      context = this,
      app = NativeApp.AGLYN,
      env = AglynEnv(
        consoleUrl = BuildConfig.CONSOLE_URL,
        firebaseApiKey = BuildConfig.FIREBASE_API_KEY,
        firebaseAuthDomain = BuildConfig.FIREBASE_AUTH_DOMAIN,
        firebaseProjectId = BuildConfig.FIREBASE_PROJECT_ID,
        firebaseAppId = BuildConfig.FIREBASE_APP_ID,
        firebaseMessagingSenderId = BuildConfig.FIREBASE_MESSAGING_SENDER_ID,
        authEmulatorHost = BuildConfig.AUTH_EMULATOR_HOST,
        firestoreEmulatorHost = BuildConfig.FIRESTORE_EMULATOR_HOST,
        appCheck = BuildConfig.APP_CHECK,
        telemetry = BuildConfig.TELEMETRY,
        passkeyRpId = BuildConfig.PASSKEY_RP_ID,
        googleWebClientId = BuildConfig.GOOGLE_WEB_CLIENT_ID,
      ),
      manifest = NativePluginManifest.entries,
      appVersion = BuildConfig.VERSION_NAME,
      debugSignIn = if (BuildConfig.DEBUG && BuildConfig.DEBUG_EMAIL.isNotEmpty()) {
        BuildConfig.DEBUG_EMAIL to BuildConfig.DEBUG_PASSWORD
      } else {
        null
      },
      // Packing slips, invoices, shipping labels and product labels go to Android's print sheet, as the console's go to
      // the browser's print dialog.
      peripherals = StaticPeripherals(systemPrinter = AndroidSystemPrinter(this)),
    )
  }
}
