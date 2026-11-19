package com.aglyn.hardware

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TerminalReaderModeTest {
  private fun session(testMode: Boolean) = CardReaderSession("pst_secret", "tml_1", "Store", testMode)

  @Test
  fun aTestSessionGivesSimulatedReadersAndALiveSessionRealOnes() {
    assertEquals(TerminalReaderMode.SIMULATED, TerminalReaderMode.of(session(testMode = true).testMode))
    assertTrue(TerminalReaderMode.of(true)!!.simulated)
    assertEquals(TerminalReaderMode.LIVE, TerminalReaderMode.of(session(testMode = false).testMode))
    assertFalse(TerminalReaderMode.of(false)!!.simulated)
  }

  @Test
  fun noSessionYetMeansNoReaderSearch() {
    assertNull(TerminalReaderMode.of(null))
  }

  @Test
  fun tapToPayIsOfferedOnACapableDeviceOrInTestMode() {
    assertTrue(TerminalReaderMode.offersTapToPay(deviceCanTapToPay = true, testMode = false))
    assertTrue(TerminalReaderMode.offersTapToPay(deviceCanTapToPay = false, testMode = true))
    assertFalse(TerminalReaderMode.offersTapToPay(deviceCanTapToPay = false, testMode = false))
    assertFalse(TerminalReaderMode.offersTapToPay(deviceCanTapToPay = false, testMode = null))
  }

  @Test
  fun aRememberedSiteKeepsItsModeAndAnOldRecordReadsAsUnknown() {
    val live = RememberedReaderSite.of(session(testMode = false))
    assertEquals(live, RememberedReaderSite.decode(live.encode()))
    assertEquals(true, RememberedReaderSite.decode(RememberedReaderSite.of(session(testMode = true)).encode())?.testMode)
    // Saved before the mode was kept: location and name only.
    assertNull(RememberedReaderSite.decode("tml_1\tStore"))
    assertNull(RememberedReaderSite.decode("tml_1\tStore\tmaybe"))
    assertNull(RememberedReaderSite.decode(null))
  }
}
