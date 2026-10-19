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

  func follow(reader: FirestoreReader?, orgID: String?, uid: String?) {
    guard let reader, let orgID, let uid else {
      stop()
      return
    }
    if orgID != self.orgID {
      self.orgID = orgID
      roleID = nil
      org.start(reader, ["orgs", orgID])
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
    roleID = nil
    org.stop()
    member.stop()
    role.stop()
  }

  /// The workspace's answers for each permission the keys name (an absent key is not held).
  func permissions(_ keys: [String]) -> [String: Bool] {
    Dictionary(
      keys.map { ($0, orgPermissionGranted($0, member: member.document?.data, customRole: role.document?.data)) },
      uniquingKeysWith: { a, _ in a })
  }

  /// Whether the workspace's plan carries each feature the keys name.
  func features(_ keys: [String]) -> [String: Bool] {
    Dictionary(keys.map { ($0, planFeatureCarried(org.document?.data, $0)) }, uniquingKeysWith: { a, _ in a })
  }
}
