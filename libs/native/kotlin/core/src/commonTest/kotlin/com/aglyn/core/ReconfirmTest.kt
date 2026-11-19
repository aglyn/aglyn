package com.aglyn.core

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.runTest
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** Signed in as `u1`; records every sign-in it is asked for. */
private class ReconfirmingAuth(signedIn: Boolean = true) : AuthSession {
  val mutable = MutableStateFlow<AuthState>(if (signedIn) AuthState.SignedIn(AuthUser("u1", "u1@example.test", null)) else AuthState.SignedOut)
  override val state: StateFlow<AuthState> = mutable
  val asked = mutableListOf<String>()
  override suspend fun idToken(forceRefresh: Boolean) = "token"
  override suspend fun signInWithEmail(email: String, password: String) { asked += "password:$email" }
  override suspend fun signInWithGoogle(googleIdToken: String): Boolean { asked += "google"; return false }
  override suspend fun signInWithCustomToken(token: String) { asked += "custom" }
  override suspend fun signOut() = Unit
}

/**
 * "Confirm it is you" before Close account (AGL-1140): the account in use signs in again its own way; a credential for anyone
 * else is refused before it can sign in.
 */
@OptIn(ExperimentalEncodingApi::class)
class ReconfirmTest {
  private fun jwt(payload: String): String {
    fun part(json: String) = Base64.UrlSafe.encode(json.encodeToByteArray()).trimEnd('=')
    return "${part("""{"alg":"none"}""")}.${part(payload)}.sig"
  }

  @Test fun thePasswordSignsTheSameAddressInAgain() = runTest {
    val auth = ReconfirmingAuth()
    auth.reconfirm(ReconfirmCredential.Password("pw"))
    assertEquals(listOf("password:u1@example.test"), auth.asked)
  }

  @Test fun googleAndAPasskeyConfirmOnlyTheAccountInUse() = runTest {
    val auth = ReconfirmingAuth()
    auth.reconfirm(ReconfirmCredential.Google(jwt("""{"email":"U1@example.test"}""")))
    auth.reconfirm(ReconfirmCredential.CustomToken(jwt("""{"uid":"u1"}""")))
    assertEquals(listOf("google", "custom"), auth.asked)
  }

  @Test fun anotherAccountIsRefusedBeforeItSignsIn() = runTest {
    val auth = ReconfirmingAuth()
    val google = assertFailsWith<AuthError> { auth.reconfirm(ReconfirmCredential.Google(jwt("""{"email":"other@example.test"}"""))) }
    assertEquals(RECONFIRM_MISMATCH, google.message)
    assertFailsWith<AuthError> { auth.reconfirm(ReconfirmCredential.CustomToken(jwt("""{"uid":"someone-else"}"""))) }
    assertEquals(emptyList(), auth.asked)
  }

  @Test fun nobodySignedInCannotConfirm() = runTest {
    val auth = ReconfirmingAuth(signedIn = false)
    assertFailsWith<AuthError> { auth.reconfirm(ReconfirmCredential.Password("pw")) }
    assertEquals(emptyList(), auth.asked)
  }
}
