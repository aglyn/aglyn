// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * THE PEOPLE ON A DEAL OR A COMPANY, AND THE PART EACH PLAYS: Salesforce's
 * Contact Roles, as the console's Contact roles card keeps them
 * (`deal-contact-roles.ts` and the roles rules of `crm.ts`; the Kotlin
 * plugin's `CrmContactRoles.kt`). A deal names its Primary twice over, in
 * `contactRoles` and as `contactId`; a company holds it on the row. Every
 * edit writes the whole list beside the ids and keys a merge, a delete, an
 * erasure and a rename of a role find the record by. Each rule is replayed
 * against the console's own answers.
 */

/// One contact on a deal or a company (`CrmDealContactRole`).
struct CrmContactRole: Equatable, Identifiable {
  let contactID: String
  /// The `opportunityContactRole` label; nil for a contact with no role yet.
  var role: String?
  var primary: Bool
  var id: String { contactID }

  /// The row as a record stores it.
  var stored: [String: Any] {
    var row: [String: Any] = ["contactId": contactID, "primary": primary]
    if let role { row["role"] = role }
    return row
  }
}

/// The most contacts one record names (`DEAL_CONTACT_ROLES_MAX`).
let crmContactRolesMax = 50
/// The org's list of roles, kept on the Deals tab of Fields.
let crmContactRolePicklist = "opportunityContactRole"

/// A label as a list stores it (`normalizePicklistLabel`): trimmed, single-spaced, capped.
func normalizePicklistLabel(_ value: String?) -> String {
  String((value ?? "").split(whereSeparator: \.isWhitespace).joined(separator: " ").prefix(120))
}

/// A role's key, as a rename finds the records holding it (`crmPicklistKey`); nil for none.
func crmPicklistKey(_ label: String?) -> String? {
  let key = nameSearchKey(normalizePicklistLabel(label))
  return key.isEmpty ? nil : key
}

/// Stored roles, read defensively (`readDealContactRoles`): a row with no usable contact is dropped, a contact named
/// twice keeps its first row, only the first Primary stays Primary, and the list stops at fifty.
func readContactRoles(_ raw: Any?) -> [CrmContactRole] {
  guard let rows = raw as? [Any] else { return [] }
  var roles: [CrmContactRole] = []
  var seen = Set<String>()
  var primaryTaken = false
  for case let row as [String: Any] in rows {
    let id = (row["contactId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if id.isEmpty || id.utf16.count > 200 || id.contains("/") || seen.contains(id) { continue }
    seen.insert(id)
    let role = (row["role"] as? String).map(normalizePicklistLabel) ?? ""
    let primary = (row["primary"] as? Bool) == true && !primaryTaken
    if primary { primaryTaken = true }
    roles.append(CrmContactRole(contactID: id, role: role.isEmpty ? nil : role, primary: primary))
    if roles.count >= crmContactRolesMax { break }
  }
  return roles
}

/// `roles` with `contactID` as the one Primary, added first with no role when the list does not name them; nil for
/// none (`dealContactRolesWithPrimary`).
func contactRolesWithPrimary(_ roles: [CrmContactRole], _ contactID: String?) -> [CrmContactRole] {
  let id = contactID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  var next = roles.map { CrmContactRole(contactID: $0.contactID, role: $0.role, primary: !id.isEmpty && $0.contactID == id) }
  if !id.isEmpty && !next.contains(where: { $0.contactID == id }) { next.insert(CrmContactRole(contactID: id, role: nil, primary: true), at: 0) }
  return Array(next.prefix(crmContactRolesMax))
}

/// The roles a deal holds, in step with its `contactId` (`dealContactRolesOf`): a deal written before roles reads as its
/// one contact, Primary.
func dealContactRolesOf(_ deal: [String: Any]) -> [CrmContactRole] {
  contactRolesWithPrimary(readContactRoles(deal["contactRoles"]), deal["contactId"] as? String)
}

/// The roles a company holds, as stored (`companyContactRolesOf`): its Primary is on the row.
func companyContactRolesOf(_ company: [String: Any]) -> [CrmContactRole] { readContactRoles(company["contactRoles"]) }

func contactRolesPrimary(_ roles: [CrmContactRole]) -> String? { roles.first(where: \.primary)?.contactID }

/// `roles` without one contact (`dealContactRolesWithout`).
func contactRolesWithout(_ roles: [CrmContactRole], _ contactID: String) -> [CrmContactRole] {
  roles.filter { $0.contactID != contactID }
}

/// Why a contact cannot be added, or nil when it can (`dealContactRoleAddProblem`).
func contactRoleAddProblem(_ roles: [CrmContactRole], _ contactID: String, noun: String) -> String? {
  if contactID.isEmpty { return "Pick a contact." }
  if roles.contains(where: { $0.contactID == contactID }) { return "That contact is already on this \(noun)." }
  if roles.count >= crmContactRolesMax { return "A \(noun) names at most \(crmContactRolesMax) contacts." }
  return nil
}

/// `roles` with one contact added, as the Primary when asked (`dealContactRolesAdded`).
func contactRolesAdded(_ roles: [CrmContactRole], contactID: String, role: String?, primary: Bool) -> [CrmContactRole] {
  roles.map { primary ? CrmContactRole(contactID: $0.contactID, role: $0.role, primary: false) : $0 }
    + [CrmContactRole(contactID: contactID, role: role.flatMap { $0.isEmpty ? nil : $0 }, primary: primary)]
}

/// `roles` with one contact's role set, "" for none (`dealContactRolesWithRole`).
func contactRolesWithRole(_ roles: [CrmContactRole], _ contactID: String, _ role: String) -> [CrmContactRole] {
  roles.map { $0.contactID == contactID ? CrmContactRole(contactID: $0.contactID, role: role.isEmpty ? nil : role, primary: $0.primary) : $0 }
}

/// Why a save was refused, in the console's words.
struct CrmContactRoleRefusal: Error, Equatable { let message: String }

/// Each role judged against the org's list (`judgeDealContactRoles`): an active value stored as the list spells it, a
/// blank cleared, and the role a contact already holds kept; anything else refused, naming what the list allows.
func judgeContactRoles(
  _ values: [(label: String, active: Bool)], _ roles: [CrmContactRole], current: [CrmContactRole]
) -> Result<[CrmContactRole], CrmContactRoleRefusal> {
  func key(_ label: String) -> String { normalizePicklistLabel(label).lowercased() }
  var judged: [CrmContactRole] = []
  for row in roles {
    let label = normalizePicklistLabel(row.role)
    var stored: String?
    if !label.isEmpty {
      let held = normalizePicklistLabel(current.first { $0.contactID == row.contactID }?.role)
      if !held.isEmpty && key(held) == key(label) {
        stored = held
      } else if let match = values.first(where: { key($0.label) == key(label) }), match.active {
        stored = match.label
      } else {
        return .failure(CrmContactRoleRefusal(message: contactRoleRefusal(values)))
      }
    }
    judged.append(CrmContactRole(contactID: row.contactID, role: stored, primary: row.primary))
  }
  return .success(judged)
}

/// The sentence a role outside the list is refused with (`crmPicklistRefusal`).
func contactRoleRefusal(_ values: [(label: String, active: Bool)]) -> String {
  let active = values.filter(\.active).map(\.label)
  if active.isEmpty { return "This organization has no active contact roles. Add one under CRM › Fields › Deals." }
  let more = active.count > 20 ? ", and \(active.count - 20) more" : ""
  return "Contact role must be one of: \(active.prefix(20).joined(separator: ", "))\(more)."
}

/// What a save of a deal's roles writes (`dealContactRolesSave`): the judged list, its Primary as `contactId` (nil to
/// delete), and whether the Primary changed, which is when the name copied beside `contactId` moves with it.
struct CrmDealRolesWrite: Equatable {
  let contactRoles: [CrmContactRole]
  let contactID: String?
  let primaryChanged: Bool
}

func dealContactRolesSave(
  _ deal: [String: Any], _ next: [CrmContactRole], _ values: [(label: String, active: Bool)]
) -> Result<CrmDealRolesWrite, CrmContactRoleRefusal> {
  judgeContactRoles(values, next, current: dealContactRolesOf(deal)).map { judged in
    let roles = readContactRoles(judged.map(\.stored))
    let primary = contactRolesPrimary(roles)
    let before = (deal["contactId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    return CrmDealRolesWrite(contactRoles: roles, contactID: primary, primaryChanged: primary != before)
  }
}

/// What a save of a company's roles writes (`companyContactRolesSave`): the judged list; its ids and keys come from
/// `contactRoleListFields`.
func companyContactRolesSave(
  _ company: [String: Any], _ next: [CrmContactRole], _ values: [(label: String, active: Bool)]
) -> Result<[CrmContactRole], CrmContactRoleRefusal> {
  judgeContactRoles(values, next, current: companyContactRolesOf(company))
}

/// The arrays a record's roles are found by (`crmDealContactRoleListFields`): every contact on it, the same ids behind
/// each of the record's scope tokens, and the keys of the roles they hold.
func contactRoleListFields(_ roles: [CrmContactRole], visibleTo: Any?) -> (ids: [String], scoped: [String], keys: [String]) {
  let ids = roles.map(\.contactID)
  var keys: [String] = []
  for key in roles.compactMap({ crmPicklistKey($0.role) }) where !keys.contains(key) { keys.append(key) }
  var scopes: [String] = []
  for case let scope as String in visibleTo as? [Any] ?? [] where !scope.isEmpty && !scopes.contains(scope) { scopes.append(scope) }
  var words: [String] = []
  for id in ids where !id.isEmpty && !words.contains(id) { words.append(id) }
  let join = ContractValues.shared.scopedSearchJoin
  return (ids, scopes.flatMap { scope in words.map { "\(scope)\(join)\($0)" } }, keys)
}

// MARK: The section

/// A record's Contact roles (the console's card, on a deal and on a company): who is on it, the part each plays, and
/// which one is Primary. Add contact sits in the section's header; each row's ⋯ sets its role, makes it Primary or
/// removes it.
struct ContactRolesSection: View {
  let context: NativePluginContext
  let kind: CrmKind
  let id: String
  let data: [String: Any]
  let scope: CrmScope
  let api: CrmAPI
  let reference: CrmReference
  let onNotice: (String) -> Void
  let onError: (String) -> Void
  @State private var adding = false
  @State private var busy = false

  private var noun: String { kind.singular.lowercased() }
  private var roles: [CrmContactRole] { kind == .deal ? dealContactRolesOf(data) : companyContactRolesOf(data) }

  private func name(_ contactID: String) -> String { reference.contactLabel(contactID) ?? "Contact" }

  var body: some View {
    let roles = roles
    Section {
      if roles.isEmpty {
        VStack(alignment: .leading, spacing: 4) {
          Text("No contacts on this \(noun)").font(AglynFont.body)
          Text(
            kind == .deal
              ? "Name the people on the deal and the part each plays — one of them Primary."
              : "Name who at the company plays which part, one of them Primary."
          )
          .font(AglynFont.subheadline).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
      }
      ForEach(roles) { row in roleRow(row, roles) }
    } header: {
      AglynSectionHeader("Contact roles") {
        if scope.canWrite {
          Button("Add contact", systemImage: "person.badge.plus") { adding = true }
            .disabled(busy)
            .accessibilityIdentifier("crm-roles-add")
        }
      }
    }
    .sheet(isPresented: $adding) {
      AddContactRoleSheet(noun: noun, roles: roles, contacts: reference.contacts, roleLabels: reference.picklists.labels(crmContactRolePicklist)) {
        contactID, role, primary in
        try await write(contactRolesAdded(roles, contactID: contactID, role: role, primary: primary))
        onNotice("Contact added.")
      }
    }
  }

  private func roleRow(_ row: CrmContactRole, _ roles: [CrmContactRole]) -> some View {
    let name = name(row.contactID)
    return AglynRow(name, subtitle: row.role, systemImage: CrmKind.contact.symbol) {
      HStack(spacing: AglynSpace.one) {
        if row.primary { StatusChip("Primary", tone: .info) }
        Menu {
          Button("Open contact", systemImage: CrmKind.contact.symbol) {
            context.navigate(CrmKind.contact.detailScreen, [CrmKind.contact.param: row.contactID])
          }
          if scope.canWrite {
            Picker(
              "Role",
              selection: Binding(
                get: { row.role ?? "" },
                set: { role in change(contactRolesWithRole(roles, row.contactID, role), "Role saved.") })
            ) {
              Text("None").tag("")
              ForEach(roleOptions(row.role), id: \.self) { Text($0).tag($0) }
            }
            if !row.primary {
              Button("Make primary", systemImage: "star") { change(contactRolesWithPrimary(roles, row.contactID), "Primary contact set.") }
                .accessibilityIdentifier("crm-roles-primary-\(row.contactID)")
            }
            Button("Remove from this \(noun)", systemImage: "person.badge.minus", role: .destructive) {
              change(contactRolesWithout(roles, row.contactID), "Contact removed.")
            }
            .accessibilityIdentifier("crm-roles-remove-\(row.contactID)")
          }
        } label: {
          Image(systemName: "ellipsis.circle").accessibilityLabel("\(name) actions")
        }
        .menuIndicator(.hidden)
        .disabled(busy)
        .accessibilityIdentifier("crm-roles-actions-\(row.contactID)")
      }
    }
    .accessibilityIdentifier("crm-role-\(row.contactID)")
  }

  /// The list's active roles, and the one a contact holds when the list no longer offers it.
  private func roleOptions(_ held: String?) -> [String] {
    let labels = reference.picklists.labels(crmContactRolePicklist)
    guard let held, !held.isEmpty, !labels.contains(where: { $0.lowercased() == held.lowercased() }) else { return labels }
    return labels + [held]
  }

  private func change(_ next: [CrmContactRole], _ done: String) {
    Task {
      busy = true
      defer { busy = false }
      do {
        try await write(next)
        onNotice(done)
      } catch {
        onError(problemText(error))
      }
    }
  }

  private func write(_ next: [CrmContactRole]) async throws {
    let values = reference.picklists.values(crmContactRolePicklist)
    if kind == .deal {
      try await api.saveDealContactRoles(id, deal: data, next, values: values) { reference.contactLabel($0) }
    } else {
      try await api.saveCompanyContactRoles(id, company: data, next, values: values)
    }
  }
}

/// Pick a contact, the part they play, and whether they are the Primary (the console's add dialog). The first contact
/// on a record is always its Primary.
struct AddContactRoleSheet: View {
  let noun: String
  let roles: [CrmContactRole]
  let contacts: [FieldOption]
  let roleLabels: [String]
  let add: (String, String?, Bool) async throws -> Void
  @State private var contactID: String?
  @State private var role = ""
  @State private var primary = false

  var body: some View {
    let problem = contactID.flatMap { contactRoleAddProblem(roles, $0, noun: noun) }
    AglynFormSheet("Add a contact to this \(noun)", confirm: "Add", canConfirm: contactID != nil && problem == nil, save: {
      guard let contactID else { return }
      try await add(contactID, role.isEmpty ? nil : role, primary || roles.isEmpty)
    }) {
      Section {
        CrmPickerField(
          "Contact", options: crmNameOptions(pinned: [], contacts: contacts), selected: contactID,
          selectedLabel: contactID.flatMap { id in contacts.first { $0.value == id }?.label }, noneLabel: "Choose",
          identifier: "crm-roles-contact"
        ) { contactID = $0 }
        Picker("Role", selection: $role) {
          Text("None").tag("")
          ForEach(roleLabels, id: \.self) { Text($0).tag($0) }
        }
        .accessibilityIdentifier("crm-roles-role")
        Toggle("Primary contact", isOn: Binding(get: { primary || roles.isEmpty }, set: { primary = $0 }))
          .toggleStyle(.aglynCheckbox)
          .disabled(roles.isEmpty)
          .accessibilityIdentifier("crm-roles-primary")
      } footer: {
        if let problem { Text(problem).foregroundStyle(AglynColor.error) }
      }
    }
  }
}

/// A record field of a form, picked from a pushed list that searches and groups its rows (the console's record
/// pickers), with None first.
struct CrmPickerField: View {
  let title: String
  let options: [CrmPickOption]
  let selected: String?
  /// The picked record's name while the options do not hold it.
  let selectedLabel: String?
  var noneLabel = "None"
  let identifier: String
  let onPick: (String?) -> Void

  init(
    _ title: String, options: [CrmPickOption], selected: String?, selectedLabel: String? = nil, noneLabel: String = "None",
    identifier: String, onPick: @escaping (String?) -> Void
  ) {
    self.title = title
    self.options = options
    self.selected = selected
    self.selectedLabel = selectedLabel
    self.noneLabel = noneLabel
    self.identifier = identifier
    self.onPick = onPick
  }

  private var current: String {
    guard let selected else { return noneLabel }
    return options.first { $0.key == selected }?.label ?? selectedLabel ?? title
  }

  var body: some View {
    NavigationLink {
      CrmPickerList(title: title, options: options, selected: selected, noneLabel: noneLabel, onPick: onPick)
    } label: {
      LabeledContent(title) { Text(current).foregroundStyle(selected == nil ? .secondary : .primary).lineLimit(1) }
    }
    .accessibilityIdentifier(identifier)
  }
}

private struct CrmPickerList: View {
  let title: String
  let options: [CrmPickOption]
  let selected: String?
  let noneLabel: String
  let onPick: (String?) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var query = ""

  private var groups: [(title: String, rows: [CrmPickOption])] {
    let words = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let shown = words.isEmpty ? options : options.filter { $0.label.localizedStandardContains(words) }
    var out: [(title: String, rows: [CrmPickOption])] = []
    for option in shown {
      if out.last?.title == option.group { out[out.count - 1].rows.append(option) } else { out.append((option.group, [option])) }
    }
    return out
  }

  var body: some View {
    List {
      if query.isEmpty {
        Section { row(noneLabel, picked: selected == nil) { pick(nil) } }
      }
      ForEach(groups, id: \.title) { group in
        Section {
          ForEach(group.rows) { option in row(option.label, picked: option.key == selected) { pick(option.key) } }
        } header: {
          if !group.title.isEmpty { Text(group.title) }
        }
      }
      if groups.isEmpty && !query.isEmpty { Text("No options").foregroundStyle(.secondary) }
    }
    .searchable(text: $query, prompt: "Search")
    .navigationTitle(title)
    #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
    #endif
  }

  private func row(_ label: String, picked: Bool, _ action: @escaping () -> Void) -> some View {
    Button(action: action) {
      HStack {
        Text(label).foregroundStyle(.primary)
        Spacer()
        if picked { Image(systemName: "checkmark").foregroundStyle(AglynColor.tint) }
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(picked ? .isSelected : [])
  }

  private func pick(_ key: String?) {
    onPick(key)
    dismiss()
  }
}
