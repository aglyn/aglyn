// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

/// The bar over a list while rows are ticked (`CrmBulkBarFrame`): how many, the list's acts, Clear; then what the last
/// act said, and every row it left, by name, until dismissed.
struct CrmBulkBar: View {
  let count: Int
  let actions: [CrmBulkAction]
  let busy: Bool
  /// Whether an act may be pressed: off for a role that cannot use it, as the console's controls are.
  var enabled: (CrmBulkAction) -> Bool = { _ in true }
  let pick: (CrmBulkAction) -> Void
  let clear: () -> Void

  var body: some View {
    HStack(spacing: AglynSpace.oneAndHalf) {
      Text("\(count.formatted()) selected").font(AglynFont.subheadline.weight(.semibold)).foregroundStyle(AglynColor.textPrimary)
        .accessibilityIdentifier("crm-bulk-count")
      Spacer(minLength: AglynSpace.one)
      if busy { ProgressView().controlSize(.small) }
      Menu {
        ForEach(actions.filter { !$0.destructive }) { action in
          Button(action.label) { pick(action) }.disabled(!enabled(action))
        }
        let destructive = actions.filter(\.destructive)
        if !destructive.isEmpty {
          Divider()
          ForEach(destructive) { action in
            Button(action.label, role: .destructive) { pick(action) }.disabled(!enabled(action))
          }
        }
      } label: {
        Text("Actions").font(AglynFont.subheadline.weight(.semibold))
      }
      .disabled(busy)
      .accessibilityIdentifier("crm-bulk-menu")
      Button("Clear", action: clear).font(AglynFont.subheadline).disabled(busy).accessibilityIdentifier("crm-bulk-clear")
    }
    .padding(.horizontal, AglynSpace.two).padding(.vertical, AglynSpace.oneAndHalf)
    .aglynCardSurface()
  }
}

/// What the last act said, and the rows it left, under the bar.
struct CrmBulkNotices: View {
  @Binding var result: CrmBulkResult?

  var body: some View {
    if let result {
      VStack(alignment: .leading, spacing: AglynSpace.one) {
        if let report = result.report {
          AglynNotice(([report.heading] + report.lines).joined(separator: "\n"), tone: .warning) { self.result = nil }
            .accessibilityIdentifier("crm-bulk-report")
        } else {
          AglynNotice(result.sentence, tone: result.outcome.done > 0 ? .success : .warning) { self.result = nil }
            .accessibilityIdentifier("crm-bulk-notice")
            .task(id: result.sentence) {
              try? await Task.sleep(nanoseconds: 6_000_000_000)
              if self.result == result { self.result = nil }
            }
        }
      }
    }
  }
}

/// The one small sheet a value-taking act opens (`CrmBulkValueDialog`): what it applies to, the field, Cancel and
/// Apply.
struct CrmBulkSheet: View {
  let action: CrmBulkAction
  let kind: CrmKind?
  let count: Int
  let reference: CrmReference
  /// The selected deals' one pipeline; nil when they span more than one (Set stage then has nothing to offer).
  var pipeline: Pipeline?
  /// The due date the sheet opens on: the first selected task's.
  var initialDue: Int64?
  let apply: (CrmBulkValue) async -> Void
  @State private var text = ""
  @State private var hasDue = false
  @State private var due = Date()
  @State private var loaded = false

  private var noun: CrmBulkNoun { kind.map(CrmBulkNoun.init) ?? .task }

  private var canApply: Bool {
    switch action {
    case .addTag, .removeTag: crmBulkTag(text) != nil
    case .stage: !text.isEmpty && (kind != .deal || pipeline != nil)
    case .status: !text.isEmpty
    case .unqualify: !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    default: true
    }
  }

  private var title: String {
    action == .lost ? (count == 1 ? "Mark this deal lost?" : "Mark \(count) deals lost?") : crmBulkSheetTitle(action, kind: kind)
  }

  private var confirm: String {
    switch action {
    case .unqualify: "Unqualify"
    case .lost: "Mark lost"
    default: "Apply"
    }
  }

  var body: some View {
    AglynFormSheet(title, confirm: confirm, working: "Applying…", destructive: action == .lost, canConfirm: canApply, save: {
      await apply(CrmBulkValue(text: text, dueAtMs: hasDue ? Int64(due.timeIntervalSince1970 * 1000) : nil))
    }) {
      Section {
        field
      } header: {
        Text(action == .lost && count > 1
          ? "\(count) deals move to Lost and leave the open pipeline, each with the reason below. Any can be reopened from its page."
          : action == .lost ? "The deal moves to Lost and leaves the open pipeline. It can be reopened from its page."
          : "Applies to \(noun.count(count)) selected.")
          .textCase(nil)
      } footer: {
        if let help { Text(help) }
      }
    }
    .onAppear {
      guard !loaded else { return }
      loaded = true
      if action == .due, let initialDue {
        hasDue = true
        due = Date(timeIntervalSince1970: Double(initialDue) / 1000)
      } else if action == .due {
        due = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date().addingTimeInterval(86_400)) ?? Date()
      }
    }
  }

  private var help: String? {
    switch action {
    case .addTag: kind == .company ? "Lowercased, like the tags on a company" : "Lowercased, like the tags on a profile"
    case .removeTag: "Removed wherever it is present"
    case .company: "Leave it empty to unlink the selected contacts from their companies."
    case .status: "Closing a lead goes through Unqualify, which asks why."
    case .unqualify: "One reason for every selected lead, kept on each so it can be counted later."
    case .lost: count == 1 ? "Optional. Kept on the deal and sent with the dealLost event." : "Optional. Kept on each deal and sent with each dealLost event."
    case .assign: "Somebody other than you is told, as the task form tells them"
    case .due: "Leave it off to clear the due date"
    case .stage: kind == .deal ? pipeline.map { "\($0.name) — each move fires its event, as a drag does" } : nil
    default: nil
    }
  }

  @ViewBuilder
  private var field: some View {
    switch action {
    case .addTag, .removeTag:
      TextField("Tag", text: $text, prompt: Text(kind == .company ? "enterprise" : "vip"))
        .autocorrectionDisabled()
        #if os(iOS)
          .textInputAutocapitalization(.never)
        #endif
        .accessibilityIdentifier("crm-bulk-tag")
    case .owner, .assign:
      Picker(action == .owner ? "Owner" : "Assignee", selection: $text) {
        Text(action == .owner ? "Nobody — clear the owner" : "Nobody — clear the assignee").tag("")
        ForEach(reference.members) { Text($0.label).tag($0.uid) }
      }
      .accessibilityIdentifier("crm-bulk-member")
    case .stage where kind == .contact:
      Picker("Lifecycle stage", selection: $text) {
        if text.isEmpty { Text("Choose").tag("") }
        ForEach(lifecycleStages, id: \.self) { Text(stageLabel($0) ?? $0).tag($0) }
      }
      .accessibilityIdentifier("crm-bulk-stage")
    case .stage:
      if let pipeline {
        Picker("Stage", selection: $text) {
          if text.isEmpty { Text("Choose").tag("") }
          ForEach(crmBulkDealStages(pipeline)) { Text($0.name).tag($0.id) }
        }
        .accessibilityIdentifier("crm-bulk-stage")
      } else {
        Text("The selected deals are in different pipelines, so there is no one list of stages to move them to. Select deals from one pipeline.")
          .foregroundStyle(.secondary)
      }
    case .company:
      Picker("Company", selection: $text) {
        Text("No company").tag("")
        ForEach(reference.companies, id: \.value) { Text($0.label).tag($0.value) }
      }
      .accessibilityIdentifier("crm-bulk-company")
    case .status:
      Picker("Status", selection: $text) {
        if text.isEmpty { Text("Choose").tag("") }
        ForEach(ContractValues.shared.nativeCrmLeadOpenStatuses, id: \.self) { Text(leadStatusLabel($0)).tag($0) }
      }
      .accessibilityIdentifier("crm-bulk-status")
    case .unqualify, .lost:
      TextField("Reason", text: Binding(get: { text }, set: { text = String($0.prefix(crmBulkReasonMax)) }), axis: .vertical)
        .lineLimit(2...6)
        .accessibilityIdentifier("crm-bulk-reason")
    case .due:
      Toggle("Due", isOn: $hasDue).accessibilityIdentifier("crm-bulk-has-due")
      if hasDue { DatePicker("When", selection: $due).accessibilityIdentifier("crm-bulk-due") }
    default:
      EmptyView()
    }
  }
}

/// A row while picking several: a tick beside it, and a tap ticks it.
struct CrmPickRow<Label: View>: View {
  let picked: Bool
  let toggle: () -> Void
  @ViewBuilder let label: Label

  var body: some View {
    Button(action: toggle) {
      HStack(spacing: AglynSpace.oneAndHalf) {
        Image(systemName: picked ? "checkmark.circle.fill" : "circle")
          .font(.title3).foregroundStyle(picked ? AglynColor.primary : .secondary)
          .accessibilityHidden(true)
        label
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(picked ? .isSelected : [])
  }
}

/// Select / Done beside a list's filters: picking several is opt-in, as the console's ticked rows are.
struct CrmSelectToggle: View {
  @Binding var selecting: Bool
  var onEnd: () -> Void

  var body: some View {
    Button(selecting ? "Done" : "Select") {
      if selecting { onEnd() }
      selecting.toggle()
    }
    .font(AglynFont.subheadline.weight(.semibold))
    .accessibilityIdentifier("crm-select")
  }
}
