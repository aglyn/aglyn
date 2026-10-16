package com.aglyn.core

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** A token refresh that can never succeed signs the session out; anything else is a failure to retry. */
class DeadSessionTest {
  @Test
  fun aRefreshTokenTheServerNoLongerHonoursEndsTheSession() {
    // What Firebase Auth threw on an emulator whose project did not issue the stored token (the app ended).
    assertTrue(isDeadSessionError(null, "An internal error has occurred. [ INVALID_REFRESH_TOKEN ]"))
    assertTrue(isDeadSessionError("ERROR_USER_TOKEN_EXPIRED", "The user's credential is no longer valid."))
    assertTrue(isDeadSessionError("ERROR_USER_NOT_FOUND", null))
    assertTrue(isDeadSessionError("ERROR_USER_DISABLED", null))
    assertTrue(isDeadSessionError("ERROR_INVALID_USER_TOKEN", null))
  }

  @Test
  fun noConnectionIsNotASignOut() {
    assertFalse(isDeadSessionError(null, "A network error (such as timeout, interrupted connection or unreachable host) has occurred."))
    assertFalse(isDeadSessionError("ERROR_NETWORK_REQUEST_FAILED", null))
    assertFalse(isDeadSessionError(null, null))
  }
}
