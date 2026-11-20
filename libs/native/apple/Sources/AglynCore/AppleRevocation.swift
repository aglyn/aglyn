// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// Closing an account that signs in with Apple revokes the app's Apple token first (App Store Review Guideline 5.1.1(v)):
/// the app holds a fresh Sign in with Apple authorization and hands its one-time `authorizationCode` to Firebase Auth,
/// which revokes the token at Apple with the project's Apple key (`revokeToken(withAuthorizationCode:)`; REST
/// `accounts:revokeToken`). Closing is the person's right, so a revoke that fails, or an authorization that never came
/// (cancelled, or a build that cannot run Sign in with Apple), never stops the close: it is recorded as a non-fatal
/// error, with no address or token in it, and the close goes on.
public enum AppleRevocation {
  /// The sign-in provider whose token is owed a revoke.
  public static let provider = "apple.com"
  /// Where a missed revoke is recorded (`Telemetry.record`).
  public static let telemetryContext = "auth.apple_revoke"

  /// Whether closing this account owes Apple a revoke: it holds the `apple.com` provider.
  public static func owed(providers: [String]) -> Bool { providers.contains(provider) }

  /// `accounts:revokeToken`'s body for an Apple authorization code: the provider, the token type, the code, and the
  /// signed-in account's ID token, which tells Firebase whose Apple grant it is.
  public static func revokeRequestBody(authorizationCode: String, idToken: String) -> [String: JSONValue] {
    [
      "providerId": .string(provider), "tokenType": .string("CODE"), "token": .string(authorizationCode),
      "idToken": .string(idToken),
    ]
  }

  /// Runs `close` after revoking with `code` when the account owes a revoke. The revoke never throws out of here: a
  /// failure, or no code to revoke with, is recorded and `close` still runs.
  public static func close<T>(
    owed: Bool, code: String?, revoke: (String) async throws -> Void, close: () async -> T
  ) async -> T {
    if owed { await self.revoke(code: code, using: revoke) }
    return await close()
  }

  /// Revokes with `code`, recording a failure or a missing code; true when the revoke went through.
  @discardableResult
  public static func revoke(code: String?, using revoke: (String) async throws -> Void) async -> Bool {
    guard let code, !code.isEmpty else {
      Telemetry.record(AppleRevocationFailure(reason: .noAuthorization), telemetryContext)
      return false
    }
    do {
      try await revoke(code)
      return true
    } catch {
      Telemetry.record(AppleRevocationFailure(reason: .revokeFailed, underlying: error), telemetryContext)
      return false
    }
  }
}

/// A revoke that did not happen, as Crashlytics is told it: why, and the failure's domain and code (an HTTP status for a
/// REST refusal). Nothing else of the failure is kept, so no address, token or message text reaches the report.
public struct AppleRevocationFailure: Error, CustomNSError, Equatable {
  public enum Reason: String, Sendable {
    /// No Sign in with Apple authorization: the person cancelled it, or this build cannot run Sign in with Apple.
    case noAuthorization = "no_authorization"
    /// Firebase refused or could not be reached.
    case revokeFailed = "revoke_failed"
  }

  public let reason: Reason
  public let underlyingDomain: String
  public let underlyingCode: Int

  public init(reason: Reason, underlying: Error? = nil) {
    self.reason = reason
    if let rest = underlying as? IdentityToolkitError {
      underlyingDomain = "IdentityToolkit"
      underlyingCode = rest.status
    } else if let underlying {
      let ns = underlying as NSError
      underlyingDomain = ns.domain
      underlyingCode = ns.code
    } else {
      underlyingDomain = ""
      underlyingCode = 0
    }
  }

  public static var errorDomain: String { "AglynCore.AppleRevocation" }
  public var errorCode: Int { reason == .noAuthorization ? 1 : 2 }
  public var errorUserInfo: [String: Any] {
    ["reason": reason.rawValue, "underlying_domain": underlyingDomain, "underlying_code": underlyingCode]
  }
}
