package com.aglyn.plugins.commerce.pos

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SmartReadersTest {
  @Test
  fun aPairingNeedsTheReadersCode() {
    assertNull(checkReaderPairing("sepia-cerulean-aqua", null))
    assertEquals("Enter the code the reader shows on its screen.", checkReaderPairing("ab", null))
    assertEquals("Enter the code the reader shows on its screen.", checkReaderPairing("not a code!", null))
  }

  @Test
  fun aStoreWithNoReaderAddressGivesOne() {
    val address = ReaderAddress("100 Main St", "Austin", "TX", "78701", "us")
    assertNull(checkReaderPairing("sepia-cerulean-aqua", address))
    assertEquals("Enter the street, city and postal code.", checkReaderPairing("sepia-cerulean-aqua", address.copy(city = " ")))
    assertEquals("Enter the two-letter country code, such as US.", checkReaderPairing("sepia-cerulean-aqua", address.copy(country = "USA")))
  }
}
