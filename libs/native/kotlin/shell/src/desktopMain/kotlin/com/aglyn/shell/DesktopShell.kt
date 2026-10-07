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
    return com.aglyn.hardware.StaticPeripherals(printers = listOfNotNull(printer), hidScanner = com.aglyn.hardware.HidBurstDetector())
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
    )
  }

  fun services(
    app: NativeApp,
    env: AglynEnv,
    manifest: List<NativePluginManifestEntry>,
    peripherals: com.aglyn.hardware.Peripherals = com.aglyn.hardware.NoPeripherals,
  ): ShellServices {
    val config = AglynConfig.read(env, if (app == NativeApp.POS) AglynAppId.POS else AglynAppId.AGLYN)
    config.problems().forEach { System.err.println("Aglyn: $it") }
    val http = defaultHttpClient()
    // One kept session per app and Firebase project, so an emulator run never restores into production.
    val auth = IdentityToolkitAuthSession(
      http,
      config.firebase.apiKey,
      config.authEmulatorHost,
      credentials = com.aglyn.core.CredentialStores.forOs(),
      credentialKey = "Aglyn/${config.app.wire}/${config.firebase.projectId}",
    )
    val firestore = RestFirestoreReader(
      http,
      config.firebase.projectId,
      config.firestoreEmulatorHost,
      { auth.idToken(false) },
      listen = com.aglyn.core.GrpcFirestoreListen(config.firebase.projectId, config.firestoreEmulatorHost),
      freshIdToken = { auth.idToken(true) },
    )
    val prefs = JavaPreferencesStore(if (app == NativeApp.POS) "com/aglyn/pos" else "com/aglyn/app")
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Swing)
    scope.launch { auth.restore() }
    val registry = NativePluginRegistry()
    registry.load(manifest).failed.forEach { System.err.println("Aglyn: plugin ${it.pluginId}: ${it.error}") }
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
    )
  }
}
