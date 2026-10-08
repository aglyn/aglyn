// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import Security

private let resourceIDAlphabet = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")

/// A new document id as the console mints one (`createResourceUid`): ten
/// random letters and digits, for a resource whose id the caller names.
public func createResourceUID(length: Int = 10) -> String {
  var generator = SystemRandomNumberGenerator()
  return String((0..<length).map { _ in resourceIDAlphabet.randomElement(using: &generator)! })
}

/// `count` cryptographically random bytes as lowercase hex: a shared secret
/// such as a webhook's (24 bytes, 48 characters).
public func randomHexSecret(bytes count: Int = 24) -> String {
  var bytes = [UInt8](repeating: 0, count: count)
  if SecRandomCopyBytes(kSecRandomDefault, count, &bytes) != errSecSuccess {
    var generator = SystemRandomNumberGenerator()
    bytes = (0..<count).map { _ in UInt8.random(in: 0...255, using: &generator) }
  }
  return bytes.map { String(format: "%02x", $0) }.joined()
}
