package com.aglyn.core

/**
 * What a native app is started with: the console origin, the public Firebase
 * web config and, for a local stack, the emulator hosts. Android reads these
 * from BuildConfig fields and desktop from a properties file; both hand the
 * raw strings to [AglynConfig.read], so validation lives in one place.
 *
 * None of the Firebase values is a secret: they are the same public config
 * the console builds with.
 */
data class FirebaseOptionsConfig(
  val apiKey: String,
  val authDomain: String,
  val projectId: String,
  val appId: String,
  val storageBucket: String? = null,
  val messagingSenderId: String? = null,
)

/** Which app this is; stamped on device registrations. */
enum class AglynAppId(val wire: String) {
  AGLYN("aglyn"),
  POS("aglyn-pos"),
}

/** The raw build values, by the same names on every platform. */
data class AglynEnv(
  val consoleUrl: String? = null,
  val firebaseApiKey: String? = null,
  val firebaseAuthDomain: String? = null,
  val firebaseProjectId: String? = null,
  val firebaseAppId: String? = null,
  val firebaseStorageBucket: String? = null,
  val firebaseMessagingSenderId: String? = null,
  val authEmulatorHost: String? = null,
  val firestoreEmulatorHost: String? = null,
  val brandName: String? = null,
)

data class AglynConfig(
  val app: AglynAppId,
  /** The console origin every API call and WebView page is on. */
  val consoleOrigin: String,
  val firebase: FirebaseOptionsConfig,
  /** `host:port` of the local Auth emulator, when the app runs against one. */
  val authEmulatorHost: String?,
  /** `host:port` of the local Firestore emulator. */
  val firestoreEmulatorHost: String?,
  /** The product name the app's copy says; a white-label build renames it here. */
  val brandName: String = DEFAULT_BRAND_NAME,
) {
  /** What is missing for the app to sign anyone in, in words for a build log. */
  fun problems(): List<String> = buildList {
    if (firebase.apiKey.isEmpty()) add("AGLYN_FIREBASE_API_KEY is not set.")
    if (firebase.projectId.isEmpty()) add("AGLYN_FIREBASE_PROJECT_ID is not set.")
    if (firebase.appId.isEmpty()) add("AGLYN_FIREBASE_APP_ID is not set.")
    if (firebase.authDomain.isEmpty()) add("AGLYN_FIREBASE_AUTH_DOMAIN is not set.")
    // A production build pointed at an emulator would sign nobody in.
    if (!isLocalHost(hostOf(consoleOrigin))) {
      if (authEmulatorHost != null) add("The Auth emulator is set for a non-local console.")
      if (firestoreEmulatorHost != null) add("The Firestore emulator is set for a non-local console.")
    }
  }

  companion object {
    const val DEFAULT_CONSOLE_ORIGIN = "https://app.aglyn.com"
    const val DEFAULT_BRAND_NAME = "Aglyn"

    private val ORIGIN = Regex("^(https?)://([A-Za-z0-9.-]+)(:\\d{2,5})?$")
    private val HOST_PORT = Regex("^[A-Za-z0-9.-]+:\\d{2,5}$")

    /** True for the hosts a local development stack runs on. */
    fun isLocalHost(host: String): Boolean =
      host == "localhost" ||
        host == "127.0.0.1" ||
        // The Android emulator's name for the computer it runs on.
        host == "10.0.2.2" ||
        host.endsWith(".localhost")

    /** An `https:` origin, or `http:` for a local stack only. */
    fun normalizeConsoleOrigin(value: String?): String {
      val raw = (value ?: "").trim().trimEnd('/')
      if (raw.isEmpty()) return DEFAULT_CONSOLE_ORIGIN
      val match = ORIGIN.matchEntire(raw)
        ?: throw IllegalArgumentException("AGLYN_CONSOLE_URL is not an origin: $raw")
      val scheme = match.groupValues[1]
      val host = match.groupValues[2]
      if (scheme == "http" && !isLocalHost(host.lowercase())) {
        throw IllegalArgumentException("AGLYN_CONSOLE_URL must be https outside a local stack.")
      }
      return raw.lowercase()
    }

    /** `host:port`, or null for anything else. */
    fun hostPort(value: String?): String? {
      val raw = (value ?: "").trim().replace(Regex("^https?://"), "")
      return if (HOST_PORT.matches(raw)) raw else null
    }

    internal fun hostOf(origin: String): String =
      ORIGIN.matchEntire(origin)?.groupValues?.get(2)?.lowercase() ?: ""

    fun read(env: AglynEnv, app: AglynAppId): AglynConfig {
      fun clean(value: String?) = (value ?: "").trim()
      return AglynConfig(
        app = app,
        consoleOrigin = normalizeConsoleOrigin(env.consoleUrl),
        firebase = FirebaseOptionsConfig(
          apiKey = clean(env.firebaseApiKey),
          authDomain = clean(env.firebaseAuthDomain),
          projectId = clean(env.firebaseProjectId),
          appId = clean(env.firebaseAppId),
          storageBucket = clean(env.firebaseStorageBucket).ifEmpty { null },
          messagingSenderId = clean(env.firebaseMessagingSenderId).ifEmpty { null },
        ),
        authEmulatorHost = hostPort(env.authEmulatorHost),
        firestoreEmulatorHost = hostPort(env.firestoreEmulatorHost),
        brandName = clean(env.brandName).ifEmpty { DEFAULT_BRAND_NAME },
      )
    }
  }
}
