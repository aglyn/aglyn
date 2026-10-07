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
import com.aglyn.webview.ConsoleView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.swing.Swing

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

  fun services(app: NativeApp, env: AglynEnv, manifest: List<NativePluginManifestEntry>): ShellServices {
    val config = AglynConfig.read(env, if (app == NativeApp.POS) AglynAppId.POS else AglynAppId.AGLYN)
    config.problems().forEach { System.err.println("Aglyn: $it") }
    val http = defaultHttpClient()
    val auth = IdentityToolkitAuthSession(http, config.firebase.apiKey, config.authEmulatorHost)
    val firestore = RestFirestoreReader(http, config.firebase.projectId, config.firestoreEmulatorHost, { auth.idToken(false) })
    val prefs = JavaPreferencesStore(if (app == NativeApp.POS) "com/aglyn/pos" else "com/aglyn/app")
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Swing)
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
      console = { path, onExit -> ConsoleView(config.consoleOrigin, path, auth, config.brandName, onExit) },
      debugSignIn = debugSignIn,
    )
  }
}
