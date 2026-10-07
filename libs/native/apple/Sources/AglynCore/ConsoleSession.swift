// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// A console session for the WebView.
///
/// The console signs a browser in with the shared `__session` cookie that
/// `/api/auth/session` mints from an ID token, and restores its user from
/// that cookie on a page load with no persisted user. So a signed-in app
/// needs no new auth path for its WebView: it POSTs its ID token to the SAME
/// route the console's own sign-in calls, and copies the `HttpOnly` cookie
/// into the WebView's cookie store. Every gate that route applies to a
/// browser (email verification, revocation, lockdown, SSO pools) applies to
/// the app unchanged. Signing out reverses it with the route's own DELETE.
public enum ConsoleSession {
  public enum Result: Equatable, Sendable {
    case ok(cookies: [HTTPCookieSnapshot])
    case failed(status: Int, error: String)
  }

  /// The parts of a cookie the WebView store needs, `Sendable` across tasks.
  public struct HTTPCookieSnapshot: Equatable, Sendable {
    public let properties: [String: String]
    public init(_ cookie: HTTPCookie) {
      var props: [String: String] = [:]
      for (key, value) in cookie.properties ?? [:] { props[key.rawValue] = "\(value)" }
      properties = props
    }
    public var cookie: HTTPCookie? {
      HTTPCookie(
        properties: Dictionary(uniqueKeysWithValues: properties.map { (HTTPCookiePropertyKey($0.key), $0.value as Any) }))
    }
  }

  public static func mint(origin: String, idToken: String, transport: HTTPTransport = URLSession.shared)
    async -> Result
  {
    guard let url = URL(string: "\(trim(origin))/api/auth/session") else {
      return .failed(status: 0, error: "The console session could not be started.")
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    do {
      let (data, response) = try await transport.send(request)
      if (200..<300).contains(response.statusCode) {
        let headers = response.allHeaderFields.reduce(into: [String: String]()) {
          $0["\($1.key)"] = "\($1.value)"
        }
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: headers, for: url)
        return .ok(cookies: cookies.map(HTTPCookieSnapshot.init))
      }
      let error = JSONValue.decode(data)?["error"]?.stringValue
      return .failed(
        status: response.statusCode,
        error: error
          ?? (response.statusCode == 403
            ? "Verify your email address, then sign in again."
            : "The console session could not be started."))
    } catch {
      return .failed(status: 0, error: "\(AglynBrand.name) could not be reached. Check the connection.")
    }
  }

  public static func end(origin: String, transport: HTTPTransport = URLSession.shared) async {
    guard let url = URL(string: "\(trim(origin))/api/auth/session") else { return }
    var request = URLRequest(url: url)
    request.httpMethod = "DELETE"
    _ = try? await transport.send(request)
  }

  private static func trim(_ origin: String) -> String {
    var value = origin
    while value.hasSuffix("/") { value.removeLast() }
    return value
  }
}
