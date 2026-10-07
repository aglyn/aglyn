package com.aglyn.core

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.tasks.await

/** [AuthSession] on the Firebase Android SDK; the SDK persists the session. */
class FirebaseAuthSession(private val auth: FirebaseAuth) : AuthSession {
  private val mutable = MutableStateFlow<AuthState>(AuthState.Restoring)
  override val state: StateFlow<AuthState> = mutable

  init {
    auth.addAuthStateListener { current ->
      val user = current.currentUser
      mutable.value = if (user == null) {
        AuthState.SignedOut
      } else {
        AuthState.SignedIn(AuthUser(user.uid, user.email, user.displayName))
      }
    }
  }

  override suspend fun idToken(forceRefresh: Boolean): String? =
    auth.currentUser?.getIdToken(forceRefresh)?.await()?.token

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
    auth.signOut()
  }
}
