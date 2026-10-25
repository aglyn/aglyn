package com.aglyn.core

import com.google.firebase.auth.EmailAuthProvider
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.auth.FirebaseAuthUserCollisionException
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.auth.UserProfileChangeRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.tasks.await

/**
 * [AuthSession] on the Firebase Android SDK; the SDK persists the session. [support] opens a support session (a staff member
 * signed in as a customer) in a Firebase app of its own, leaving this one's sign-in as it is.
 */
class FirebaseAuthSession(private val auth: FirebaseAuth, support: SupportBackend? = null) : AuthSession {
  private val mutable = MutableStateFlow<AuthState>(AuthState.Restoring)
  override val state: StateFlow<AuthState> = mutable
  private val supportSessions = SupportSessions(support)
  override val impersonation: StateFlow<Impersonation?> = supportSessions.impersonation

  init {
    auth.addAuthStateListener { current ->
      // While a support session is on, the SDK's user is the staff member's, set aside.
      if (supportSessions.active) return@addAuthStateListener
      val user = current.currentUser
      mutable.value = if (user == null) {
        AuthState.SignedOut
      } else {
        AuthState.SignedIn(user.toAuthUser())
      }
    }
  }

  private fun com.google.firebase.auth.FirebaseUser.toAuthUser() = AuthUser(uid, email, displayName, isEmailVerified, photoUrl?.toString())

  override suspend fun beginImpersonation(customToken: String, tenantId: String?) {
    // A support session already on ends first, so the state it set aside is back before the next one starts.
    if (supportSessions.active) endImpersonation()
    val customer = supportSessions.begin(customToken, tenantId, mutable.value)
    mutable.value = AuthState.SignedIn(customer)
  }

  override suspend fun endImpersonation() {
    mutable.value = supportSessions.end() ?: return
  }

  override suspend fun idToken(forceRefresh: Boolean): String? {
    if (supportSessions.active) {
      val token = supportSessions.idToken(forceRefresh)
      // A refresh the server refuses (the support session was revoked) ends it, and the staff session returns.
      if (token == null) endImpersonation()
      return token
    }
    val user = auth.currentUser ?: return null
    return try {
      user.getIdToken(forceRefresh).await()?.token
    } catch (failure: com.google.firebase.FirebaseException) {
      // A token can only fail here. The session the server no longer honours (a refresh token from another project's
      // emulator, a deleted or disabled account) is signed out, so the app asks for a sign-in instead of ending; any other
      // failure (no connection) answers no token, which a caller reads as "sign in to continue" and the next call retries.
      // Neither may escape: an uncaught one ends the app from whichever screen asked.
      if (isDeadSessionError((failure as? FirebaseAuthException)?.errorCode, failure.message)) auth.signOut()
      null
    }
  }

  override suspend fun signInWithEmail(email: String, password: String) {
    requireProjectPool()
    try {
      auth.signInWithEmailAndPassword(email.trim(), password).await()
    } catch (error: FirebaseAuthException) {
      throw AuthError(authErrorMessage(error.errorCode), error, error.errorCode)
    } catch (error: Exception) {
      throw AuthError(authErrorMessage(appCheckRefusalCode(error)), error, appCheckRefusalCode(error))
    }
  }

  override suspend fun signUpWithEmail(email: String, password: String): AuthUser {
    requireProjectPool()
    val created = try {
      auth.createUserWithEmailAndPassword(email.trim(), password).await().user
    } catch (error: FirebaseAuthException) {
      throw AuthError(signUpErrorMessage(error.errorCode), error, error.errorCode)
    } catch (error: Exception) {
      throw AuthError(signUpErrorMessage(appCheckRefusalCode(error) ?: "NETWORK"), error, appCheckRefusalCode(error))
    } ?: throw AuthError(signUpErrorMessage(null))
    return created.toAuthUser().also { if (!supportSessions.active) mutable.value = AuthState.SignedIn(it) }
  }

  override suspend fun signInWithGoogle(googleIdToken: String): Boolean = try {
    requireProjectPool()
    val result = auth.signInWithCredential(GoogleAuthProvider.getCredential(googleIdToken, null)).await()
    result.additionalUserInfo?.isNewUser == true
  } catch (error: FirebaseAuthException) {
    throw AuthError(signUpErrorMessage(error.errorCode), error, error.errorCode)
  } catch (error: Exception) {
    throw AuthError(signUpErrorMessage(appCheckRefusalCode(error) ?: "NETWORK"), error, appCheckRefusalCode(error))
  }

  override suspend fun reload() {
    val user = auth.currentUser ?: return
    runCatching { user.reload().await() }
    val current = auth.currentUser ?: return
    // The fresh token carries `email_verified`, which the routes read.
    if (current.isEmailVerified) runCatching { current.getIdToken(true).await() }
    if (!supportSessions.active) mutable.value = AuthState.SignedIn(current.toAuthUser())
  }

  override suspend fun applyActionCode(code: String) {
    try {
      auth.applyActionCode(code).await()
    } catch (error: FirebaseAuthException) {
      throw AuthError(signUpErrorMessage(error.errorCode), error, error.errorCode)
    } catch (error: Exception) {
      throw AuthError(signUpErrorMessage(appCheckRefusalCode(error) ?: "NETWORK"), error)
    }
    reload()
  }

  override suspend fun verifyPasswordResetCode(code: String): String = try {
    auth.verifyPasswordResetCode(code).await().orEmpty()
  } catch (error: FirebaseAuthException) {
    throw AuthError(signUpErrorMessage(error.errorCode), error, error.errorCode)
  } catch (error: Exception) {
    throw AuthError(signUpErrorMessage(appCheckRefusalCode(error) ?: "NETWORK"), error)
  }

  override suspend fun confirmPasswordReset(code: String, newPassword: String) {
    try {
      auth.confirmPasswordReset(code, newPassword).await()
    } catch (error: FirebaseAuthException) {
      throw AuthError(signUpErrorMessage(error.errorCode), error, error.errorCode)
    } catch (error: Exception) {
      throw AuthError(signUpErrorMessage(appCheckRefusalCode(error) ?: "NETWORK"), error)
    }
  }

  override suspend fun providerIds(): List<String> = auth.currentUser?.providerData?.map { it.providerId }.orEmpty()

  override suspend fun signInWithCustomToken(token: String) {
    try {
      auth.signInWithCustomToken(token).await()
    } catch (error: FirebaseAuthException) {
      throw AuthError(authErrorMessage(error.errorCode), error)
    } catch (error: Exception) {
      throw AuthError(authErrorMessage(appCheckRefusalCode(error)), error)
    }
  }

  /**
   * The console hand-off's custom token, in the pool it was minted in. The Android SDK can aim its instance at a tenant but has
   * no public way back to the project pool (`setTenantId` takes no null), so signing out (or a door finding nobody signed in)
   * puts it back with [returnToProjectPool] (AGL-3844). The other doors refuse rather than create or find the account in the
   * wrong pool (AGL-1993) only when that could not be done.
   */
  override suspend fun signInWithCustomToken(token: String, tenantId: String?) {
    if (!tenantId.isNullOrEmpty()) {
      auth.setTenantId(tenantId)
    } else {
      requireProjectPool()
    }
    signInWithCustomToken(token)
  }

  private fun requireProjectPool() {
    if (auth.tenantId == null) return
    // Nobody is signed in to the tenant (a sign-out, or an SSO hand-off that failed after aiming at it): go back (AGL-3844).
    if (auth.currentUser == null && auth.returnToProjectPool()) return
    throw AuthError(TENANT_STUCK_MESSAGE)
  }

  override suspend fun changePassword(current: String, new: String) {
    val user = auth.currentUser
    val email = user?.email ?: throw AuthError(passwordChangeMessage(null))
    try {
      user.reauthenticate(EmailAuthProvider.getCredential(email, current)).await()
      user.updatePassword(new).await()
    } catch (error: FirebaseAuthException) {
      throw AuthError(passwordChangeMessage(error.errorCode), error)
    } catch (error: Exception) {
      throw AuthError(passwordChangeMessage(appCheckRefusalCode(error)), error)
    }
  }

  override suspend fun unlinkProvider(providerId: String) {
    val user = auth.currentUser ?: throw AuthError(authErrorMessage(null))
    try {
      user.unlink(providerId).await()
      // The token's identities are read for the provider list, so ask for a fresh one.
      user.getIdToken(true).await()
    } catch (error: Exception) {
      throw AuthError("That sign-in method could not be disconnected. Try again.", error)
    }
  }

  override suspend fun linkGoogle(googleIdToken: String) {
    val user = auth.currentUser ?: throw AuthError(authErrorMessage(null))
    try {
      user.linkWithCredential(GoogleAuthProvider.getCredential(googleIdToken, null)).await()
      // The token's identities are read for the provider list, so ask for a fresh one.
      user.getIdToken(true).await()
    } catch (error: FirebaseAuthUserCollisionException) {
      throw AuthError(GoogleLink.linkRefusal("CREDENTIAL_ALREADY_IN_USE"), error)
    } catch (error: Exception) {
      throw AuthError(GoogleLink.linkRefusal(null), error)
    }
  }

  override suspend fun updateDisplayName(name: String) {
    val user = auth.currentUser ?: return
    user.updateProfile(UserProfileChangeRequest.Builder().setDisplayName(name).build()).await()
    mutable.value = AuthState.SignedIn(AuthUser(user.uid, user.email, name.ifEmpty { null }, user.isEmailVerified, user.photoUrl?.toString()))
  }

  override suspend fun signOut() {
    // Leaving the app from a support session ends it, and then signs the staff member out as well.
    endImpersonation()
    auth.signOut()
    // An SSO account's tenant outlives `signOut`; the next sign-in, of whatever kind, starts on the project pool (AGL-3844).
    auth.returnToProjectPool()
  }
}

/** Why a sign-in after a single sign-on in the same process is refused on Android. */
internal const val TENANT_STUCK_MESSAGE = "To sign in with another account after single sign-on, close the app and open it again."
