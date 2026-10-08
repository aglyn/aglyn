// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import Foundation

/*
 * THE CRM'S RECORDS (the Kotlin plugin's `CrmRecords.kt`): each object one
 * collection under `orgs/{orgId}`, listed by the console's own declaration
 * through the shared planner with the reader's `visibleTo` as the base; a
 * record's fields described once, drawing the detail and the edit sheet and
 * turning the sheet into the write.
 */

enum CrmKind: String, CaseIterable, Identifiable {
  case contact, lead, company, deal
  var id: String { rawValue }

  var collection: String {
    switch self {
    case .contact: "contacts"
    case .lead: "leads"
    case .company: "companies"
    case .deal: "deals"
    }
  }

  var singular: String { rawValue.capitalized }
  var plural: String {
    switch self {
    case .company: "Companies"
    default: "\(singular)s"
    }
  }

  var symbol: String {
    switch self {
    case .contact: "person"
    case .lead: "person.badge.plus"
    case .company: "building.2"
    case .deal: "dollarsign.circle"
    }
  }

  var detailScreen: String { "crm.\(rawValue)" }
  var param: String { rawValue }
  var linkField: String { "\(rawValue)Id" }

  var declaration: ListQueryDeclaration {
    let values = ContractValues.shared
    switch self {
    case .contact: return values.contactListDeclaration
    case .lead: return values.leadListDeclaration
    case .company: return values.companyListDeclaration
    case .deal: return values.dealListDeclaration
    }
  }
}

func crmPath(_ orgID: String, _ collection: String) -> [String] { ["orgs", orgID, collection] }

func scopeBase(_ scope: CrmScope) -> [ListQueryFilter] {
  [ListQueryFilter(op: .arrayContainsAny, path: "visibleTo", value: .array(scope.readTokens.map { .string($0) }))]
}

/// A scoped collection read, as every CRM listener asks it.
func scopedQuery(
  _ scope: CrmScope, _ collection: String, filters: [ListQueryConstraint] = [], order: [FirestoreQuery.Order] = [],
  limit: Int = 200
) -> FirestoreQuery {
  FirestoreQuery(
    crmPath(scope.orgID, collection),
    filters: [ListQueryConstraint(path: "visibleTo", op: .arrayContainsAny, value: scope.readTokens)] + filters,
    order: order, limit: limit)
}

struct CrmFilter: Identifiable, Equatable {
  let id: String
  let label: String
  var clauses: [ListFilterRequest] = []
}

func facetKeyValue(_ value: String) -> String {
  String(value.trimmingCharacters(in: .whitespacesAndNewlines).split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased().prefix(120))
}

let leadStatuses: [String] = ContractValues.shared.nativeCrmLeadStatuses
func leadStatusLabel(_ status: String) -> String { ContractValues.shared.crmLeadStatusLabels[status] ?? status.capitalized }
let lifecycleStages: [String] = ContractValues.shared.nativeContactLifecycleStages
func stageLabel(_ stage: String?) -> String? { stage.map { ContractValues.shared.contactLifecycleStageLabels[$0] ?? $0 } }

func crmFilters(_ kind: CrmKind, _ scope: CrmScope) -> [CrmFilter] {
  let mine = ListFilterRequest(field: "ownerUid", op: "equals", value: scope.uid)
  switch kind {
  case .lead:
    return [
      CrmFilter(
        id: "open", label: "Open",
        clauses: [ListFilterRequest(field: "status", op: "isAnyOf", value: ContractValues.shared.nativeCrmLeadOpenStatuses.joined(separator: ","))]),
      CrmFilter(id: "all", label: "All"),
    ] + leadStatuses.map { CrmFilter(id: $0, label: leadStatusLabel($0), clauses: [ListFilterRequest(field: "status", op: "equals", value: $0)]) }
      + [CrmFilter(id: "mine", label: "Mine", clauses: [mine])]
  case .contact:
    return [
      CrmFilter(id: "all", label: "All"),
      CrmFilter(
        id: "mine", label: "Mine",
        clauses: [ListFilterRequest(field: "facetKeys", op: "contains", value: "\(scope.groupID):owner=\(facetKeyValue(scope.uid))")]),
    ] + lifecycleStages.map {
      CrmFilter(
        id: $0, label: stageLabel($0) ?? $0,
        clauses: [ListFilterRequest(field: "facetKeys", op: "contains", value: "\(scope.groupID):stage=\(facetKeyValue($0))")])
    }
  case .company:
    return [
      CrmFilter(id: "all", label: "All"),
      CrmFilter(id: "mine", label: "Mine", clauses: [mine]),
      CrmFilter(id: "no-next", label: "No next activity", clauses: [ListFilterRequest(field: "nextTaskAtMs", op: "isEmpty", value: "")]),
    ]
  case .deal:
    return ["open", "won", "lost"].map {
      CrmFilter(id: $0, label: $0.capitalized, clauses: [ListFilterRequest(field: "status", op: "equals", value: $0)])
    } + [CrmFilter(id: "all", label: "All")]
  }
}

/// The list's plan, as `useCrmListQuery` builds it (see the Kotlin `crmListPlan`).
func crmListPlan(_ kind: CrmKind, _ scope: CrmScope, _ filter: CrmFilter, search: String) -> ListQueryPlan {
  var declaration = kind.declaration
  if !scope.orgWide, var search = declaration.search, search.scoped != nil {
    search.scoped = nil
    declaration.search = search
  }
  let words = search.trimmingCharacters(in: .whitespacesAndNewlines)
  let asked = words.isEmpty ? nil : [words]
  let impliesScope = { (clause: ListFilterRequest) in
    kind == .contact && clause.field == "facetKeys" && clause.value.hasPrefix("\(scope.groupID):")
  }
  if scope.orgWide && filter.clauses.contains(where: impliesScope) {
    let trial = planListQuery(declaration, ListQueryRequest(clauses: filter.clauses, search: asked))
    if trial.served.contains(where: impliesScope) { return trial }
  }
  return planListQuery(declaration, ListQueryRequest(base: scopeBase(scope), clauses: filter.clauses, search: asked))
}

func crmListQuery(_ kind: CrmKind, _ scope: CrmScope, _ filter: CrmFilter, search: String, limit: Int) -> FirestoreQuery {
  crmListPlan(kind, scope, filter, search: search).firestoreQuery(crmPath(scope.orgID, kind.collection), limit: limit)
}

// MARK: Fields

enum Stored { case text, cents, millis, day, number, bool }

struct CrmField: Identifiable {
  let spec: FieldSpec
  var path: String
  var stored: Stored = .text
  var editable = true
  var id: String { spec.key }

  init(_ spec: FieldSpec, path: String? = nil, stored: Stored = .text, editable: Bool = true) {
    self.spec = spec
    self.path = path ?? spec.key
    self.stored = stored
    self.editable = editable
  }
}

struct Picklists {
  var stored: [String: [(label: String, active: Bool)]] = [:]

  func labels(_ id: String) -> [String] {
    if let values = stored[id] { return values.filter(\.active).map(\.label) }
    return ContractValues.shared.nativeCrmPicklists.first { $0.id == id }?.standardLabels ?? []
  }

  func options(_ id: String) -> [FieldOption] { labels(id).map { FieldOption($0, $0) } }

  init(stored: [String: [(label: String, active: Bool)]] = [:]) { self.stored = stored }

  init(_ docs: [FirestoreDocument]) {
    for doc in docs {
      stored[doc.id] = (doc.data["values"] as? [[String: Any]] ?? []).compactMap { value in
        guard let label = value["label"] as? String else { return nil }
        return (label, (value["active"] as? Bool) != false)
      }
    }
  }
}

struct CrmMember: Identifiable, Hashable {
  let uid: String
  let label: String
  let email: String?
  var id: String { uid }
}

private func text(_ key: String, _ label: String, _ kind: FieldKind = .text, required: Bool = false) -> CrmField {
  CrmField(FieldSpec(key, label, kind: kind, required: required))
}

func standardFields(
  _ kind: CrmKind, picklists: Picklists, members: [CrmMember], companies: [FieldOption], contacts: [FieldOption]
) -> [CrmField] {
  func picklist(_ key: String, _ label: String, _ id: String) -> CrmField {
    CrmField(FieldSpec(key, label, kind: .select, options: picklists.options(id)))
  }
  let owner = CrmField(FieldSpec("ownerUid", "Owner", kind: .select, options: members.map { FieldOption($0.uid, $0.label) }, emptyLabel: "No owner"))
  let email = CrmField(FieldSpec("email", "Email", kind: .email, required: true), editable: false)
  let company = CrmField(FieldSpec("companyId", "Company", kind: .select, options: companies, emptyLabel: "No company"))
  let revenue = CrmField(FieldSpec("annualRevenue", "Annual revenue", kind: .money), path: "annualRevenueCents", stored: .cents)
  let employees = CrmField(FieldSpec("numberOfEmployees", "Employees", kind: .number), stored: .number)
  let notes = text("notes", "Notes", .multiline)
  switch kind {
  case .lead:
    return [
      text("name", "Name"), email, picklist("salutation", "Salutation", "salutation"), text("firstName", "First name"),
      text("lastName", "Last name"), text("company", "Company"), text("jobTitle", "Title"), text("phone", "Phone", .phone),
      text("mobilePhone", "Mobile", .phone), text("fax", "Fax", .phone), text("website", "Website", .url),
      picklist("leadSource", "Lead source", "leadSource"), picklist("industry", "Industry", "industry"),
      picklist("rating", "Rating", "rating"), revenue, employees, owner,
      CrmField(FieldSpec("doNotCall", "Do not call", kind: .toggle), stored: .bool), notes,
    ]
  case .contact:
    return [
      text("name", "Name"), email, picklist("salutation", "Salutation", "salutation"), text("firstName", "First name"),
      text("lastName", "Last name"), text("jobTitle", "Title"), text("department", "Department"), company,
      text("phone", "Phone", .phone), text("mobilePhone", "Mobile", .phone), text("homePhone", "Home phone", .phone),
      text("otherPhone", "Other phone", .phone), text("fax", "Fax", .phone),
      CrmField(FieldSpec("birthdate", "Birthdate", kind: .date), stored: .day), text("assistantName", "Assistant"),
      text("assistantPhone", "Assistant phone", .phone), picklist("leadSource", "Lead source", "leadSource"), owner,
      CrmField(FieldSpec("doNotCall", "Do not call", kind: .toggle), stored: .bool), notes,
    ]
  case .company:
    return [
      text("name", "Name", required: true), text("domain", "Domain"), text("website", "Website", .url),
      text("phone", "Phone", .phone), picklist("type", "Type", "accountType"), picklist("industry", "Industry", "industry"),
      picklist("rating", "Rating", "rating"), picklist("ownership", "Ownership", "ownership"),
      picklist("accountSource", "Account source", "leadSource"), revenue, employees, text("accountNumber", "Account number"),
      text("site", "Account site"), text("tickerSymbol", "Ticker symbol"), text("sicCode", "SIC code"),
      text("fax", "Fax", .phone),
      CrmField(FieldSpec("parentCompanyId", "Parent company", kind: .select, options: companies, emptyLabel: "None")), owner,
      notes,
    ]
  case .deal:
    return [
      text("title", "Name", required: true),
      CrmField(FieldSpec("amount", "Amount", kind: .money), path: "amountCents", stored: .cents),
      CrmField(FieldSpec("expectedClose", "Close date", kind: .date), path: "expectedCloseAtMs", stored: .millis),
      CrmField(FieldSpec("contactId", "Primary contact", kind: .select, options: contacts, emptyLabel: "No contact")), company,
      picklist("type", "Type", "opportunityType"), picklist("leadSource", "Lead source", "leadSource"),
      text("nextStep", "Next step"), CrmField(FieldSpec("probability", "Probability (%)", kind: .number), stored: .number), owner,
      notes,
    ]
  }
}

struct CustomFieldDefinition: Identifiable, Equatable {
  let id: String
  let key: String
  let label: String
  let type: String
  let options: [String]
  let required: Bool
  let order: Int
  let retired: Bool
  let object: String
}

func customField(_ doc: FirestoreDocument) -> CustomFieldDefinition {
  CustomFieldDefinition(
    id: doc.id, key: doc.string("key") ?? doc.id, label: doc.string("label") ?? doc.string("key") ?? doc.id,
    type: doc.string("type") ?? "text",
    options: (doc.data["options"] as? [Any] ?? []).compactMap { ($0 as? String) ?? (($0 as? [String: Any])?["label"] as? String) },
    required: doc.bool("required") == true, order: doc.int("order") ?? 0,
    retired: doc.data["retiredAt"] != nil && !(doc.data["retiredAt"] is NSNull), object: doc.string("object") ?? "contact")
}

func customFieldsOf(_ kind: CrmKind, _ definitions: [CustomFieldDefinition]) -> [CrmField] {
  definitions.filter { !$0.retired && $0.object == kind.rawValue }.sorted { $0.order < $1.order }.map { def in
    let fieldKind: FieldKind =
      switch def.type {
      case "number": .number
      case "date": .date
      case "select": .select
      case "checkbox": .toggle
      case "url": .url
      default: .text
      }
    let stored: Stored =
      switch def.type {
      case "number": .number
      case "date": .day
      case "checkbox": .bool
      default: .text
      }
    return CrmField(
      FieldSpec("custom.\(def.key)", def.label, kind: fieldKind, required: def.required, options: def.options.map { FieldOption($0, $0) }),
      path: "custom.\(def.key)", stored: stored)
  }
}

func millis(_ raw: Any?) -> Int64? { epochMillis(raw) }

func displayValue(_ field: CrmField, _ raw: Any?) -> String {
  switch field.stored {
  case .cents:
    guard let cents = (raw as? NSNumber)?.doubleValue else { return "" }
    let value = cents / 100
    return value.rounded() == value ? String(Int64(value)) : String(value)
  case .millis:
    return millis(raw).map { isoDayString(Date(timeIntervalSince1970: Double($0) / 1000)) } ?? ""
  case .day: return raw as? String ?? ""
  case .number:
    guard let number = raw as? NSNumber else { return "" }
    return number.doubleValue.rounded() == number.doubleValue ? String(number.int64Value) : String(number.doubleValue)
  case .bool:
    guard let number = raw as? NSNumber else { return "" }
    return number.boolValue ? "true" : "false"
  case .text:
    switch raw {
    case let string as String: return string
    case let array as [Any]: return array.map { "\($0)" }.joined(separator: ", ")
    case nil, is NSNull: return ""
    default: return "\(raw!)"
    }
  }
}

func valueAt(_ data: [String: Any], _ path: String) -> Any? {
  var at: Any? = data
  for part in path.split(separator: ".") { at = (at as? [String: Any])?[String(part)] }
  return at
}

func formValues(_ fields: [CrmField], _ data: [String: Any]) -> [String: String] {
  Dictionary(uniqueKeysWithValues: fields.map { ($0.spec.key, displayValue($0, valueAt(data, $0.path))) })
}

func storedValue(_ field: CrmField, _ value: String) -> Any? {
  let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
  if text.isEmpty { return nil }
  switch field.stored {
  case .text, .day: return text
  case .cents:
    return Double(text.replacingOccurrences(of: "$", with: "").replacingOccurrences(of: ",", with: "")).map { Int64(($0 * 100).rounded()) }
  case .millis: return isoDay(text).map { Int64($0.timeIntervalSince1970 * 1000) + 12 * 3_600_000 }
  case .number: return Int64(text) as Any? ?? Double(text)
  case .bool: return text == "true"
  }
}

private func setPath(_ into: inout [String: Any], _ path: [String], _ value: Any) {
  guard let first = path.first else { return }
  if path.count == 1 {
    into[first] = value
  } else {
    var nested = into[first] as? [String: Any] ?? [:]
    setPath(&nested, Array(path.dropFirst()), value)
    into[first] = nested
  }
}

/// The changes an edit writes: each changed field at its stored path, a cleared one deleted.
func changedFields(_ fields: [CrmField], before: [String: String], after: [String: String]) -> [String: Any] {
  var out: [String: Any] = [:]
  for field in fields where field.editable {
    let old = (before[field.spec.key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let new = (after[field.spec.key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if old == new { continue }
    setPath(&out, field.path.split(separator: ".").map(String.init), storedValue(field, new) ?? FirestoreSentinel.delete)
  }
  return out
}

func createdFields(_ fields: [CrmField], _ values: [String: String]) -> [String: Any] {
  var out: [String: Any] = [:]
  for field in fields where field.editable {
    if let value = storedValue(field, values[field.spec.key] ?? "") {
      setPath(&out, field.path.split(separator: ".").map(String.init), value)
    }
  }
  return out
}

// MARK: Rows

struct CrmRow: Identifiable {
  let id: String
  let kind: CrmKind
  let title: String
  let subtitle: String
  let chip: String?
  let data: [String: Any]

  var tone: AglynTone {
    switch kind {
    case .lead:
      switch data["status"] as? String {
      case "qualified": .success
      case "unqualified": .neutral
      case "nurturing": .warning
      default: .info
      }
    case .deal: data["status"] as? String == "won" ? .success : data["status"] as? String == "lost" ? .error : .neutral
    case .contact: data["lifecycleStage"] as? String == "customer" ? .success : .info
    case .company: .neutral
    }
  }
}

/// A contact's own fields for this viewer: the holder's facet over the shared record.
func contactView(_ data: [String: Any], groupID: String) -> [String: Any] {
  let facet = (data["facets"] as? [String: Any])?[groupID] as? [String: Any] ?? [:]
  var merged = data
  for (key, value) in facet where !(value is NSNull) { merged[key] = value }
  if let name = facet["name"] as? String, !name.isEmpty { merged["name"] = name } else { merged["name"] = data["name"] }
  return merged
}

func formatCents(_ cents: Int64, currency: String? = "usd") -> String {
  let value = Double(cents) / 100
  let code = (currency ?? "usd").uppercased()
  return value.formatted(.currency(code: code).precision(.fractionLength(value.rounded() == value ? 0 : 2)))
}

func crmRow(_ kind: CrmKind, _ doc: FirestoreDocument, _ scope: CrmScope, stages: [String: String] = [:]) -> CrmRow {
  let data = kind == .contact ? contactView(doc.data, groupID: scope.groupID) : doc.data
  func s(_ key: String) -> String? { (data[key] as? String).flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 } }
  switch kind {
  case .lead:
    return CrmRow(
      id: doc.id, kind: kind, title: s("name") ?? s("email") ?? "Lead",
      subtitle: [s("email") == s("name") ? nil : s("email"), s("company")].compactMap { $0 }.joined(separator: " · "),
      chip: s("statusLabel") ?? s("status").map(leadStatusLabel), data: data)
  case .contact:
    return CrmRow(
      id: doc.id, kind: kind, title: s("name") ?? s("email") ?? "Contact",
      subtitle: [s("email") == s("name") ? nil : s("email"), s("companyName"), s("jobTitle")].compactMap { $0 }.joined(separator: " · "),
      chip: stageLabel(s("lifecycleStage")), data: data)
  case .company:
    let count = (data["contactsCount"] as? NSNumber)?.intValue ?? 0
    return CrmRow(
      id: doc.id, kind: kind, title: s("name") ?? "Company",
      subtitle: [s("domain"), s("industry"), count > 0 ? (count == 1 ? "1 contact" : "\(count) contacts") : nil].compactMap { $0 }
        .joined(separator: " · "),
      chip: s("type"), data: data)
  case .deal:
    let amount = (data["amountCents"] as? NSNumber).map { formatCents($0.int64Value, currency: s("currency")) }
    let stage = s("stageId").map { stages[$0] ?? $0 }
    let status = s("status")
    return CrmRow(
      id: doc.id, kind: kind, title: s("title") ?? "Deal", subtitle: [amount, stage].compactMap { $0 }.joined(separator: " · "),
      chip: status == "won" ? "Won" : status == "lost" ? "Lost" : nil, data: data)
  }
}

// MARK: Pipelines

struct Stage: Identifiable, Hashable {
  let id: String
  let name: String
  let order: Int
  let probability: Int
  let kind: String
  let forecastCategory: String?
}

struct Pipeline: Identifiable, Hashable {
  let id: String
  let name: String
  let stages: [Stage]
  let isDefault: Bool
  let archived: Bool

  var openStages: [Stage] { stages.filter { $0.kind == "open" } }

  static var standard: Pipeline {
    Pipeline(
      id: "default", name: "Sales",
      stages: ContractValues.shared.defaultDealStages.map {
        Stage(
          id: $0.id, name: $0.name, order: Int($0.order), probability: Int($0.probability), kind: $0.kind.rawValue,
          forecastCategory: $0.forecastCategory?.rawValue)
      }, isDefault: true, archived: false)
  }
}

func pipelineOf(_ doc: FirestoreDocument) -> Pipeline {
  Pipeline(
    id: doc.id, name: doc.string("name") ?? "Pipeline",
    stages: (doc.data["stages"] as? [[String: Any]] ?? []).compactMap { stage in
      guard let id = stage["id"] as? String else { return nil }
      return Stage(
        id: id, name: stage["name"] as? String ?? "Stage", order: (stage["order"] as? NSNumber)?.intValue ?? 0,
        probability: (stage["probability"] as? NSNumber)?.intValue ?? 0, kind: stage["kind"] as? String ?? "open",
        forecastCategory: stage["forecastCategory"] as? String)
    }.sorted { $0.order < $1.order },
    isDefault: doc.bool("isDefault") == true, archived: doc.data["archivedAt"] != nil && !(doc.data["archivedAt"] is NSNull))
}

/// A new document id, as `createResourceUid` mints them.
func newRecordID() -> String {
  let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
  return String((0..<20).map { _ in alphabet.randomElement()! })
}
