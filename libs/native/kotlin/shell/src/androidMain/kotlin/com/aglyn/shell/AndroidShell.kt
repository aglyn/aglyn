package com.aglyn.shell

import android.content.Context
import com.aglyn.core.AglynAppId
import com.aglyn.core.AglynConfig
import com.aglyn.core.AglynEnv
import com.aglyn.core.AndroidFirebase
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FcmPushRegistrar
import com.aglyn.core.FirebaseAuthSession
import com.aglyn.core.FirebaseFirestoreReader
import com.aglyn.core.SharedPreferencesStore
import com.aglyn.core.WorkspaceStore
import com.aglyn.core.defaultHttpClient
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.webview.BesignerWebView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers

/**
 * Builds the shell's services on Android: Firebase configured in code from
 * the build's [AglynEnv], the console API client, the workspace store and
 * the plugin registry loaded from the native manifest.
 */
object AndroidShell {
  fun services(
    context: Context,
    app: NativeApp,
    env: AglynEnv,
    manifest: List<NativePluginManifestEntry>,
    debugSignIn: Pair<String, String>? = null,
    peripherals: com.aglyn.hardware.Peripherals = com.aglyn.hardware.NoPeripherals,
    appVersion: String? = null,
  ): ShellServices {
    val config = AglynConfig.read(env, if (app == NativeApp.POS) AglynAppId.POS else AglynAppId.AGLYN)
    config.problems().forEach { android.util.Log.w("Aglyn", it) }
    val firebase = AndroidFirebase.init(context, config)
    val auth = FirebaseAuthSession(firebase.auth)
    val firestore = FirebaseFirestoreReader(firebase.firestore)
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val api = ConsoleApiClient(config.consoleOrigin, defaultHttpClient(), auth::idToken, config.brandName)
    val prefs = SharedPreferencesStore(context)
    val registry = NativePluginRegistry()
    registry.load(PLATFORM_ENTRIES + manifest).failed.forEach { android.util.Log.e("Aglyn", "plugin ${it.pluginId}: ${it.error}") }
    return ShellServices(
      app = app,
      config = config,
      auth = auth,
      firestore = firestore,
      api = api,
      workspace = WorkspaceStore(scope, auth, firestore, prefs),
      prefs = prefs,
      registry = registry,
      besigner = { path, onExit, onConsoleLink -> BesignerWebView(config.consoleOrigin, path, auth, config.brandName, onExit, onConsoleLink) },
      debugSignIn = debugSignIn,
      peripherals = peripherals,
      push = com.aglyn.core.FcmPushRegistrar(firebase, prefs, config.app, appVersion),
      writer = com.aglyn.core.FirebaseFirestoreWriter(firebase.firestore),
    )
  }
}
