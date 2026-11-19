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
      } else if !model.missing, let form = model.form {
        content(form)
      } else {
        AglynEmptyState("This form is gone", systemImage: FormsSymbols.form)
      }
    }
    .navigationTitle(titled ? (model.form?.name ?? "Form") : "Forms")
    .aglynScreenTitle(titled ? (model.form?.name ?? "Form") : "Forms")
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
      FormMetricsSections(form: form)
      FormRoutingSection(form: form, api: api, runner: runner, canEdit: context.can("site.edit"))
      FormResponsesSection(form: form, api: api, runner: runner, canEdit: context.can("site.edit"))
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
    .formStyle(.aglynGrouped)
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
            .disabled(!context.can("site.edit"))
          Button { act(.duplicate(form)) } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
            .disabled(!context.can("site.edit"))
          Button { act(.export(form)) } label: { Label("Export submissions", systemImage: "square.and.arrow.down") }
            .keyboardShortcut("e", modifiers: .command)
          // The console's quick Preview: the published version as a visitor sees it. A form never opened in the
          // Besigner has no version to render.
          Button {
            if let version = form.versionID {
              context.openBesigner(formBesignerPath(formID: form.id, versionID: version, preview: true), scope: .site)
            }
          } label: {
            Label(form.versionID == nil ? "Preview (open it in the Besigner once)" : "Preview", systemImage: "eye")
          }
          .disabled(form.versionID == nil)
          .accessibilityIdentifier("form-preview")
          Divider()
          Button(role: form.retired ? nil : .destructive) { act(.retire(form)) } label: {
            Label(form.retired ? "Bring back" : "Retire", systemImage: form.retired ? "tray.and.arrow.up" : "archivebox")
          }
          .disabled(!context.can("site.edit"))
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
        .buttonStyle(.aglynProminent)
        .accessibilityIdentifier("form-submissions")
        Button {
          guard let api else { return }
          runner.run {
            let versionID = try await api.versionToOpen(form, newest: model.versions.first?.id)
            context.openBesigner(formBesignerPath(formID: form.id, versionID: versionID), scope: .site)
          }
        } label: {
          Label("Design in the Besigner", systemImage: FormsSymbols.besigner)
        }
        .buttonStyle(.aglynSecondary)
        .disabled(!context.can("site.edit") || runner.busy)
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
                  .disabled(!context.can("site.publish") || runner.busy)
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
  @State private var optIn = false

  private var changed: Bool {
    lead != form.routesLeads || consent != form.consentFieldName || optIn != form.optInOnSubmit
  }

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
      if lead && consent == nil && !optIn {
        AglynNotice("A form that sends leads should ask for marketing consent.", tone: .warning)
      }
      Toggle(isOn: $optIn) {
        VStack(alignment: .leading, spacing: 2) {
          Text("This is a sign-up form: submitting it subscribes the person")
          Text(
            "For a form whose only purpose is subscribing, like a newsletter sign-up. Every submission records marketing "
              + "consent and makes the person at least a subscriber, so the form should say plainly what they are "
              + "signing up for."
          )
          .font(AglynFont.caption).foregroundStyle(.secondary)
        }
      }
      .disabled(!canEdit)
      .accessibilityIdentifier("form-opt-in-on-submit")
      Button {
        guard let api else { return }
        let lead = lead
        let consent = consent
        let optIn = optIn != form.optInOnSubmit ? optIn : nil
        runner.run(success: "CRM routing saved.") {
          try await api.saveRouting(form, lead: lead, consentFieldName: consent, optInOnSubmit: optIn)
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
    .onChange(of: form.optInOnSubmit, initial: true) { _, value in optIn = value }
  }
}

/// "After someone sends it" (AGL-4098): whether the form asks for a quote, and whether the person is emailed a
/// confirmation, saved together.
struct FormResponsesSection: View {
  let form: FormRow
  let api: FormsAPI?
  let runner: PluginActionRunner
  let canEdit: Bool
  @State private var quote: Bool?
  @State private var confirms: Bool?

  private var effectiveQuote: Bool { quote ?? form.asksForQuote }
  private var effectiveConfirms: Bool { confirms ?? form.confirmationEmail ?? effectiveQuote }
  private var changed: Bool {
    (quote != nil && quote != form.asksForQuote) || (confirms != nil && confirms != form.sendsConfirmation())
  }

  var body: some View {
    Section {
      Toggle(isOn: Binding(get: { effectiveQuote }, set: { quote = $0 })) {
        VStack(alignment: .leading, spacing: 2) {
          Text("This form asks for a quote")
          Text(
            "Each submission arrives in the Inbox marked as a quote request, with any files attached, and you can start "
              + "a quote from it in one step. The person is added to Contacts as with any form."
              + (form.hasFileField ? "" : " Add a File upload field in the design to take logos or artwork.")
          )
          .font(AglynFont.caption).foregroundStyle(.secondary)
        }
      }
      .disabled(!canEdit)
      .accessibilityIdentifier("form-asks-for-quote")
      Toggle(isOn: Binding(get: { effectiveConfirms }, set: { confirms = $0 })) {
        VStack(alignment: .leading, spacing: 2) {
          Text("Email the person a confirmation")
          Text(
            form.hasEmailField
              ? "Sends the address they give a copy of what they sent, the names of their files and what happens next, "
                + "in your site’s email style (Emails → Form confirmation). Replies come to your site’s contact email, "
                + "and a quote you send them later arrives in the same conversation."
              : "Needs an email field in the published design: without an address there is no one to send it to."
          )
          .font(AglynFont.caption).foregroundStyle(.secondary)
        }
      }
      .disabled(!canEdit)
      .accessibilityIdentifier("form-confirmation-email")
      HStack {
        Button("Discard") {
          quote = nil
          confirms = nil
        }
        .disabled(!changed || runner.busy)
        Button {
          guard let api else { return }
          let (quote, confirms) = (quote, confirms)
          runner.run(success: "Saved") {
            try await api.saveResponses(form, asksForQuote: quote, confirms: confirms)
            self.quote = nil
            self.confirms = nil
          }
        } label: {
          if runner.busy && changed { ProgressView() } else { Text("Save") }
        }
        .disabled(!canEdit || runner.busy || !changed)
        .accessibilityIdentifier("form-responses-save")
      }
      .buttonStyle(.borderless)
    } header: {
      Text("After someone sends it")
    }
  }
}

/// "What this form has collected" (the console's `FormMetricsCard`): the four figures, the rates with what each is
/// taken over, submissions by month from the first recorded one, the most recent, and what is not measured.
struct FormMetricsSections: View {
  let form: FormRow

  var body: some View {
    let rates = FormRates(form)
    let series = formPeriodSeries(form.periods)
    let peak = series.map(\.submissions).max() ?? 0
    Section("What this form has collected") {
      AglynCardGrid(minimum: 140, maxColumns: 4, spacing: AglynSpace.one) {
        figure("Views", form.views, note: "times this form was rendered")
        figure("Submissions", form.submissions, note: "since this form was created")
        figure("Leads", form.leads, note: "people this form filed to Leads")
        figure("Declared fields", form.fields.count, note: "on the published design")
      }
      .listRowInsets(EdgeInsets(top: AglynSpace.one, leading: AglynSpace.one, bottom: AglynSpace.one, trailing: AglynSpace.one))
    }
    Section("Rates") {
      rate("Views that became a submission", rates.completion)
      rate("Started and never submitted", rates.abandon)
      rate("Submissions that became a lead", rates.lead)
      if !form.routesLeads {
        AglynHelperText("This form does not route to leads, so there is nothing for that rate to be over.")
      }
      AglynHelperText(
        "Views and starts are counted in the visitor’s browser and submissions on the server, so a blocked request is a "
          + "view this misses and a submission it does not. Each rate covers only the months its denominator was being "
          + "recorded.")
    }
    Section("Submissions by month") {
      if series.isEmpty {
        Text("Nothing recorded yet. The series starts at the first month this form collects something.")
          .foregroundStyle(.secondary)
      }
      ForEach(series, id: \.period) { point in
        HStack(spacing: AglynSpace.one) {
          Text(point.period).font(AglynFont.caption).foregroundStyle(.secondary).frame(minWidth: 64, alignment: .leading)
          GeometryReader { geo in
            Capsule()
              .fill(AglynColor.tint)
              .frame(width: max(2, peak > 0 ? geo.size.width * point.submissions / peak : 2), height: 8)
              .frame(maxHeight: .infinity, alignment: .center)
          }
          .frame(height: 12)
          Text(Int(point.submissions).formatted()).font(AglynFont.caption).frame(minWidth: 40, alignment: .trailing)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
          "\(point.period): \(Int(point.submissions)) submissions"
            + (point.views > 0 ? ", \(Int(point.views)) views" : ""))
      }
    }
    Section("Most recent") {
      Text(
        form.lastSubmissionAt.map { $0.formatted(date: .abbreviated, time: .shortened) }
          ?? "No submission has been recorded for this form.")
    }
    Section("Not measured") {
      AglynHelperText(
        "Per-field answer rates — which questions people skip. The values live on the submission documents, and "
          + "counting them is a read of the whole collection every time this page opens.")
      AglynHelperText(
        "Anything before a counter started. The month series begins where the record begins rather than padding "
          + "backwards with zeros, and a rate is taken only over the months its denominator was live.")
      AglynHelperText(
        "Who abandoned, or where they stopped. A start is one signal per form, not per field, so this says how often a "
          + "form was left and never which question lost the visitor.")
    }
  }

  private func figure(_ label: String, _ value: Int?, note: String) -> some View {
    AglynFigureTile(label, value: value.map { $0.formatted() } ?? "—", caption: value == nil ? "not recorded" : note)
  }

  private func rate(_ label: String, _ rate: MeasuredRate?) -> some View {
    LabeledContent(label) {
      if let rate {
        VStack(alignment: .trailing, spacing: 0) {
          Text(rate.percent).bold()
          Text(rate.detail).font(AglynFont.caption).foregroundStyle(.secondary)
        }
      } else {
        Text("— not enough recorded to compute").font(AglynFont.caption).foregroundStyle(.secondary)
      }
    }
  }
}
