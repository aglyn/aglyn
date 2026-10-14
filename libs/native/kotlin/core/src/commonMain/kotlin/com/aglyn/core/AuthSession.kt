package com.aglyn.core

import kotlinx.coroutines.flow.StateFlow

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

  /** The current Firebase ID token, refreshed when asked or when stale; null when signed out. */
  suspend fun idToken(forceRefresh: Boolean = false): String?

  /** Throws [AuthError] with words for the sign-in form. */
  suspend fun signInWithEmail(email: String, password: String)

  suspend fun signOut()

  /** Proves [current], then sets [new]. Throws [AuthError] with words for the form. */
  suspend fun changePassword(current: String, new: String): Unit =
    throw AuthError("Changing the password is not available here.")

  /** Keeps the account's display name in step with the profile (rosters and comments read it). */
  suspend fun updateDisplayName(name: String) {}
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

/** The password change's words for an Identity Toolkit / Firebase Auth error code. */
fun passwordChangeMessage(code: String?): String = when (code?.uppercase()?.substringBefore(' ')) {
  "WEAK_PASSWORD", "ERROR_WEAK_PASSWORD" -> "That password is too weak. Use a longer one."
  "EMAIL_NOT_FOUND", "INVALID_PASSWORD", "INVALID_LOGIN_CREDENTIALS", "ERROR_WRONG_PASSWORD",
  "ERROR_INVALID_CREDENTIAL", "INVALID_CREDENTIAL",
  -> "Your current password is not right."
  else -> authErrorMessage(code)
}
