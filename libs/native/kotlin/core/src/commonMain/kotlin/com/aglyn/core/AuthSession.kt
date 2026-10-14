package com.aglyn.core

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** The support session of an [AuthSession] that has none. */
private val NoImpersonation: StateFlow<Impersonation?> = MutableStateFlow(null)

data class AuthUser(
  val uid: String,
  val email: String?,
  val displayName: String?,
)

sealed interface AuthState {
  /** The persisted session is still being restored. */
  data object Restoring : AuthState
  data object SignedOut : AuthState
  data class SignedIn(val user: AuthUser) : AuthState
}

/**
 * The signed-in person, as every platform provides it. Android binds the
 * Firebase Android SDK; desktop binds the Identity Toolkit REST API. Callers
 * never see which.
 */
interface AuthSession {
  val state: StateFlow<AuthState>

  /**
   * The support session a staff member is in as a customer, null for an ordinary session. While it is on, [state] is the customer
   * and every token is theirs; the staff member's own sign-in is set aside untouched.
   */
  val impersonation: StateFlow<Impersonation?> get() = NoImpersonation

  /** Signs in as the customer with the custom token `/api/admin/impersonate` minted, in the identity pool [tenantId] names. */
  suspend fun beginImpersonation(customToken: String, tenantId: String?): Unit =
    throw AuthError("Support sessions are not available here.")

  /** Ends the support session and returns to the staff member's own sign-in, which was never signed out. */
  suspend fun endImpersonation() {}

  /** The current Firebase ID token, refreshed when asked or when stale; null when signed out. */
  suspend fun idToken(forceRefresh: Boolean = false): String?

  /** Throws [AuthError] with words for the sign-in form. */
  suspend fun signInWithEmail(email: String, password: String)

  suspend fun signOut()
}

class AuthError(override val message: String, cause: Throwable? = null) : Exception(message, cause)

/** The sign-in form's words for an Identity Toolkit / Firebase Auth error code. */
fun authErrorMessage(code: String?): String = when (code?.uppercase()?.substringBefore(' ')) {
  "EMAIL_NOT_FOUND", "INVALID_PASSWORD", "INVALID_LOGIN_CREDENTIALS", "ERROR_WRONG_PASSWORD",
  "ERROR_USER_NOT_FOUND", "ERROR_INVALID_CREDENTIAL", "INVALID_CREDENTIAL",
  -> "That email and password do not match."
  "USER_DISABLED", "ERROR_USER_DISABLED" -> "This account is turned off."
  "TOO_MANY_ATTEMPTS_TRY_LATER", "ERROR_TOO_MANY_REQUESTS" -> "Too many tries. Wait a moment and try again."
  "INVALID_EMAIL", "ERROR_INVALID_EMAIL" -> "Enter a valid email address."
  else -> "Could not sign in. Check the connection and try again."
}
