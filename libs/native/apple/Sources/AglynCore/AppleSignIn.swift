// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import CryptoKit
import Foundation

/// Sign in with Apple's one-time nonce: the request carries its SHA-256, and Firebase is handed the raw value with
/// Apple's identity token (`accounts:signInWithIdp`, provider `apple.com`), so a token replayed from another request is
/// refused.
public enum AppleSignInNonce {
  /// A random URL-safe nonce and the hex SHA-256 the authorization request is made with.
  public static func make(length: Int = 32) -> (raw: String, hashed: String) {
    let alphabet = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
    var generator = SystemRandomNumberGenerator()
    let raw = String((0..<length).map { _ in alphabet[Int(generator.next(upperBound: UInt(alphabet.count)))] })
    return (raw, sha256(raw))
  }

  public static func sha256(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }
}

/// Whether a provider sheet ended because the person closed it (the console ignores `popup-closed-by-user`).
public func isCanceledSignIn(_ error: Error) -> Bool {
  let ns = error as NSError
  if ns.domain == "com.apple.AuthenticationServices.WebAuthenticationSession" && ns.code == 1 { return true }
  if ns.domain == "com.apple.AuthenticationServices.AuthorizationError" && ns.code == 1001 { return true }
  if let google = error as? GoogleLinkError, google.message == "Google sign-in was canceled." { return true }
  return error is CancellationError
}
