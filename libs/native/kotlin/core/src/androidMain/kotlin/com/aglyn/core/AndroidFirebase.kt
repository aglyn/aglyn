package com.aglyn.core

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore

/**
 * Firebase configured in code from [AglynConfig]: no google-services.json and
 * no google-services Gradle plugin, so the same build runs against the local
 * emulator stack, a self-hosted project or production by build settings alone.
 */
class AndroidFirebase private constructor(val app: FirebaseApp, val config: AglynConfig) {
  val auth: FirebaseAuth = FirebaseAuth.getInstance(app)
  val firestore: FirebaseFirestore = FirebaseFirestore.getInstance(app)

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
  }
}

class SharedPreferencesStore(context: Context, name: String = "aglyn") : KeyValueStore {
  private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)
  override fun get(key: String): String? = prefs.getString(key, null)
  override fun set(key: String, value: String?) {
    prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
  }
}
