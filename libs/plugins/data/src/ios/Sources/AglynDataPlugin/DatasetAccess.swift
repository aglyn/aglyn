// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import Foundation
import Observation

/// The one site `visibleTo` places a dataset on, or nil for every site, several or none (`oneSitePlacement`).
func oneSitePlacement(_ visibleTo: [String]?) -> String? {
  guard let visibleTo, visibleTo.count == 1, visibleTo[0].hasPrefix("host:") else { return nil }
  let host = String(visibleTo[0].dropFirst(5))
  return host.isEmpty || host.contains(":") || host.contains("/") ? nil : host
}

/// What the signed-in member can do with one dataset, and what a refused press says (`datasetAccessBlocked`).
struct DatasetAccess: Equatable {
  let canWrite: Bool
  let writeRefusal: String
  /// Writes are off, and who it is shared with stays theirs: a site narrows a holder of "Manage data".
  let sharingOnly: Bool
  let canDelete: Bool
  let deleteRefusal: String
  let canRead: Bool
  let canExport: Bool
}

private let siteRoleRank = ["viewer": 0, "author": 1, "editor": 2, "admin": 3, "owner": 3]

/// The verdict for a dataset, as the rule `canWriteDatasetOn` and the routes give it. The workspace key admits, unless a
/// site narrows the member on the one site the dataset sits on; else, on that one site, the site key. Placed on every site
/// or several, the workspace key alone. For what to show only: the rules and routes decide.
func datasetAccess(
  workspace: [String: Bool], orgWide: Bool, orgRole: String?, visibleTo: [String]?, site: [String: Any]?, uid: String
) -> DatasetAccess {
  let catalog = ContractValues.shared.orgRoleGrants
  let host = oneSitePlacement(visibleTo)
  let onSite = sitePermissions(catalog, workspace: workspace, site: site, uid: uid)
  let siteRole = (site?["memberRoles"] as? [String: Any])?[uid] as? String
  let narrowed =
    orgWide && host != nil && siteRole != nil
    && (siteRoleRank[siteRole ?? ""] ?? 0) < (siteRoleRank[orgRole ?? ""] ?? 0)
  func verdict(_ workspaceKey: String, _ siteKey: String) -> Bool {
    let held = workspace[workspaceKey] == true
    guard host != nil else { return held }
    return (held && !narrowed) || onSite[siteKey] == true
  }
  let canWrite = verdict("data.manage", "data.siteManage")
  let beyond = !orgWide && host == nil
  let deleteRefusal =
    beyond
    ? "This dataset is shared beyond one site, so deleting it takes access to every site in the workspace."
    : permissionRefusalText(catalog, key: host != nil ? "data.siteDelete" : "org.eraseRecords")
  return DatasetAccess(
    canWrite: canWrite,
    writeRefusal: permissionRefusalText(catalog, key: host != nil ? "data.siteManage" : "data.manage"),
    sharingOnly: !canWrite && workspace["data.manage"] == true && orgWide,
    canDelete: !beyond && verdict("org.eraseRecords", "data.siteDelete"),
    deleteRefusal: deleteRefusal,
    canRead: workspace["data.viewRecords"] == true,
    canExport: workspace["data.export"] == true)
}

/// The reads [datasetAccess] needs for a dataset: the member's reach, and the one site it sits on.
@MainActor
@Observable
final class DatasetPlacement {
  private(set) var site: [String: Any]?
  let member = OrgAccessModel()
  @ObservationIgnored private var listener: FirestoreListening?

  func start(_ context: NativePluginContext, visibleTo: [String]?) {
    if let orgID = context.orgID, member.orgWide == nil { member.start(context, orgID: orgID) }
    listener?.remove()
    listener = nil
    site = nil
    guard let host = oneSitePlacement(visibleTo) else { return }
    listener = context.firestore.listenDocument(["hosts", host]) { [weak self] result in
      if case .success(let doc) = result { self?.site = doc?.data }
    }
  }

  func access(_ context: NativePluginContext, visibleTo: [String]?) -> DatasetAccess {
    let keys = ["data.manage", "org.eraseRecords", "data.siteManage", "data.siteDelete", "data.viewRecords", "data.export"]
    let workspace = Dictionary(uniqueKeysWithValues: keys.map { ($0, context.canInWorkspace($0)) })
    return datasetAccess(
      workspace: workspace, orgWide: member.orgWide == true, orgRole: context.orgRole, visibleTo: visibleTo, site: site,
      uid: context.uid)
  }
}
