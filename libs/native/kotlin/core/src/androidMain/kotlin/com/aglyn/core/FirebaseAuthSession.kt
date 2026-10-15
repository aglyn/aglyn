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
        AuthState.SignedIn(AuthUser(user.uid, user.email, user.displayName))
      }
    }
  }

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
    return auth.currentUser?.getIdToken(forceRefresh)?.await()?.token
  }

  override suspend fun signInWithEmail(email: String, password: String) {
    try {
      auth.signInWithEmailAndPassword(email.trim(), password).await()
    } catch (error: FirebaseAuthException) {
      throw AuthError(authErrorMessage(error.errorCode), error)
    } catch (error: Exception) {
      throw AuthError(authErrorMessage(appCheckRefusalCode(error)), error)
    }
  }

  override suspend fun signInWithCustomToken(token: String) {
    try {
      auth.signInWithCustomToken(token).await()
    } catch (error: FirebaseAuthException) {
      throw AuthError(authErrorMessage(error.errorCode), error)
    } catch (error: Exception) {
      throw AuthError(authErrorMessage(appCheckRefusalCode(error)), error)
    }
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
    mutable.value = AuthState.SignedIn(AuthUser(user.uid, user.email, name.ifEmpty { null }))
  }

  override suspend fun signOut() {
    // Leaving the app from a support session ends it, and then signs the staff member out as well.
    endImpersonation()
    auth.signOut()
  }
}
