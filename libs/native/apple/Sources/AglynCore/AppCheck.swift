// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// Firebase App Check: a short-lived token proving a request comes from a genuine copy of the app.
/// Production enforces it on Authentication and Firestore, so a request without one is refused
/// (`401 "Firebase App Check token is invalid."`) before any rule runs.
///
/// The Firebase SDK's Auth and Firestore read the token through `FirebaseAppCheck` on their own
/// (`AglynFirebase.configure` installs the provider). The kit's REST clients (Identity Toolkit, Secure
/// Token, Firestore REST, the Google link) take it from this protocol through `AppCheckTransport`.
public protocol AppCheckTokenProvider: Sendable {
  /// The current token, or nil when App Check is off for this build (the emulator stack).
  func token(forceRefresh: Bool) async throws -> String?
}

/// App Check off: the emulator stack does not enforce it, and tests.
public struct NoAppCheck: AppCheckTokenProvider {
  public init() {}
  public func token(forceRefresh: Bool) async throws -> String? { nil }
}

/// How this device proves the app is genuine.
public enum AppCheckAttestation: String, Sendable, Equatable {
  /// Apple's App Attest (`DCAppAttestService`): iPhone and iPad.
  case appAttest
  /// Apple's DeviceCheck (`DCDevice`): where App Attest is not offered, which is every Mac
  /// (`DCAppAttestService.isSupported` is false on macOS).
  case deviceCheck

  /// App Attest where the device offers it, DeviceCheck where it does not, nil when neither does
  /// (the simulator): such a build then sends no token and production refuses its sign-in plainly.
  public static func choose(appAttestSupported: Bool, deviceCheckSupported: Bool) -> AppCheckAttestation? {
    if appAttestSupported { return .appAttest }
    if deviceCheckSupported { return .deviceCheck }
    return nil
  }
}

/// The words a refusal for a missing or rejected App Check token shows.
public let appCheckRefusalMessage = "This copy of the app could not be verified. Update the app or try again."

/// Whether a server answer's text is an App Check refusal (`"Firebase App Check token is invalid."`).
func isAppCheckRefusalText(_ text: String) -> Bool {
  text.range(of: "App Check", options: .caseInsensitive) != nil
}

/// Whether an error is an App Check refusal: the REST clients' own code, or the Firebase SDK's
/// unexpected-response error, which carries the server's message in its user info (or its
/// underlying error's).
public func isAppCheckRefusal(_ error: Error) -> Bool {
  if let rest = error as? IdentityToolkitError { return rest.code == IdentityToolkitError.appCheckRefused }
  var current: NSError? = error as NSError
  var depth = 0
  while let nsError = current, depth < 4 {
    let info = nsError.userInfo.filter { $0.key != NSUnderlyingErrorKey }
    if isAppCheckRefusalText(String(describing: info)) { return true }
    current = nsError.userInfo[NSUnderlyingErrorKey] as? NSError
    depth += 1
  }
  return false
}

/// An `HTTPTransport` that adds the `X-Firebase-AppCheck` header to every request bound for a
/// Firebase API, and passes everything else (the console, Google's OAuth endpoint, signed upload
/// URLs) through untouched. A request the server refuses for its App Check token is sent once more
/// with a freshly minted one.
public struct AppCheckTransport: HTTPTransport {
  public static let header = "X-Firebase-AppCheck"

  /// The Firebase APIs App Check can be enforced on that the kit calls over REST.
  static let firebaseHosts: Set<String> = [
    "identitytoolkit.googleapis.com", "securetoken.googleapis.com", "firestore.googleapis.com",
    "firebasestorage.googleapis.com",
  ]

  public let base: HTTPTransport
  public let appCheck: AppCheckTokenProvider

  public init(base: HTTPTransport = URLSession.shared, appCheck: AppCheckTokenProvider) {
    self.base = base
    self.appCheck = appCheck
  }

  /// Whether a URL is a Firebase API that takes an App Check token (never a local emulator).
  public static func isFirebase(_ url: URL?) -> Bool {
    guard let host = url?.host?.lowercased(), url?.scheme == "https" else { return false }
    return firebaseHosts.contains(host) || host.hasSuffix(".cloudfunctions.net")
  }

  public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    guard Self.isFirebase(request.url) else { return try await base.send(request) }
    let first = try await base.send(await stamped(request, forceRefresh: false))
    guard Self.refusedForAppCheck(first), let retry = await stamped(request, forceRefresh: true, required: true)
    else { return first }
    return try await base.send(retry)
  }

  /// The request with the current token on it; nil (when `required`) if no token could be minted.
  private func stamped(_ request: URLRequest, forceRefresh: Bool, required: Bool) async -> URLRequest? {
    guard let token = (try? await appCheck.token(forceRefresh: forceRefresh)) ?? nil, !token.isEmpty else {
      return required ? nil : request
    }
    var stamped = request
    stamped.setValue(token, forHTTPHeaderField: Self.header)
    return stamped
  }

  private func stamped(_ request: URLRequest, forceRefresh: Bool) async -> URLRequest {
    await stamped(request, forceRefresh: forceRefresh, required: false) ?? request
  }

  static func refusedForAppCheck(_ answer: (Data, HTTPURLResponse)) -> Bool {
    guard answer.1.statusCode == 401 || answer.1.statusCode == 403 else { return false }
    return isAppCheckRefusalText(String(decoding: answer.0, as: UTF8.self))
  }
}
