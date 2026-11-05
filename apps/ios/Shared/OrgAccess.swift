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
  @ObservationIgnored private let site = ObservedDocument()
  // Observed: a view that asked for a key before `follow` set these read the workspace's verdict, and it must ask again.
  private var uid: String?
  private var siteID: String?
  /// The role the membership index names, which answers until the member row is read.
  private var indexRole: String?
  @ObservationIgnored private var orgID: String?
  @ObservationIgnored private var roleID: String?
  /// The workspace's features as the console resolves them (`/api/orgs/entitlements`: the plan, its comp, add-ons such
  /// as the events calendar, and per-workspace overrides); nil until read.
  private var resolvedFeatures: [String: Bool]?

  func follow(reader: FirestoreReader?, api: ConsoleAPIClient?, orgID: String?, uid: String?, hostID: String? = nil, orgRole: String? = nil) {
    guard let reader, let orgID, let uid else {
      stop()
      return
    }
    self.uid = uid
    indexRole = orgRole
    if hostID != siteID {
      siteID = hostID
      if let hostID { site.start(reader, ["hosts", hostID]) } else { site.stop() }
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
    site.stop()
    siteID = nil
    uid = nil
    indexRole = nil
  }

  /// The member's verdict on every catalog key in this workspace (`memberPermissions`).
  var workspacePermissions: [String: Bool] {
    memberPermissions(
      ContractValues.shared.orgRoleGrants, member: member.document?.data, orgRole: indexRole, customRole: role.document?.data)
  }

  /// The same on the site `follow` was given, as that site's own document answers for this member.
  var pickedSitePermissions: [String: Bool] {
    sitePermissions(
      ContractValues.shared.orgRoleGrants, workspace: workspacePermissions, site: site.document?.data, uid: uid ?? "")
  }

  /// The site `pickedSitePermissions` answers for.
  var pickedSiteID: String? { siteID }

  /// The answer for one key on a site: that site's when it is the one followed, else the workspace's.
  func holds(_ key: String, onSite hostID: String?) -> Bool {
    (hostID != nil && hostID == siteID ? pickedSitePermissions : workspacePermissions)[key] == true
  }

  /// The workspace's answers for each permission the keys name (an absent key is not held).
  func permissions(_ keys: [String]) -> [String: Bool] {
    let all = workspacePermissions
    return Dictionary(keys.map { ($0, all[$0] ?? false) }, uniquingKeysWith: { a, _ in a })
  }

  /// Whether the workspace carries each feature the keys name: the console's resolved answer, else (before it is read,
  /// or offline) the plan's default from the workspace's own document.
  func features(_ keys: [String]) -> [String: Bool] {
    Dictionary(
      keys.map { ($0, resolvedFeatures?[$0] ?? planFeatureCarried(org.document?.data, $0)) }, uniquingKeysWith: { a, _ in a })
  }

  /// The mark a white-label workspace configured, for the Home tab (P2): read as the console's `useBranding` reads it,
  /// only when the workspace carries `whiteLabel` and set a brand (`hasBrandingProfile`: a product name or a logo).
  /// Its favicon is the square mark; a workspace with only a logo shows that. Nil means the platform's own mark.
  var whiteLabelMark: (light: String, dark: String?)? {
    guard features(["whiteLabel"])["whiteLabel"] == true,
      let profile = org.document?.data["brandingProfile"] as? [String: Any]
    else { return nil }
    func clean(_ key: String) -> String? {
      (profile[key] as? String).flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
    }
    guard clean("productName") != nil || clean("logoUrl") != nil else { return nil }
    if let favicon = clean("faviconUrl") { return (favicon, clean("faviconDarkUrl")) }
    if let logo = clean("logoUrl") { return (logo, clean("logoDarkUrl")) }
    return nil
  }
}
