package com.aglyn.core

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** The support session of an [AuthSession] that has none. */
private val NoImpersonation: StateFlow<Impersonation?> = MutableStateFlow(null)

data class AuthUser(
  val uid: String,
  val email: String?,
  val displayName: String?,
  /**
   * Whether the account's email address is confirmed. Every console route refuses an account that has not confirmed it, so the
   * shell shows the verification step first, as the console's `/verify-email` does. Each [AuthSession] states it.
   */
  val emailVerified: Boolean = true,
  /**
   * The picture on the sign-in record (the SDK's `photoUrl`, Identity Toolkit's `photoUrl`): the fallback for the person's own
   * photo when their profile has none (`readAccountPhoto`, AGL-4010).
   */
  val photoUrl: String? = null,
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

  /** Signs in with a Firebase custom token, as a passkey sign-in ends (the server mints it for the credential's owner). */
  suspend fun signInWithCustomToken(token: String): Unit = throw AuthError("Signing in with a passkey is not available here.")

  /**
   * Signs in with a custom token minted in the identity pool [tenantId] names (an SSO account lives in its workspace's tenant):
   * the console hand-off's. The project pool when null.
   */
  suspend fun signInWithCustomToken(token: String, tenantId: String?) {
    if (tenantId.isNullOrEmpty()) signInWithCustomToken(token) else throw AuthError("Single sign-on is not available here.")
  }

  /**
   * Creates an email and password account in the project pool and signs in as it, as the console's sign-up does
   * (`createUserWithEmailAndPassword`); the blocking functions and abuse checks run on it as on the console's. Throws [AuthError]
   * with the sign-up form's words and the Identity Toolkit code.
   */
  suspend fun signUpWithEmail(email: String, password: String): AuthUser =
    throw AuthError("Creating an account is not available here.")

  /**
   * Signs in with Google's ID token (a [GoogleCredentialSource]'s), which signs up a person the project has not seen; returns
   * whether it did, the console's `isNewAccount(credential)`. Throws [AuthError] with the form's words.
   */
  suspend fun signInWithGoogle(googleIdToken: String): Boolean = throw AuthError("Google sign-in is not available here.")

  /** Re-reads the account (the console's `user.reload()`), so a confirmed address shows as confirmed in [state]. */
  suspend fun reload() {}

  /** Confirms an address with an emailed verification link's code (`applyActionCode`); no one need be signed in. */
  suspend fun applyActionCode(code: String): Unit = throw AuthError("Verifying an email is not available here.")

  /** The address an emailed reset link's code is for (`verifyPasswordResetCode`); throws when it is spent or expired. */
  suspend fun verifyPasswordResetCode(code: String): String = throw AuthError("Resetting a password is not available here.")

  /** Sets a new password with an emailed reset link's code (`confirmPasswordReset`). */
  suspend fun confirmPasswordReset(code: String, newPassword: String): Unit =
    throw AuthError("Resetting a password is not available here.")

  /** The sign-in providers the account holds (`password`, `google.com`, …), as the console reads `user.providerData`. */
  suspend fun providerIds(): List<String> = emptyList()

  suspend fun signOut()

  /** Proves [current], then sets [new]. Throws [AuthError] with words for the form. */
  suspend fun changePassword(current: String, new: String): Unit =
    throw AuthError("Changing the password is not available here.")

  /** Disconnects a sign-in provider (`google.com`) from the account, as the console's Account section does with `unlink`. */
  suspend fun unlinkProvider(providerId: String): Unit =
    throw AuthError("Disconnecting a sign-in method is not available here.")

  /** Attaches Google's credential (the ID token a [GoogleCredentialSource] returned) to the account, as the console's `linkWithPopup` does. */
  suspend fun linkGoogle(googleIdToken: String): Unit =
    throw AuthError("Connecting Google is not available here.")

  /** Keeps the account's display name in step with the profile (rosters and comments read it). */
  suspend fun updateDisplayName(name: String) {}
}

/** A failed auth call, in words for the form; [code] is the Identity Toolkit code it carried, when one did. */
class AuthError(override val message: String, cause: Throwable? = null, val code: String? = null) : Exception(message, cause)

/** The sign-in form's words for an Identity Toolkit / Firebase Auth error code. */
fun authErrorMessage(code: String?): String = if (code == APP_CHECK_REFUSED || isAppCheckRefusalText(code)) {
  APP_CHECK_REFUSAL_MESSAGE
} else when (code?.uppercase()?.substringBefore(' ')) {
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

/**
 * Whether a failed token refresh means the session is over (its refresh token is no longer honoured, the account was
 * deleted or disabled), from the Firebase error code or, where the SDK wraps it, the server's code in the message.
 */
fun isDeadSessionError(code: String?, message: String?): Boolean {
  val dead = setOf("INVALID_REFRESH_TOKEN", "TOKEN_EXPIRED", "USER_NOT_FOUND", "USER_DISABLED", "INVALID_GRANT_TYPE", "USER_TOKEN_EXPIRED", "INVALID_USER_TOKEN")
  val normalized = code?.removePrefix("ERROR_")?.uppercase()
  return normalized in dead || dead.any { message?.contains(it) == true }
}
