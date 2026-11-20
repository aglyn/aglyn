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

  /// Close account's route (AGL-1140). Its contract: the client signs the person out on any 2xx, because the account
  /// behind the session no longer exists and every later request would fail in a way that reads like a bug (the
  /// console goes straight to `/signout`).
  public static let closeAccountRoute = "/api/account/close"

  /// Whether a finished action closed the account, so the app signs out.
  public static func signsOut(url: String?) -> Bool { url == closeAccountRoute }

  /// Close account for an account that signs in with Apple (`AppleRevocation`, App Store Review Guideline 5.1.1(v)):
  /// before the close is sent, the app holds a fresh Sign in with Apple authorization to revoke with. One flow per press
  /// of Close my account:
  /// - "Confirm it is you" opens first with the account's own ways. Confirming with Apple is the authorization: its code
  ///   is kept and the person approves once.
  /// - Confirmed another way (a password, Google, a passkey, single sign-on), here or when the route asks for a fresh
  ///   sign-in: the sheet opens once more with Apple alone, only to revoke.
  /// - A sheet closed without Apple, or a build that cannot run Sign in with Apple, closes anyway; the missing revoke is
  ///   recorded (`AppleRevocation.revoke`). Closing is the person's right.
  /// An account without `apple.com` closes exactly as before: no sheet, no revoke.
  public struct AppleRevokeFlow: Sendable, Equatable {
    public enum Next: Sendable, Equatable {
      /// Open "Confirm it is you" with these ways first.
      case ask([ReconfirmMethod])
      /// Send the close; `owed` revokes first with `code` (nil records the missing authorization).
      case close(owed: Bool, code: String?)
    }

    /// The Apple authorization code held for the revoke; it is spent once.
    public private(set) var code: String?
    /// Whether the account was confirmed another way in this flow.
    public private(set) var confirmedAnotherWay = false
    private var askedAll = false
    private var askedApple = false
    private var settled = false

    public init() {}

    /// A Sign in with Apple authorization in this flow (the sheet's Apple button): its code is kept for the revoke.
    public mutating func authorized(code: String) {
      guard !code.isEmpty else { return }
      self.code = code
    }

    /// The account was confirmed with a way other than Apple.
    public mutating func confirmed() {
      if code == nil { confirmedAnotherWay = true }
    }

    /// What happens before the close is sent, for an account holding `providers` and offered `methods` to confirm with.
    public mutating func next(providers: [String], methods: [ReconfirmMethod]) -> Next {
      guard AppleRevocation.owed(providers: providers) else { return .close(owed: false, code: nil) }
      if let held = code {
        code = nil
        settled = true
        return .close(owed: true, code: held)
      }
      if settled { return .close(owed: false, code: nil) }
      if methods.contains(.apple) {
        if confirmedAnotherWay, !askedApple {
          askedApple = true
          return .ask([.apple])
        }
        if !confirmedAnotherWay, !askedAll {
          askedAll = true
          return .ask(methods)
        }
      }
      settled = true
      return .close(owed: true, code: nil)
    }
  }

  /// What the sheet says when this app can run none of the account's ways.
  public static let noMethodMessage =
    "This app cannot ask for this account's sign-in method. Sign out, sign in again, then try this within five minutes."
}
