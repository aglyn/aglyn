package com.aglyn.screens

/** A way the account in use can confirm it is them again before a guarded step (Close account's `reauth-required`). */
enum class ReconfirmMethod { PASSWORD, APPLE, GOOGLE, SINGLE_SIGN_ON, PASSKEY }

/**
 * Which ways "Confirm it is you" offers, the console's close-account card's rule (AGL-1140): the password when the account
 * has one, else the account's own provider signs in again (read off its `providerData`, never assumed to be Google: an SSO
 * account's only provider is `saml.<id>` or `oidc.<id>`). Only the ways this build can run are offered; when none of the
 * account's own is, a passkey sign-in (project pool only) is offered instead, since any fresh sign-in of the same account
 * satisfies the route. An empty answer means the dialog says to sign out and in again. Twin of the Apple `Reconfirm`.
 */
object Reconfirm {
  data class Offers(
    val apple: Boolean = false,
    val google: Boolean = false,
    val singleSignOn: Boolean = false,
    val passkey: Boolean = false,
  )

  fun methods(providers: List<String>, offers: Offers): List<ReconfirmMethod> {
    val federated = providers.any { it.startsWith("saml.") || it.startsWith("oidc.") }
    val own = buildList {
      if ("password" in providers) add(ReconfirmMethod.PASSWORD)
      if (offers.apple && "apple.com" in providers) add(ReconfirmMethod.APPLE)
      if (offers.google && "google.com" in providers) add(ReconfirmMethod.GOOGLE)
      if (offers.singleSignOn && federated) add(ReconfirmMethod.SINGLE_SIGN_ON)
    }
    return if (own.isEmpty() && offers.passkey && !federated) listOf(ReconfirmMethod.PASSKEY) else own
  }

  /** What the dialog says when this app can run none of the account's ways. */
  const val NO_METHOD_MESSAGE =
    "This app cannot ask for this account's sign-in method. Sign out, sign in again, then try this within five minutes."
}
