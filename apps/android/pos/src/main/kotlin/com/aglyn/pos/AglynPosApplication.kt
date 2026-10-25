package com.aglyn.pos

import android.app.Application
import com.aglyn.core.AglynEnv
import com.aglyn.hardware.AndroidSystemPrinter
import com.aglyn.hardware.OfflineCardForwardLedger
import com.aglyn.hardware.OfflineCardForwardStore
import com.aglyn.hardware.StaticPeripherals
import com.aglyn.pluginhost.NativeApp
import com.aglyn.plugins.manifest.NativePluginManifest
import com.aglyn.shell.AndroidShell
import com.aglyn.pos.card.StripeKeyedCardEntry
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

  /** Stripe's card form for a card typed in at the register; the activity on screen attaches it. */
  internal val keyedCards: StripeKeyedCardEntry by lazy { StripeKeyedCardEntry(this) }

  /** Cards the reader stored offline and what Stripe made of them once forwarded (AGL-4039), on this device. */
  private val offlineCardForwards: OfflineCardForwardLedger by lazy {
    val prefs = getSharedPreferences("aglyn-pos-offline-cards", MODE_PRIVATE)
    OfflineCardForwardLedger(object : OfflineCardForwardStore {
      override fun read(): String? = prefs.getString("forwards", null)
      override fun write(value: String?) {
        prefs.edit().apply { if (value == null) remove("forwards") else putString("forwards", value) }.commit()
      }
    })
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
        appCheck = BuildConfig.APP_CHECK,
        telemetry = BuildConfig.TELEMETRY,
        googleWebClientId = BuildConfig.GOOGLE_WEB_CLIENT_ID,
      ),
      manifest = NativePluginManifest.entries,
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
        cardCollector = StripeTerminalCollector(
          this,
          simulated = !BuildConfig.TERMINAL_LIVE_READERS,
          permissions = { permissionGate },
          forwards = offlineCardForwards,
          mirrorOfflineToStripe = BuildConfig.DEBUG,
        ),
        // What the reader's SDK did with cards it stored offline, read by the register (AGL-4039).
        offlineCardForwards = offlineCardForwards,
        // A receipt with no printer of its own goes to Android's print sheet, as the console's goes to the browser's.
        systemPrinter = AndroidSystemPrinter(this),
        // A card typed in at the register goes into Stripe's own card form, not through our code.
        keyedCardEntry = keyedCards,
      ),
    )
  }
}
