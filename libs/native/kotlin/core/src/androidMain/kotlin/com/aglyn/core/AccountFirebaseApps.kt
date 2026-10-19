package com.aglyn.core

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore

/**
 * One Firebase app per signed-in account (Add account): each keeps its own sign-in, persisted by the SDK under its own
 * app name, and its own Firestore, so one account's session and cache never serve another's screens. The build's
 * original account is the default app ([AccountSessions.PRIMARY]).
 */
class AccountFirebaseApps(private val context: Context, private val base: AndroidFirebase) {
  private class Account(val auth: FirebaseAuth, val firestore: FirebaseFirestore)

  private val accounts = mutableMapOf<String, Account>()

  private fun account(slot: String): Account = synchronized(this) {
    accounts.getOrPut(slot) {
      if (slot == AccountSessions.PRIMARY) return@getOrPut Account(base.auth, base.firestore)
      val name = "$APP_PREFIX$slot"
      val app = FirebaseApp.getApps(context).firstOrNull { it.name == name }
        ?: FirebaseApp.initializeApp(context, base.app.options, name).also { AndroidFirebase.installAppCheck(it, base.config) }
      val auth = FirebaseAuth.getInstance(app)
      base.config.authEmulatorHost?.let { hostPort ->
        val (host, port) = hostPort.split(':')
        auth.useEmulator(host, port.toInt())
      }
      val firestore = FirebaseFirestore.getInstance(app)
      base.config.firestoreEmulatorHost?.let { hostPort ->
        val (host, port) = hostPort.split(':')
        firestore.useEmulator(host, port.toInt())
      }
      Account(auth, firestore)
    }
  }

  fun auth(slot: String): FirebaseAuth = account(slot).auth
  fun firestore(slot: String): FirebaseFirestore = account(slot).firestore

  companion object {
    const val APP_PREFIX = "aglyn-account-"
  }
}
