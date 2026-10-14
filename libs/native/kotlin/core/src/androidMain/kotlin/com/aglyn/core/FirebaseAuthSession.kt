package com.aglyn.core

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
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
      throw AuthError(authErrorMessage(null), error)
    }
  }

  override suspend fun signOut() {
    // Leaving the app from a support session ends it, and then signs the staff member out as well.
    endImpersonation()
    auth.signOut()
  }
}
