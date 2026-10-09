// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import FirebaseAuth
import Foundation
import Observation
import Security

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

/// How the app signs in: the Firebase SDK, or the Identity Toolkit REST API
/// for a Mac build without a team signature (see `IdentityToolkitAuth`).
public enum AuthTransport: String, Sendable {
  case sdk
  case rest

  /// `rest` on a Mac whose code signature carries no team identifier (an
  /// ad-hoc or unsigned build), `sdk` everywhere else. A debug override
  /// (`-AglynAuthTransport rest|sdk`) wins.
  public static func resolve(override: String? = UserDefaults.standard.string(forKey: "AglynAuthTransport"))
    -> AuthTransport
  {
    if let override, let forced = AuthTransport(rawValue: override) { return forced }
    #if os(macOS)
      return CodeSignature.currentTeamIdentifier() == nil ? .rest : .sdk
    #else
      return .sdk
    #endif
  }
}

#if os(macOS)
  enum CodeSignature {
    /// The team that signed this process, or nil for an ad-hoc or unsigned build.
    static func currentTeamIdentifier() -> String? {
      var code: SecCode?
      guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return nil }
      var staticCode: SecStaticCode?
      guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
      var info: CFDictionary?
      guard
        SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info)
          == errSecSuccess,
        let values = info as? [String: Any]
      else { return nil }
      let team = values[kSecCodeInfoTeamIdentifier as String] as? String
      return team?.isEmpty == false ? team : nil
    }
  }
#endif

/// The words a failed sign-in shows, by Firebase Auth error code.
public func signInErrorMessage(_ error: Error) -> String {
  let brand = AglynBrand.name
  if let rest = error as? IdentityToolkitError {
    switch rest.code {
    case "INVALID_LOGIN_CREDENTIALS", "INVALID_PASSWORD", "EMAIL_NOT_FOUND", "INVALID_EMAIL":
      return "That email and password do not match an \(brand) account."
    case "TOO_MANY_ATTEMPTS_TRY_LATER":
      return "Too many attempts. Wait a few minutes, then try again."
    case "USER_DISABLED":
      return "This account is turned off. Contact your workspace owner."
    case nil where rest.status == 0:
      return "\(brand) could not be reached. Check the connection and try again."
    default:
      return "Sign-in did not work. Try again."
    }
  }
  let code = AuthErrorCode(rawValue: (error as NSError).code)
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

/// The words a failed password change shows.
public func passwordChangeMessage(_ error: Error) -> String {
  if let rest = error as? IdentityToolkitError, rest.code?.hasPrefix("WEAK_PASSWORD") == true {
    return "That password is too weak. Use a longer one."
  }
  if let code = AuthErrorCode(rawValue: (error as NSError).code), code == .weakPassword {
    return "That password is too weak. Use a longer one."
  }
  let message = signInErrorMessage(error)
  return message.hasPrefix("That email and password") ? "Your current password is not right." : message
}

/// The signed-in person, observed: who is signed in, and the ID token the
/// console API and the WebView session are minted from. With the SDK the
/// user is kept in the Keychain by Firebase; with REST the refresh token is
/// kept by `KeychainCredentialStore`. Either way a relaunch restores them
/// without a prompt.
@MainActor
@Observable
public final class AuthSession {
  public private(set) var user: AglynUser?
  /// False until it is known whether someone is signed in.
  public private(set) var ready = false
  public let transport: AuthTransport

  @ObservationIgnored private let rest: IdentityToolkitAuth?
  @ObservationIgnored private var handle: AuthStateDidChangeListenerHandle?
  @ObservationIgnored private var beforeSignOut: [@MainActor () async -> Void] = []

  /// `rest` is the REST client to sign in with; nil signs in with the Firebase SDK.
  public init(rest: IdentityToolkitAuth? = nil) {
    self.rest = rest
    transport = rest == nil ? .sdk : .rest
    if let rest {
      Task { @MainActor in
        self.user = await rest.restore()
        self.ready = true
      }
      return
    }
    handle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
      MainActor.assumeIsolated {
        self?.user = user.map {
          AglynUser(uid: $0.uid, email: $0.email, displayName: $0.displayName)
        }
        self?.ready = true
      }
    }
  }

  /// The session for a config: REST when `transport` says so, else the SDK.
  public static func make(_ config: AglynConfig, transport: AuthTransport = .resolve()) -> AuthSession {
    guard transport == .rest else { return AuthSession() }
    return AuthSession(
      rest: IdentityToolkitAuth(
        apiKey: config.firebase.apiKey,
        emulatorHost: config.authEmulatorHost,
        store: KeychainCredentialStore(
          service: "\(Bundle.main.bundleIdentifier ?? "com.aglyn.app").rest-auth",
          account: config.firebase.projectID)))
  }

  public func signIn(email: String, password: String) async throws {
    let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
    if let rest {
      user = try await rest.signIn(email: trimmed, password: password)
      return
    }
    _ = try await Auth.auth().signIn(withEmail: trimmed, password: password)
  }

  /// Changes the password, after proving the current one.
  public func changePassword(current: String, new: String) async throws {
    guard let email = user?.email else { throw IdentityToolkitError(code: "INVALID_LOGIN_CREDENTIALS", status: 401) }
    if let rest {
      user = try await rest.changePassword(email: email, current: current, new: new)
      return
    }
    guard let signedIn = Auth.auth().currentUser else { throw IdentityToolkitError(code: nil, status: 401) }
    try await signedIn.reauthenticate(with: EmailAuthProvider.credential(withEmail: email, password: current))
    try await signedIn.updatePassword(to: new)
  }

  /// Keeps the account's display name in step with the profile (rosters and comments read it).
  public func updateDisplayName(_ name: String) async throws {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    if let rest {
      user = try await rest.updateDisplayName(trimmed)
      return
    }
    guard let signedIn = Auth.auth().currentUser else { return }
    let change = signedIn.createProfileChangeRequest()
    change.displayName = trimmed
    try await change.commitChanges()
    user = AglynUser(uid: signedIn.uid, email: signedIn.email, displayName: trimmed.isEmpty ? nil : trimmed)
  }

  public func resetPassword(email: String) async throws {
    let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
    if let rest {
      try await rest.sendPasswordReset(email: trimmed)
      return
    }
    try await Auth.auth().sendPasswordReset(withEmail: trimmed)
  }

  /// Work that must finish while the person is still signed in (dropping the
  /// device's push row, ending the WebView's console session).
  public func onBeforeSignOut(_ task: @escaping @MainActor () async -> Void) {
    beforeSignOut.append(task)
  }

  public func signOut() async {
    for task in beforeSignOut { await task() }
    if let rest {
      await rest.signOut()
      user = nil
      return
    }
    try? Auth.auth().signOut()
  }

  /// The current ID token; nil when signed out.
  public nonisolated func idToken(forceRefresh: Bool) async throws -> String? {
    if let rest {
      let token = try await rest.idToken(forceRefresh: forceRefresh)
      if token == nil { await MainActor.run { self.user = nil } }
      return token
    }
    guard let current = Auth.auth().currentUser else { return nil }
    return try await current.getIDTokenResult(forcingRefresh: forceRefresh).token
  }
}
