package com.aglyn.webview

import kotlin.test.Test
import kotlin.test.assertEquals

class BesignerNavigationTest {
  private val origin = "https://app.aglyn.com"

  @Test
  fun besignerPagesStayInTheView() {
    assertEquals(BesignerNavigation.Stay, besignerNavigation("$origin/acme/hosts/shop/screens/s1/versions/v2/preview", origin))
    assertEquals(BesignerNavigation.Stay, besignerNavigation("$origin/acme/hosts/shop/theme", origin))
  }

  @Test
  fun anyOtherConsolePageLeavesForItsNativeScreen() {
    assertEquals(BesignerNavigation.Native("/acme/hosts/shop/screens"), besignerNavigation("$origin/acme/hosts/shop/screens", origin))
    assertEquals(BesignerNavigation.Native("/acme/hosts/shop/media?x=1"), besignerNavigation("$origin/acme/hosts/shop/media?x=1", origin))
    assertEquals(BesignerNavigation.Native("/"), besignerNavigation(origin, origin))
  }

  @Test
  fun theEntryPageStaysAndTheEditorsBackArrowLeaves() {
    val editor = "/acme/hosts/shop/screens/s1/versions/v2/besigner"
    assertEquals(BesignerNavigation.Stay, besignerNavigation("$origin/auth/besigner?continue=%2Fx", origin, editor))
    assertEquals(BesignerNavigation.Leave, besignerNavigation("$origin/acme/hosts/shop/screens/s1/versions/v2/view", origin, editor))
    assertEquals(BesignerNavigation.SessionEnded, besignerNavigation("$origin/signin?continue=%2F", origin, editor))
  }

  @Test
  fun anotherSiteIsExternalOnlyFromALinkThePersonClicked() {
    assertEquals(BesignerNavigation.External, besignerNavigation("https://evil.example/acme/hosts/shop/theme", origin, userActivated = true))
    assertEquals(BesignerNavigation.External, besignerNavigation("http://app.aglyn.com/acme/hosts/shop/theme", origin, userActivated = true))
  }

  /** The console's once-a-day editor-hint bounce opened the person's browser beside the in-app Besigner (AGL-4002). */
  @Test
  fun aScriptOrRedirectToAnotherSiteIsDroppedNotOpenedInTheBrowser() {
    val bounce = "https://console.aglyn.app/api/edit-hint/set?sig=abc&return=https%3A%2F%2Fapp.aglyn.com%2Fauth%2Fbesigner"
    assertEquals(BesignerNavigation.Ignore, besignerNavigation(bounce, origin, "/acme/hosts/shop/screens/s1/versions/v2/besigner"))
    assertEquals(BesignerNavigation.Ignore, besignerNavigation("https://evil.example/", origin))
    // The console's own pages are decided the same way however they were reached.
    assertEquals(BesignerNavigation.Native("/acme/hosts/shop/screens"), besignerNavigation("$origin/acme/hosts/shop/screens", origin, userActivated = false))
  }
}
