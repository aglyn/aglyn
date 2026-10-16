package com.aglyn.pluginhost

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class BesignerEntryTest {
  private val editor = "/acme/hosts/shop/screens/s1/versions/v2/besigner"

  @Test
  fun opensTheBesignerThroughTheEntryPage() {
    assertEquals(
      "https://app.aglyn.com/auth/besigner?continue=%2Facme%2Fhosts%2Fshop%2Fscreens%2Fs1%2Fversions%2Fv2%2Fbesigner",
      BesignerEntry.url("https://app.aglyn.com/", editor),
    )
    assertEquals(
      "http://10.0.2.2:4200/auth/besigner?continue=%2Facme%2Fhosts%2Fshop%2Ftheme%3Ftab%3Da%26b%3D1",
      BesignerEntry.url("http://10.0.2.2:4200", "/acme/hosts/shop/theme?tab=a&b=1"),
    )
  }

  @Test
  fun refusesAnEntryForAnythingButABesignerPage() {
    assertNull(BesignerEntry.url("https://app.aglyn.com", "/acme/hosts/shop/redirects"))
    assertNull(BesignerEntry.url("https://app.aglyn.com", "https://evil.example/besigner"))
  }

  @Test
  fun staysOnTheEntryPageAndOtherBesignerPages() {
    assertEquals(BesignerEntry.Exit.Stay, BesignerEntry.exit(editor, "/auth/besigner?continue=%2Fx"))
    assertEquals(BesignerEntry.Exit.Stay, BesignerEntry.exit(editor, "$editor?panel=layers"))
    assertEquals(BesignerEntry.Exit.Stay, BesignerEntry.exit(editor, "/acme/hosts/shop/screens/s1/versions/v3/besigner"))
    assertEquals(BesignerEntry.Exit.Stay, BesignerEntry.exit(editor, "/acme/hosts/shop/screens/s1/versions/v2/preview"))
  }

  @Test
  fun theEditorsBackArrowReturnsToTheApp() {
    assertEquals(BesignerEntry.Exit.Leave, BesignerEntry.exit(editor, "/acme/hosts/shop/screens/s1/versions/v2/view"))
    assertEquals(BesignerEntry.Exit.Stay, BesignerEntry.exit(editor, "/acme/hosts/shop/screens/s9/versions/v2/view"))
  }

  @Test
  fun aConsolePageOpensTheAppsOwnScreen() {
    assertEquals(BesignerEntry.Exit.Open("/acme"), BesignerEntry.exit(editor, "/acme"))
    assertEquals(BesignerEntry.Exit.Open("/acme/hosts/shop/media?tab=org"), BesignerEntry.exit(editor, "/acme/hosts/shop/media?tab=org"))
  }

  @Test
  fun theSignInWallMeansTheSessionEnded() {
    assertEquals(BesignerEntry.Exit.SessionEnded, BesignerEntry.exit(editor, "/signin?continue=%2Facme"))
    assertEquals(BesignerEntry.Exit.SessionEnded, BesignerEntry.exit(editor, "/verify-email"))
    assertEquals(BesignerEntry.Exit.Open("/signup-later"), BesignerEntry.exit(editor, "/signup-later"))
  }
}
