// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// Wraps an editor's Form: readable width on a wide window, the list look, the toast.
struct EditorFrame<Content: View>: View {
  @ViewBuilder let content: () -> Content

  var body: some View {
    content()
      .formStyle(.grouped)
      .frame(maxWidth: 820)
      .frame(maxWidth: .infinity)
      .aglynListBackground()
  }
}

/// The workflow dialog: name, steps (function calls and server steps), the
/// trigger, the return value and a local test run — "Add Workflow" / "Edit Workflow".
struct WorkflowEditorScreen: View {
  let context: NativePluginContext
  let params: NativeParams
  @Environment(\.dismiss) private var dismiss
  @State private var stored = LiveDoc()
  @State private var list = LiveQuery()
  @State private var pickers = AutomationPickers()
  @State private var draft = WorkflowDraft()
  @State private var seeded = false
  @State private var testResult: String?
  @State private var saving = false
  @State private var notice: String?

  private var hostID: String? { params["hostId"] ?? context.hostID }
  private var editingID: String? { params["id"].flatMap { $0 == "new" || $0.isEmpty ? nil : $0 } }

  var body: some View {
    Group {
      if let editingID, !stored.loaded {
        Form { SkeletonRows(count: 6) }.formStyle(.grouped).aglynListBackground()
          .accessibilityIdentifier("workflow-editor-loading-\(editingID)")
      } else if editingID != nil && stored.doc == nil {
        AglynEmptyState("This workflow is gone", systemImage: "point.3.connected.trianglepath.dotted")
      } else {
        form
      }
    }
    .navigationTitle(editingID == nil ? "Add Workflow" : "Edit Workflow")
    #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .toolbar {
      ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
      ToolbarItem(placement: .confirmationAction) {
        Button(saving ? "Saving…" : "Done") { save() }
          .disabled(draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || nameTaken || saving)
          .accessibilityIdentifier("workflow-save")
      }
    }
    .task(id: "\(hostID ?? "")|\(editingID ?? "new")") {
      guard let hostID else { return }
      list.start(context.firestore, AutomationQueries.workflows(hostID))
      if let editingID { stored.start(context.firestore, AutomationPaths.workflows(hostID) + [editingID]) }
      await pickers.loadSite(context.firestore, hostID: hostID, orgID: context.orgID, withFunctions: true)
    }
    .onChange(of: stored.loaded) { _, loaded in seed(loaded) }
    .onAppear { seed(stored.loaded) }
    .onDisappear {
      stored.stop()
      list.stop()
    }
  }

  private func seed(_ loaded: Bool) {
    guard !seeded else { return }
    if let editingID {
      guard loaded, let doc = stored.doc else { return }
      draft = WorkflowDraft(id: editingID, data: doc.data)
    }
    seeded = true
  }

  private var rows: [WorkflowRow] { visibleWorkflows(ceilinged(list.docs, AutomationCeilings.workflows).rows) }
  private var nameTaken: Bool { draft.nameTaken(among: rows) }

  private var functionOptions: [PickerOption] {
    pickers.functions.filter { !isDeleted($0.data) && !(($0.data["name"] as? String) ?? "").isEmpty }
      .map { PickerOption(id: $0.id, name: $0.data["name"] as! String) }.sorted { byName($0.name, $1.name) }
  }

  private var form: some View {
    EditorFrame {
      Form {
        if let notice { Section { AglynNotice(notice, tone: .warning) { self.notice = nil } } }
        Section {
          AglynLabeledField(
            "Name", text: $draft.name,
            helper: nameTaken ? "A workflow with this name already exists" : "Used to identify the workflow",
            isError: nameTaken
          )
          .accessibilityIdentifier("workflow-name")
        }
        if !pickers.truncated.isEmpty {
          Section {
            AglynNotice(
              "Offering the first 100 \(pickers.truncated.joined(separator: ", ")) on this site, ordered by id. There are more, so the pickers below are short and a test run may not resolve every expression.",
              tone: .info)
          }
        }
        ForEach($draft.steps) { $step in
          let index = draft.steps.firstIndex { $0.id == step.id } ?? 0
          StepSection(
            step: $step, index: index, kinds: workflowStepKinds, pickers: pickers,
            reply: ReplyContext(event: draft.triggerEvent, afterWait: stepRunsAfterWait(draft.stepDocuments, index)),
            functionCall: FunctionCallContext(options: functionOptions, functions: functionMap(pickers.functions)),
            onRemove: { draft.steps.removeAll { $0.id == step.id } })
        }
        Section {
          Button {
            draft.steps.append(StepDraft(blankFunctionCall()))
          } label: {
            Label("Add step", systemImage: "plus")
          }
          .disabled(draft.steps.count >= workflowMaxSteps)
          .accessibilityIdentifier("workflow-add-step")
        }
        Section("Trigger") {
          Picker(
            "Run on event",
            selection: Binding(
              get: { draft.triggerEvent ?? "" },
              set: { event in
                if event.isEmpty {
                  draft.triggerEvent = nil
                } else {
                  draft.triggerEvent = event
                }
              })
          ) {
            Text("Manual only").tag("")
            if let event = draft.triggerEvent, !isHostEventType(event) { Text(hostEventLabel(event)).tag(event) }
            ForEach(hostEvents, id: \.type) { Text($0.label).tag($0.type) }
          }
          .accessibilityIdentifier("workflow-trigger")
          if draft.triggerEvent != nil {
            let problem = triggerFilterProblem(draft.triggerFilter, remedy: "action")
            AglynLabeledField(
              "Filter (optional)", text: $draft.triggerFilter, placeholder: "subscribe",
              helper: problem
                ?? (["Runs only when this expression is truthy — a field name, or arithmetic. It cannot compare values."]
                  + [hostEventPayloadHint(draft.triggerEvent)].compactMap { $0 }).joined(separator: " "),
              isError: problem != nil
            )
            .accessibilityIdentifier("workflow-filter")
          }
        }
        Section {
          AglynLabeledField(
            "Return value", text: $draft.returnValue, helper: "A step result name; defaults to the last step")
            .accessibilityIdentifier("workflow-return")
        }
        Section {
          Button {
            testResult = workflowTestResult(
              draft, functions: functionMap(pickers.functions), variables: variableList(pickers.variables))
          } label: {
            Label("Test run", systemImage: "play")
          }
          .accessibilityIdentifier("workflow-test")
          if let testResult {
            AglynNotice(testResult, tone: testResult.hasPrefix("Error") ? .warning : .success)
              .accessibilityIdentifier("workflow-test-result")
          }
        } footer: {
          Text("Uses current variable values")
        }
      }
    }
    .accessibilityIdentifier("workflow-editor")
  }

  private func save() {
    guard let hostID else { return }
    if let problem = draft.problem {
      notice = problem
      return
    }
    if let editingID {
      if let refusal = seedWriteRefusal(subject: "workflow", unreadable: stored.failed, fromCache: stored.doc?.fromCache == true) {
        notice = refusal
        return
      }
      saving = true
      Task {
        do {
          try await context.automationAPI.saveWorkflow(hostID: hostID, id: editingID, fields: draft.fields)
          AutomationToasts.shared.show("Workflow saved")
          dismiss()
        } catch {
          notice = routeMessage(error, fallback: "An error has occurred")
        }
        saving = false
      }
    } else {
      saving = true
      Task {
        do {
          try await context.automationAPI.createWorkflow(hostID: hostID, fields: draft.fields)
          AutomationToasts.shared.show("Workflow saved")
          dismiss()
        } catch {
          notice = routeMessage(error, fallback: "An error has occurred")
        }
        saving = false
      }
    }
  }
}
