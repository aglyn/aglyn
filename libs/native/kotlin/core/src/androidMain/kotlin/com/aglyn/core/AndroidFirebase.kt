package com.aglyn.core

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await

/**
 * Firebase configured in code from [AglynConfig]: no google-services.json and
 * no google-services Gradle plugin, so the same build runs against the local
 * emulator stack, a self-hosted project or production by build settings alone.
 */
class AndroidFirebase private constructor(val app: FirebaseApp, val config: AglynConfig) {
  val auth: FirebaseAuth = FirebaseAuth.getInstance(app)
  val firestore: FirebaseFirestore = FirebaseFirestore.getInstance(app)
  /** The App Check token, for a REST or gRPC call to Firebase; Auth and Firestore read it themselves. */
  val appCheck: AppCheckTokenProvider = if (config.appCheck) FirebaseAppCheckTokens(app) else NoAppCheck

  companion object {
    @Volatile private var current: AndroidFirebase? = null

    fun init(context: Context, config: AglynConfig): AndroidFirebase = current ?: synchronized(this) {
      current ?: create(context.applicationContext, config).also { current = it }
    }

    private fun create(context: Context, config: AglynConfig): AndroidFirebase {
      val options = FirebaseOptions.Builder()
        .setApiKey(config.firebase.apiKey)
        .setApplicationId(config.firebase.appId)
        .setProjectId(config.firebase.projectId)
        .apply {
          config.firebase.storageBucket?.let(::setStorageBucket)
          config.firebase.messagingSenderId?.let(::setGcmSenderId)
        }
        .build()
      val app = FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }
        ?: FirebaseApp.initializeApp(context, options)
      installAppCheck(app, config)
      // Crash reports, non-fatal errors and Analytics: release builds on production only (AGL-4067).
      FirebaseTelemetrySink.install(context, app, config)
      val firebase = AndroidFirebase(app, config)
      config.authEmulatorHost?.let { hostPort ->
        val (host, port) = hostPort.split(':')
        firebase.auth.useEmulator(host, port.toInt())
      }
      config.firestoreEmulatorHost?.let { hostPort ->
        val (host, port) = hostPort.split(':')
        firebase.firestore.useEmulator(host, port.toInt())
      }
      return firebase
    }

    /**
     * Firebase App Check on [app], before Auth or Firestore make a call: production enforces it on both. The Play Integrity
     * provider asks Firebase for a challenge (`generatePlayIntegrityChallenge`), has Google Play attest the app with it as the
     * nonce, and trades the verdict for a token (`exchangePlayIntegrityToken`); `firebase-appcheck` caches the token for its
     * lifetime, refreshes it before it lapses and shares one exchange among concurrent callers. Every Firebase app needs its
     * own (a support session's named app too): copying the options does not copy App Check. Off for the emulator stack.
     */
    fun installAppCheck(app: FirebaseApp, config: AglynConfig) {
      if (!config.appCheck) return
      FirebaseAppCheck.getInstance(app).apply {
        installAppCheckProviderFactory(PlayIntegrityAppCheckProviderFactory.getInstance())
        setTokenAutoRefreshEnabled(true)
      }
    }
  }
}

/** Firebase App Check's current token for one Firebase app. */
private class FirebaseAppCheckTokens(private val app: FirebaseApp) : AppCheckTokenProvider {
  override suspend fun token(forceRefresh: Boolean): String? =
    FirebaseAppCheck.getInstance(app).getAppCheckToken(forceRefresh).await().token
}

class SharedPreferencesStore(context: Context, name: String = "aglyn") : KeyValueStore {
  private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)
  override fun get(key: String): String? = prefs.getString(key, null)
  override fun set(key: String, value: String?) {
    prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
  }
}
