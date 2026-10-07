package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.request.forms.FormDataContent
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.Parameters
import io.ktor.http.contentType
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * [AuthSession] on the JVM desktop, over the Identity Toolkit REST API
 * (`accounts:signInWithPassword`) and the Secure Token API (refresh), against
 * the Auth emulator when [emulatorHost] is set. The refresh token is kept in
 * [credentials] under [credentialKey] (Windows Credential Manager on Windows),
 * so [restore] signs the person back in at the next launch.
 */
class IdentityToolkitAuthSession(
  private val http: HttpClient,
  private val apiKey: String,
  emulatorHost: String?,
  private val now: () -> Long = ::nowMillis,
  private val credentials: CredentialStore = InMemoryCredentialStore(),
  private val credentialKey: String = "Aglyn",
) : AuthSession {
  private val identityBase = emulatorHost?.let { "http://$it/identitytoolkit.googleapis.com" } ?: "https://identitytoolkit.googleapis.com"
  private val tokenBase = emulatorHost?.let { "http://$it/securetoken.googleapis.com" } ?: "https://securetoken.googleapis.com"

  private class Tokens(val idToken: String, val refreshToken: String, val expiresAt: Long, val uid: String)

  private val mutable = MutableStateFlow<AuthState>(
    if (storedRefreshToken() != null) AuthState.Restoring else AuthState.SignedOut,
  )
  override val state: StateFlow<AuthState> = mutable
  private val lock = Mutex()
  private var tokens: Tokens? = null

  private fun storedRefreshToken(): String? = runCatching { credentials.read(credentialKey) }.getOrNull()?.ifEmpty { null }

  private fun keep(refreshToken: String) {
    runCatching { credentials.write(credentialKey, refreshToken) }
      .onFailure { System.err.println("Aglyn: could not keep the session (${it.message})") }
  }

  /**
   * Signs back in with the kept refresh token, if any: a token the server
   * refuses (revoked, the account disabled or deleted) is forgotten; one that
   * could not be checked (offline) is kept for the next launch. Either way the
   * state settles on signed in or signed out.
   */
  suspend fun restore() {
    val refreshToken = storedRefreshToken()
    if (refreshToken == null) {
      mutable.compareAndSet(AuthState.Restoring, AuthState.SignedOut)
      return
    }
    val restored = runCatching {
      lock.withLock {
        val refreshed = refreshLocked(refreshToken) ?: return@withLock null
        tokens = refreshed
        refreshed
      }
    }.getOrNull()
    if (restored == null) {
      if (mutable.value == AuthState.Restoring) mutable.value = AuthState.SignedOut
      return
    }
    val user = runCatching { lookup(restored.idToken) }.getOrNull()
    mutable.value = AuthState.SignedIn(user ?: AuthUser(restored.uid, null, null))
  }

  /** The account behind [idToken]: `accounts:lookup`. */
  private suspend fun lookup(idToken: String): AuthUser? {
    val response = http.post("$identityBase/v1/accounts:lookup?key=$apiKey") {
      contentType(ContentType.Application.Json)
      setBody(buildJsonObject { put("idToken", idToken) }.toString())
    }
    if (response.status.value !in 200..299) return null
    val user = (Json.parseToJsonElement(response.bodyAsText()).jsonObject["users"] as? kotlinx.serialization.json.JsonArray)
      ?.firstOrNull()?.jsonObject ?: return null
    return AuthUser(
      uid = user.getValue("localId").jsonPrimitive.content,
      email = user["email"]?.jsonPrimitive?.content,
      displayName = user["displayName"]?.jsonPrimitive?.content?.ifEmpty { null },
    )
  }

  /** A fresh ID token for [refreshToken], or null when the server refuses it (and the kept one is then forgotten). */
  private suspend fun refreshLocked(refreshToken: String): Tokens? {
    val response = http.post("$tokenBase/v1/token?key=$apiKey") {
      setBody(FormDataContent(Parameters.build { append("grant_type", "refresh_token"); append("refresh_token", refreshToken) }))
    }
    val body = runCatching { Json.parseToJsonElement(response.bodyAsText()).jsonObject }.getOrNull()
    if (response.status.value !in 200..299 || body == null) {
      // A refresh the server refuses (revoked, disabled) ends the session.
      if (response.status.value in 400..499) signOutLocked()
      return null
    }
    val refreshed = Tokens(
      idToken = body.getValue("id_token").jsonPrimitive.content,
      refreshToken = body.getValue("refresh_token").jsonPrimitive.content,
      expiresAt = now() + (body["expires_in"]?.jsonPrimitive?.content?.toLongOrNull() ?: 3600) * 1000,
      uid = body["user_id"]?.jsonPrimitive?.content.orEmpty(),
    )
    if (refreshed.refreshToken != refreshToken) keep(refreshed.refreshToken)
    return refreshed
  }

  override suspend fun idToken(forceRefresh: Boolean): String? = lock.withLock {
    val current = tokens ?: return@withLock null
    // Refresh a minute early, so a token never expires in flight.
    if (!forceRefresh && current.expiresAt - 60_000 > now()) return@withLock current.idToken
    val refreshed = refreshLocked(current.refreshToken) ?: return@withLock null
    tokens = refreshed
    refreshed.idToken
  }

  override suspend fun signInWithEmail(email: String, password: String) {
    val response = try {
      http.post("$identityBase/v1/accounts:signInWithPassword?key=$apiKey") {
        contentType(ContentType.Application.Json)
        setBody(buildJsonObject { put("email", email.trim()); put("password", password); put("returnSecureToken", true) }.toString())
      }
    } catch (error: Exception) {
      throw AuthError(authErrorMessage(null), error)
    }
    val body = runCatching { Json.parseToJsonElement(response.bodyAsText()).jsonObject }.getOrNull()
    if (response.status.value !in 200..299 || body == null) {
      val code = (body?.get("error") as? JsonObject)?.get("message")?.jsonPrimitive?.content
      throw AuthError(authErrorMessage(code))
    }
    lock.withLock {
      tokens = Tokens(
        idToken = body.getValue("idToken").jsonPrimitive.content,
        refreshToken = body.getValue("refreshToken").jsonPrimitive.content,
        expiresAt = now() + (body["expiresIn"]?.jsonPrimitive?.content?.toLongOrNull() ?: 3600) * 1000,
        uid = body.getValue("localId").jsonPrimitive.content,
      )
      keep(tokens!!.refreshToken)
    }
    mutable.value = AuthState.SignedIn(
      AuthUser(
        uid = body.getValue("localId").jsonPrimitive.content,
        email = body["email"]?.jsonPrimitive?.content,
        displayName = body["displayName"]?.jsonPrimitive?.content?.ifEmpty { null },
      ),
    )
  }

  override suspend fun signOut() = lock.withLock { signOutLocked() }

  private fun signOutLocked() {
    tokens = null
    runCatching { credentials.delete(credentialKey) }
    mutable.value = AuthState.SignedOut
  }
}
