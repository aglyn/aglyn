package com.aglyn.webview

import kotlin.test.Test
import kotlin.test.assertEquals

class WebDestinationTest {
  @Test
  fun plainWebPagesOpenInTheAppsSheet() {
    assertEquals(WebDestination.IN_APP, webDestination("https://bakery.aglyn.app/"))
    assertEquals(WebDestination.IN_APP, webDestination("https://www.example.com/menu?x=1#top"))
    assertEquals(WebDestination.IN_APP, webDestination("http://10.0.2.2:4360/acme/preview"))
    assertEquals(WebDestination.IN_APP, webDestination("https://tools.usps.com/go/TrackConfirmAction?tLabels=1"))
  }

  @Test
  fun aProvidersSignInOrConnectStepKeepsTheSecureTab() {
    assertEquals(WebDestination.SECURE_TAB, webDestination("https://accounts.google.com/o/oauth2/v2/auth?client_id=x"))
    assertEquals(WebDestination.SECURE_TAB, webDestination("https://connect.stripe.com/setup/s/abc"))
    assertEquals(WebDestination.SECURE_TAB, webDestination("https://billing.stripe.com/p/session/x"))
    assertEquals(WebDestination.SECURE_TAB, webDestination("https://STRIPE.com/"))
    // A host that only ends in a provider's name is not the provider.
    assertEquals(WebDestination.IN_APP, webDestination("https://notstripe.com/"))
  }

  @Test
  fun anythingThatIsNotAWebPageGoesToTheSystem() {
    assertEquals(WebDestination.SYSTEM, webDestination("mailto:hello@example.com"))
    assertEquals(WebDestination.SYSTEM, webDestination("tel:+15125550100"))
    assertEquals(WebDestination.SYSTEM, webDestination("geo:0,0?q=Austin"))
    assertEquals(WebDestination.SYSTEM, webDestination("intent://scan/#Intent;scheme=zxing;end"))
    assertEquals(WebDestination.SYSTEM, webDestination("https://"))
  }

  @Test
  fun theScreenNamesThePagesHost() {
    assertEquals("bakery.aglyn.app", webPageHost("https://bakery.aglyn.app/menu"))
    assertEquals("example.com", webPageHost("https://www.example.com?x=1"))
  }

  @Test
  fun theAddressIsTheHostAndPathWithoutTheScheme() {
    assertEquals("juniper-street.aglyn.app", webPageAddress("https://juniper-street.aglyn.app/"))
    assertEquals("example.com/menu", webPageAddress("https://www.example.com/menu/?x=1#top"))
    assertEquals("10.0.2.2:4380/acme/preview", webPageAddress("http://10.0.2.2:4380/acme/preview"))
    assertEquals("docs.aglyn.com/whats-new", webPageAddress("https://docs.aglyn.com/whats-new"))
    assertEquals("example.com", webPageAddress("https://example.com#top"))
  }

  @Test
  fun theTitleIsThePagesOwnOrItsHostUntilItHasOne() {
    assertEquals("Juniper Street — Menu", webPageTitle("  Juniper Street — Menu \n", "https://juniper-street.aglyn.app/menu"))
    assertEquals("juniper-street.aglyn.app", webPageTitle(null, "https://www.juniper-street.aglyn.app/menu"))
    assertEquals("juniper-street.aglyn.app", webPageTitle("   ", "https://juniper-street.aglyn.app/menu"))
  }
}
