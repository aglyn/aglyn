// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import Foundation

/*
 * WHO AND WHAT AN ACTIVITY IS ABOUT, AS THE LOG SHEET ASKS IT (the console's
 * `crm-activity-link.ts`; the Kotlin plugin's `CrmLinks.kt`). **Name** is the
 * contact the entry was with, **Related To** the deal or company it is about,
 * and the company it rolls up to is stamped from them when it is written
 * (`crmActivityCompanyID`). Each rule is replayed against the console's own
 * answers (function-cases.generated.json).
 */

/// What **Related To** names: one company or one deal (`CrmActivityRelated`).
struct CrmRelated: Hashable {
  enum Kind: String { case company, deal }
  let kind: Kind
  let id: String

  /// The record as a picker's row key, `deal:{id}` or `company:{id}`.
  var key: String { "\(kind.rawValue):\(id)" }

  init(kind: Kind, id: String) {
    self.kind = kind
    self.id = id
  }

  init?(key: String) {
    let parts = key.split(separator: ":", maxSplits: 1).map(String.init)
    guard parts.count == 2, let kind = Kind(rawValue: parts[0]), !parts[1].isEmpty else { return nil }
    self.init(kind: kind, id: parts[1])
  }
}

/// The log sheet's two fields as a person leaves them (`CrmActivityPicks`).
struct CrmActivityPicks: Equatable {
  /// **Name**: the contact it was with.
  var contactID: String?
  /// **Related To**.
  var related: CrmRelated?

  /// An activity attached to nothing is a sentence nobody can find.
  var linked: Bool { contactID != nil || related != nil }
}

/// A stored id, or nil for anything that is not one.
private func storedID(_ value: Any?) -> String? {
  let id = (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  return id.isEmpty ? nil : id
}

/// The fields as they open on a record's links (`crmActivityPicksFrom`): a deal outranks the company stamped beside it,
/// and opened from a deal, **Name** defaults to the deal's Primary.
func crmActivityPicksFrom(_ link: [String: Any], primaryContactID: String? = nil) -> CrmActivityPicks {
  let deal = storedID(link["dealId"])
  let company = storedID(link["companyId"])
  return CrmActivityPicks(
    contactID: storedID(link["contactId"]) ?? storedID(primaryContactID),
    related: deal.map { CrmRelated(kind: .deal, id: $0) } ?? company.map { CrmRelated(kind: .company, id: $0) })
}

/// The links the fields name, before the company is stamped (`crmActivityLinkFromPicks`). A lead's own log keeps its lead.
func crmActivityLinkFromPicks(_ picks: CrmActivityPicks, leadID: String? = nil) -> [String: String] {
  var links: [String: String] = [:]
  if let contact = picks.contactID, !contact.isEmpty { links["contactId"] = contact }
  if let related = picks.related { links[related.kind == .deal ? "dealId" : "companyId"] = related.id }
  if let leadID, !leadID.isEmpty { links["leadId"] = leadID }
  return links
}

/// One row a record picker offers: its key, the name it shows, and the heading it is listed under ("" for none).
struct CrmPickOption: Identifiable, Hashable {
  let key: String
  let label: String
  let group: String
  var id: String { key }
}

/// Where **Related To** lists its rows (`CRM_RELATED_TO_GROUPS`).
enum CrmRelatedToGroup {
  static let openDeals = "Open deals"
  static let companies = "Companies"
  static let deals = "Deals"
}

/// Names in the order the console's menus list them (`localeCompare`): letters before case.
func crmLabelOrder(_ a: String, _ b: String) -> Bool {
  a.compare(b, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedAscending
}

/// What **Related To** offers, in its menu's order (`crmRelatedToOptions`): the open deals that name the person or the
/// company, each once, then the companies, then every other deal, each group by name. A row is never blank.
func crmRelatedToOptions(
  linkedDeals: [FirestoreDocument], deals: [FirestoreDocument], companies: [FirestoreDocument]
) -> [CrmPickOption] {
  func text(_ doc: FirestoreDocument, _ field: String) -> String { doc.data[field] as? String ?? "" }
  var open: [String: CrmPickOption] = [:]
  var order: [String] = []
  for deal in linkedDeals where deal.data["status"] as? String == "open" {
    if open[deal.id] == nil { order.append(deal.id) }
    let title = text(deal, "title")
    open[deal.id] = CrmPickOption(
      key: CrmRelated(kind: .deal, id: deal.id).key, label: title.isEmpty ? "Untitled deal" : title, group: CrmRelatedToGroup.openDeals)
  }
  func named(_ doc: FirestoreDocument, _ field: String) -> String {
    let value = text(doc, field)
    return value.isEmpty ? doc.id : value
  }
  let listed = companies.map {
    CrmPickOption(key: CrmRelated(kind: .company, id: $0.id).key, label: named($0, "name"), group: CrmRelatedToGroup.companies)
  }
  let others = deals.filter { open[$0.id] == nil }.map {
    CrmPickOption(key: CrmRelated(kind: .deal, id: $0.id).key, label: named($0, "title"), group: CrmRelatedToGroup.deals)
  }
  let byLabel = { (a: CrmPickOption, b: CrmPickOption) in crmLabelOrder(a.label, b.label) }
  return order.compactMap { open[$0] }.sorted(by: byLabel) + listed.sorted(by: byLabel) + others.sorted(by: byLabel)
}

/// What **Name** offers (the console's contact picker): a deal's contact roles first under "On this deal", then every
/// other contact under "All contacts"; with no roles to pin, one list by name.
func crmNameOptions(pinned: [CrmPickOption], contacts: [FieldOption]) -> [CrmPickOption] {
  let held = Set(pinned.map(\.key))
  let rest = contacts.filter { !held.contains($0.value) }.map { CrmPickOption(key: $0.value, label: $0.label, group: pinned.isEmpty ? "" : "All contacts") }
    .sorted { crmLabelOrder($0.label, $1.label) }
  return pinned.map { CrmPickOption(key: $0.key, label: $0.label, group: "On this deal") } + rest
}

/// The deals that name a person or a company, for **Related To**'s first group (the console's `useLinkedDeals` and
/// `useContactRoleDeals`): a contact's as Primary and in any role, and the company's. A contact's other roles are asked
/// only by a reader the rules let skip the scope clause; any other reader reads the deals that name them as Primary.
@MainActor
func crmLinkedDeals(_ reader: FirestoreReader, _ scope: CrmScope, contactID: String?, companyID: String?) async -> [FirestoreDocument] {
  let recent: [FirestoreQuery.Order] = [.init("updatedAt", descending: true)]
  var queries: [FirestoreQuery] = []
  if let contactID {
    queries.append(scopedQuery(scope, "deals", filters: [ListQueryConstraint(path: "contactId", op: .equal, value: contactID)], order: recent, limit: 25))
    if scope.orgLevel && scope.readTokens.isEmpty {
      queries.append(
        FirestoreQuery(
          crmPath(scope.orgID, "deals"), filters: [ListQueryConstraint(path: "contactRoleContactIds", op: .arrayContains, value: contactID)],
          order: recent, limit: 25))
    } else if scope.orgWide, !scope.readTokens.isEmpty {
      let join = ContractValues.shared.scopedSearchJoin
      queries.append(
        FirestoreQuery(
          crmPath(scope.orgID, "deals"),
          filters: [
            ListQueryConstraint(
              path: "scopedContactRoleContactIds", op: .arrayContainsAny, value: scope.readTokens.prefix(maxScopeHosts).map { "\($0)\(join)\(contactID)" })
          ], order: recent, limit: 25))
    }
  }
  if let companyID {
    queries.append(scopedQuery(scope, "deals", filters: [ListQueryConstraint(path: "companyId", op: .equal, value: companyID)], order: recent, limit: 25))
  }
  var deals: [FirestoreDocument] = []
  for query in queries {
    // A list this reader may not run costs the menu its lead rows, never the sheet.
    deals += (try? await reader.readOnce(query)) ?? []
  }
  return deals
}

// MARK: The marketing opt-in

/// The sentence a capture surface shows beside an opt-in for a declared group (`consentGroupDisclosure`), or nil.
func consentGroupDisclosure(_ group: ConsentGroup) -> String? {
  guard group.declared, let name = group.name, !name.isEmpty else { return nil }
  return "You'll receive marketing email from \(name), which covers \(group.hostIDs.count) sites."
}

/// A string as `JSON.stringify` writes it: quotes, the backslash and control characters escaped, the rest as is.
private func jsonStringLiteral(_ text: String) -> String {
  var out = "\""
  for scalar in text.unicodeScalars {
    switch scalar.value {
    case 0x22: out += "\\\""
    case 0x5C: out += "\\\\"
    case 0x08: out += "\\b"
    case 0x0C: out += "\\f"
    case 0x0A: out += "\\n"
    case 0x0D: out += "\\r"
    case 0x09: out += "\\t"
    case 0..<0x20: out += String(format: "\\u%04x", scalar.value)
    default: out.unicodeScalars.append(scalar)
    }
  }
  return out + "\""
}

/// The fingerprint of the sentence the form showed (`consentGroupDisclosureKey`): FNV-1a over the UTF-16 units of the
/// group's id, name and sorted sites as JSON. The route pools the opt-in across the group only while it still matches.
func consentGroupDisclosureKey(_ group: ConsentGroup) -> String? {
  guard consentGroupDisclosure(group) != nil else { return nil }
  let sites = group.hostIDs.sorted { Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16)) }
  let text = "[\(jsonStringLiteral(group.groupID)),\(jsonStringLiteral(group.name ?? "")),[\(sites.map(jsonStringLiteral).joined(separator: ","))]]"
  var hash: UInt32 = 0x811c_9dc5
  for unit in text.utf16 {
    hash ^= UInt32(unit)
    hash = hash &* 0x0100_0193
  }
  return String(format: "%08x", hash)
}

/// The words under New contact's opt-in box (the console's drawer): why it is off with no address, else the group's
/// sentence, what no source site means, and that adding a contact is never itself consent.
func contactConsentHelp(hasEmail: Bool, group: ConsentGroup?) -> String {
  if !hasEmail { return "Add an email first: there is nowhere to send marketing without one." }
  let disclosure = group.flatMap(consentGroupDisclosure).map { "\($0) " } ?? ""
  let everySite = group == nil ? "With no source site, this records it on every site. " : ""
  return disclosure + everySite + "Tick it only if they agreed. Adding a contact is never itself consent."
}

/// The values key the create form holds the opt-in under; it is never a field of the record.
let contactConsentKey = "marketingConsent"

/// What New contact sends for the opt-in (`contacts-create`): the box, only with an address, and the sentence's key
/// beside a ticked box so the route can pool it across the group the sentence named.
func contactConsentFields(_ values: [String: String], group: ConsentGroup?) -> [String: Any] {
  let hasEmail = !(values["email"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  let consent = hasEmail && values[contactConsentKey] == "true"
  var fields: [String: Any] = ["marketingConsent": consent]
  if consent, let key = group.flatMap(consentGroupDisclosureKey) { fields["disclosedConsentGroup"] = key }
  return fields
}
