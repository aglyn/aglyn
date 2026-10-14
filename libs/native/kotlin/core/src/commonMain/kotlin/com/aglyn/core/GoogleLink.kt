package com.aglyn.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Why Google could not be connected, in words for the person. */
class GoogleLinkError(override val message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * Signs the person in to Google on this device and hands back Google's ID token. Google refuses embedded web views, so
 * each platform uses its own sheet: the Credential Manager on Android, the system browser with a loopback return on the
 * desktop. Throws [GoogleLinkError] with words for the person (canceled, no account, refused).
 */
fun interface GoogleCredentialSource {
  suspend fun idToken(loginHint: String?): String
}

/**
 * Connecting Google to the signed-in account: the platform's [GoogleCredentialSource] gets Google's ID token, and the
 * session attaches that credential to the account (Identity Toolkit's `accounts:signInWithIdp`, which is the call the web
 * SDK's `linkWithPopup` ends in). Twin of the Apple `GoogleLink`.
 */
object GoogleLink {
  /** What `accounts:signInWithIdp` is sent to attach Google's credential to the signed-in account. */
  fun linkBody(firebaseIdToken: String, googleIdToken: String): JsonObject = JsonObject(
    mapOf<String, JsonElement>(
      "idToken" to JsonPrimitive(firebaseIdToken),
      "postBody" to JsonPrimitive("id_token=${encodeComponent(googleIdToken)}&providerId=google.com"),
      "requestUri" to JsonPrimitive("http://localhost"),
      "returnSecureToken" to JsonPrimitive(true),
      "returnIdpCredential" to JsonPrimitive(true),
    ),
  )

  /** The words for Identity Toolkit's refusal of the link. */
  fun linkRefusal(code: String?): String = when (code.orEmpty().trim().substringBefore(' ')) {
    "FEDERATED_USER_ID_ALREADY_LINKED", "EMAIL_EXISTS", "CREDENTIAL_ALREADY_IN_USE" ->
      "That Google account is already linked to an Aglyn account."
    else -> "Connecting Google failed."
  }

  private fun encodeComponent(value: String): String = buildString {
    for (byte in value.encodeToByteArray()) {
      val c = byte.toInt() and 0xff
      if (c.toChar() in 'A'..'Z' || c.toChar() in 'a'..'z' || c.toChar() in '0'..'9' || c.toChar() in "-._~") {
        append(c.toChar())
      } else {
        append('%').append("0123456789ABCDEF"[c shr 4]).append("0123456789ABCDEF"[c and 15])
      }
    }
  }
}
