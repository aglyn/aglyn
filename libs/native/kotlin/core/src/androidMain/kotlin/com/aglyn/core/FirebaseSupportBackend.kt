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
 * Each identity pool gets an app of its own, so a pool is set once on an instance and never has to be cleared again.
 *
 * The SDK keeps a signed-in user on disk, and a support session must not outlive the app: [prefs] remembers which app one is on,
 * so the next launch signs it out before anything reads it.
 */
class FirebaseSupportBackend(
  private val context: Context,
  private val base: AndroidFirebase,
  private val prefs: KeyValueStore,
) : SupportBackend {
  /** One identity pool's app: its sign-in and its Firestore. */
  private class Session(val appName: String, val auth: FirebaseAuth, val firestore: FirebaseFirestore)

  private val sessions = mutableMapOf<String, Session>()
  private var current: Session? = null

  init {
    // A support session the last run did not end (the app was killed): sign it out now.
    prefs.get(ON_KEY)?.let { appName ->
      runCatching { FirebaseAuth.getInstance(app(appName)).signOut() }
      prefs.set(ON_KEY, null)
    }
  }

  private fun app(name: String): FirebaseApp =
    FirebaseApp.getApps(context).firstOrNull { it.name == name }
      ?: FirebaseApp.initializeApp(context, base.app.options, name).also { AndroidFirebase.installAppCheck(it, base.config) }

  private fun session(tenantId: String?): Session {
    val pool = tenantId?.takeIf { it.isNotEmpty() }
    val name = if (pool == null) NAME else "$NAME-$pool"
    return sessions.getOrPut(name) {
      val app = app(name)
      val auth = FirebaseAuth.getInstance(app)
      base.config.authEmulatorHost?.let { hostPort ->
        val (host, port) = hostPort.split(':')
        auth.useEmulator(host, port.toInt())
      }
      pool?.let { auth.setTenantId(it) }
      val firestore = FirebaseFirestore.getInstance(app)
      base.config.firestoreEmulatorHost?.let { hostPort ->
        val (host, port) = hostPort.split(':')
        firestore.useEmulator(host, port.toInt())
      }
      Session(name, auth, firestore)
    }
  }

  /** The support session's own Firestore, signed in as the customer. */
  fun firestore(): FirebaseFirestore = checkNotNull(current) { "No support session is on." }.firestore

  override suspend fun signIn(customToken: String, tenantId: String?): AuthUser {
    val session = session(tenantId)
    session.auth.signOut()
    prefs.set(ON_KEY, session.appName)
    try {
      val user = session.auth.signInWithCustomToken(customToken).await().user ?: throw AuthError(supportErrorMessage(null))
      current = session
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
    current?.auth?.currentUser?.getIdToken(forceRefresh)?.await()?.token

  override suspend fun signOut() {
    current?.auth?.signOut()
    current = null
    prefs.set(ON_KEY, null)
  }

  private companion object {
    const val NAME = "support"
    const val ON_KEY = "supportSessionOn"
  }
}
