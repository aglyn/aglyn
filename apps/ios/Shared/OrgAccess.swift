// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Observation

/// What the signed-in person may do in the workspace in hand, live: its document (plan features) and their membership
/// with its custom role (workspace permissions). Create new reads it to show an item it cannot offer disabled, with why.
@MainActor
@Observable
final class OrgAccess {
  @ObservationIgnored private let org = ObservedDocument()
  @ObservationIgnored private let member = ObservedDocument()
  @ObservationIgnored private let role = ObservedDocument()
  @ObservationIgnored private var orgID: String?
  @ObservationIgnored private var roleID: String?
  /// The workspace's features as the console resolves them (`/api/orgs/entitlements`: the plan, its comp, add-ons such
  /// as the events calendar, and per-workspace overrides); nil until read.
  private var resolvedFeatures: [String: Bool]?

  func follow(reader: FirestoreReader?, api: ConsoleAPIClient?, orgID: String?, uid: String?) {
    guard let reader, let orgID, let uid else {
      stop()
      return
    }
    if orgID != self.orgID {
      self.orgID = orgID
      roleID = nil
      resolvedFeatures = nil
      org.start(reader, ["orgs", orgID])
      if let api {
        Task {
          guard let body = try? await api.request("/api/orgs/entitlements", query: [("orgId", orgID)]),
            self.orgID == orgID, case .object(let map)? = body["features"]
          else { return }
          resolvedFeatures = map.compactMapValues(\.boolValue)
        }
      }
      member.start(reader, ["orgs", orgID, "members", uid])
      role.stop()
    }
    let next = member.document?.string("roleId")
    if let next, next != roleID {
      roleID = next
      role.start(reader, ["orgs", orgID, "roles", next])
    }
  }

  /// The member's custom role, once their membership is read: `follow` again when it changes.
  var memberRoleID: String? { member.document?.string("roleId") }

  func stop() {
    orgID = nil
    resolvedFeatures = nil
    roleID = nil
    org.stop()
    member.stop()
    role.stop()
  }

  /// The workspace's answers for each permission the keys name (an absent key is not held).
  ///
  /// The verdict stamped on the member (`resolvedPermissions`, every layer applied) when there is one; else the role's
  /// grants from the catalog (`ORG_ROLE_GRANTS`), then the member's custom role, then their own overrides.
  func permissions(_ keys: [String]) -> [String: Bool] {
    let data = member.document?.data
    let stamped = data?["resolvedPermissions"] as? [String: Any]
    let resolved = rolePermissions(
      ContractValues.shared.orgRoleGrants, role: data?["role"] as? String,
      customRole: data?["roleId"] as? String != nil ? role.document?.data : nil, overrides: data)
    return Dictionary(
      keys.map { key in (key, data == nil ? false : (stamped?[key] as? Bool) ?? resolved[key] ?? false) },
      uniquingKeysWith: { a, _ in a })
  }

  /// Whether the workspace carries each feature the keys name: the console's resolved answer, else (before it is read,
  /// or offline) the plan's default from the workspace's own document.
  func features(_ keys: [String]) -> [String: Bool] {
    Dictionary(
      keys.map { ($0, resolvedFeatures?[$0] ?? planFeatureCarried(org.document?.data, $0)) }, uniquingKeysWith: { a, _ in a })
  }
}
