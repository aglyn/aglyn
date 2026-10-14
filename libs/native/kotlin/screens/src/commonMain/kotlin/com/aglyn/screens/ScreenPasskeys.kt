package com.aglyn.screens

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
