package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.request.forms.FormDataContent
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.Parameters
import io.ktor.http.contentType
import io.ktor.http.encodeURLParameter
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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
  /** How a support session signs in: over REST, keeping nothing. */
  private val support: SupportSessions = SupportSessions(RestSupportBackend(http, apiKey, emulatorHost, now)),
) : AuthSession {
  private val identityBase = emulatorHost?.let { "http://$it/identitytoolkit.googleapis.com" } ?: "https://identitytoolkit.googleapis.com"
  private val tokenBase = emulatorHost?.let { "http://$it/securetoken.googleapis.com" } ?: "https://securetoken.googleapis.com"

  private class Tokens(val idToken: String, val refreshToken: String, val expiresAt: Long, val uid: String)

  private val mutable = MutableStateFlow<AuthState>(
    if (storedRefreshToken() != null) AuthState.Restoring else AuthState.SignedOut,
  )
  override val state: StateFlow<AuthState> = mutable
  private val lock = Mutex()
  @Volatile private var tokens: Tokens? = null

  /**
   * The signed-in person's current ID token, never refreshed and without waiting on a refresh in flight: for a caller that a
   * refresh itself goes through ([ConsoleMintedAppCheck]). Null when signed out, in a support session, or when it has expired.
   */
  fun currentIdToken(): String? {
    if (support.active) return null
    return tokens?.takeIf { it.expiresAt > now() }?.idToken
  }

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
    mutable.value = AuthState.SignedIn(user ?: AuthUser(restored.uid, null, null, TokenClaims.fromIdToken(restored.idToken).emailVerified))
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
      emailVerified = user["emailVerified"]?.jsonPrimitive?.content == "true",
      photoUrl = user["photoUrl"]?.jsonPrimitive?.content?.ifEmpty { null },
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

  override val impersonation: StateFlow<Impersonation?> = support.impersonation

  /** Signs in as a customer with the custom token a staff route minted; the staff member's own tokens stay as they are. */
  override suspend fun beginImpersonation(customToken: String, tenantId: String?) {
    // A support session already on ends first, so the state it set aside is back before the next one starts.
    if (support.active) endImpersonation()
    val customer = support.begin(customToken, tenantId, mutable.value)
    mutable.value = AuthState.SignedIn(customer)
  }

  /** Ends the support session and returns to the staff member's own sign-in, which was never signed out. */
  override suspend fun endImpersonation() {
    mutable.value = support.end() ?: return
  }

  override suspend fun idToken(forceRefresh: Boolean): String? {
    if (support.active) {
      val token = support.idToken(forceRefresh)
      // A refresh the server refuses (the support session was revoked) ends it, and the staff session returns.
      if (token == null) endImpersonation()
      return token
    }
    return staffIdToken(forceRefresh)
  }

  private suspend fun staffIdToken(forceRefresh: Boolean): String? = lock.withLock {
    val current = tokens ?: return@withLock null
    // Refresh a minute early, so a token never expires in flight.
    if (!forceRefresh && current.expiresAt - 60_000 > now()) return@withLock current.idToken
    val refreshed = refreshLocked(current.refreshToken) ?: return@withLock null
    tokens = refreshed
    refreshed.idToken
  }

  override suspend fun signInWithEmail(email: String, password: String) {
    val body = call("accounts:signInWithPassword", ::authErrorMessage) {
      put("email", email.trim()); put("password", password); put("returnSecureToken", true)
    }
    accept(body)
  }

  override suspend fun signUpWithEmail(email: String, password: String): AuthUser {
    val body = call("accounts:signUp", { signUpErrorMessage(it) }) {
      put("email", email.trim()); put("password", password); put("returnSecureToken", true)
    }
    return accept(body)
  }

  override suspend fun signInWithGoogle(googleIdToken: String): Boolean {
    val body = call("accounts:signInWithIdp", { signUpErrorMessage(it) }) {
      put("postBody", "id_token=${googleIdToken.encodeURLParameter()}&providerId=google.com")
      put("requestUri", "http://localhost")
      put("returnSecureToken", true)
      put("returnIdpCredential", true)
    }
    if (body["idToken"] == null) throw AuthError(signUpErrorMessage("NEED_CONFIRMATION"), code = "NEED_CONFIRMATION")
    accept(body)
    return body["isNewUser"]?.jsonPrimitive?.content == "true"
  }

  override suspend fun signInWithCustomToken(token: String) = signInWithCustomToken(token, null)

  /** A custom token (the console hand-off's, a passkey's) in the pool [tenantId] names; the person is read off the ID token. */
  override suspend fun signInWithCustomToken(token: String, tenantId: String?) {
    val body = call("accounts:signInWithCustomToken", ::authErrorMessage) {
      put("token", token)
      put("returnSecureToken", true)
      if (!tenantId.isNullOrEmpty()) put("tenantId", tenantId)
    }
    val claims = TokenClaims.fromIdToken(body["idToken"]?.jsonPrimitive?.content)
    val uid = (claims.values["user_id"] as? JsonPrimitive)?.content ?: (claims.values["sub"] as? JsonPrimitive)?.content
      ?: throw AuthError(authErrorMessage(null))
    val email = (claims.values["email"] as? JsonPrimitive)?.content
    val name = (claims.values["name"] as? JsonPrimitive)?.content
    accept(
      JsonObject(
        body + mapOf("localId" to JsonPrimitive(uid)) +
          listOfNotNull(email?.let { "email" to JsonPrimitive(it) }, name?.let { "displayName" to JsonPrimitive(it) }),
      ),
    )
  }

  override suspend fun reload() {
    val signedIn = (mutable.value as? AuthState.SignedIn)?.user ?: return
    if (support.active) return
    val idToken = runCatching { staffIdToken(forceRefresh = true) }.getOrNull() ?: return
    val fresh = runCatching { lookup(idToken) }.getOrNull()
    mutable.value = AuthState.SignedIn(fresh ?: signedIn.copy(emailVerified = TokenClaims.fromIdToken(idToken).emailVerified))
  }

  override suspend fun applyActionCode(code: String) {
    call("accounts:update", { signUpErrorMessage(it) }) { put("oobCode", code) }
    reload()
  }

  override suspend fun verifyPasswordResetCode(code: String): String =
    call("accounts:resetPassword", { signUpErrorMessage(it) }) { put("oobCode", code) }["email"]?.jsonPrimitive?.content.orEmpty()

  override suspend fun confirmPasswordReset(code: String, newPassword: String) {
    call("accounts:resetPassword", { signUpErrorMessage(it) }) { put("oobCode", code); put("newPassword", newPassword) }
  }

  override suspend fun providerIds(): List<String> {
    val idToken = lock.withLock { tokens?.idToken } ?: return emptyList()
    val body = runCatching { call("accounts:lookup", ::authErrorMessage) { put("idToken", idToken) } }.getOrNull() ?: return emptyList()
    val user = (body["users"] as? JsonArray)?.firstOrNull() as? JsonObject ?: return emptyList()
    return (user["providerUserInfo"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.get("providerId")?.jsonPrimitive?.content }
  }

  /** One Identity Toolkit call; a refusal throws [AuthError] in [message]'s words, carrying its code. */
  private suspend fun call(
    method: String,
    message: (String?) -> String,
    body: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit,
  ): JsonObject {
    val response = try {
      http.post("$identityBase/v1/$method?key=$apiKey") {
        contentType(ContentType.Application.Json)
        setBody(buildJsonObject(body).toString())
      }
    } catch (error: Exception) {
      throw AuthError(message("NETWORK"), error, "NETWORK")
    }
    val parsed = runCatching { Json.parseToJsonElement(response.bodyAsText()).jsonObject }.getOrNull()
    if (response.status.value !in 200..299 || parsed == null) {
      val text = (parsed?.get("error") as? JsonObject)?.get("message")?.jsonPrimitive?.content
      val code = if (isAppCheckRefusalText(text)) APP_CHECK_REFUSED else text?.substringBefore(' ')
      throw AuthError(message(code), code = code)
    }
    return parsed
  }

  /** Keeps a sign-in's tokens and signs the person in; whether the address is confirmed is read off the ID token. */
  private suspend fun accept(body: JsonObject): AuthUser {
    lock.withLock {
      tokens = Tokens(
        idToken = body.getValue("idToken").jsonPrimitive.content,
        refreshToken = body.getValue("refreshToken").jsonPrimitive.content,
        expiresAt = now() + (body["expiresIn"]?.jsonPrimitive?.content?.toLongOrNull() ?: 3600) * 1000,
        uid = body.getValue("localId").jsonPrimitive.content,
      )
      keep(tokens!!.refreshToken)
    }
    val user = AuthUser(
      uid = body.getValue("localId").jsonPrimitive.content,
      email = body["email"]?.jsonPrimitive?.content,
      displayName = body["displayName"]?.jsonPrimitive?.content?.ifEmpty { null },
      emailVerified = TokenClaims.fromIdToken(body["idToken"]?.jsonPrimitive?.content).emailVerified,
      // `signInWithPassword` answers `profilePicture`, `signInWithIdp` answers `photoUrl`.
      photoUrl = (body["photoUrl"] ?: body["profilePicture"])?.jsonPrimitive?.content?.ifEmpty { null },
    )
    mutable.value = AuthState.SignedIn(user)
    return user
  }

  /** `accounts:update` with the current ID token; the new tokens replace the old, which a password change revokes. */
  private suspend fun update(fields: Map<String, JsonElement>): JsonObject {
    val idToken = lock.withLock { tokens?.idToken } ?: throw AuthError(authErrorMessage(null))
    val response = try {
      http.post("$identityBase/v1/accounts:update?key=$apiKey") {
        contentType(ContentType.Application.Json)
        setBody(JsonObject(fields + mapOf("idToken" to JsonPrimitive(idToken), "returnSecureToken" to JsonPrimitive(true))).toString())
      }
    } catch (error: Exception) {
      throw AuthError(authErrorMessage(null), error)
    }
    val body = runCatching { Json.parseToJsonElement(response.bodyAsText()).jsonObject }.getOrNull()
    if (response.status.value !in 200..299 || body == null) {
      val code = (body?.get("error") as? JsonObject)?.get("message")?.jsonPrimitive?.content
      throw AuthError(passwordChangeMessage(code))
    }
    lock.withLock {
      val current = tokens ?: return@withLock
      val fresh = Tokens(
        idToken = body["idToken"]?.jsonPrimitive?.content ?: current.idToken,
        refreshToken = body["refreshToken"]?.jsonPrimitive?.content ?: current.refreshToken,
        expiresAt = now() + (body["expiresIn"]?.jsonPrimitive?.content?.toLongOrNull() ?: 3600) * 1000,
        uid = current.uid,
      )
      tokens = fresh
      keep(fresh.refreshToken)
    }
    return body
  }

  override suspend fun changePassword(current: String, new: String) {
    val email = (mutable.value as? AuthState.SignedIn)?.user?.email ?: throw AuthError(passwordChangeMessage(null))
    // Signing in with the current password proves it and gives the fresh token the change needs.
    try {
      signInWithEmail(email, current)
    } catch (error: AuthError) {
      throw AuthError(if ("do not match" in error.message) passwordChangeMessage("INVALID_LOGIN_CREDENTIALS") else error.message, error)
    }
    update(mapOf("password" to JsonPrimitive(new)))
  }

  override suspend fun unlinkProvider(providerId: String) {
    update(mapOf("deleteProvider" to JsonArray(listOf(JsonPrimitive(providerId)))))
  }

  override suspend fun linkGoogle(googleIdToken: String) {
    val idToken = lock.withLock { tokens?.idToken } ?: throw AuthError(GoogleLink.linkRefusal(null))
    val response = try {
      http.post("$identityBase/v1/accounts:signInWithIdp?key=$apiKey") {
        contentType(ContentType.Application.Json)
        setBody(GoogleLink.linkBody(idToken, googleIdToken).toString())
      }
    } catch (error: Exception) {
      throw AuthError(GoogleLink.linkRefusal(null), error)
    }
    val body = runCatching { Json.parseToJsonElement(response.bodyAsText()).jsonObject }.getOrNull()
    if (response.status.value !in 200..299 || body == null) {
      throw AuthError(GoogleLink.linkRefusal((body?.get("error") as? JsonObject)?.get("message")?.jsonPrimitive?.content))
    }
    // The new tokens carry the Google identity, which is what the provider list is read from.
    lock.withLock {
      val current = tokens ?: return@withLock
      val fresh = Tokens(
        idToken = body["idToken"]?.jsonPrimitive?.content ?: current.idToken,
        refreshToken = body["refreshToken"]?.jsonPrimitive?.content ?: current.refreshToken,
        expiresAt = now() + (body["expiresIn"]?.jsonPrimitive?.content?.toLongOrNull() ?: 3600) * 1000,
        uid = current.uid,
      )
      tokens = fresh
      keep(fresh.refreshToken)
    }
  }

  override suspend fun updateDisplayName(name: String) {
    val signedIn = (mutable.value as? AuthState.SignedIn)?.user ?: return
    update(mapOf("displayName" to JsonPrimitive(name)))
    mutable.value = AuthState.SignedIn(signedIn.copy(displayName = name.ifEmpty { null }))
  }

  override suspend fun signOut() {
    // Leaving the app from a support session ends it, and then signs the staff member out as well.
    endImpersonation()
    lock.withLock { signOutLocked() }
  }

  private fun signOutLocked() {
    tokens = null
    runCatching { credentials.delete(credentialKey) }
    mutable.value = AuthState.SignedOut
  }
}
