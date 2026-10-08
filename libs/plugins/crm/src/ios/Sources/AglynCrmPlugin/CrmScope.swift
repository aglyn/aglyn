// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import Observation

/*
 * WHO IS READING THE CRM, AND WHAT THEY STAMP (the console's `useCrmScope`;
 * the Kotlin plugin's `CrmScope.kt`, rule for rule, replayed against the
 * console's own answers).
 */

let orgScopeToken = "org"
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

func crmDefaultScope(_ org: [String: Any]?) -> String? {
  if let own = (org?["crm"] as? [String: Any])?["defaultRecordScope"] as? String, own == "org" || own == "host" { return own }
  if let legacy = org?["defaultResourceScope"] as? String, legacy == "org" || legacy == "host" { return legacy }
  return nil
}

func crmScopeTokens(_ org: [String: Any]?, _ group: ConsentGroup) -> [String] {
  crmDefaultScope(org) == "org" ? [orgScopeToken] : group.hostIDs.map(hostScopeToken)
}

func crmReadTokens(_ group: ConsentGroup) -> [String] {
  Array(([orgScopeToken] + group.hostIDs.map(hostScopeToken)).prefix(maxScopeHosts))
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

/// The CRM as this member sees it from the picked site.
struct CrmScope: Equatable {
  let orgID: String
  let hostID: String
  /// The holder a contact's own fields are kept under: the site's consent group.
  let groupID: String
  let uid: String
  let role: String?
  let orgWide: Bool
  let readTokens: [String]
  let createTokens: [String]
  let suite: Bool
  let org: [String: Any]

  var canWrite: Bool { ["owner", "admin", "editor"].contains(role ?? "") }
  var canManage: Bool { ["owner", "admin"].contains(role ?? "") }
  var routeScope: [String: Any?] { ["hostId": hostID, "orgId": orgID] }

  static func == (a: CrmScope, b: CrmScope) -> Bool {
    a.orgID == b.orgID && a.hostID == b.hostID && a.uid == b.uid && a.role == b.role && a.readTokens == b.readTokens
      && a.createTokens == b.createTokens && a.suite == b.suite && a.orgWide == b.orgWide
  }

  init(
    orgID: String, hostID: String, uid: String, org: [String: Any]?, member: [String: Any]?
  ) {
    let role = member?["role"] as? String
    let orgWide = ["owner", "admin"].contains(role ?? "") || member?["allHosts"] as? Bool == true
    let group = consentGroupForHost(org, hostID)
    var read = crmReadTokens(group)
    if group.declared && !orgWide, let held = member?["scopeTokens"] as? [String] {
      read = read.filter { $0 == orgScopeToken || held.contains($0) }
    }
    self.orgID = orgID
    self.hostID = hostID
    self.groupID = group.groupID
    self.uid = uid
    self.role = role
    self.orgWide = orgWide
    self.readTokens = read
    self.createTokens = crmScopeTokens(org, group)
    self.suite = crmSuiteCarried(org)
    self.org = org ?? [:]
  }
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

  func start(_ reader: FirestoreReader, orgID: String, hostID: String, uid: String) {
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
      scope = CrmScope(orgID: ids.0, hostID: ids.1, uid: ids.2, org: org.document?.data, member: member.document?.data)
    }
  }

  func stop() {
    org.stop()
    member.stop()
  }
}
