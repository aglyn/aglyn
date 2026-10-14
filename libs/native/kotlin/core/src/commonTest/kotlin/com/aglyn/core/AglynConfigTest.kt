package com.aglyn.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AglynConfigTest {
  @Test
  fun consoleOriginIsHttpsOutsideALocalStack() {
    assertEquals(AglynConfig.DEFAULT_CONSOLE_ORIGIN, AglynConfig.normalizeConsoleOrigin(null))
    assertEquals("https://app.example.com", AglynConfig.normalizeConsoleOrigin(" https://App.Example.com/ "))
    assertEquals("http://10.0.2.2:4200", AglynConfig.normalizeConsoleOrigin("http://10.0.2.2:4200"))
    assertEquals("http://console.localhost:4200", AglynConfig.normalizeConsoleOrigin("http://console.localhost:4200"))
    assertFailsWith<IllegalArgumentException> { AglynConfig.normalizeConsoleOrigin("http://app.aglyn.com") }
    assertFailsWith<IllegalArgumentException> { AglynConfig.normalizeConsoleOrigin("https://app.aglyn.com/path") }
  }

  @Test
  fun emulatorHostsAreHostAndPortOnly() {
    assertEquals("10.0.2.2:9099", AglynConfig.hostPort("http://10.0.2.2:9099"))
    assertNull(AglynConfig.hostPort("10.0.2.2"))
    assertNull(AglynConfig.hostPort(""))
  }

  @Test
  fun refusesAnEmulatorOnANonLocalConsole() {
    val config = AglynConfig.read(
      AglynEnv(
        consoleUrl = "https://app.aglyn.com",
        firebaseApiKey = "k",
        firebaseAuthDomain = "d",
        firebaseProjectId = "p",
        firebaseAppId = "a",
        authEmulatorHost = "10.0.2.2:9099",
        firestoreEmulatorHost = "10.0.2.2:8082",
      ),
      AglynAppId.AGLYN,
    )
    assertEquals(
      listOf("The Auth emulator is set for a non-local console.", "The Firestore emulator is set for a non-local console."),
      config.problems(),
    )
    val local = config.copy(consoleOrigin = "http://10.0.2.2:4200")
    assertTrue(local.problems().isEmpty())
  }

  @Test
  fun namesWhatIsMissing() {
    val config = AglynConfig.read(AglynEnv(), AglynAppId.POS)
    assertEquals(4, config.problems().size)
    assertEquals("Aglyn", config.brandName)
    assertEquals("aglyn-pos", config.app.wire)
  }

  @Test
  fun passkeysNeedALinkedDomainNotAnAddress() {
    assertNull(AglynConfig.read(AglynEnv(), AglynAppId.AGLYN).passkeyRelyingParty)
    assertEquals("aglyn.com", AglynConfig.read(AglynEnv(passkeyRpId = " Aglyn.com "), AglynAppId.AGLYN).passkeyRelyingParty)
    // An origin, a port, a path or a local host is not a relying party.
    for (wrong in listOf("https://aglyn.com", "aglyn.com:443", "aglyn.com/app", "localhost", "127.0.0.1", "10.0.2.2", "aglyn")) {
      assertNull(AglynConfig.read(AglynEnv(passkeyRpId = wrong), AglynAppId.AGLYN).passkeyRelyingParty, wrong)
    }
  }

  @Test
  fun googleSignInClientsAreReadTrimmedAndAbsentWhenBlank() {
    val none = AglynConfig.read(AglynEnv(googleWebClientId = " ", googleDesktopClientId = ""), AglynAppId.AGLYN)
    assertNull(none.googleWebClientId)
    assertNull(none.googleDesktopClientId)
    val set = AglynConfig.read(
      AglynEnv(googleWebClientId = " web.apps.googleusercontent.com ", googleDesktopClientId = "desk", googleDesktopClientSecret = "shh"),
      AglynAppId.AGLYN,
    )
    assertEquals("web.apps.googleusercontent.com", set.googleWebClientId)
    assertEquals("desk", set.googleDesktopClientId)
    assertEquals("shh", set.googleDesktopClientSecret)
  }
}
