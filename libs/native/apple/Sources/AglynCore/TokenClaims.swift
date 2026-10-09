// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// The claims a Firebase ID token carries (`staff`, `staffRole`, `auth_time`).
///
/// Read from the token's own payload, the way the console's
/// `getIdTokenResult().claims` reads them. This is a UI gate only: the
/// `/api/admin/*` routes and the Firestore rules verify the signed token on
/// every request, so a forged payload opens a screen whose reads all fail.
public struct TokenClaims: Equatable, Sendable {
  public let values: [String: JSONValue]

  public init(_ values: [String: JSONValue] = [:]) { self.values = values }

  /// The payload of a JWT (its middle, base64url segment); empty when unreadable.
  public init(idToken: String?) {
    let parts = (idToken ?? "").split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3 else {
      self.values = [:]
      return
    }
    var base64 = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while base64.count % 4 != 0 { base64 += "=" }
    guard let data = Data(base64Encoded: base64), case .object(let record)? = JSONValue.decode(data) else {
      self.values = [:]
      return
    }
    self.values = record
  }

  /// Whether the token carries the staff claim (`staff: true`).
  public var isStaff: Bool { values["staff"] == .bool(true) }

  /// The staff role, `support` when the claim is absent (the routes fail closed
  /// to the least-privileged role the same way); nil for anyone not staff.
  public var staffRole: String? {
    guard isStaff else { return nil }
    return values["staffRole"]?.stringValue ?? "support"
  }

  public var isSuper: Bool { staffRole == "super" }
}
