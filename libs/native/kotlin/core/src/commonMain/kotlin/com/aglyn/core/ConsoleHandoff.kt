package com.aglyn.core

import io.ktor.http.encodeURLParameter
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

internal expect fun sha256(bytes: ByteArray): ByteArray

/**
 * Signing in through the console (AGL-3816): workspace single sign-on runs the workspace's own identity provider on the
 * console's `/sso` page, and the Windows build signs in and up there too. The app opens the console's `/auth/native` page
 * with a PKCE challenge, the person signs in exactly as on the web, and the page hands a one-time code back to the app's own
 * return address (its URL scheme on Android, a loopback listener on the desktop). The app trades the code and its verifier
 * for a Firebase custom token (`/api/auth/native-handoff/redeem`) in the identity pool the account lives in. Twin of the
 * Apple kit's `ConsoleHandoff`.
 */
object ConsoleHandoff {
  /** Which console page the person starts on. */
  enum class Start(val wire: String) { SIGN_IN("signin"), SIGN_UP("signup"), SINGLE_SIGN_ON("sso") }

  /** One sign-in in flight: what the app keeps until the code comes back. */
  data class Pending(val url: String, val verifier: String, val state: String, val redirectUri: String)

  data class Grant(val token: String, val tenantId: String?)

  /** The Aglyn app's and Aglyn POS's return addresses on Android. */
  fun appRedirectUri(app: AglynAppId): String = if (app == AglynAppId.POS) "aglyn-pos://auth/handoff" else "aglyn://auth/handoff"

  /** The desktop's return address, a listener on the loopback address (RFC 8252 §7.3). */
  fun loopbackRedirectUri(port: Int): String = "http://127.0.0.1:$port/handoff"

  @OptIn(ExperimentalEncodingApi::class)
  private fun base64Url(bytes: ByteArray) = Base64.UrlSafe.withPadding(Base64.PaddingOption.ABSENT).encode(bytes)

  /** The S256 challenge for a verifier. */
  fun challenge(verifier: String): String = base64Url(sha256(verifier.encodeToByteArray()))

  /** A fresh PKCE pair and state, and the console page to open. */
  fun begin(origin: String, redirectUri: String, start: Start, loginHint: String? = null): Pending {
    val verifier = base64Url(secureRandomBytes(32))
    val state = base64Url(secureRandomBytes(16))
    val query = listOf(
      "start" to start.wire, "challenge" to challenge(verifier), "redirect_uri" to redirectUri, "state" to state,
    ).plus(listOfNotNull(loginHint?.let { "login_hint" to it })).joinToString("&") { (key, value) -> "$key=${value.encodeURLParameter()}" }
    return Pending("${origin.trimEnd('/')}/auth/native?$query", verifier, state, redirectUri)
  }

  /** Whether [link] is a hand-off return to [redirectUri]. */
  fun isReturn(link: String?, redirectUri: String): Boolean = link?.substringBefore('?') == redirectUri

  /** The code the console handed back, refused when the state is not this sign-in's. */
  fun code(callback: String, pending: Pending): String {
    val query = queryParams(callback.substringAfter('?', ""))
    val code = query["code"]
    if (query["state"] != pending.state || code.isNullOrEmpty()) {
      throw AuthError("The sign-in did not come back as expected. Try again.")
    }
    return code
  }

  /** Trades the code and verifier for a custom token. */
  suspend fun redeem(api: ConsoleApiClient, code: String, pending: Pending): Grant {
    val answer = try {
      api.request(
        "/api/auth/native-handoff/redeem", ApiMethod.POST,
        buildJsonObject {
          put("code", code)
          put("verifier", pending.verifier)
          put("redirectUri", pending.redirectUri)
        },
        anonymous = true,
      ) as? JsonObject
    } catch (error: ConsoleApiError) {
      throw AuthError(error.message, error)
    }
    val token = (answer?.get("token") as? JsonPrimitive)?.contentOrNull
    if (token.isNullOrEmpty()) throw AuthError("The sign-in did not come back as expected. Try again.")
    return Grant(token, (answer["tenantId"] as? JsonPrimitive)?.contentOrNull)
  }
}

/**
 * How a platform opens the console page and hears back: [run] builds the page for the return address it listens on (the
 * desktop's loopback port is chosen per sign-in), opens it, and answers the return URL, or null when the return arrives later
 * on its own (an Android intent to the app's scheme, which hands it to the shell).
 */
fun interface ConsoleHandoffTransport {
  suspend fun run(page: (redirectUri: String) -> String): String?
}
