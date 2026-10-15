// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// Signing in through the console (AGL-3816): workspace single sign-on runs the workspace's own identity provider
/// on the console's `/sso` page, so the app opens the console's `/auth/native` page in the platform's auth session
/// with a PKCE challenge, the person signs in there exactly as on the web, and the page hands a one-time code back to
/// the app's own URL scheme. The app trades the code and its verifier for a Firebase custom token
/// (`/api/auth/native-handoff/redeem`) in the identity pool the account lives in.
public enum ConsoleHandoff {
  /// Which console page the person starts on.
  public enum Start: String, Sendable {
    case signIn = "signin"
    case signUp = "signup"
    case singleSignOn = "sso"
  }

  /// One sign-in in flight: what the app keeps until the code comes back.
  public struct Pending: Equatable, Sendable {
    public let url: URL
    public let verifier: String
    public let state: String
    public let redirectURI: String
    /// The scheme the auth session listens for (`aglyn`, `aglyn-pos`).
    public let callbackScheme: String
  }

  public struct Grant: Equatable, Sendable {
    public let token: String
    public let tenantID: String?
  }

  /// The app's return address: its own URL scheme.
  public static func redirectURI(app: AglynAppID) -> String {
    app == .pos ? "aglyn-pos://auth/handoff" : "aglyn://auth/handoff"
  }

  /// A fresh PKCE pair and state, and the console page to open.
  public static func begin(origin: String, app: AglynAppID, start: Start, loginHint: String? = nil) -> Pending {
    let (verifier, challenge) = GoogleLink.pkce()
    let state = GoogleLink.base64URL(Data((0..<16).map { _ in UInt8.random(in: 0...255) }))
    let redirect = redirectURI(app: app)
    var parts = URLComponents(string: origin.hasSuffix("/") ? "\(origin)auth/native" : "\(origin)/auth/native")!
    parts.queryItems = [
      URLQueryItem(name: "start", value: start.rawValue),
      URLQueryItem(name: "challenge", value: challenge),
      URLQueryItem(name: "redirect_uri", value: redirect),
      URLQueryItem(name: "state", value: state),
    ] + (loginHint.map { [URLQueryItem(name: "login_hint", value: $0)] } ?? [])
    return Pending(
      url: parts.url!, verifier: verifier, state: state, redirectURI: redirect,
      callbackScheme: String(redirect.prefix { $0 != ":" }))
  }

  /// The code the console handed back, refused when the state is not this sign-in's.
  public static func code(from callback: URL, pending: Pending) throws -> String {
    let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
    func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
    guard value("state") == pending.state, let code = value("code"), !code.isEmpty else {
      throw ConsoleAPIError(status: 0, message: "The sign-in did not come back as expected. Try again.")
    }
    return code
  }

  /// Trades the code and verifier for a custom token.
  public static func redeem(api: ConsoleAPIClient, code: String, pending: Pending) async throws -> Grant {
    let answer = try await api.request(
      "/api/auth/native-handoff/redeem", method: .post,
      body: .object([
        "code": .string(code), "verifier": .string(pending.verifier), "redirectUri": .string(pending.redirectURI),
      ]),
      anonymous: true)
    guard let token = answer?["token"]?.stringValue, !token.isEmpty else {
      throw ConsoleAPIError(status: 0, message: "The sign-in did not come back as expected. Try again.")
    }
    return Grant(token: token, tenantID: answer?["tenantId"]?.stringValue)
  }
}
