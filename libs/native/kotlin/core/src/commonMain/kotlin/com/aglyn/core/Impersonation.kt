package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.request.forms.FormDataContent
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.Parameters
import io.ktor.http.contentType
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * A support session: a staff member signed in as a customer, through the custom token `/api/admin/impersonate` mints. The
 * customer's session is held in memory and never persisted, and the staff member's own is set aside untouched and returns
 * when the support session ends, so quitting the app ends it too.
 */
data class Impersonation(
  /** The customer the staff member is signed in as. */
  val customer: AuthUser,
  /** The staff member, for the banner and the audit trail that names them. */
  val staffEmail: String?,
) {
  /** The banner's words, the console's (`ImpersonationBanner`): who the session is, who opened it, and that it is audited. */
  val banner: String get() = "You are impersonating ${customer.email ?: "this account"} (staff: ${staffEmail ?: "unknown"}). Actions are audited."
}

/** What a platform provides so a support session has its own sign-in, apart from the staff member's. */
interface SupportBackend {
  /** Exchanges the custom token in the identity pool [tenantId] names (null is the project's own); throws [AuthError]. */
  suspend fun signIn(customToken: String, tenantId: String?): AuthUser

  /** The customer's current ID token, refreshed when asked or when stale; null once the server refuses it. */
  suspend fun idToken(forceRefresh: Boolean): String?

  /** Forgets the customer's session. */
  suspend fun signOut()
}

/**
 * The support-session half of an [AuthSession], the same on every platform: it sets the staff member's sign-in aside while the
 * customer's is on, answers the customer's tokens, and gives the staff member's back. [backend] is null where a build cannot
 * open one.
 */
class SupportSessions(private val backend: SupportBackend?) {
  private val mutable = MutableStateFlow<Impersonation?>(null)
  val impersonation: StateFlow<Impersonation?> = mutable
  private var staffAside: AuthState? = null
  private val lock = Mutex()

  val active: Boolean get() = mutable.value != null

  /** Signs in as the customer; returns them. The staff member's [current] sign-in is kept for [end]. */
  suspend fun begin(customToken: String, tenantId: String?, current: AuthState): AuthUser {
    val support = backend ?: throw AuthError("Support sessions are not available here.")
    // A second support session replaces the first; the staff member's own sign-in is the one set aside, never the first customer's.
    val staff = if (active) end() ?: current else current
    val customer = support.signIn(customToken, tenantId)
    lock.withLock {
      staffAside = staff
      mutable.value = Impersonation(customer, (staff as? AuthState.SignedIn)?.user?.email)
    }
    return customer
  }

  /** Ends the support session; returns the staff member's own sign-in to go back to, or null when none was on. */
  suspend fun end(): AuthState? {
    val back = lock.withLock {
      if (mutable.value == null) return null
      val aside = staffAside
      staffAside = null
      mutable.value = null
      aside ?: AuthState.SignedOut
    }
    backend?.signOut()
    return back
  }

  /** The customer's token while a support session is on; null otherwise. */
  suspend fun idToken(forceRefresh: Boolean): String? = if (active) backend?.idToken(forceRefresh) else null
}

/** The staff account that opened this session as someone else (`impersonatedBy`); null for an ordinary session. */
val TokenClaims.impersonatedBy: String? get() = (values["impersonatedBy"] as? JsonPrimitive)?.contentOrNull
val TokenClaims.impersonatedByEmail: String? get() = (values["impersonatedByEmail"] as? JsonPrimitive)?.contentOrNull

/**
 * The Firestore reader a signed-in person reads with, and the one a support session reads with: the Android SDK's is bound
 * to the staff member's own sign-in, so while a support session is on every read goes through the customer's instead, and the
 * rules treat the staff member exactly as they treat the customer.
 */
class SwitchingFirestoreReader(
  private val normal: FirestoreReader,
  private val impersonated: () -> FirestoreReader,
  private val active: () -> Boolean,
) : FirestoreReader {
  private val reader: FirestoreReader get() = if (active()) impersonated() else normal

  override suspend fun get(path: String): FirestoreDoc? = reader.get(path)
  override suspend fun page(query: FirestoreQuery): FirestorePage = reader.page(query)
  override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = reader.observeDoc(path)
  override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = reader.observe(query)
  override suspend fun count(query: FirestoreQuery): Long? = reader.count(query)
  override suspend fun sum(query: FirestoreQuery, field: String): Double? = reader.sum(query, field)
}

/** The same switch for writes. */
class SwitchingFirestoreWriter(
  private val normal: FirestoreWriter,
  private val impersonated: () -> FirestoreWriter,
  private val active: () -> Boolean,
) : FirestoreWriter {
  private val writer: FirestoreWriter get() = if (active()) impersonated() else normal

  override suspend fun merge(path: String, data: Map<String, Any?>) = writer.merge(path, data)
  override suspend fun update(path: String, data: Map<String, Any?>) = writer.update(path, data)
  override suspend fun delete(path: String) = writer.delete(path)
  override suspend fun add(collectionPath: String, data: Map<String, Any?>): String = writer.add(collectionPath, data)
}

/**
 * A support session over the Identity Toolkit REST API (`accounts:signInWithCustomToken`, then the Secure Token refresh),
 * against the Auth emulator when [emulatorHost] is set. It keeps the customer's tokens in memory only.
 */
class RestSupportBackend(
  private val http: HttpClient,
  private val apiKey: String,
  emulatorHost: String?,
  private val now: () -> Long = ::nowMillis,
) : SupportBackend {
  private val identityBase = emulatorHost?.let { "http://$it/identitytoolkit.googleapis.com" } ?: "https://identitytoolkit.googleapis.com"
  private val tokenBase = emulatorHost?.let { "http://$it/securetoken.googleapis.com" } ?: "https://securetoken.googleapis.com"

  private class Tokens(val idToken: String, val refreshToken: String, val expiresAt: Long)

  private val lock = Mutex()
  private var tokens: Tokens? = null

  override suspend fun signIn(customToken: String, tenantId: String?): AuthUser {
    val response = try {
      http.post("$identityBase/v1/accounts:signInWithCustomToken?key=$apiKey") {
        contentType(ContentType.Application.Json)
        setBody(
          buildJsonObject {
            put("token", customToken)
            put("returnSecureToken", true)
            if (!tenantId.isNullOrEmpty()) put("tenantId", tenantId)
          }.toString(),
        )
      }
    } catch (error: Exception) {
      throw AuthError(authErrorMessage(null), error)
    }
    val body = runCatching { Json.parseToJsonElement(response.bodyAsText()).jsonObject }.getOrNull()
    if (response.status.value !in 200..299 || body == null) {
      throw AuthError(supportErrorMessage((body?.get("error") as? JsonObject)?.get("message")?.jsonPrimitive?.content))
    }
    val idToken = body["idToken"]?.jsonPrimitive?.content
    val refreshToken = body["refreshToken"]?.jsonPrimitive?.content
    val claims = TokenClaims.fromIdToken(idToken)
    val uid = (claims.values["user_id"] as? JsonPrimitive)?.contentOrNull ?: (claims.values["sub"] as? JsonPrimitive)?.contentOrNull
    if (idToken == null || refreshToken == null || uid == null) throw AuthError(supportErrorMessage(null))
    lock.withLock {
      tokens = Tokens(idToken, refreshToken, now() + (body["expiresIn"]?.jsonPrimitive?.content?.toLongOrNull() ?: 3600) * 1000)
    }
    return AuthUser(
      uid = uid,
      email = (claims.values["email"] as? JsonPrimitive)?.contentOrNull,
      displayName = (claims.values["name"] as? JsonPrimitive)?.contentOrNull?.ifEmpty { null },
    )
  }

  override suspend fun idToken(forceRefresh: Boolean): String? = lock.withLock {
    val current = tokens ?: return@withLock null
    // Refresh a minute early, so a token never expires in flight.
    if (!forceRefresh && current.expiresAt - 60_000 > now()) return@withLock current.idToken
    val response = http.post("$tokenBase/v1/token?key=$apiKey") {
      setBody(FormDataContent(Parameters.build { append("grant_type", "refresh_token"); append("refresh_token", current.refreshToken) }))
    }
    val body = runCatching { Json.parseToJsonElement(response.bodyAsText()).jsonObject }.getOrNull()
    if (response.status.value !in 200..299 || body == null) {
      // A refresh the server refuses (the support session was revoked) ends it.
      if (response.status.value in 400..499) tokens = null
      return@withLock null
    }
    val refreshed = Tokens(
      idToken = body.getValue("id_token").jsonPrimitive.content,
      refreshToken = body.getValue("refresh_token").jsonPrimitive.content,
      expiresAt = now() + (body["expires_in"]?.jsonPrimitive?.content?.toLongOrNull() ?: 3600) * 1000,
    )
    tokens = refreshed
    refreshed.idToken
  }

  override suspend fun signOut() = lock.withLock { tokens = null }
}

/** The words for a support session that did not open. */
fun supportErrorMessage(code: String?): String = when (code?.uppercase()?.substringBefore(' ')) {
  "INVALID_CUSTOM_TOKEN", "CREDENTIAL_MISMATCH", "ERROR_INVALID_CUSTOM_TOKEN" -> "The support session was refused. Try again."
  "USER_DISABLED", "ERROR_USER_DISABLED" -> "This account is turned off."
  else -> "The support session could not be opened. Check the connection and try again."
}
