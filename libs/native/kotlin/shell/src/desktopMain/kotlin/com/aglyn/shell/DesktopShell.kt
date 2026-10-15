package com.aglyn.shell

import com.aglyn.core.AglynAppId
import com.aglyn.core.AglynConfig
import com.aglyn.core.AglynEnv
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.IdentityToolkitAuthSession
import com.aglyn.core.JavaPreferencesStore
import com.aglyn.core.RestFirestoreReader
import com.aglyn.core.WorkspaceStore
import com.aglyn.core.defaultHttpClient
import com.aglyn.core.withAppCheck
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.webview.BesignerWebView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.swing.Swing
import kotlinx.coroutines.launch

/**
 * The shell's services on the JVM desktop: Identity Toolkit REST for auth,
 * Firestore REST for reads (both with the person's own ID token, under the
 * same rules), the console in the system browser, and no push in v1.
 */
object DesktopShell {
  /**
   * The build values, from `-Daglyn.<name>=…` or `AGLYN_<NAME>`, defaulting
   * to the local emulator stack the README describes.
   */
  /**
   * The register's peripherals on a desktop: a keyboard-wedge barcode
   * scanner always (it types into the window), and a network receipt
   * printer when `-Daglyn.receiptPrinter=host[:port]` names one (raw TCP,
   * 9100 by default). Desktop takes cards on smart readers only, so there is
   * no card collector.
   */
  fun posPeripherals(): com.aglyn.hardware.Peripherals {
    val printer = (System.getProperty("aglyn.receiptPrinter") ?: System.getenv("AGLYN_RECEIPT_PRINTER"))
      ?.trim()?.ifEmpty { null }
      ?.let { address ->
        val host = address.substringBeforeLast(':', address)
        val port = address.substringAfterLast(':', "").toIntOrNull() ?: com.aglyn.hardware.NetworkReceiptPrinter.DEFAULT_PORT
        com.aglyn.hardware.NetworkReceiptPrinter("Receipt printer", host, port)
      }
    return com.aglyn.hardware.StaticPeripherals(
      printers = listOfNotNull(printer),
      hidScanner = com.aglyn.hardware.HidBurstDetector(),
      // A receipt with no printer of its own goes to the desktop's print dialog, as the console's goes to the browser's.
      systemPrinter = com.aglyn.hardware.AwtSystemPrinter(),
    )
  }

  fun envFromSystem(): AglynEnv {
    fun read(name: String, fallback: String?): String? =
      System.getProperty("aglyn.$name")
        ?: System.getenv("AGLYN_" + name.replace(Regex("([A-Z])"), "_$1").uppercase())
        ?: fallback
    return AglynEnv(
      consoleUrl = read("consoleUrl", "http://localhost:4200"),
      firebaseApiKey = read("firebaseApiKey", "emulator-api-key"),
      firebaseAuthDomain = read("firebaseAuthDomain", "localhost"),
      firebaseProjectId = read("firebaseProjectId", "demo-aglyn"),
      firebaseAppId = read("firebaseAppId", "1:000000000000:web:emulator"),
      authEmulatorHost = read("authEmulatorHost", "127.0.0.1:9099"),
      firestoreEmulatorHost = read("firestoreEmulatorHost", "127.0.0.1:8082"),
      googleDesktopClientId = read("googleDesktopClientId", null),
      googleDesktopClientSecret = read("googleDesktopClientSecret", null),
      appCheck = read("appCheck", null),
    )
  }

  /** Google sign-in through the system browser and a loopback return, once the desktop OAuth client is configured; null until then. */
  fun googleSource(config: AglynConfig, http: io.ktor.client.HttpClient = defaultHttpClient()): com.aglyn.core.GoogleCredentialSource? {
    val id = config.googleDesktopClientId ?: return null
    val secret = config.googleDesktopClientSecret ?: return null
    return com.aglyn.core.GoogleLoopback(http, id, secret, openBrowser = { url ->
      runCatching { java.awt.Desktop.getDesktop().browse(java.net.URI(url)) }
        .onFailure { throw com.aglyn.core.GoogleLinkError("The browser could not be opened. Try again.", it) }
    })
  }

  fun services(
    app: NativeApp,
    env: AglynEnv,
    manifest: List<NativePluginManifestEntry>,
    peripherals: com.aglyn.hardware.Peripherals = com.aglyn.hardware.NoPeripherals,
  ): ShellServices {
    val config = AglynConfig.read(env, if (app == NativeApp.POS) AglynAppId.POS else AglynAppId.AGLYN)
    config.problems().forEach { System.err.println("Aglyn: $it") }
    val prefs = JavaPreferencesStore(if (app == NativeApp.POS) "com/aglyn/pos" else "com/aglyn/app")
    // Firebase App Check: Compose Desktop has no attestation, so the console mints this app's tokens for the session it
    // signed in (AGL-3816), and every Firebase call below carries them. Off for the emulator stack.
    val consoleAppCheck = if (config.appCheck) {
      com.aglyn.core.ConsoleMintedAppCheck(defaultHttpClient(), config.consoleOrigin, installId(prefs))
    } else {
      null
    }
    val appCheck: com.aglyn.core.AppCheckTokenProvider = consoleAppCheck ?: com.aglyn.core.NoAppCheck
    val http = defaultHttpClient().let { if (config.appCheck) it.withAppCheck(appCheck) else it }
    // One kept session per app and Firebase project, so an emulator run never restores into production.
    val auth = IdentityToolkitAuthSession(
      http,
      config.firebase.apiKey,
      config.authEmulatorHost,
      credentials = com.aglyn.core.CredentialStores.forOs(),
      credentialKey = "Aglyn/${config.app.wire}/${config.firebase.projectId}",
    )
    consoleAppCheck?.idToken = { auth.currentIdToken() }
    val firestore = RestFirestoreReader(
      http,
      config.firebase.projectId,
      config.firestoreEmulatorHost,
      { auth.idToken(false) },
      listen = com.aglyn.core.GrpcFirestoreListen(
        config.firebase.projectId, config.firestoreEmulatorHost, if (config.appCheck) appCheck else com.aglyn.core.NoAppCheck,
      ),
      freshIdToken = { auth.idToken(true) },
    )
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Swing)
    scope.launch { auth.restore() }
    val registry = NativePluginRegistry()
    registry.load(PLATFORM_ENTRIES + manifest).failed.forEach { System.err.println("Aglyn: plugin ${it.pluginId}: ${it.error}") }
    // The seeded emulator member (tools/scripts/seed-native-emulator.mjs) fills the
    // sign-in form only against a local emulator on a demo- project.
    val project = config.firebase.projectId
    val debugSignIn = if (config.authEmulatorHost != null && project.startsWith("demo-")) {
      "mobile-owner@example.test" to "seed-$project-mobile"
    } else {
      null
    }
    return ShellServices(
      app = app,
      config = config,
      auth = auth,
      firestore = firestore,
      api = ConsoleApiClient(config.consoleOrigin, http, auth::idToken, config.brandName),
      workspace = WorkspaceStore(scope, auth, firestore, prefs),
      prefs = prefs,
      registry = registry,
      besigner = { path, onExit, onConsoleLink -> BesignerWebView(config.consoleOrigin, path, auth, config.brandName, onExit, onConsoleLink) },
      debugSignIn = debugSignIn,
      peripherals = peripherals,
      writer = firestore,
      // A JVM has no in-app browser sheet; Stripe's pages open in the system browser, as the console opens them in a tab.
      openHostedPage = { url ->
        runCatching { java.awt.Desktop.getDesktop().browse(java.net.URI(url)) }
          .onFailure { System.err.println("Aglyn: could not open $url: ${it.message}") }
      },
      mediaPicker = DesktopMediaPicker,
      fileExporter = DesktopFileExporter,
      // Signing in through the console: the system browser, back to a loopback listener (AGL-3816). Against a project that
      // enforces App Check it is the only way in, since this build has no attestation provider.
      consoleHandoff = com.aglyn.core.ConsoleLoopback(openBrowser = { url ->
        runCatching { java.awt.Desktop.getDesktop().browse(java.net.URI(url)) }
          .onFailure { System.err.println("Aglyn: could not open the browser: ${it.message}") }
      }),
      // Before anyone is signed in there is no session to mint a token for, so every door is the console's.
      signInThroughConsoleOnly = config.appCheck,
      consoleAppCheck = consoleAppCheck,
    )
  }

  /** A random id this install keeps (never a hardware identifier), for the App Check route's per-device rate limit. */
  private fun installId(prefs: JavaPreferencesStore): String =
    prefs.get(INSTALL_ID_KEY) ?: com.aglyn.core.secureRandomHex(16).also { prefs.set(INSTALL_ID_KEY, it) }

  private const val INSTALL_ID_KEY = "aglyn.install.id"
}
