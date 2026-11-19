// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

/// A way the account in use can confirm it is them again before a guarded step (Close account's `reauth-required`).
public enum ReconfirmMethod: String, Sendable, Hashable, CaseIterable {
  case password
  case apple
  case google
  case singleSignOn
  case passkey
}

/// Which ways "Confirm it is you" offers, the console's close-account card's rule (AGL-1140): the password when the
/// account has one, else the account's own provider signs in again (read off its `providerData`, never assumed to be
/// Google: an SSO account's only provider is `saml.<id>` or `oidc.<id>`). The apps also sign in with Apple, so an Apple
/// account confirms with Apple. Only the ways this build can run are offered; when none of the account's own is, a
/// passkey sign-in (project pool only) is offered instead, since any fresh sign-in of the same account satisfies the
/// route. An empty answer means the sheet says to sign out and in again.
public enum Reconfirm {
  public struct Offers: Sendable, Equatable {
    public var apple: Bool
    public var google: Bool
    public var singleSignOn: Bool
    public var passkey: Bool

    public init(apple: Bool = false, google: Bool = false, singleSignOn: Bool = false, passkey: Bool = false) {
      self.apple = apple
      self.google = google
      self.singleSignOn = singleSignOn
      self.passkey = passkey
    }
  }

  public static func methods(providers: [String], offers: Offers) -> [ReconfirmMethod] {
    let federated = providers.contains { $0.hasPrefix("saml.") || $0.hasPrefix("oidc.") }
    var own: [ReconfirmMethod] = []
    if providers.contains("password") { own.append(.password) }
    if offers.apple && providers.contains("apple.com") { own.append(.apple) }
    if offers.google && providers.contains("google.com") { own.append(.google) }
    if offers.singleSignOn && federated { own.append(.singleSignOn) }
    if own.isEmpty && offers.passkey && !federated { own.append(.passkey) }
    return own
  }

  /// The SSO provider to sign in with again: the account's own `saml.` / `oidc.` id.
  public static func singleSignOnProvider(_ providers: [String]) -> String? {
    providers.first { $0.hasPrefix("saml.") } ?? providers.first { $0.hasPrefix("oidc.") }
  }

  /// What the sheet says when this app can run none of the account's ways.
  public static let noMethodMessage =
    "This app cannot ask for this account's sign-in method. Sign out, sign in again, then try this within five minutes."
}
