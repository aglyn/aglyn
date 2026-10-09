package com.aglyn.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/**
 * The claims a Firebase ID token carries (`staff`, `staffRole`, `auth_time`),
 * read from the token's own payload the way the console reads
 * `getIdTokenResult().claims`. A UI gate only: `/api/admin/` routes and the
 * Firestore rules verify the signed token on every request. Twin of the
 * Apple `TokenClaims`.
 */
class TokenClaims(val values: Map<String, JsonElement> = emptyMap()) {
  val isStaff: Boolean get() = (values["staff"] as? JsonPrimitive)?.booleanOrNull == true

  /** `support` when the claim is absent, as the routes fail closed; null for anyone not staff. */
  val staffRole: String?
    get() = if (!isStaff) null else (values["staffRole"] as? JsonPrimitive)?.contentOrNull ?: "support"

  val isSuper: Boolean get() = staffRole == "super"

  override fun equals(other: Any?) = other is TokenClaims && other.values == values
  override fun hashCode() = values.hashCode()

  companion object {
    @OptIn(ExperimentalEncodingApi::class)
    fun fromIdToken(token: String?): TokenClaims {
      val parts = (token ?: "").split('.')
      if (parts.size != 3) return TokenClaims()
      return runCatching {
        val bytes = Base64.UrlSafe.withPadding(Base64.PaddingOption.ABSENT_OPTIONAL).decode(parts[1])
        TokenClaims((Json.parseToJsonElement(bytes.decodeToString()) as JsonObject).toMap())
      }.getOrDefault(TokenClaims())
    }
  }
}
