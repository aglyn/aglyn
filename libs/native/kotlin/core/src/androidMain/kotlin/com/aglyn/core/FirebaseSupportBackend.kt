package com.aglyn.core

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await

/**
 * A support session on the Firebase Android SDK, in a Firebase app of its own: its own sign-in (the custom token, exchanged in the
 * identity pool it was minted in) and its own Firestore, so the staff member's sign-in and listeners are untouched while it is on.
 *
 * The SDK keeps a signed-in user on disk, and a support session must not outlive the app: [prefs] remembers that one is on, so the
 * next launch signs it out before anything reads it.
 */
class FirebaseSupportBackend(
  private val context: Context,
  private val base: AndroidFirebase,
  private val prefs: KeyValueStore,
) : SupportBackend {
  private var supportAuth: FirebaseAuth? = null
  private var supportFirestore: FirebaseFirestore? = null

  init {
    // A support session the last run did not end (the app was killed): sign it out now.
    if (prefs.get(ON_KEY) == "1") {
      runCatching { auth().signOut() }
      prefs.set(ON_KEY, null)
    }
  }

  private fun app(): FirebaseApp =
    FirebaseApp.getApps(context).firstOrNull { it.name == NAME } ?: FirebaseApp.initializeApp(context, base.app.options, NAME)

  private fun auth(): FirebaseAuth = supportAuth ?: FirebaseAuth.getInstance(app()).also { auth ->
    base.config.authEmulatorHost?.let { hostPort ->
      val (host, port) = hostPort.split(':')
      auth.useEmulator(host, port.toInt())
    }
    supportAuth = auth
  }

  /** The support session's own Firestore, signed in as the customer. */
  fun firestore(): FirebaseFirestore = supportFirestore ?: FirebaseFirestore.getInstance(app()).also { db ->
    base.config.firestoreEmulatorHost?.let { hostPort ->
      val (host, port) = hostPort.split(':')
      db.useEmulator(host, port.toInt())
    }
    supportFirestore = db
  }

  override suspend fun signIn(customToken: String, tenantId: String?): AuthUser {
    val auth = auth()
    auth.signOut()
    // Assigned unconditionally: a null tenant is the project's own pool, not "no opinion".
    auth.tenantId = tenantId?.ifEmpty { null }
    prefs.set(ON_KEY, "1")
    try {
      val user = auth.signInWithCustomToken(customToken).await().user ?: throw AuthError(supportErrorMessage(null))
      return AuthUser(user.uid, user.email, user.displayName)
    } catch (error: AuthError) {
      prefs.set(ON_KEY, null)
      throw error
    } catch (error: FirebaseAuthException) {
      prefs.set(ON_KEY, null)
      throw AuthError(supportErrorMessage(error.errorCode), error)
    } catch (error: Exception) {
      prefs.set(ON_KEY, null)
      throw AuthError(supportErrorMessage(null), error)
    }
  }

  override suspend fun idToken(forceRefresh: Boolean): String? =
    supportAuth?.currentUser?.getIdToken(forceRefresh)?.await()?.token

  override suspend fun signOut() {
    supportAuth?.signOut()
    prefs.set(ON_KEY, null)
  }

  private companion object {
    const val NAME = "support"
    const val ON_KEY = "supportSessionOn"
  }
}
