// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * THE CRM'S FIELDS AND SETTINGS (the Kotlin `CrmSetup.kt`): custom fields
 * written as the console's Fields section writes them, picklists shown with
 * the org's values, and the org document's `crm` settings.
 */

private let fieldTypes: [(String, String)] = [
  ("text", "Text"), ("number", "Number"), ("date", "Date"), ("select", "Choice"), ("checkbox", "Checkbox"), ("url", "Web address"),
]

func fieldKey(_ label: String) -> String {
  let lowered = label.lowercased().map { ($0.isLetter && $0.isASCII) || $0.isNumber ? String($0) : "_" }.joined()
  let collapsed = lowered.split(separator: "_").joined(separator: "_")
  let lead = collapsed.first?.isLetter == true ? collapsed : "f_\(collapsed)"
  return String(lead.prefix(40)).trimmingCharacters(in: CharacterSet(charactersIn: "_"))
}

/// `crmFieldListFields`: the Fields table's query fields.
func fieldListFields(key: String, label: String, required: Bool, object: String) -> [String: Any] {
  let words = [label, key, key.replacingOccurrences(of: #"[_.-]+"#, with: " ", options: .regularExpression)].joined(separator: " ")
  return ["object": object, "required": required, "searchTokens": nameSearchTokens(words)]
}

struct FieldsSection: View {
  let context: NativePluginContext
  let scope: CrmScope
  let reference: CrmReference
  @State private var object = "contact"
  @State private var editing: CustomFieldDefinition?
  @State private var creating = false

  var body: some View {
    let definitions = reference.customFields.filter { $0.object == object }.sorted { $0.order < $1.order }
    Form {
      Section {
        Picker("Object", selection: $object) {
          ForEach(ContractValues.shared.nativeCrmFieldObjects, id: \.self) { Text(ContractValues.shared.crmFieldObjectLabels[$0] ?? $0).tag($0) }
        }
        .pickerStyle(.segmented)
      }
      Section {
        if definitions.isEmpty { Text("No custom fields here yet.").foregroundStyle(.secondary) }
        ForEach(definitions) { def in
          Button {
            if scope.canWrite { editing = def }
          } label: {
            AglynRow(
              def.label,
              subtitle: [def.key, fieldTypes.first { $0.0 == def.type }?.1 ?? def.type, def.required ? "Required" : nil].compactMap { $0 }
                .joined(separator: " · "), systemImage: "slider.horizontal.3"
            ) {
              if def.retired { StatusChip("Retired") }
            }
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("field-\(def.key)")
        }
      } header: {
        HStack {
          Text("Custom fields")
          Spacer()
          if scope.canWrite {
            Button("New field") { creating = true }.accessibilityIdentifier("crm-new-field")
          }
        }
      }
      Section("Picklists") {
        ForEach(ContractValues.shared.nativeCrmPicklists.filter { $0.object == object }, id: \.id) { picklist in
          AglynRow(picklist.label, subtitle: reference.picklists.labels(picklist.id).joined(separator: ", "), systemImage: "list.bullet")
        }
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .accessibilityIdentifier("crm-fields")
    .sheet(isPresented: $creating) { NewFieldSheet(context: context, scope: scope, reference: reference, object: object) }
    .sheet(item: $editing) { def in EditFieldSheet(context: context, scope: scope, definition: def) }
  }
}

private struct NewFieldSheet: View {
  let context: NativePluginContext
  let scope: CrmScope
  let reference: CrmReference
  let object: String
  @State private var label = ""
  @State private var type = "text"
  @State private var options = ""
  @State private var required = false

  var body: some View {
    let key = fieldKey(label)
    let taken = reference.customFields.contains { $0.key == key && $0.object == object }
    AglynFormSheet(
      "New field", confirm: "Add field",
      canConfirm: !label.trimmingCharacters(in: .whitespaces).isEmpty && !taken && (type != "select" || !options.isEmpty),
      save: {
        let order = (reference.customFields.filter { $0.object == object }.map(\.order).max() ?? -1) + 1
        var fields: [String: Any] = [
          "key": key, "label": label.trimmingCharacters(in: .whitespaces), "type": type, "required": required, "order": order,
          "retiredAt": NSNull(), "hostId": scope.hostID, "visibleTo": [orgScopeToken],
          "createdAt": FirestoreSentinel.serverTimestamp, "updatedAt": FirestoreSentinel.serverTimestamp,
        ]
        if type == "select" { fields["options"] = options.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } }
        for (k, v) in fieldListFields(key: key, label: label.trimmingCharacters(in: .whitespaces), required: required, object: object) { fields[k] = v }
        try await context.firestore.setDocument(crmPath(scope.orgID, "contactFields") + [newRecordID()], fields, merge: true)
      }
    ) {
      Section {
        TextField("Label", text: $label).accessibilityIdentifier("field-label")
        LabeledContent("Key", value: key)
        if taken { Text("A field with this key exists.").foregroundStyle(AglynColor.error) }
        Picker("Type", selection: $type) { ForEach(fieldTypes, id: \.0) { Text($0.1).tag($0.0) } }
        if type == "select" { TextField("Choices, separated by commas", text: $options) }
        Toggle("Required", isOn: $required)
      }
    }
  }
}

private struct EditFieldSheet: View {
  let context: NativePluginContext
  let scope: CrmScope
  let definition: CustomFieldDefinition
  @State private var label = ""
  @State private var options = ""
  @State private var required = false
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    let path = crmPath(scope.orgID, "contactFields") + [definition.id]
    AglynFormSheet(definition.label, save: {
      var fields: [String: Any] = ["label": label.trimmingCharacters(in: .whitespaces), "updatedAt": FirestoreSentinel.serverTimestamp]
      if definition.type == "select" { fields["options"] = options.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } }
      for (k, v) in fieldListFields(key: definition.key, label: label, required: required, object: definition.object) { fields[k] = v }
      try await context.firestore.setDocument(path, fields, merge: true)
    }) {
      Section {
        TextField("Label", text: $label)
        if definition.type == "select" { TextField("Choices, separated by commas", text: $options) }
        Toggle("Required", isOn: $required)
      } footer: {
        Text("Key \(definition.key). The key and the type stay as they are.")
      }
      Section {
        Button(definition.retired ? "Restore" : "Retire") {
          Task {
            try? await context.firestore.setDocument(
              path,
              ["retiredAt": definition.retired ? NSNull() : Int64(Date().timeIntervalSince1970 * 1000), "updatedAt": FirestoreSentinel.serverTimestamp],
              merge: true)
            dismiss()
          }
        }
        if definition.retired {
          Button("Delete for good", role: .destructive) {
            Task {
              try? await context.firestore.deleteDocument(path)
              dismiss()
            }
          }
        }
      }
    }
    .onAppear {
      label = definition.label
      options = definition.options.joined(separator: ", ")
      required = definition.required
    }
  }
}

/// The CRM's settings, from the org document's `crm` map.
struct SettingsSection: View {
  let context: NativePluginContext
  let scope: CrmScope
  let reference: CrmReference
  @State private var error: String?

  private var crm: [String: Any] { scope.org["crm"] as? [String: Any] ?? [:] }

  var body: some View {
    let hostSettings = (crm["hosts"] as? [String: Any])?[scope.hostID] as? [String: Any]
    let pool = (crm["roundRobin"] as? [String: Any])?["memberUids"] as? [String] ?? []
    Form {
      if let error { AglynNotice(error, tone: .error) { self.error = nil } }
      if !scope.canManage { AglynNotice("Only the workspace's owners and admins change these.", tone: .info) }
      Section("Who sees new records") {
        Picker("New records", selection: Binding(get: { crmDefaultScope(scope.org) ?? "host" }, set: { write(["defaultRecordScope": $0]) })) {
          Text("The site that made them").tag("host")
          Text("Every site in the workspace").tag("org")
        }
        .pickerStyle(.inline)
        .labelsHidden()
      }
      Section {
        Toggle(
          "Make a company from a work address",
          isOn: Binding(get: { crm["autoCreateCompanies"] as? Bool == true }, set: { write(["autoCreateCompanies": $0]) }))
      } footer: {
        Text("When someone writes in from a business domain no company has yet.")
      }
      Section("Default owner for this site") {
        Picker(
          "Owner",
          selection: Binding(
            get: { hostSettings?["defaultOwnerUid"] as? String ?? "" },
            set: { uid in write(["hosts": [scope.hostID: ["defaultOwnerUid": uid.isEmpty ? FirestoreSentinel.delete as Any : uid as Any]]]) })
        ) {
          Text("Nobody").tag("")
          ForEach(reference.members) { Text($0.label).tag($0.uid) }
        }
      }
      Section {
        ForEach(reference.members) { member in
          Toggle(
            member.label,
            isOn: Binding(
              get: { pool.contains(member.uid) },
              set: { on in write(["roundRobin": ["memberUids": on ? pool + [member.uid] : pool.filter { $0 != member.uid }]]) }))
        }
      } header: {
        Text("Round robin")
      } footer: {
        Text("New records without a rule's owner go to these people in turn.")
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .disabled(!scope.canManage)
    .accessibilityIdentifier("crm-settings")
  }

  private func write(_ changes: [String: Any]) {
    error = nil
    Task {
      do {
        try await context.firestore.setDocument(["orgs", scope.orgID], ["crm": changes], merge: true)
      } catch {
        self.error = problemText(error)
      }
    }
  }
}
