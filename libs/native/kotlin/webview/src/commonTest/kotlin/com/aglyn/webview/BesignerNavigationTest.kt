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
  fun anotherSiteIsExternal() {
    assertEquals(BesignerNavigation.External, besignerNavigation("https://evil.example/acme/hosts/shop/theme", origin))
    assertEquals(BesignerNavigation.External, besignerNavigation("http://app.aglyn.com/acme/hosts/shop/theme", origin))
  }
}
