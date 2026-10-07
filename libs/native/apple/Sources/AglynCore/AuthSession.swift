// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import FirebaseAuth
import Foundation
import Observation

/// The signed-in person, as the app needs them.
public struct AglynUser: Equatable, Sendable {
  public let uid: String
  public let email: String?
  public let displayName: String?

  public init(uid: String, email: String?, displayName: String?) {
    self.uid = uid
    self.email = email
    self.displayName = displayName
  }
}

/// The words a failed sign-in shows, by Firebase Auth error code.
public func signInErrorMessage(_ error: Error) -> String {
  let code = AuthErrorCode(rawValue: (error as NSError).code)
  let brand = AglynBrand.name
  switch code {
  case .invalidCredential, .wrongPassword, .userNotFound, .invalidEmail:
    return "That email and password do not match an \(brand) account."
  case .tooManyRequests:
    return "Too many attempts. Wait a few minutes, then try again."
  case .userDisabled:
    return "This account is turned off. Contact your workspace owner."
  case .networkError:
    return "\(brand) could not be reached. Check the connection and try again."
  case .secondFactorRequired:
    return
      "This account uses two-step verification. Sign in on the web console to finish setting up this device."
  default:
    return "Sign-in did not work. Try again."
  }
}

/// Firebase Auth, observed: who is signed in, and the ID token the console
/// API and the WebView session are minted from. The SDK keeps the user in
/// the Keychain, so a relaunch restores them without a prompt.
@MainActor
@Observable
public final class AuthSession {
  public private(set) var user: AglynUser?
  /// False until Firebase has said whether someone is signed in.
  public private(set) var ready = false

  @ObservationIgnored private var handle: AuthStateDidChangeListenerHandle?
  @ObservationIgnored private var beforeSignOut: [@MainActor () async -> Void] = []

  public init() {
    handle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
      MainActor.assumeIsolated {
        self?.user = user.map {
          AglynUser(uid: $0.uid, email: $0.email, displayName: $0.displayName)
        }
        self?.ready = true
      }
    }
  }

  public func signIn(email: String, password: String) async throws {
    _ = try await Auth.auth().signIn(
      withEmail: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
  }

  public func resetPassword(email: String) async throws {
    try await Auth.auth().sendPasswordReset(
      withEmail: email.trimmingCharacters(in: .whitespacesAndNewlines))
  }

  /// Work that must finish while the person is still signed in (dropping the
  /// device's push row, ending the WebView's console session).
  public func onBeforeSignOut(_ task: @escaping @MainActor () async -> Void) {
    beforeSignOut.append(task)
  }

  public func signOut() async {
    for task in beforeSignOut { await task() }
    try? Auth.auth().signOut()
  }

  /// The current ID token; nil when signed out.
  public nonisolated static func idToken(forceRefresh: Bool) async throws -> String? {
    guard let current = Auth.auth().currentUser else { return nil }
    return try await current.getIDTokenResult(forcingRefresh: forceRefresh).token
  }
}
