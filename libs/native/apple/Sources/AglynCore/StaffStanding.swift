// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * AGLYN STAFF, AS THE CONSOLE TELLS THEM APART.
 *
 * The signed-in ID token carries the same claims the browser's staff console
 * checks: `staff === true`, and `staffRole` naming what the staff member may
 * do (`super`, `support`, `billing`, …). The app reads them only to decide
 * what to show. Every `/api/admin` route re-verifies the token on each
 * request and refuses regardless of what rendered, exactly as on the web.
 */

/// A staff member's standing; nil for everyone else.
public struct StaffStanding: Equatable, Sendable {
  /// The token's `staffRole`; nil while it names none.
  public let role: String?

  public init(role: String?) {
    self.role = role
  }

  /// The standing the claims grant, or nil when they are not staff claims.
  public static func from(claims: [String: Any]) -> StaffStanding? {
    guard let staff = claims["staff"] as? Bool, staff else { return nil }
    let role = (claims["staffRole"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    return StaffStanding(role: role?.isEmpty == false ? role : nil)
  }

  /// This standing against the roles an act admits (`resolveStaffRoleGate`).
  public func gate(_ allowed: [String]) -> StaffRoleGate { resolveStaffRoleGate(role, allowed) }
}

/// The viewer's standing against the set of roles a route admits: the
/// console's `resolveStaffRoleGate` (staff-role-gate.ts), case for case.
public struct StaffRoleGate: Equatable, Sendable {
  /// False while the role is still unknown. Nothing is blocked in that window.
  public let ready: Bool
  /// Whether the role is one the route admits; false until `ready`.
  public let admitted: Bool
  /// A resolved role the route would refuse: the one thing a control branches on.
  public let blocked: Bool
  /// The words to show when `blocked`.
  public let reason: String?
}

public func resolveStaffRoleGate(_ role: String?, _ allowed: [String]) -> StaffRoleGate {
  let ready = role != nil
  let admitted = ready && allowed.contains(role ?? "")
  let blocked = ready && !admitted
  return StaffRoleGate(
    ready: ready, admitted: admitted, blocked: blocked,
    reason: blocked
      ? "This action requires the \(allowed.joined(separator: " or ")) staff role. Ask someone who holds it." : nil)
}

/// The claims an ID token carries (its payload, base64url JSON). Read for
/// display only; the server is the boundary.
public func idTokenClaims(_ token: String) -> [String: Any]? {
  let parts = token.split(separator: ".", omittingEmptySubsequences: false)
  guard parts.count >= 2 else { return nil }
  var payload = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
  while payload.count % 4 != 0 { payload += "=" }
  guard let data = Data(base64Encoded: payload),
    let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  else { return nil }
  return object
}
