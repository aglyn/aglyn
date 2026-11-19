package com.aglyn.core

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** A store build takes no payment to Aglyn and says so in one line (the owner's decision of 2026-11-19). */
class StoreBillingTest {
  private fun config(value: String?) =
    AglynConfig.read(AglynEnv(consoleUrl = "https://app.example.com", inAppBilling = value), AglynAppId.AGLYN)

  @AfterTest
  fun reset() = StoreBilling.reset()

  @Test
  fun buyingIsOnOnlyWhenTheBuildSaysSo() {
    assertTrue(config("on").inAppBilling)
    assertTrue(config("YES").inAppBilling)
    assertFalse(config("off").inAppBilling)
    // Unset, empty or a typo: off, so a missing field never turns buying on.
    assertFalse(config(null).inAppBilling)
    assertFalse(config("").inAppBilling)
    assertFalse(config("onn").inAppBilling)
  }

  @Test
  fun theStoreBuildOverrideOnlyTurnsBuyingOff() {
    assertTrue(StoreBilling.decide(configured = true, storeBuildOverride = false))
    assertFalse(StoreBilling.decide(configured = true, storeBuildOverride = true))
    assertFalse(StoreBilling.decide(configured = false, storeBuildOverride = false))
    assertFalse(StoreBilling.decide(configured = false, storeBuildOverride = true))
  }

  @Test
  fun configureFollowsTheBuildAndTheOverrideOnlyInADebugBuild() {
    assertFalse(StoreBilling.buying)
    StoreBilling.configure(config("on"))
    assertTrue(StoreBilling.buying)
    // A release build never applies the override.
    StoreBilling.overrideForDebug(storeBuild = true, debuggable = false)
    assertTrue(StoreBilling.buying)
    StoreBilling.overrideForDebug(storeBuild = true, debuggable = true)
    assertFalse(StoreBilling.buying)
    StoreBilling.overrideForDebug(storeBuild = false, debuggable = true)
    assertTrue(StoreBilling.buying)
    // A build with buying off stays off whatever the override says.
    StoreBilling.configure(config("off"))
    StoreBilling.overrideForDebug(storeBuild = false, debuggable = true)
    assertFalse(StoreBilling.buying)
  }

  @Test
  fun playGetsNoWebBillingLinkYet() {
    assertFalse(StoreBilling.WEB_BILLING_LINK_ALLOWED)
    assertFalse(StoreBilling.webBillingLink)
  }

  @Test
  fun theLinkOpensTheWorkspaceBillingPageThroughSignIn() {
    assertEquals("https://app.aglyn.com/signin?continue=/acme-inc/billing", StoreBilling.webBillingUrl("https://app.aglyn.com", "acme-inc"))
    assertEquals("http://10.0.2.2:4610/signin?continue=/acme/billing", StoreBilling.webBillingUrl("http://10.0.2.2:4610/", "acme"))
    assertNull(StoreBilling.webBillingUrl("https://app.aglyn.com", ""))
    assertNull(StoreBilling.webBillingUrl("https://app.aglyn.com", "a/../b"))
  }

  @Test
  fun bothLinesComeFromTheContracts() {
    assertEquals("Manage billing on the web", StoreBilling.webBillingLinkLabel)
    assertEquals("Plan and billing changes are not available in the app.", StoreBilling.noBillingNote)
    // The no-link sentence names no address and no other place to buy.
    for (word in listOf("web", "http", "aglyn.com", "$", "browser", "site")) {
      assertFalse(word in StoreBilling.noBillingNote.lowercase(), word)
    }
  }
}
