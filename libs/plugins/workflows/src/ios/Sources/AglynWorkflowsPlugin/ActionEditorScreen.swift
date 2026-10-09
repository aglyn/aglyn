// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The action dialog: name, trigger (host, on-page and custom events), filter,
/// conditions, the site-event fields and frequency, and the steps — "Add action" / "Edit action".
struct ActionEditorScreen: View {
  let context: NativePluginContext
  let params: NativeParams
  @Environment(\.dismiss) private var dismiss
  @State private var stored = LiveDoc()
  @State private var pickers = AutomationPickers()
  @State private var draft = ActionDraft()
  @State private var seeded = false
  @State private var saving = false
  @State private var notice: String?

  private var hostID: String? { params["hostId"] ?? context.hostID }
  private var editingID: String? { params["id"].flatMap { $0 == "new" || $0.isEmpty ? nil : $0 } }

  var body: some View {
    Group {
      if editingID != nil && !stored.loaded {
        Form { SkeletonRows(count: 6) }.formStyle(.grouped).aglynListBackground()
      } else if editingID != nil && stored.doc == nil {
        AglynEmptyState("This action is gone", systemImage: "bolt.slash")
      } else {
        form
      }
    }
    .navigationTitle(editingID == nil ? "Add action" : "Edit action")
    #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .toolbar {
      ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
      ToolbarItem(placement: .confirmationAction) {
        Button(saving ? "Saving…" : "Save action") { save() }
          .disabled(draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving)
          .accessibilityIdentifier("action-save")
      }
    }
    .task(id: "\(hostID ?? "")|\(editingID ?? "new")") {
      guard let hostID else { return }
      if let editingID { stored.start(context.firestore, AutomationPaths.actions(hostID) + [editingID]) }
      await pickers.loadSite(context.firestore, hostID: hostID, orgID: context.orgID, withFunctions: false)
    }
    .onChange(of: stored.loaded) { _, loaded in seed(loaded) }
    .onAppear { seed(stored.loaded) }
    .onDisappear { stored.stop() }
  }

  private func seed(_ loaded: Bool) {
    guard !seeded else { return }
    if let editingID {
      guard loaded, let doc = stored.doc else { return }
      draft = ActionDraft(id: editingID, data: doc.data)
    }
    seeded = true
  }

  /// The event's payload carries `formId`, so a "Form is…" condition is offered.
  private var eventCarriesFormID: Bool {
    hostEvents.first { $0.type == draft.event }?.payloadKeys?.contains(formIDField) == true
  }

  private var form: some View {
    EditorFrame {
      Form {
        if let notice { Section { AglynNotice(notice, tone: .warning) { self.notice = nil } } }
        if let recipe = draft.recipe as? String, !recipe.isEmpty {
          Section { Text("Started from a recipe — change anything, then save.").foregroundStyle(.secondary) }
        }
        if !pickers.truncated.isEmpty {
          Section {
            AglynNotice(
              "Offering the first 100 rows, ordered by id, for: \(pickers.truncated.joined(separator: ", ")). This site has more, so a step target may not be listed below.",
              tone: .info)
          }
        }
        Section {
          AglynLabeledField("Name", text: $draft.name).accessibilityIdentifier("action-name")
        }
        Section("Trigger") {
          Picker("Trigger event", selection: $draft.event) {
            ForEach(hostEvents, id: \.type) { Text($0.label).tag($0.type) }
            ForEach(siteEventTypes, id: \.self) { Text("\($0) (on page)").tag($0) }
            Text("Custom event…").tag(customEventValue)
          }
          .accessibilityIdentifier("action-event")
          if draft.event == customEventValue {
            let bad = !draft.customEvent.isEmpty && !matchesCustomEventPattern(draft.customEvent.trimmingCharacters(in: .whitespaces))
            AglynLabeledField(
              "Custom event name", text: $draft.customEvent,
              helper: bad ? "Custom event names are 2–40 letters, digits, dashes" : nil, isError: bad
            )
            .accessibilityIdentifier("action-custom-event")
          } else {
            let problem = triggerFilterProblem(draft.filter)
            AglynLabeledField(
              "Filter (optional)", text: $draft.filter, placeholder: "subscribe",
              helper: problem ?? hostEventPayloadHint(draft.event), isError: problem != nil
            )
            .accessibilityIdentifier("action-filter")
          }
        }
        ConditionRowsSection(
          rows: $draft.conditionRows, combinator: $draft.combinator, forms: eventCarriesFormID ? pickers.forms : nil)
        if isSiteEventType(draft.event) { siteEventSection }
        ForEach($draft.steps) { $step in
          let index = draft.steps.firstIndex { $0.id == step.id } ?? 0
          StepSection(
            step: $step, index: index, kinds: actionStepKinds, pickers: pickers,
            reply: ReplyContext(
              event: draft.triggerEvent, afterWait: stepRunsAfterWait(draft.steps.map(\.fields), index)),
            functionCall: nil, onRemove: { draft.steps.removeAll { $0.id == step.id } })
        }
        Section {
          Button {
            draft.steps.append(StepDraft(defaultAutomationStep("siteAlert")))
          } label: {
            Label("Add step", systemImage: "plus")
          }
          .disabled(draft.steps.count >= actionMaxSteps)
          .accessibilityIdentifier("action-add-step")
        } header: {
          Text("Steps (run in order)")
        }
      }
    }
    .accessibilityIdentifier("action-editor")
  }

  private var siteEventSection: some View {
    Section("On the page") {
      if elementScopedSiteEvents.contains(draft.event) {
        AglynLabeledField("CSS selector", text: $draft.selector, placeholder: "#pricing-table")
          .accessibilityIdentifier("action-selector")
      }
      if draft.event == "scrollDepth" || draft.event == "timeOnPage" {
        AglynLabeledField(
          draft.event == "scrollDepth" ? "Scroll %" : "Seconds",
          text: Binding(get: { draft.threshold }, set: { draft.threshold = $0.filter { $0.isNumber || $0 == "." } })
        )
        #if os(iOS)
          .keyboardType(.decimalPad)
        #endif
        .accessibilityIdentifier("action-threshold")
      }
      AglynLabeledField("Only on pages (optional)", text: $draft.pathPattern, placeholder: "/pricing or /blog/*")
        .accessibilityIdentifier("action-path")
      Picker(
        "Frequency",
        selection: Binding(
          get: { draft.frequency },
          set: { mode in
            draft.frequency = mode
            if mode == .cooldown, (Double(draft.cooldownMinutes) ?? 0) < 1 { draft.cooldownMinutes = "60" }
          })
      ) {
        ForEach(ActionFrequency.allCases) { Text($0.label).tag($0) }
      }
      .accessibilityIdentifier("action-frequency")
      if draft.frequency == .cooldown {
        AglynLabeledField(
          "Cooldown (minutes)", text: Binding(get: { draft.cooldownMinutes }, set: { draft.cooldownMinutes = $0.filter(\.isNumber) }))
          .accessibilityIdentifier("action-cooldown")
      }
    }
  }

  private func save() {
    guard let hostID else { return }
    let candidate = draft.candidate
    if let problem = validateHostAction(candidate, knownRecipes: draft.knownRecipes) {
      notice = problem
      return
    }
    if editingID != nil,
      let refusal = seedWriteRefusal(subject: "action", unreadable: stored.failed, fromCache: stored.doc?.fromCache == true)
    {
      notice = refusal
      return
    }
    saving = true
    Task {
      do {
        try await context.automationAPI.saveAction(hostID: hostID, id: editingID, candidate: candidate)
        AutomationToasts.shared.show("Action saved")
        dismiss()
      } catch let error as ConsoleAPIError where error.status == 0 {
        notice = error.message
      } catch {
        notice = routeMessage(error, fallback: "An error has occurred")
      }
      saving = false
    }
  }
}
