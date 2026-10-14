package com.aglyn.screens

import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/** The person closed the system's passkey prompt without making one. */
class PasskeyCancelled : Exception("Passkey cancelled")

/**
 * Makes a passkey on this device: given the WebAuthn creation options the server answered (the JSON the console
 * hands `navigator.credentials.create`), it asks the platform and returns the registration the server verifies
 * (`RegistrationResponseJSON`). Throws [PasskeyCancelled] when the person dismisses the prompt.
 */
fun interface PasskeyCreator {
  suspend fun create(options: JsonElement): JsonElement
}

/**
 * Signs in with a passkey on this device: given the WebAuthn authentication options the server answered (the JSON the console
 * hands `navigator.credentials.get`), it asks the platform to sign the challenge with a discoverable passkey and returns the
 * assertion the server verifies (`AuthenticationResponseJSON`). Throws [PasskeyCancelled] when the person dismisses the prompt.
 */
fun interface PasskeyAsserter {
  suspend fun get(options: JsonElement): JsonElement
}

/** The parts of a passkey ceremony that are not the platform's: the encodings it speaks and the words a failure is shown in. */
@OptIn(ExperimentalEncodingApi::class)
object ScreenPasskeys {
  private val base64Url = Base64.UrlSafe.withPadding(Base64.PaddingOption.ABSENT_OPTIONAL)

  /** Base64url (RFC 4648 §5, no padding), the encoding every WebAuthn field travels in. */
  fun base64Url(bytes: ByteArray): String = base64Url.encode(bytes).trimEnd('=')

  /** The bytes a base64url text stands for; null when it is not base64url. */
  fun bytes(base64Url: String): ByteArray? = runCatching { this.base64Url.decode(base64Url) }.getOrNull()

  /**
   * The origin the platform wrote into the credential's client data: the server checks the ceremony against exactly
   * this (`https://aglyn.com` for an Apple app, `android:apk-key-hash:…` for an Android one), so it is what the verify
   * request is sent as.
   */
  fun clientDataOrigin(registration: JsonElement): String? {
    val encoded = ((registration as? JsonObject)?.get("response") as? JsonObject)?.get("clientDataJSON")?.let { (it as? JsonPrimitive)?.contentOrNull } ?: return null
    val client = bytes(encoded)?.let { runCatching { Json.parseToJsonElement(it.decodeToString()) }.getOrNull() } as? JsonObject ?: return null
    return (client["origin"] as? JsonPrimitive)?.contentOrNull
  }

  /** The words for a failed ceremony: the action's own for the route's reason (`limit-reached`), else its general ones. */
  fun message(error: Throwable, passkey: JsonElement, scope: JsonElement): String {
    fun words(text: JsonElement?) = (text as? JsonPrimitive)?.contentOrNull?.let { ScreenValues.render(it, scope) }
    if (error is ConsoleApiError) {
      val body = error.body as? JsonObject
      val reason = listOf("error", "reason").firstNotNullOfOrNull { (body?.get(it) as? JsonPrimitive)?.contentOrNull }
      val known = reason?.let { words((passkey.obj("errors") as? JsonObject)?.get(it)) }
      if (known != null) return known
    }
    return words(passkey.obj("otherwise")) ?: "Adding the passkey failed. Try again."
  }
}

/**
 * Signing in with a passkey, as the console's sign-in page does (`signInWithPasskey`): the options route answers a challenge,
 * the platform signs it, and the verify route answers a Firebase custom token for the credential's owner, which the app signs
 * in with ([com.aglyn.core.AuthSession.signInWithCustomToken]). Both routes are asked without a session, and read the
 * ceremony's `Origin`: the relying party's own for the options, and the origin the platform signed into the credential for
 * the verify.
 */
object PasskeySignIn {
  private val refusals = mapOf(
    "rate-limited" to "Too many passkey attempts from this network. Wait a few minutes and try again.",
    "bad-origin" to "Passkey sign-in is not available on this address.",
    "passkey-signin-failed" to
      "That passkey could not be used to sign in. Try another sign-in method, then re-add the passkey from Manage account → Security.",
    "credential-unknown" to "That passkey is not registered to an Aglyn account. It may have been removed.",
    "credential-cloned" to "That passkey was refused for security reasons. Sign in another way and remove it from Manage account → Security.",
    "challenge-invalid" to "The passkey request expired. Try again.",
    "verification-failed" to "That passkey could not be verified.",
  )

  /** Whether [error] came from the ceremony or the passkey routes (their words), rather than the Firebase sign-in after them. */
  fun failed(error: Throwable): Boolean = error is PasskeyCancelled || error is ConsoleApiError

  /** The words for a failed sign-in, the console's: closing the prompt, a route's reason, or the general one. */
  fun message(error: Throwable, brand: String = "Aglyn"): String {
    if (error is PasskeyCancelled) return "No passkey was used to sign in."
    if (error is ConsoleApiError) {
      val reason = ((error.body as? JsonObject)?.get("error") as? JsonPrimitive)?.contentOrNull
      refusals[reason]?.let { return it.replace("Aglyn", brand) }
    }
    return "Passkey sign-in failed."
  }

  /** The custom token for the passkey [asserter] signs the server's challenge with (the platform's prompt). */
  suspend fun token(api: ConsoleApiClient, relyingParty: String, asserter: PasskeyAsserter): String {
    val origin = "https://$relyingParty"
    val started = api.request("/api/auth/passkeys/signin/options", ApiMethod.POST, JsonObject(emptyMap()), anonymous = true, headers = mapOf("Origin" to origin))
    val challengeId = started.str("challengeId")
    val options = started.obj("options")
    if (challengeId == null || options == null) throw ConsoleApiError("internal", 500, JsonObject(mapOf("error" to JsonPrimitive("internal"))))
    val credential = asserter.get(options)
    val verified = api.request(
      "/api/auth/passkeys/signin/verify", ApiMethod.POST,
      JsonObject(mapOf("challengeId" to JsonPrimitive(challengeId), "response" to credential)),
      anonymous = true, headers = mapOf("Origin" to (ScreenPasskeys.clientDataOrigin(credential) ?: origin)),
    )
    return verified.str("token")?.takeIf { it.isNotEmpty() } ?: throw ConsoleApiError("internal", 500, JsonObject(mapOf("error" to JsonPrimitive("internal"))))
  }
}
