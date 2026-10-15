package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.plugins.api.Send
import io.ktor.client.plugins.api.createClientPlugin

/**
 * Firebase App Check: a short-lived token proving a request comes from a genuine copy of the app. Production enforces it on
 * Authentication and Firestore, so a request without one is refused (`401 "Firebase App Check token is invalid."`) before any
 * rule runs.
 *
 * On Android the Firebase SDK's Auth and Firestore read the token through `firebase-appcheck` on their own ([AndroidFirebase]
 * installs the Play Integrity provider). The kit's REST and gRPC clients take it from this interface: [withAppCheck] for Ktor,
 * and the `x-firebase-appcheck` metadata on the desktop Firestore listener. Compose Desktop has no attestation, so it uses
 * [ConsoleMintedAppCheck], whose tokens the console mints for the session it signed in.
 */
interface AppCheckTokenProvider {
  /** The current token, or null when App Check is off for this build (the emulator stack) or there is none to be had. */
  suspend fun token(forceRefresh: Boolean = false): String?
}

/** App Check off: the emulator stack does not enforce it, and tests. */
object NoAppCheck : AppCheckTokenProvider {
  override suspend fun token(forceRefresh: Boolean): String? = null
}

const val APP_CHECK_HEADER = "X-Firebase-AppCheck"

/** The code an App Check refusal is mapped to (the server answers with a sentence, not a code). */
const val APP_CHECK_REFUSED = "APP_CHECK_TOKEN_INVALID"

/** The words a refusal for a missing or rejected App Check token shows. */
const val APP_CHECK_REFUSAL_MESSAGE = "This copy of the app could not be verified. Update the app or try again."

private val FIREBASE_HOSTS = setOf(
  "identitytoolkit.googleapis.com", "securetoken.googleapis.com", "firestore.googleapis.com", "firebasestorage.googleapis.com",
)

/** Whether a host (over https) is a Firebase API that takes an App Check token; never a local emulator. */
fun isFirebaseApi(scheme: String, host: String): Boolean {
  val name = host.lowercase()
  return scheme.lowercase() == "https" && (name in FIREBASE_HOSTS || name.endsWith(".cloudfunctions.net"))
}

/** Whether a server answer's text is an App Check refusal. */
fun isAppCheckRefusalText(text: String?): Boolean = text?.contains("App Check", ignoreCase = true) == true

/** [APP_CHECK_REFUSED] when an error (or its cause) is an App Check refusal, else null. */
fun appCheckRefusalCode(error: Throwable?): String? {
  var current = error
  var depth = 0
  while (current != null && depth < 4) {
    if (isAppCheckRefusalText(current.message)) return APP_CHECK_REFUSED
    current = current.cause
    depth++
  }
  return null
}

/**
 * A client that adds the App Check header to every request bound for a Firebase API, and leaves every other request alone. A
 * Firebase answer of 401 to a request that carried a token is tried once more with a fresh one (`token(forceRefresh = true)`),
 * so a token the server stopped accepting is replaced rather than surfacing as a failed sign-in.
 */
fun HttpClient.withAppCheck(provider: AppCheckTokenProvider): HttpClient {
  if (provider === NoAppCheck) return this
  val plugin = createClientPlugin("AglynAppCheck") {
    on(Send) { request ->
      if (!isFirebaseApi(request.url.protocol.name, request.url.host)) return@on proceed(request)
      val token = runCatching { provider.token(false) }.getOrNull()?.takeIf { it.isNotEmpty() }
      token?.let { request.headers[APP_CHECK_HEADER] = it }
      val call = proceed(request)
      if (token == null || call.response.status.value != 401) return@on call
      val fresh = runCatching { provider.token(true) }.getOrNull()?.takeIf { it.isNotEmpty() && it != token } ?: return@on call
      request.headers[APP_CHECK_HEADER] = fresh
      proceed(request)
    }
  }
  return config { install(plugin) }
}
