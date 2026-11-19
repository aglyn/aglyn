package com.aglyn.screens

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Which ways "Confirm it is you" offers (AGL-1140): the console's close-account card's rule, read off the account's own
 * sign-in methods, limited to what the build can run. Twin of the Apple `ReconfirmMethodsTests`.
 */
class ReconfirmMethodsTest {
  private val everything = Reconfirm.Offers(apple = true, google = true, singleSignOn = true, passkey = true)

  @Test fun aPasswordAccountIsAskedForItsPassword() {
    assertEquals(listOf(ReconfirmMethod.PASSWORD), Reconfirm.methods(listOf("password"), everything))
    assertEquals(listOf(ReconfirmMethod.PASSWORD, ReconfirmMethod.GOOGLE), Reconfirm.methods(listOf("password", "google.com"), everything))
  }

  @Test fun anAccountWithNoPasswordSignsInAgainWithItsOwnProvider() {
    assertEquals(listOf(ReconfirmMethod.GOOGLE), Reconfirm.methods(listOf("google.com"), everything))
    assertEquals(listOf(ReconfirmMethod.SINGLE_SIGN_ON), Reconfirm.methods(listOf("saml.acme"), everything))
    assertEquals(listOf(ReconfirmMethod.SINGLE_SIGN_ON), Reconfirm.methods(listOf("oidc.acme"), everything))
  }

  @Test fun aProviderThisBuildCannotRunFallsBackToAPasskeyOutsideSingleSignOn() {
    // Android has no Sign in with Apple: an Apple account confirms with a passkey, else is told to sign in again.
    val android = Reconfirm.Offers(google = true, singleSignOn = true, passkey = true)
    assertEquals(listOf(ReconfirmMethod.PASSKEY), Reconfirm.methods(listOf("apple.com"), android))
    assertEquals(emptyList(), Reconfirm.methods(listOf("apple.com"), Reconfirm.Offers()))
    assertEquals(emptyList(), Reconfirm.methods(listOf("saml.acme"), Reconfirm.Offers(passkey = true)))
    assertEquals(listOf(ReconfirmMethod.GOOGLE), Reconfirm.methods(listOf("google.com"), everything))
  }
}
