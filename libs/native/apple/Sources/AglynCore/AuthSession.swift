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

/// The Keychain service a REST session is kept under: per build, since the
/// REST path is the Mac build without a team signature, whose every rebuild
/// is a new ad-hoc signature that another build's item would prompt for.
func restAuthKeychainService(bundleID: String, buildHash: String?) -> String {
  guard let buildHash, !buildHash.isEmpty else { return "\(bundleID).rest-auth" }
  return "\(bundleID).rest-auth.\(buildHash.prefix(16))"
}

private func restBuildHash() -> String? {
  #if os(macOS)
    return CodeSignature.currentUniqueHash()
  #else
    return nil
  #endif
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

    /// This build's code directory hash in hex, or nil when it cannot be read.
    static func currentUniqueHash() -> String? {
      var code: SecCode?
      guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return nil }
      var staticCode: SecStaticCode?
      guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
      var info: CFDictionary?
      guard
        SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info)
          == errSecSuccess,
        let values = info as? [String: Any], let unique = values[kSecCodeInfoUnique as String] as? Data
      else { return nil }
      return unique.map { String(format: "%02x", $0) }.joined()
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

/// The signed-in person, observed: who is signed in, and the ID token the
/// console API and the WebView session are minted from. With the SDK the
/// user is kept in the Keychain by Firebase; with REST the refresh token is
/// kept by `KeychainCredentialStore`. Either way a relaunch restores them
/// without a prompt.
@MainActor
@Observable
public final class AuthSession {
  public private(set) var user: AglynUser?
  /// The signed-in person's Aglyn staff standing (`staff` and `staffRole`
  /// claims), nil for everyone else. For display only; the routes decide.
  public private(set) var staff: StaffStanding?
  /// False until it is known whether someone is signed in.
  public private(set) var ready = false
  public let transport: AuthTransport

  /// The support session a staff member is in as a customer, nil for an ordinary session. While it is on, `user` is the
  /// customer and every token is theirs; the staff member's own session is set aside untouched.
  public private(set) var impersonation: Impersonation?
  /// Whether a support session is on, for readers that are not on the main actor.
  public let impersonationFlag = ImpersonationFlag()

  @ObservationIgnored private let rest: IdentityToolkitAuth?
  @ObservationIgnored private var handle: AuthStateDidChangeListenerHandle?
  @ObservationIgnored private var beforeSignOut: [@MainActor () async -> Void] = []
  /// How a support session signs in: a REST client that keeps its session in memory, never in the Keychain.
  @ObservationIgnored private let makeImpersonationAuth: (@Sendable () -> IdentityToolkitAuth)?
  @ObservationIgnored private var impersonated: IdentityToolkitAuth?
  /// The staff member's own sign-in, set aside while a support session is on.
  @ObservationIgnored private var staffAside: AglynUser?

  /// `rest` is the REST client to sign in with; nil signs in with the Firebase SDK.
  public init(rest: IdentityToolkitAuth? = nil, impersonationAuth: (@Sendable () -> IdentityToolkitAuth)? = nil) {
    self.rest = rest
    makeImpersonationAuth = impersonationAuth
    transport = rest == nil ? .sdk : .rest
    if let rest {
      Task { @MainActor in
        self.user = await rest.restore()
        self.ready = true
        await self.refreshStanding()
      }
      return
    }
    handle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
      MainActor.assumeIsolated {
        let signedIn = user.map { AglynUser(uid: $0.uid, email: $0.email, displayName: $0.displayName) }
        self?.ready = true
        // While a support session is on, the SDK's user is the staff member's, set aside.
        if self?.impersonation != nil {
          self?.staffAside = signedIn
          return
        }
        self?.user = signedIn
        Task { await self?.refreshStanding() }
      }
    }
  }

  /// The session for a config: REST when `transport` says so, else the SDK.
  public static func make(_ config: AglynConfig, transport: AuthTransport = .resolve()) -> AuthSession {
    // A support session signs in over REST in either case, and keeps nothing: the customer's session is never persisted.
    let impersonationAuth: @Sendable () -> IdentityToolkitAuth = {
      IdentityToolkitAuth(apiKey: config.firebase.apiKey, emulatorHost: config.authEmulatorHost, store: MemoryCredentialStore())
    }
    guard transport == .rest else { return AuthSession(impersonationAuth: impersonationAuth) }
    return AuthSession(
      rest: IdentityToolkitAuth(
        apiKey: config.firebase.apiKey,
        emulatorHost: config.authEmulatorHost,
        store: KeychainCredentialStore(
          service: restAuthKeychainService(
            bundleID: Bundle.main.bundleIdentifier ?? "com.aglyn.app", buildHash: restBuildHash()),
          account: config.firebase.projectID)),
      impersonationAuth: impersonationAuth)
  }

  public func signIn(email: String, password: String) async throws {
    let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
    if let rest {
      user = try await rest.signIn(email: trimmed, password: password)
      await refreshStanding()
      return
    }
    _ = try await Auth.auth().signIn(withEmail: trimmed, password: password)
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

  /// Signs in as a customer with the custom token `/api/admin/impersonate` minted, in the pool it was minted in. The staff
  /// member's own session is set aside untouched; the customer's lives in memory only. Throws when the token is refused.
  public func beginImpersonation(token: String, tenantId: String?) async throws {
    guard let makeImpersonationAuth else { throw IdentityToolkitError(code: nil, status: 0) }
    if impersonation != nil { await endImpersonation() }
    let aside = user
    let session = makeImpersonationAuth()
    let customer = try await session.signInWithCustomToken(token, tenantId: tenantId)
    staffAside = aside
    impersonated = session
    impersonationFlag.set(true)
    impersonation = Impersonation(customer: customer, staffEmail: aside?.email)
    staff = nil
    user = customer
    await refreshStanding()
  }

  /// Ends the support session and returns to the staff member's own, which was never signed out.
  public func endImpersonation() async {
    guard let session = impersonated else { return }
    await session.signOut()
    impersonated = nil
    impersonationFlag.set(false)
    impersonation = nil
    user = staffAside
    staffAside = nil
    await refreshStanding()
  }

  public func signOut() async {
    // Leaving the app from a support session ends it, and then signs the staff member out as well.
    await endImpersonation()
    for task in beforeSignOut { await task() }
    staff = nil
    if let rest {
      await rest.signOut()
      user = nil
      return
    }
    try? Auth.auth().signOut()
  }

  /// Reads the staff standing from the current ID token's claims.
  public func refreshStanding() async {
    guard user != nil, let token = try? await idToken(forceRefresh: false) else {
      staff = nil
      return
    }
    staff = idTokenClaims(token).flatMap(StaffStanding.from(claims:))
  }

  /// The current ID token; nil when signed out.
  public nonisolated func idToken(forceRefresh: Bool) async throws -> String? {
    if let session = await MainActor.run(body: { self.impersonated }) {
      let token = try await session.idToken(forceRefresh: forceRefresh)
      // A refresh the server refuses (the support session was revoked) ends it, and the staff session returns.
      if token == nil { await endImpersonation() }
      return token
    }
    if let rest {
      let token = try await rest.idToken(forceRefresh: forceRefresh)
      if token == nil { await MainActor.run { self.user = nil } }
      return token
    }
    guard let current = Auth.auth().currentUser else { return nil }
    return try await current.getIDTokenResult(forcingRefresh: forceRefresh).token
  }
}
