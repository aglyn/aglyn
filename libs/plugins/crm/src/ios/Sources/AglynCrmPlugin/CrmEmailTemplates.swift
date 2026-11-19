// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * THE CRM'S EMAIL TEMPLATES AND SNIPPETS (the Kotlin `CrmEmailTemplates.kt`;
 * the console's `crm-email-templates.ts`, `use-crm-email-templates.ts`,
 * `email-templates-card.tsx`, `email-template-drawer.tsx` and
 * `crm-email-template-tools.tsx`): the letters a team sends from a record. A
 * template fills Send email's subject and message; a snippet drops a paragraph
 * in. Merge fields such as {{contact.firstName}} are filled by the send route.
 */

let crmEmailTemplatesCollection = "crmEmailTemplates"

struct CrmEmailTemplate: Identifiable, Equatable {
  let id: String
  var name: String
  var subject: String
  var body: String
  /// `template` or `snippet`.
  var kind: String
  /// `shared` or `personal`.
  var visibility: String
  var ownerUID: String?
}

/// `normalizeCrmEmailTemplate`: a stored row read with the console's caps and fallbacks.
func crmEmailTemplate(id: String, _ data: [String: Any]?) -> CrmEmailTemplate {
  let values = ContractValues.shared
  func text(_ key: String, _ max: Int) -> String { String((data?[key] as? String ?? "").prefix(max)) }
  let visibility = ["shared", "personal"].contains(data?["visibility"] as? String ?? "") ? data!["visibility"] as! String : "shared"
  let kind = ["template", "snippet"].contains(data?["kind"] as? String ?? "") ? data!["kind"] as! String : "template"
  let owner = text("ownerUid", 128)
  return CrmEmailTemplate(
    id: id, name: text("name", values.crmEmailTemplateNameMax).trimmingCharacters(in: .whitespacesAndNewlines),
    subject: text("subject", values.crmEmailSubjectMax), body: text("body", values.crmEmailBodyMax), kind: kind, visibility: visibility,
    ownerUID: visibility == "personal" && !owner.isEmpty ? owner : nil)
}

/// `crmEmailTemplateIsListed`: a shared template is everyone's; a personal one its owner's alone.
func crmEmailTemplateIsListed(visibility: String?, ownerUID: String?, uid: String?) -> Bool {
  guard visibility == "personal" else { return true }
  guard let uid, !uid.isEmpty else { return false }
  return ownerUID == uid
}

/// The listed templates of a workspace for a reader, named ones only, ordered as the console reads them.
func crmListedTemplates(_ docs: [FirestoreDocument], uid: String) -> [CrmEmailTemplate] {
  docs.map { crmEmailTemplate(id: $0.id, $0.data) }
    .filter { !$0.name.isEmpty && crmEmailTemplateIsListed(visibility: $0.visibility, ownerUID: $0.ownerUID, uid: uid) }
}

/// The picker's order: shared (the team's) first, then the reader's own, each by name (`CrmTemplatePicker`).
func crmTemplatePickOrder(_ templates: [CrmEmailTemplate]) -> [CrmEmailTemplate] {
  templates.filter { $0.kind == "template" }.sorted {
    $0.visibility == $1.visibility ? $0.name.localizedCompare($1.name) == .orderedAscending : $1.visibility == "personal"
  }
}

/// `{{key}}`.
func crmMergeFieldToken(_ key: String) -> String { "{{\(key)}}" }

/// The merge-field groups a letter to this record may use (the send dialog's `fieldGroups`).
func crmMergeGroups(_ links: [String: String]) -> [CrmMergeFieldGroup] {
  let contact = links["contactId"] != nil
  let deal = links["dealId"] != nil
  let lead = links["leadId"] != nil
  return (contact || deal ? [.contact] : []) + (lead && !contact ? [.lead] : []) + (deal ? [.deal] : []) + [.you, .site]
}

/// A snippet or a field put into the message: at its end, the caret's place on a phone's field, within the cap.
func crmInsert(_ text: String, into body: String) -> String {
  String((body + text).prefix(ContractValues.shared.crmEmailBodyMax))
}

/// Where templates are read and what a new one is stamped with: under a site its tokens and the site; from the
/// workspace's own CRM the org token and no site (`useCrmEmailTemplateScope`).
struct CrmTemplateStamp {
  let hostID: String?
  let visibleTo: [String]

  init(_ scope: CrmScope) {
    hostID = scope.orgLevel ? nil : scope.createHostID
    visibleTo = scope.orgLevel ? [orgScopeToken] : scope.createTokens
  }
}

extension CrmAPI {
  private var templatesPath: [String] { crmPath(scope.orgID, crmEmailTemplatesCollection) }

  /// A new template or snippet (the drawer's create and Save as template), stamped as every CRM record is.
  func createTemplate(name: String, kind: String, visibility: String, subject: String, body: String) async throws {
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    let stamp = CrmTemplateStamp(scope)
    var fields: [String: Any] = [
      "name": name, "kind": kind, "visibility": visibility, "subject": kind == "template" ? subject : "", "body": body,
      "createdByUid": scope.uid, "createdAtMs": now, "updatedAtMs": now, "hostId": stamp.hostID.map { $0 as Any } ?? NSNull(),
      "visibleTo": stamp.visibleTo, "createdAt": FirestoreSentinel.serverTimestamp, "updatedAt": FirestoreSentinel.serverTimestamp,
    ]
    if visibility == "personal" { fields["ownerUid"] = scope.uid }
    try await reader.setDocument(templatesPath + [newRecordID()], fields, merge: true)
  }

  /// An edit: the drawer's fields, the owner kept for a personal one and dropped for a shared one.
  func updateTemplate(_ id: String, name: String, kind: String, visibility: String, subject: String, body: String) async throws {
    try await reader.setDocument(
      templatesPath + [id],
      [
        "name": name, "kind": kind, "visibility": visibility, "subject": kind == "template" ? subject : "", "body": body,
        "ownerUid": visibility == "personal" ? scope.uid as Any : FirestoreSentinel.delete as Any,
        "updatedAtMs": Int64(Date().timeIntervalSince1970 * 1000), "updatedAt": FirestoreSentinel.serverTimestamp,
      ], merge: true)
  }

  func deleteTemplate(_ id: String) async throws { try await reader.deleteDocument(templatesPath + [id]) }
}

/// The workspace's templates as this reader may list them, live.
@MainActor
@Observable
final class CrmTemplatesModel {
  @ObservationIgnored let list = LiveQueryList(pageSize: 200) { $0 }

  func start(_ reader: FirestoreReader, _ scope: CrmScope) {
    list.show(reader) { _ in
      scopedQuery(scope, crmEmailTemplatesCollection, order: [.init("name")], limit: ContractValues.shared.crmEmailTemplatesLimit)
    }
  }

  func stop() { list.stop() }

  func templates(uid: String) -> [CrmEmailTemplate] { crmListedTemplates(list.rows, uid: uid) }
}

/// New template / Edit template (`email-template-drawer.tsx`).
struct CrmTemplateSheet: View {
  let editing: CrmEmailTemplate?
  let save: (_ name: String, _ kind: String, _ visibility: String, _ subject: String, _ body: String) async throws -> Void
  @State private var name = ""
  @State private var kind = "template"
  @State private var visibility = "shared"
  @State private var subject = ""
  @State private var message = ""
  @State private var loaded = false

  var body: some View {
    let values = ContractValues.shared
    AglynFormSheet(
      editing == nil ? "New template" : "Edit template", confirm: editing == nil ? "Create template" : "Save",
      canConfirm: !name.trimmingCharacters(in: .whitespaces).isEmpty && !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      save: {
        try await save(
          String(name.trimmingCharacters(in: .whitespaces).prefix(values.crmEmailTemplateNameMax)), kind, visibility,
          String(subject.trimmingCharacters(in: .whitespaces).prefix(values.crmEmailSubjectMax)),
          String(message.trimmingCharacters(in: .whitespacesAndNewlines).prefix(values.crmEmailBodyMax)))
      }
    ) {
      Section {
        TextField("Name", text: $name).accessibilityIdentifier("crm-template-name")
        Picker("Kind", selection: $kind) {
          ForEach(["template", "snippet"], id: \.self) { Text(values.crmEmailTemplateKindLabels[$0] ?? $0).tag($0) }
        }
        .accessibilityIdentifier("crm-template-kind")
      } footer: {
        Text(kind == "template" ? "Fills in the subject and the message of an email." : "A paragraph inserted where the cursor is.")
      }
      Section {
        Picker("Who it is for", selection: $visibility) {
          ForEach(["shared", "personal"], id: \.self) { Text(values.crmEmailTemplateVisibilityLabels[$0] ?? $0).tag($0) }
        }
        .accessibilityIdentifier("crm-template-visibility")
      } footer: {
        Text(visibility == "shared" ? "Every CRM editor can use and change it." : "Listed for you alone.")
      }
      if kind == "template" {
        Section {
          TextField("Subject", text: $subject).accessibilityIdentifier("crm-template-subject")
        } footer: {
          Text("Optional. An email keeps its own subject when this is blank.")
        }
      }
      Section {
        TextField("Message", text: $message, axis: .vertical).lineLimit(5...16).accessibilityIdentifier("crm-template-body")
      } footer: {
        Text("Plain text. A blank line starts a new paragraph. Merge fields such as {{contact.firstName}} are filled in from the record when the email is sent.")
      }
    }
    .onAppear {
      guard !loaded else { return }
      loaded = true
      name = editing?.name ?? ""
      kind = editing?.kind ?? "template"
      visibility = editing?.visibility ?? "shared"
      subject = editing?.subject ?? ""
      message = editing?.body ?? ""
    }
  }
}

/// Save as template (`CrmSaveAsTemplateDialog`): a name and whose it is, over the draft as written.
struct CrmSaveAsTemplateSheet: View {
  let save: (_ name: String, _ visibility: String) async throws -> Void
  @State private var name = ""
  @State private var visibility = "personal"

  var body: some View {
    AglynFormSheet("Save as template", confirm: "Save template", canConfirm: !name.trimmingCharacters(in: .whitespaces).isEmpty, save: {
      try await save(String(name.trimmingCharacters(in: .whitespaces).prefix(ContractValues.shared.crmEmailTemplateNameMax)), visibility)
    }) {
      Section {
        TextField("Template name", text: $name).accessibilityIdentifier("crm-save-template-name")
        Picker("Who it is for", selection: $visibility) {
          Text("Personal — listed for you alone").tag("personal")
          Text("Shared — every CRM editor can use and edit it").tag("shared")
        }
        .pickerStyle(.inline)
        .labelsHidden()
      }
    }
  }
}

/// Settings › Email templates (`email-templates-card.tsx`): every listed template and snippet, New, Edit, Delete.
struct CrmTemplatesSection: View {
  let context: NativePluginContext
  let scope: CrmScope
  let api: CrmAPI
  @State private var model = CrmTemplatesModel()
  @State private var editing: CrmEmailTemplate?
  @State private var creating = false
  @State private var deleting: CrmEmailTemplate?
  @State private var duplicating: CrmEmailTemplate?
  @State private var error: String?
  @State private var notice: String?

  var body: some View {
    let templates = model.templates(uid: scope.uid)
    let limit = ContractValues.shared.crmEmailTemplatesLimit
    let atCap = templates.count >= limit
    Section {
      if let error { AglynNotice(error, tone: .error) { self.error = nil } }
      if let notice { AglynNotice(notice, tone: .success) { self.notice = nil } }
      if model.list.ready && templates.isEmpty {
        Text("No templates yet. Write one here, or save an email you are about to send as a template.").foregroundStyle(.secondary)
      }
      ForEach(templates) { template in
        Button {
          editing = template
        } label: {
          AglynRow(
            template.name,
            subtitle: [
              ContractValues.shared.crmEmailTemplateKindLabels[template.kind] ?? template.kind,
              template.kind == "template" ? (template.subject.isEmpty ? "—" : template.subject) : template.body,
            ].joined(separator: " · ")
          ) {
            StatusChip(ContractValues.shared.crmEmailTemplateVisibilityLabels[template.visibility] ?? template.visibility, tone: template.visibility == "personal" ? .neutral : .info)
          }
        }
        .buttonStyle(.plain)
        .contextMenu {
          Button("Edit", systemImage: "pencil") { editing = template }
          Button(crmDuplicateMenuLabel, systemImage: "plus.square.on.square") { duplicating = template }
          Button("Delete", systemImage: "trash", role: .destructive) { deleting = template }
        }
        .swipeActions {
          Button("Delete", role: .destructive) { deleting = template }
          Button(crmDuplicateMenuLabel) { duplicating = template }.accessibilityIdentifier("crm-template-duplicate")
        }
        .accessibilityIdentifier("crm-template-\(template.id)")
      }
      Button("New template", systemImage: "plus") { creating = true }
        .disabled(atCap)
        .accessibilityIdentifier("crm-template-new")
    } header: {
      Text("Email templates")
    } footer: {
      Text(
        atCap
          ? "A workspace keeps at most \(limit) templates and snippets. Delete one to add another."
          : "The letters your team sends from a record. A template fills in the subject and the message of Send email; a snippet drops a paragraph in where the cursor is. Merge fields such as {{contact.firstName}} are filled in from the record when the email is sent.")
    }
    .task(id: scope.orgID + scope.hostID) { model.start(context.firestore, scope) }
    .onDisappear { model.stop() }
    .sheet(isPresented: $creating) {
      CrmTemplateSheet(editing: nil) { name, kind, visibility, subject, body in
        try await api.createTemplate(name: name, kind: kind, visibility: visibility, subject: subject, body: body)
      }
    }
    .sheet(item: $duplicating) { template in
      CrmDuplicateTemplateSheet(template: template) { name, attemptKey in
        let copy = try await api.duplicateTemplate(template.id, name: name, attemptKey: attemptKey)
        notice = "Duplicated as “\(copy)”"
      }
    }
    .sheet(item: $editing) { template in
      CrmTemplateSheet(editing: template) { name, kind, visibility, subject, body in
        try await api.updateTemplate(template.id, name: name, kind: kind, visibility: visibility, subject: subject, body: body)
      }
    }
    .alert(
      deleting.map { "Delete \"\($0.name)\"?" } ?? "", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
      presenting: deleting
    ) { template in
      Button("Cancel", role: .cancel) { deleting = nil }
      Button("Delete", role: .destructive) {
        deleting = nil
        Task {
          do { try await api.deleteTemplate(template.id) } catch { self.error = problemText(error) }
        }
      }
    } message: { template in
      Text(
        template.kind == "snippet"
          ? "The snippet is removed for everyone it is listed for. Emails already sent are not changed."
          : "The template is removed for everyone it is listed for. Emails already sent are not changed.")
    }
  }
}

/// Send email from a record with the workspace's templates read while it is open (the dialog's `useCrmEmailTemplates`).
struct CrmEmailComposer: View {
  let context: NativePluginContext
  let scope: CrmScope
  let api: CrmAPI
  let to: String?
  let links: [String: String]
  var loadMerge: (() async -> CrmMergeContext)?
  let send: (String, String) async throws -> Void
  @State private var model = CrmTemplatesModel()

  var body: some View {
    EmailSheet(
      to: to, links: links, templates: model.list.ready ? model.templates(uid: scope.uid) : [], loadMerge: loadMerge,
      saveTemplate: { name, visibility, subject, body in
        try await api.createTemplate(name: name, kind: "template", visibility: visibility, subject: subject, body: body)
      }, save: send
    )
    .task { model.start(context.firestore, scope) }
    .onDisappear { model.stop() }
  }
}

/// The row menus' label for the act (`DUPLICATE_MENU_LABEL`).
let crmDuplicateMenuLabel = "Duplicate…"

/// `duplicateDisplayName`: the copy's default name, "Copy of …" once, within the name's limit.
func crmDuplicateDisplayName(_ source: String?) -> String {
  let values = ContractValues.shared
  let trimmed = (source ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  let name = trimmed.isEmpty ? "Untitled" : trimmed
  let base = name.hasPrefix(values.duplicateNamePrefix) ? name : values.duplicateNamePrefix + name
  return String(base.prefix(values.duplicateNameMax))
}

/// Duplicate… on a template (`DuplicateResourceDialog`): the copy's name, filled with "Copy of …", above what the copy
/// carries. One attempt key per open, so a retried tap makes one copy.
struct CrmDuplicateTemplateSheet: View {
  let template: CrmEmailTemplate
  let duplicate: (_ name: String, _ attemptKey: String) async throws -> Void
  @State private var name = ""
  @State private var attemptKey = UUID().uuidString

  var body: some View {
    let values = ContractValues.shared
    let noun = values.duplicableResourceNouns["emailTemplate"] ?? "email template"
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    AglynFormSheet("Duplicate \(noun)", confirm: "Duplicate", working: "Duplicating…", canConfirm: !trimmed.isEmpty, save: { try await duplicate(trimmed, attemptKey) }) {
      Section {
        TextField("Name", text: Binding(get: { name }, set: { name = String($0.prefix(values.duplicateNameMax)) }))
          .accessibilityIdentifier("crm-template-duplicate-name")
      } footer: {
        Text("A name another \(noun) already has gets a number.")
      }
      Section("What the copy carries") {
        ForEach(values.duplicateCopies["emailTemplate"] ?? [], id: \.self) { Text($0) }
      }
    }
    .onAppear { name = crmDuplicateDisplayName(template.name) }
  }
}
