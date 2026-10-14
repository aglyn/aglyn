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

  override suspend fun signInWithCustomToken(token: String) {
    try {
      auth.signInWithCustomToken(token).await()
    } catch (error: FirebaseAuthException) {
      throw AuthError(authErrorMessage(error.errorCode), error)
    } catch (error: Exception) {
      throw AuthError(authErrorMessage(null), error)
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
      throw AuthError(passwordChangeMessage(null), error)
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
    auth.signOut()
  }
}
