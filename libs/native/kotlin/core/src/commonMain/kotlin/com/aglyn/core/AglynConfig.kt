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
  ;

  /**
   * Whether the server sends this app any push. Aglyn carries every workspace notification; the register is pushed
   * only the types in the server's `POS_PUSH_TYPES` (`push-delivery.ts`), which lists none, so Aglyn POS neither asks
   * for notification permission nor registers a device.
   */
  val receivesPushes: Boolean get() = this == AGLYN
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
  /** The domain passkeys are made for (`aglyn.com`); empty until the app is linked to it. */
  val passkeyRpId: String? = null,
  /** The Firebase project's Web OAuth client id, which the Android Credential Manager asks Google's ID token for. */
  val googleWebClientId: String? = null,
  /** The desktop OAuth client Google's loopback sign-in uses (its secret is required by the token endpoint, not confidential). */
  val googleDesktopClientId: String? = null,
  val googleDesktopClientSecret: String? = null,
  /** Firebase App Check: `on` or `off`; unset is on, except on a local stack (`AGLYN_APP_CHECK`). */
  val appCheck: String? = null,
  /** Where the published Terms of Service and Privacy Policy live (`AGLYN_LEGAL_ORIGIN`); unset is the default. */
  val legalOrigin: String? = null,
  /** Where the documentation lives (`AGLYN_DOCS_ORIGIN`); unset is the default. */
  val docsOrigin: String? = null,
  /** Crash reports and Analytics: `on` or `off`; unset is on, except on a local stack (`AGLYN_TELEMETRY`, AGL-4067). */
  val telemetry: String? = null,
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
  /**
   * The relying party passkeys are made for (`aglyn.com`, the registrable domain the console's passkeys belong to), set
   * once the app is linked to it (an `assetlinks.json` on that domain naming the app's signing certificate); null, and the
   * "Set up a passkey" action hidden, until then.
   */
  val passkeyRelyingParty: String? = null,
  /** Google sign-in to connect to an account; the web client on Android, the desktop client on Windows. Null, and the action hidden, until set. */
  val googleWebClientId: String? = null,
  val googleDesktopClientId: String? = null,
  val googleDesktopClientSecret: String? = null,
  /**
   * Whether Firebase App Check is on: Play Integrity on Android. Production enforces it, so a release build has it on; the
   * emulator stack does not, so it is off there, and off by default whenever an emulator or a local console is configured.
   */
  val appCheck: Boolean = true,
  /** The origin the sign-up's Terms of Service and Privacy Policy links point at, the console's `LEGAL_URLS`. */
  val legalOrigin: String = DEFAULT_LEGAL_ORIGIN,
  /**
   * The origin the Documentation and What's new links point at, the console's `NEXT_PUBLIC_DOCS_ORIGIN`: a self-hosted
   * build's own documentation, never ours presented as theirs.
   */
  val docsOrigin: String = DEFAULT_DOCS_ORIGIN,
  /**
   * Whether crash reports, non-fatal errors and Analytics are collected (AGL-4067): on for a release build pointed at
   * production, never on a local stack, so a debug build on the emulator stack never reports. Android also keeps it off
   * in any debuggable build (`AndroidFirebase`).
   */
  val telemetry: Boolean = true,
) {
  /** The domain workspace addresses sit under (`acme-inc.aglyn.com`): the console's host without its own label. */
  val workspaceDomain: String
    get() {
      val host = hostOf(consoleOrigin)
      val labels = host.split('.')
      return when {
        labels.size >= 3 -> labels.drop(1).joinToString(".")
        host.isEmpty() || isLocalHost(host) -> "aglyn.com"
        else -> host
      }
    }

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
    /** The console's `OPERATOR_LEGAL_ORIGIN`. */
    const val DEFAULT_LEGAL_ORIGIN = "https://aglyn.com"
    /** The console's `NEXT_PUBLIC_DOCS_ORIGIN`. */
    const val DEFAULT_DOCS_ORIGIN = "https://docs.aglyn.com"

    private val ORIGIN = Regex("^(https?)://([A-Za-z0-9.-]+)(:\\d{2,5})?$")
    private val HOST_PORT = Regex("^[A-Za-z0-9.-]+:\\d{2,5}$")

    /** An `https:` origin with no path, lowercased and without a trailing slash; null for anything else. */
    internal fun httpsOrigin(value: String?): String? =
      (value ?: "").trim().trimEnd('/').lowercase().takeIf { Regex("^https://[a-z0-9.-]+(:\\d{2,5})?$").matches(it) }

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

    private val RELYING_PARTY = Regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$")

    /** A domain name (no scheme, port or path) that is not a local host; null for anything else. */
    fun relyingParty(value: String?): String? {
      val raw = (value ?: "").trim().lowercase()
      return raw.takeIf { RELYING_PARTY.matches(it) && !isLocalHost(it) }
    }

    /** `host:port`, or null for anything else. */
    fun hostPort(value: String?): String? {
      val raw = (value ?: "").trim().replace(Regex("^https?://"), "")
      return if (HOST_PORT.matches(raw)) raw else null
    }

    /** `AGLYN_APP_CHECK`: on or off, or unset for the default ([localStack] decides). */
    fun appCheckSetting(value: String?, localStack: Boolean): Boolean = when ((value ?: "").trim().lowercase()) {
      "" -> !localStack
      "on", "true", "yes", "1" -> true
      "off", "false", "no", "0" -> false
      else -> throw IllegalArgumentException("AGLYN_APP_CHECK must be on or off, not ${value?.trim()}.")
    }

    /** `AGLYN_TELEMETRY`: on unless set otherwise, and never on a local stack. Anything but on is off: a typo never turns it on. */
    fun telemetrySetting(value: String?, localStack: Boolean): Boolean = !localStack && when ((value ?: "").trim().lowercase()) {
      "", "on", "true", "yes", "1" -> true
      else -> false
    }

    internal fun hostOf(origin: String): String =
      ORIGIN.matchEntire(origin)?.groupValues?.get(2)?.lowercase() ?: ""

    fun read(env: AglynEnv, app: AglynAppId): AglynConfig {
      fun clean(value: String?) = (value ?: "").trim()
      val origin = normalizeConsoleOrigin(env.consoleUrl)
      val authEmulator = hostPort(env.authEmulatorHost)
      val firestoreEmulator = hostPort(env.firestoreEmulatorHost)
      val localStack = authEmulator != null || firestoreEmulator != null || isLocalHost(hostOf(origin))
      return AglynConfig(
        app = app,
        consoleOrigin = origin,
        firebase = FirebaseOptionsConfig(
          apiKey = clean(env.firebaseApiKey),
          authDomain = clean(env.firebaseAuthDomain),
          projectId = clean(env.firebaseProjectId),
          appId = clean(env.firebaseAppId),
          storageBucket = clean(env.firebaseStorageBucket).ifEmpty { null },
          messagingSenderId = clean(env.firebaseMessagingSenderId).ifEmpty { null },
        ),
        authEmulatorHost = authEmulator,
        firestoreEmulatorHost = firestoreEmulator,
        brandName = clean(env.brandName).ifEmpty { DEFAULT_BRAND_NAME },
        passkeyRelyingParty = relyingParty(env.passkeyRpId),
        googleWebClientId = clean(env.googleWebClientId).ifEmpty { null },
        googleDesktopClientId = clean(env.googleDesktopClientId).ifEmpty { null },
        googleDesktopClientSecret = clean(env.googleDesktopClientSecret).ifEmpty { null },
        appCheck = appCheckSetting(env.appCheck, localStack),
        legalOrigin = httpsOrigin(env.legalOrigin) ?: DEFAULT_LEGAL_ORIGIN,
        docsOrigin = httpsOrigin(env.docsOrigin) ?: DEFAULT_DOCS_ORIGIN,
        telemetry = telemetrySetting(env.telemetry, localStack),
      )
    }
  }
}
