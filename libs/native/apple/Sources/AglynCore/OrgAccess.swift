// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// What a member row (`orgs/{orgId}/members/{uid}`) grants, read the way the
/// console reads it (the Kotlin kit's `OrgAccess`). Navigation only: the
/// security rules are the boundary.
public enum OrgAccess {
  /// The scope token every member of a workspace holds.
  public static let orgScopeToken = "org"

  /// The scope token one site's members hold.
  public static func hostScopeToken(_ hostID: String) -> String { "host:\(hostID)" }

  /// Owner, admin, every site, or a legacy member with no site list.
  public static func isOrgWideMember(_ data: [String: Any]?) -> Bool {
    guard let data else { return false }
    let role = data["role"] as? String
    if role == "owner" || role == "admin" { return true }
    if data["allHosts"] as? Bool == true { return true }
    let scoping = data["hostAccess"] as? [String: Any]
    return data["allHosts"] == nil && (scoping?.isEmpty ?? true)
  }

  /// The scope tokens the rules admit this member's reads by.
  public static func memberScopeTokens(_ data: [String: Any]?) -> [String] {
    if let stored = (data?["scopeTokens"] as? [Any])?.compactMap({ $0 as? String }), !stored.isEmpty {
      return stored
    }
    if isOrgWideMember(data) { return [orgScopeToken] }
    let hostIDs = (data?["hostAccess"] as? [String: Any])?.keys.sorted() ?? []
    return [orgScopeToken] + hostIDs.map(hostScopeToken)
  }

  /// A library's scope clause for this member: nil reads the whole library
  /// (an org-wide member), else the member's tokens.
  public static func libraryScope(_ member: FirestoreDocument?) -> [String]? {
    guard let member else { return nil }
    return isOrgWideMember(member.data) ? nil : memberScopeTokens(member.data)
  }
}
