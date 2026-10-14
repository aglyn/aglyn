// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import CryptoKit
import Foundation

public struct GoogleLinkError: Error, Equatable, LocalizedError {
  public let message: String
  public var errorDescription: String? { message }
}

/// Connecting Google to the signed-in account without a web view of ours (Google refuses embedded
/// sign-in): the person signs in on the platform's auth sheet with the app's own OAuth client
/// (authorization code with PKCE, returning to its reversed-client-id scheme), the code is traded
/// for Google's ID token, and Identity Toolkit's `accounts:signInWithIdp` links that credential to
/// the account, which is the call the web SDK's `linkWithPopup` ends in.
public enum GoogleLink {
  static let authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth"
  static let tokenEndpoint = "https://oauth2.googleapis.com/token"

  /// `com.googleusercontent.apps.<id>`, the scheme Google returns an iOS client to.
  public static func redirectScheme(iosClientID: String) -> String {
    let suffix = ".apps.googleusercontent.com"
    let base = iosClientID.hasSuffix(suffix) ? String(iosClientID.dropLast(suffix.count)) : iosClientID
    return "com.googleusercontent.apps.\(base)"
  }

  static func redirectURI(iosClientID: String) -> String { "\(redirectScheme(iosClientID: iosClientID)):/oauth2redirect" }

  /// A random verifier and its S256 challenge.
  public static func pkce() -> (verifier: String, challenge: String) {
    var bytes = [UInt8](repeating: 0, count: 32)
    for index in bytes.indices { bytes[index] = UInt8.random(in: 0...255) }
    let verifier = base64URL(Data(bytes))
    return (verifier, challenge(for: verifier))
  }

  public static func challenge(for verifier: String) -> String {
    base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
  }

  static func base64URL(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  public static func authorizationURL(iosClientID: String, challenge: String, state: String, loginHint: String? = nil) -> URL {
    var parts = URLComponents(string: authorizationEndpoint)!
    var items = [
      URLQueryItem(name: "client_id", value: iosClientID),
      URLQueryItem(name: "redirect_uri", value: redirectURI(iosClientID: iosClientID)),
      URLQueryItem(name: "response_type", value: "code"),
      URLQueryItem(name: "scope", value: "openid email profile"),
      URLQueryItem(name: "code_challenge", value: challenge),
      URLQueryItem(name: "code_challenge_method", value: "S256"),
      URLQueryItem(name: "state", value: state),
      URLQueryItem(name: "prompt", value: "select_account"),
    ]
    if let loginHint { items.append(URLQueryItem(name: "login_hint", value: loginHint)) }
    parts.queryItems = items
    return parts.url!
  }

  /// The code Google returned to the app's scheme, refused when the state is not ours or Google said no.
  public static func authorizationCode(from redirect: URL, state: String) throws -> String {
    let items = URLComponents(url: redirect, resolvingAgainstBaseURL: false)?.queryItems ?? []
    func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
    if let error = value("error") {
      throw GoogleLinkError(message: error == "access_denied" ? "Google sign-in was canceled." : "Google refused the sign-in (\(error)).")
    }
    guard value("state") == state, let code = value("code"), !code.isEmpty else {
      throw GoogleLinkError(message: "The Google sign-in did not come back as expected. Try again.")
    }
    return code
  }

  static func tokenBody(iosClientID: String, code: String, verifier: String) -> String {
    [
      ("client_id", iosClientID), ("code", code), ("code_verifier", verifier),
      ("grant_type", "authorization_code"), ("redirect_uri", redirectURI(iosClientID: iosClientID)),
    ].map { "\($0.0)=\(ConsoleAPIClient.encodeComponent($0.1))" }.joined(separator: "&")
  }

  /// What `accounts:signInWithIdp` is sent to attach Google's credential to the signed-in account.
  static func linkBody(firebaseIDToken: String, googleIDToken: String) -> [String: JSONValue] {
    [
      "idToken": .string(firebaseIDToken),
      "postBody": .string("id_token=\(ConsoleAPIClient.encodeComponent(googleIDToken))&providerId=google.com"),
      "requestUri": "http://localhost",
      "returnSecureToken": true,
      "returnIdpCredential": true,
    ]
  }

  /// The whole link: sheet, code, token, Identity Toolkit. `authenticate` opens the URL in the platform's
  /// auth sheet and returns the URL it came back to; `firebaseIDToken` is the account's current token.
  public static func link(
    iosClientID: String, apiKey: String, emulatorHost: String?, loginHint: String?, transport: HTTPTransport,
    firebaseIDToken: @Sendable () async throws -> String?,
    authenticate: @Sendable (_ url: URL, _ callbackScheme: String) async throws -> URL
  ) async throws {
    let (verifier, challenge) = pkce()
    let state = base64URL(Data((0..<16).map { _ in UInt8.random(in: 0...255) }))
    let url = authorizationURL(iosClientID: iosClientID, challenge: challenge, state: state, loginHint: loginHint)
    let redirect = try await authenticate(url, redirectScheme(iosClientID: iosClientID))
    let code = try authorizationCode(from: redirect, state: state)

    var token = URLRequest(url: URL(string: tokenEndpoint)!)
    token.httpMethod = "POST"
    token.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    token.httpBody = Data(tokenBody(iosClientID: iosClientID, code: code, verifier: verifier).utf8)
    let (tokenData, tokenResponse) = try await transport.send(token)
    guard (200..<300).contains(tokenResponse.statusCode), case .object(let granted)? = JSONValue.decode(tokenData),
      let googleIDToken = granted["id_token"]?.stringValue
    else { throw GoogleLinkError(message: "Google did not hand back a sign-in. Try again.") }

    guard let firebaseToken = try await firebaseIDToken() else { throw GoogleLinkError(message: "Sign in again, then connect Google.") }
    let base = emulatorHost.map { "http://\($0)/identitytoolkit.googleapis.com" } ?? "https://identitytoolkit.googleapis.com"
    var link = URLRequest(url: URL(string: "\(base)/v1/accounts:signInWithIdp?key=\(apiKey)")!)
    link.httpMethod = "POST"
    link.setValue("application/json", forHTTPHeaderField: "Content-Type")
    link.httpBody = try JSONValue.object(linkBody(firebaseIDToken: firebaseToken, googleIDToken: googleIDToken)).encoded()
    let (linkData, linkResponse) = try await transport.send(link)
    guard (200..<300).contains(linkResponse.statusCode) else {
      let code = JSONValue.decode(linkData)?["error"]?["message"]?.stringValue ?? ""
      throw GoogleLinkError(message: Self.linkRefusal(code))
    }
  }

  static func linkRefusal(_ code: String) -> String {
    switch code.split(separator: " ").first.map(String.init) ?? "" {
    case "FEDERATED_USER_ID_ALREADY_LINKED", "EMAIL_EXISTS", "CREDENTIAL_ALREADY_IN_USE":
      return "That Google account is already linked to an Aglyn account."
    default:
      return "Connecting Google failed."
    }
  }
}
