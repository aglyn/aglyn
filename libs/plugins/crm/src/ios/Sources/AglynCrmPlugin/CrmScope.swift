// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

/*
 * WHO IS READING THE CRM, AND WHAT THEY STAMP (the console's `useCrmScope`;
 * the Kotlin plugin's `CrmScope.kt`, rule for rule, replayed against the
 * console's own answers).
 */

let orgScopeToken = "org"
/// "Change CRM settings".
let crmSettingsKey = "crm.settings"
/// "Move contacts and deals between stages".
let crmMoveStagesKey = "crm.moveStages"
let maxScopeHosts = 30

func hostScopeToken(_ hostID: String) -> String { "host:\(hostID)" }

struct ConsentGroup: Equatable {
  let hostID: String
  let groupID: String
  let name: String?
  let hostIDs: [String]
  let declared: Bool

  static func solo(_ hostID: String) -> ConsentGroup {
    ConsentGroup(hostID: hostID, groupID: hostID, name: nil, hostIDs: [hostID], declared: false)
  }
}

private func consentGroupSiteIDs(_ org: [String: Any], _ raw: [String: Any]) -> Set<String> {
  var ids = Set<String>()
  if let hosts = org["hosts"] as? [Any] {
    for case let id as String in hosts where !id.isEmpty { ids.insert(id) }
  } else if let hosts = org["hosts"] as? [String: Any] {
    for id in hosts.keys where !id.isEmpty { ids.insert(id) }
  }
  for value in raw.values {
    guard let hostIDs = (value as? [String: Any])?["hostIds"] as? [Any] else { continue }
    for id in hostIDs {
      let trimmed = "\(id)".trimmingCharacters(in: .whitespaces)
      if !trimmed.isEmpty { ids.insert(trimmed) }
    }
  }
  return ids
}

private func readConsentGroups(_ org: [String: Any]?) -> [String: (name: String, hostIDs: [String])] {
  guard let org, let raw = org["consentGroups"] as? [String: Any] else { return [:] }
  let siteIDs = consentGroupSiteIDs(org, raw)
  var usable: [String: (name: String, hostIDs: [String])] = [:]
  for (groupID, value) in raw {
    guard !groupID.isEmpty, let group = value as? [String: Any], !siteIDs.contains(groupID) else { continue }
    let name = (group["name"] as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
    if name.isEmpty { continue }
    let hostIDs = Array(Set((group["hostIds"] as? [Any] ?? []).map { "\($0)".trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })).sorted()
    if hostIDs.count < 2 || hostIDs.count > maxScopeHosts { continue }
    usable[groupID] = (name, hostIDs)
  }
  var claims: [String: Int] = [:]
  for group in usable.values { for id in group.hostIDs { claims[id, default: 0] += 1 } }
  let contested = Set(claims.filter { $0.value > 1 }.keys)
  if contested.isEmpty { return usable }
  return usable.filter { !$0.value.hostIDs.contains(where: contested.contains) }
}

func consentGroupForHost(_ org: [String: Any]?, _ hostID: String) -> ConsentGroup {
  for (groupID, group) in readConsentGroups(org).sorted(by: { $0.key < $1.key }) where group.hostIDs.contains(hostID) {
    return ConsentGroup(hostID: hostID, groupID: groupID, name: group.name, hostIDs: group.hostIDs, declared: true)
  }
  return .solo(hostID)
}

/// `crm.defaultRecordScope`, else the legacy `defaultResourceScope`, else the whole org.
/// `nil` only with no org to read, which every caller treats as the site.
func crmDefaultScope(_ org: [String: Any]?) -> String? {
  guard let org else { return nil }
  if let own = (org["crm"] as? [String: Any])?["defaultRecordScope"] as? String, own == "org" || own == "host" { return own }
  if let legacy = org["defaultResourceScope"] as? String, legacy == "org" || legacy == "host" { return legacy }
  return "org"
}

/// The sites the CRM default leaves out, when it is all sites except some, or nil (`crmDefaultExceptOf`, AGL-4047). Only
/// the org's own `crm.defaultRecordScope: 'host'` carries it.
func crmDefaultExcept(_ org: [String: Any]?) -> [String]? {
  let settings = org?["crm"] as? [String: Any] ?? [:]
  guard settings["defaultRecordScope"] as? String == "host", let except = settings["defaultRecordExcept"] as? [Any] else {
    return nil
  }
  var ids: [String] = []
  for case let id as String in except where !id.isEmpty && !ids.contains(id) { ids.append(id) }
  return ids.isEmpty ? nil : ids
}

/// The CRM default as the settings offer it: `org`, `host` or `allExcept` (`crmDefaultSharingOf`).
func crmDefaultSharing(_ org: [String: Any]?) -> String? {
  crmDefaultExcept(org) != nil ? "allExcept" : crmDefaultScope(org)
}

/// The most sites the CRM default may reach when it leaves some out (`CRM_DEFAULT_MAX_INCLUDED`).
let crmDefaultMaxIncluded = maxScopeHosts

/// What a new record stores of its sites (`crmScopeFields`): under all sites except some, the workspace's sites
/// (`orgs/{orgId}.hosts`) less the ones left out, plus the site it came in on; never wider than the site and its group
/// when the sites can't be read or would be too many. Only a server stores the marker; a client's record is marked on
/// the server's follow-up.
func crmScopeFields(_ org: [String: Any]?, _ group: ConsentGroup) -> (visibleTo: [String], scopeMode: String?, scopeExcept: [String]?) {
  if crmDefaultScope(org) == "org" { return ([orgScopeToken], nil, nil) }
  let kept = group.hostIDs.map(hostScopeToken)
  guard let except = crmDefaultExcept(org), let hosts = org?["hosts"] as? [String: Any] else { return (kept, nil, nil) }
  let orgHostIDs = hosts.filter { entry in
    if let on = entry.value as? Bool { return on }
    return !(entry.value is NSNull)
  }.map(\.key)
  if orgHostIDs.isEmpty { return (kept, nil, nil) }
  let left = except.filter(orgHostIDs.contains)
  if left.isEmpty { return ([orgScopeToken], nil, nil) }
  let out = Set(left)
  let included = Array(Set(orgHostIDs.filter { !out.contains($0) } + [group.hostID])).filter { !$0.isEmpty }.sorted()
  if included.count > crmDefaultMaxIncluded { return (kept, nil, nil) }
  return (included.map(hostScopeToken), "allExcept", left.sorted().map(hostScopeToken))
}

func crmScopeTokens(_ org: [String: Any]?, _ group: ConsentGroup) -> [String] {
  crmScopeFields(org, group).visibleTo
}

func crmReadTokens(_ group: ConsentGroup) -> [String] {
  Array(([orgScopeToken] + group.hostIDs.map(hostScopeToken)).prefix(maxScopeHosts))
}

/// What a record created from `hostID` is stamped with. With no site: the whole org when its records belong to every
/// site, and nothing when it keeps its sites apart, where a create waits for a site (a record stamped with no tokens is
/// visible to nobody).
func crmCreateTokens(_ org: [String: Any]?, _ hostID: String?) -> [String] {
  if let hostID, !hostID.isEmpty { return crmScopeTokens(org, consentGroupForHost(org, hostID)) }
  return crmDefaultScope(org) == "org" ? [orgScopeToken] : []
}

/// The site a create comes from at the workspace's level: the last pick while the workspace still has it, its only
/// site, else none. Nothing else is picked silently: a wrong guess files a person under a brand that never met them.
func crmCreateHost(picked: String?, sites: [String]) -> String? {
  if let picked, sites.contains(picked) { return picked }
  return sites.count == 1 ? sites[0] : nil
}

/// The site a record came from, as a workspace-wide page reaches it: its own `hostId`, or the site that first captured
/// a contact (`contactPrimaryGroup`'s capture order).
func crmRecordSite(_ data: [String: Any]) -> String? {
  if let site = data["hostId"] as? String, !site.isEmpty { return site }
  return (data["capturedByHostIds"] as? [Any])?.compactMap { $0 as? String }.first { !$0.isEmpty }
}

private let crmPlans: Set<String> = ["starter", "pro", "business", "scale", "advanced", "agency", "enterprise"]
private let lapsed: Set<String> = ["canceled", "unpaid", "incomplete", "incomplete_expired"]

/// Whether the org carries the CRM suite, as the rules' `crmSuiteCarried` decides it.
func crmSuiteCarried(_ org: [String: Any]?) -> Bool {
  let entitlements = org?["entitlements"] as? [String: Any]
  if let override = (entitlements?["features"] as? [String: Any])?["crm"] as? Bool { return override }
  let billing = (org?["billingStatus"] as? String) ?? ""
  let status = billing.isEmpty ? ((org?["subscription"] as? [String: Any])?["status"] as? String ?? "") : billing
  let plan = org?["plan"] as? String ?? "free"
  let comp = (entitlements?["planComp"] as? [String: Any])?["plan"] as? String ?? ""
  return (crmPlans.contains(plan) && !lapsed.contains(status)) || (crmPlans.contains(comp) && (status.isEmpty || lapsed.contains(status)))
}

/// The CRM as this member sees it: from the picked site, or for the whole workspace (the console's org CRM page,
/// `useCrmScope` with no host): every site's records, a new one belonging to the whole workspace unless a site is named.
struct CrmScope: Equatable {
  let orgID: String
  /// The site the CRM is read from; empty at the workspace's level, where a create names its site itself.
  let hostID: String
  /// The workspace's own CRM rather than one site's.
  let orgLevel: Bool
  /// The holder a contact's own fields are kept under: the site's consent group.
  let groupID: String
  let uid: String
  let role: String?
  let orgWide: Bool
  let readTokens: [String]
  /// What a record created here is stamped with: empty while a kept-apart workspace waits for its site.
  private(set) var createTokens: [String]
  let suite: Bool
  let org: [String: Any]
  /// The member's own row, which `forSite` narrows a declared group's reach by.
  let member: [String: Any]?

  /// What the member holds across the workspace, off their own row (its `resolvedPermissions` stamp over their role).
  let permissions: [String: Bool]

  /// "Manage data": what every write to the CRM's records asks.
  var canWrite: Bool { permissions["data.manage"] == true }
  /// "Change CRM settings": the settings that hold for every site.
  var canManage: Bool { permissions[crmSettingsKey] == true }
  /// The workspace's own CRM reads every site's records at once: it asks for the reach and for "Manage data".
  var opensWorkspaceCrm: Bool { orgWide && canWrite }

  /// "Move contacts and deals between stages", where the stage route will ask it: on the site it is called for (`site`,
  /// that site's document), with no site the workspace's verdict. Until the site is read nothing is switched off, and
  /// the route answers. For what to show only.
  func movesStages(on site: [String: Any]?) -> Bool {
    if hostID.isEmpty { return permissions[crmMoveStagesKey] == true }
    guard let site else { return true }
    return sitePermissions(ContractValues.shared.orgRoleGrants, workspace: permissions, site: site, uid: uid)[crmMoveStagesKey] == true
  }
  /// The site a new record names as its source; nil for a record from no site.
  var createHostID: String? { hostID.isEmpty ? nil : hostID }
  /// Whether a create must name a site: the workspace keeps each site's records apart, so the site decides who sees it.
  var createNeedsSite: Bool { crmDefaultScope(org) != "org" }
  /// The site and the workspace, as the console's site hub sends them; the workspace alone from its own CRM.
  var routeScope: [String: Any?] { hostID.isEmpty ? ["orgId": orgID] : ["hostId": hostID, "orgId": orgID] }
  /// The scope the task routes take: the site, or the workspace from its own CRM (`crmTaskCallScope`).
  var taskScope: [String: Any?] { orgLevel ? ["orgId": orgID] : ["hostId": hostID] }

  static func == (a: CrmScope, b: CrmScope) -> Bool {
    a.orgID == b.orgID && a.hostID == b.hostID && a.orgLevel == b.orgLevel && a.uid == b.uid && a.role == b.role
      && a.permissions == b.permissions && a.readTokens == b.readTokens
      && a.createTokens == b.createTokens && a.suite == b.suite && a.orgWide == b.orgWide
  }

  /// `orgLevel`: the workspace's CRM, `hostID` then the site new records go to. An org-wide reader reads with no scope
  /// clause (`readTokens` empty); anyone else reads what their own tokens reach.
  init(
    orgID: String, hostID: String, uid: String, org: [String: Any]?, member: [String: Any]?, orgLevel: Bool = false
  ) {
    let role = member?["role"] as? String
    // Reach, not a permission: no key grants a collaborator the sites they were not given (`isOrgWideMember`).
    let orgWide = ["owner", "admin"].contains(role ?? "") || member?["allHosts"] as? Bool == true
    let group = consentGroupForHost(org, hostID)
    var read = crmReadTokens(group)
    if orgLevel {
      read = orgWide ? [] : Array(((member?["scopeTokens"] as? [String]) ?? [orgScopeToken]).prefix(maxScopeHosts))
    } else if group.declared && !orgWide, let held = member?["scopeTokens"] as? [String] {
      read = read.filter { $0 == orgScopeToken || held.contains($0) }
    }
    self.orgID = orgID
    self.hostID = hostID
    self.orgLevel = orgLevel
    // At the workspace's level a contact shows its shared record, not one site's holder facet.
    self.groupID = orgLevel ? "" : group.groupID
    self.uid = uid
    self.role = role
    self.permissions = memberPermissions(ContractValues.shared.orgRoleGrants, member: member, orgRole: role)
    self.orgWide = orgWide
    self.readTokens = read
    self.createTokens = crmCreateTokens(org, hostID)
    self.suite = crmSuiteCarried(org)
    self.org = org ?? [:]
    self.member = member
  }

  /// The same member's CRM on one site: what a record is created under, and a record's own site.
  func forSite(_ site: String) -> CrmScope { CrmScope(orgID: orgID, hostID: site, uid: uid, org: org, member: member) }

  /// This scope, stamping what a record of no site is already visible to.
  func stamping(_ tokens: [String]) -> CrmScope {
    var copy = self
    copy.createTokens = tokens
    return copy
  }
}

/// The scope a record's own page works in (the Kotlin `recordScope`): from the whole workspace's CRM, the site the
/// record came from (its tasks, notes and emails belong there), else the workspace's, stamping what the record itself
/// is visible to.
func recordScope(_ scope: CrmScope, _ data: [String: Any]) -> CrmScope {
  guard scope.orgLevel else { return scope }
  if let site = crmRecordSite(data) { return scope.forSite(site) }
  let visibleTo = (data["visibleTo"] as? [Any])?.compactMap { $0 as? String } ?? []
  return scope.stamping(visibleTo.isEmpty ? [orgScopeToken] : visibleTo)
}

/// The scope, live: the org document and the member's own row.
@MainActor
@Observable
final class CrmScopeModel {
  private(set) var scope: CrmScope?
  private(set) var failed = false
  @ObservationIgnored private let org = ObservedDocument()
  @ObservationIgnored private let member = ObservedDocument()
  @ObservationIgnored private var ids: (String, String, String)?

  @ObservationIgnored private var orgLevel = false

  /// `orgLevel`: the workspace's CRM, `hostID` the site new records are filed under.
  func start(_ reader: FirestoreReader, orgID: String, hostID: String, uid: String, orgLevel: Bool = false) {
    self.orgLevel = orgLevel
    ids = (orgID, hostID, uid)
    org.start(reader, ["orgs", orgID])
    member.start(reader, ["orgs", orgID, "members", uid])
    observe()
  }

  private func observe() {
    withObservationTracking {
      _ = org.document
      _ = org.ready
      _ = member.document
      _ = member.ready
      _ = org.failed
    } onChange: { [weak self] in
      Task { @MainActor in self?.observe() }
    }
    guard let ids else { return }
    failed = org.failed
    if org.ready && member.ready {
      scope = CrmScope(
        orgID: ids.0, hostID: ids.1, uid: ids.2, org: org.document?.data, member: member.document?.data, orgLevel: orgLevel)
    }
  }

  func stop() {
    org.stop()
    member.stop()
  }
}
