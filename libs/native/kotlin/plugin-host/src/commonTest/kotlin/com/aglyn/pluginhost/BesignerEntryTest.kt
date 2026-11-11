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

  // The console's `native-app-web-view` (libs/aglyn app-utils) reads exactly this shape (AGL-3894).
  @Test
  fun theUserAgentMarkerNamesTheAppItsVersionAndPlatform() {
    assertEquals("AglynApp/1.4.0 (android)", BesignerEntry.userAgentMarker("1.4.0", "android"))
    assertEquals("AglynApp/0 (windows)", BesignerEntry.userAgentMarker(null, "windows"))
    assertEquals("AglynApp/1.4beta (android)", BesignerEntry.userAgentMarker("1.4 beta", "android"))
  }

  @Test
  fun theMarkerFollowsTheEnginesOwnUserAgent() {
    val webView = "Mozilla/5.0 (Linux; Android 13; sdk_gphone64_arm64; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/109.0.5414.123 Mobile Safari/537.36"
    assertEquals("$webView AglynApp/0.1.0 (android)", BesignerEntry.userAgent(webView, "0.1.0", "android"))
    assertEquals("AglynApp/0.1.0 (windows)", BesignerEntry.userAgent(null, "0.1.0", "windows"))
    // A view that already carries it is not marked twice.
    assertEquals("$webView AglynApp/0.1.0 (android)", BesignerEntry.userAgent("$webView AglynApp/0.1.0 (android)", "0.2.0", "android"))
  }

  // AGL-4056: every editor's own back control returns to the screen the Besigner was opened from.
  @Test
  fun eachEditorsBackControlReturnsToTheApp() {
    val leave = BesignerEntry.Exit.Leave
    assertEquals(leave, BesignerEntry.exit("/acme/hosts/shop/forms/f1/versions/v3/besigner", "/acme/hosts/shop/forms/f1"))
    assertEquals(leave, BesignerEntry.exit("/acme/hosts/shop/layouts/l1/versions/v1/besigner", "/acme/hosts/shop/layouts"))
    assertEquals(leave, BesignerEntry.exit("/acme/hosts/shop/components/c1/versions/v1/besigner", "/acme/hosts/shop/components?x=1"))
    assertEquals(leave, BesignerEntry.exit("/acme/hosts/shop/templates/t1/besigner", "/acme/hosts/shop/templates"))
    assertEquals(leave, BesignerEntry.exit("/admin/emails/welcome/versions/v1/besigner", "/admin/emails"))
    // The logo's workspace and site homes are not a way back: they open the app's Home.
    assertEquals(BesignerEntry.Exit.Open("/acme/hosts/shop"), BesignerEntry.exit(editor, "/acme/hosts/shop"))
    assertEquals(BesignerEntry.Exit.Open("/acme"), BesignerEntry.exit(editor, "/acme"))
    // Another document's page is not this editor's way back.
    assertEquals(
      BesignerEntry.Exit.Open("/acme/hosts/shop/forms/f2"),
      BesignerEntry.exit("/acme/hosts/shop/forms/f1/versions/v3/besigner", "/acme/hosts/shop/forms/f2"),
    )
  }

  @Test
  fun theBackScriptPressesTheControlTheConsoleNames() {
    assertEquals("aglyn-besigner-back", BesignerEntry.BACK_CONTROL_ID)
    kotlin.test.assertTrue("getElementById('aglyn-besigner-back')" in BesignerEntry.BACK_SCRIPT)
    kotlin.test.assertTrue(".click()" in BesignerEntry.BACK_SCRIPT)
  }

  @Test
  fun backAfterASwitchReturnsToTheCurrentDocumentsPlace() {
    val opened = "/acme/hosts/shop/screens/s1/versions/v2/besigner"
    assertNull(BesignerEntry.returnPath(opened, opened, "/acme/hosts/shop/screens/s1/versions/v2/view"))
    assertNull(BesignerEntry.returnPath(opened, "/acme/hosts/shop/screens/s1/versions/v3/besigner", "/acme/hosts/shop/screens/s1/versions/v3/view"))
    assertEquals(
      "/acme/hosts/shop/screens/s7/versions/v1/view",
      BesignerEntry.returnPath(opened, "/acme/hosts/shop/screens/s7/versions/v1/besigner", "/acme/hosts/shop/screens/s7/versions/v1/view"),
    )
    assertEquals(
      "/acme/hosts/shop/layouts",
      BesignerEntry.returnPath(opened, "/acme/hosts/shop/layouts/l1/versions/v1/besigner?panel=layers", "/acme/hosts/shop/layouts"),
    )
  }
}
