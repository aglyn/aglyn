// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AuthenticationServices
import Foundation
import SwiftUI

/// Signing in with a passkey, as the console's sign-in page does (`signInWithPasskey`): the options route answers a
/// challenge, the platform signs it with a discoverable passkey, and the verify route answers a Firebase custom token for the
/// credential's owner, which the app signs in with (`AuthSession.signIn(customToken:)`). Both routes are asked without a
/// session, and read the ceremony's `Origin`: the relying party's own for the options, and the origin the platform signed into
/// the credential for the verify.
public enum PasskeySignIn {
  /// The words for a failed sign-in, the console's: closing the prompt, a route's reason, or the general one.
  public static func message(for error: Error) -> String {
    if error is PasskeyCancelled { return "No passkey was used to sign in." }
    if let refused = error as? ConsoleAPIError, let reason = refused.body?["error"]?.stringValue, let words = refusals[reason] {
      return words
    }
    return "Passkey sign-in failed."
  }

  /// Whether `error` came from the ceremony or the passkey routes (their words), rather than the Firebase sign-in after them.
  public static func failed(_ error: Error) -> Bool { error is PasskeyCancelled || error is ConsoleAPIError }

  private static let refusals: [String: String] = [
    "rate-limited": "Too many passkey attempts from this network. Wait a few minutes and try again.",
    "bad-origin": "Passkey sign-in is not available on this address.",
    "passkey-signin-failed":
      "That passkey could not be used to sign in. Try another sign-in method, then re-add the passkey from Manage account → Security.",
    "credential-unknown": "That passkey is not registered to an \(AglynBrand.name) account. It may have been removed.",
    "credential-cloned":
      "That passkey was refused for security reasons. Sign in another way and remove it from Manage account → Security.",
    "challenge-invalid": "The passkey request expired. Try again.",
    "verification-failed": "That passkey could not be verified.",
  ]

  /// The custom token for the passkey `get` signs the server's challenge with (the platform's prompt).
  public static func token(
    api: ConsoleAPIClient, relyingParty: String, get: (JSONValue) async throws -> JSONValue
  ) async throws -> String {
    let origin = "https://\(relyingParty)"
    let started = try await api.request(
      "/api/auth/passkeys/signin/options", method: .post, body: [:], anonymous: true, headers: ["Origin": origin])
    guard let challengeId = started?["challengeId"]?.stringValue, let options = started?["options"] else {
      throw ConsoleAPIError(status: 500, message: "internal", body: ["error": "internal"])
    }
    let credential = try await get(options)
    let verified = try await api.request(
      "/api/auth/passkeys/signin/verify", method: .post, body: ["challengeId": .string(challengeId), "response": credential],
      anonymous: true, headers: ["Origin": ScreenPasskeys.clientDataOrigin(of: credential) ?? origin])
    guard let token = verified?["token"]?.stringValue, !token.isEmpty else {
      throw ConsoleAPIError(status: 500, message: "internal", body: ["error": "internal"])
    }
    return token
  }

  /// The same, with the system's passkey prompt.
  @MainActor
  public static func token(api: ConsoleAPIClient, relyingParty: String, controller: AuthorizationController) async throws -> String {
    try await token(api: api, relyingParty: relyingParty) { options in try await SystemPasskeys.get(options, using: controller) }
  }
}
