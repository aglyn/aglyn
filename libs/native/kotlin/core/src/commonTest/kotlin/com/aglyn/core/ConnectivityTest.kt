package com.aglyn.core

import kotlin.test.Test
import kotlin.test.assertTrue

/** A platform that cannot tell reads as online, so the Offline indicator (AGL-1056) never shows there. */
class ConnectivityTest {
  @Test
  fun aPlatformThatCannotTellIsOnline() {
    assertTrue(AlwaysOnline.online.value)
    assertTrue(OFFLINE_DETAIL.startsWith("Your device has lost its network connection."))
  }
}
