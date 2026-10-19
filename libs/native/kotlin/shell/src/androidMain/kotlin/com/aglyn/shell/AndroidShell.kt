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
import com.aglyn.core.FirebaseSupportBackend
import com.aglyn.core.SwitchingFirestoreReader
import com.aglyn.core.SwitchingFirestoreWriter
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
    val prefs = SharedPreferencesStore(context)
    // A support session (a staff member signed in as a customer) has a Firebase app of its own: its own sign-in and Firestore.
    val support = FirebaseSupportBackend(context, firebase, prefs)
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    // Each signed-in account (Add account) has a Firebase app of its own: its sign-in and its Firestore.
    val accountApps = com.aglyn.core.AccountFirebaseApps(context, firebase)
    val auth = com.aglyn.core.AccountSessions(scope, { slot ->
      if (slot == com.aglyn.core.AccountSessions.PRIMARY) FirebaseAuthSession(firebase.auth, support) else FirebaseAuthSession(accountApps.auth(slot))
    }, prefs)
    val supporting = { auth.impersonation.value != null }
    val readers = mutableMapOf<String, FirebaseFirestoreReader>()
    val writers = mutableMapOf<String, com.aglyn.core.FirebaseFirestoreWriter>()
    val accountReader = com.aglyn.core.PickedFirestoreReader { auth.active.value.let { slot -> readers.getOrPut(slot) { FirebaseFirestoreReader(accountApps.firestore(slot)) } } }
    val accountWriter = com.aglyn.core.PickedFirestoreWriter { auth.active.value.let { slot -> writers.getOrPut(slot) { com.aglyn.core.FirebaseFirestoreWriter(accountApps.firestore(slot)) } } }
    val firestore = SwitchingFirestoreReader(accountReader, { FirebaseFirestoreReader(support.firestore()) }, supporting)
    val slotOf = { uid: String -> auth.accounts.value.firstOrNull { it.uid == uid }?.slot ?: auth.active.value }
    val api = ConsoleApiClient(config.consoleOrigin, defaultHttpClient(), auth::idToken, config.brandName)
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
      push = if (config.app.receivesPushes) {
        com.aglyn.core.FcmPushRegistrar(firebase, prefs, config.app, appVersion, firestoreFor = { uid -> accountApps.firestore(slotOf(uid)) }, signedIn = { auth.accounts.value.map { it.uid } })
      } else {
        com.aglyn.core.NoPush
      },
      writer = SwitchingFirestoreWriter(accountWriter, { com.aglyn.core.FirebaseFirestoreWriter(support.firestore()) }, supporting),
      openHostedPage = { url -> openCustomTab(context, url) },
      // Single sign-on runs on the console in a Custom Tab, whose page hands the code back to this app's own scheme; the
      // activity hears it and finishes the sign-in (`finishConsoleHandoff`).
      consoleHandoff = com.aglyn.core.ConsoleHandoffTransport { page ->
        openCustomTab(context, page(com.aglyn.core.ConsoleHandoff.appRedirectUri(config.app)))
        null
      },
    )
  }

  private fun openCustomTab(context: Context, url: String) {
    val intent = androidx.browser.customtabs.CustomTabsIntent.Builder().setShowTitle(true).build()
    intent.intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
    intent.launchUrl(context, android.net.Uri.parse(url))
  }
}
