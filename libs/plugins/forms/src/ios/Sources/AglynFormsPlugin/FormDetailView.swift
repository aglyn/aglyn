// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// One form, live (the Kotlin `FormDetail`): its numbers, CRM routing,
/// questions, versions (open in the Besigner, publish) and details, with
/// its submissions a tap away.
struct FormDetailView: View {
  let context: NativePluginContext
  let formID: String
  let runner: PluginActionRunner
  let role: SiteRoleModel
  /// False beside the list, where the screen's own title stays.
  var titled = true
  let act: (FormDetailAction) -> Void

  @State private var model = FormModel()
  @State private var refused: [String] = []

  private var api: FormsAPI? {
    context.hostID.map { FormsAPI(api: context.api, writer: context.writer, hostID: $0) }
  }

  var body: some View {
    Group {
      if !model.ready {
        List { SkeletonRows(count: 6) }.aglynListBackground()
      } else if model.failed && model.form == nil {
        AglynEmptyState(
          "Could not load this form", systemImage: "exclamationmark.triangle",
          message: "Check the connection and try again.")
      } else if model.missing || model.form == nil {
        AglynEmptyState("This form is gone", systemImage: FormsSymbols.form)
      } else if let form = model.form {
        content(form)
      }
    }
    .navigationTitle(titled ? (model.form?.name ?? "Form") : "Forms")
    .task(id: formID) {
      refused = []
      if let hostID = context.hostID { model.start(context.firestore, hostID: hostID, formID: formID) }
    }
    .onDisappear { model.stop() }
  }

  private func content(_ form: FormRow) -> some View {
    let now = Date()
    return Form {
      // Pushed on a phone, the list's banner is out of sight: say it here.
      if titled, let error = runner.error {
        Section { AglynNotice(error, tone: .error) { runner.clear() } }
      } else if titled, let notice = runner.notice {
        Section { AglynNotice(notice, tone: .success) { runner.clear() } }
      }
      header(form)
      Section {
        AglynCardGrid(minimum: 140, maxColumns: 3, spacing: AglynSpace.one) {
          AglynFigureTile(
            "Submissions", value: "\(form.submissions ?? 0)",
            caption: form.lastSubmissionAt.map { "Last " + relativeTime($0, now: now) } ?? "None yet")
          AglynFigureTile(
            "Leads", value: form.leads.map(String.init) ?? "—",
            caption: form.routesLeads ? "Sent to the CRM" : "Not sent to the CRM")
          AglynFigureTile("Views", value: "\(form.views ?? 0)", caption: "Times it was shown")
        }
        .listRowInsets(EdgeInsets(top: AglynSpace.one, leading: AglynSpace.one, bottom: AglynSpace.one, trailing: AglynSpace.one))
      }
      FormRoutingSection(form: form, api: api, runner: runner, canEdit: role.canEditContent)
      Section("Questions") {
        if form.fields.isEmpty {
          Text("This form declares no questions yet. Add them in the Besigner.").foregroundStyle(.secondary)
        }
        ForEach(form.fields) { field in
          AglynRow(field.label, subtitle: field.summary, systemImage: FormsSymbols.question)
            .accessibilityIdentifier("form-question-\(field.name)")
        }
      }
      versions(form, now: now)
      Section("Details") {
        LabeledContent("Form id") { Text(form.id).textSelection(.enabled) }
        if let updatedAt = form.updatedAt { LabeledContent("Updated", value: relativeTime(updatedAt, now: now)) }
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .accessibilityIdentifier("form-detail")
  }

  private func header(_ form: FormRow) -> some View {
    Section {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          Text(form.name).font(AglynFont.title2).accessibilityAddTraits(.isHeader)
          if let slug = form.slug { Text(slug).font(AglynFont.subheadline).foregroundStyle(.secondary) }
        }
        Spacer(minLength: AglynSpace.one)
        Menu {
          Button { act(.rename(form)) } label: { Label("Rename", systemImage: "pencil") }
            .disabled(!role.canEditContent)
          Button { act(.duplicate(form)) } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
            .disabled(!role.canEditContent)
          Button { act(.export(form)) } label: { Label("Export submissions", systemImage: "square.and.arrow.down") }
            .keyboardShortcut("e", modifiers: .command)
          Divider()
          Button(role: form.retired ? nil : .destructive) { act(.retire(form)) } label: {
            Label(form.retired ? "Bring back" : "Retire", systemImage: form.retired ? "tray.and.arrow.up" : "archivebox")
          }
          .disabled(!role.canEditContent)
        } label: {
          Label("More", systemImage: "ellipsis.circle").labelStyle(.iconOnly).imageScale(.large)
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .accessibilityLabel("More actions")
        .accessibilityIdentifier("form-actions")
      }
      AglynWrapRow(spacing: AglynSpace.one, lineSpacing: AglynSpace.half) {
        StatusChip(form.retired ? "Retired" : "In use", tone: form.retired ? .neutral : .success)
        if form.routesLeads { StatusChip("Sends leads to the CRM", tone: .info) }
        if form.campaignCount > 0 {
          StatusChip(form.campaignCount == 1 ? "In 1 campaign" : "In \(form.campaignCount) campaigns")
        }
      }
      AglynWrapRow {
        Button {
          context.navigate(inboxSubmissionsScreen, ["formId": form.id, "formName": form.name])
        } label: {
          Label("Submissions", systemImage: FormsSymbols.submissions)
        }
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier("form-submissions")
        Button {
          guard let api else { return }
          runner.run {
            let versionID = try await api.versionToOpen(form)
            context.openBesigner(formBesignerPath(formID: form.id, versionID: versionID), scope: .site)
          }
        } label: {
          Label("Design in the Besigner", systemImage: FormsSymbols.besigner)
        }
        .buttonStyle(.bordered)
        .disabled(!role.canEditContent || runner.busy)
        .accessibilityIdentifier("form-edit-besigner")
      }
    }
  }

  private func versions(_ form: FormRow, now: Date) -> some View {
    Section("Versions") {
      if !model.versionsReady {
        SkeletonRows(count: 2)
      } else if model.versionsFailed {
        Text("Versions could not be loaded.").foregroundStyle(.secondary)
      } else {
        if model.versions.isEmpty {
          Text("No versions yet. Open the Besigner to design the form.").foregroundStyle(.secondary)
        }
        if !refused.isEmpty {
          AglynNotice("Fix these in the Besigner first: " + refused.joined(separator: "; "), tone: .warning)
        }
        ForEach(Array(model.versions.enumerated()), id: \.element.id) { index, version in
          let current = version.id == form.versionID
          AglynRow(
            version.name ?? "Version \(model.versions.count - index)",
            subtitle: version.createdAt.map { "Saved " + relativeTime($0, now: now) }, systemImage: FormsSymbols.version
          ) {
            HStack(spacing: AglynSpace.one) {
              if current { StatusChip("Published", tone: .success) }
              Button("Open") {
                context.openBesigner(formBesignerPath(formID: form.id, versionID: version.id), scope: .site)
              }
              .buttonStyle(.borderless)
              .accessibilityIdentifier("form-version-open-\(version.id)")
              if !current {
                Button("Publish") { publish(form, version) }
                  .buttonStyle(.borderless)
                  .disabled(!role.canPublish || runner.busy)
                  .accessibilityIdentifier("form-version-publish-\(version.id)")
              }
            }
          }
          .accessibilityIdentifier("form-version-\(version.id)")
        }
      }
    }
  }

  private func publish(_ form: FormRow, _ version: FormVersionRow) {
    guard let api else { return }
    refused = []
    runner.run(success: "This version is now the published form.") {
      do {
        try await api.promote(formID: form.id, versionID: version.id)
      } catch let refusal as FormPromoteRefused {
        refused = refusal.violations
        throw refusal
      }
    }
  }
}

/// The CRM routing: the lead switch and the consent question, saved together.
struct FormRoutingSection: View {
  let form: FormRow
  let api: FormsAPI?
  let runner: PluginActionRunner
  let canEdit: Bool
  @State private var lead = false
  @State private var consent: String?

  private var changed: Bool { lead != form.routesLeads || consent != form.consentFieldName }

  var body: some View {
    Section {
      Toggle(isOn: $lead) {
        VStack(alignment: .leading, spacing: 2) {
          Text("Send submissions to the CRM as leads")
          Text("Each submission with an email address becomes a lead.").font(AglynFont.caption).foregroundStyle(.secondary)
        }
      }
      .disabled(!canEdit)
      .accessibilityIdentifier("form-route-leads")
      Picker("Marketing consent question", selection: $consent) {
        Text("None").tag(String?.none)
        ForEach(form.fields.filter(\.canHoldConsent)) { field in
          Text(field.label).tag(String?.some(field.name))
        }
        // A consent question the form no longer offers still shows as chosen.
        if let consent, !form.fields.contains(where: { $0.name == consent && $0.canHoldConsent }) {
          Text(form.consentLabel(consent)).tag(String?.some(consent))
        }
      }
      .disabled(!canEdit)
      .accessibilityIdentifier("form-consent")
      if lead && consent == nil {
        AglynNotice("A form that sends leads should ask for marketing consent.", tone: .warning)
      }
      Button {
        guard let api else { return }
        let lead = lead
        let consent = consent
        runner.run(success: "CRM routing saved.") {
          try await api.saveRouting(form, lead: lead, consentFieldName: consent)
        }
      } label: {
        if runner.busy && changed { ProgressView() } else { Text("Save routing") }
      }
      .disabled(!canEdit || runner.busy || !changed)
      .accessibilityIdentifier("form-routing-save")
    } header: {
      Text("CRM routing")
    }
    .onChange(of: form.routesLeads, initial: true) { _, value in lead = value }
    .onChange(of: form.consentFieldName, initial: true) { _, value in consent = value }
  }
}
