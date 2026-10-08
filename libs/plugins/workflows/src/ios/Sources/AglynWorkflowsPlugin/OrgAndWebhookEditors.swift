// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The org automation dialog: name, trigger, filter, conditions, where it runs,
/// its steps and its switch — saved through the manage route after `readOrgAutomation`.
struct OrgAutomationEditorScreen: View {
  let context: NativePluginContext
  let params: NativeParams
  @Environment(\.dismiss) private var dismiss
  @State private var stored = LiveDoc()
  @State private var pickers = AutomationPickers()
  @State private var sites = OrgSites()
  @State private var draft = OrgAutomationDraft()
  @State private var seeded = false
  @State private var saving = false
  @State private var notice: String?

  private var editingID: String? { params["id"].flatMap { $0 == "new" || $0.isEmpty ? nil : $0 } }

  var body: some View {
    Group {
      if context.orgID == nil {
        AglynEmptyState("Pick a workspace", systemImage: "building.2")
      } else if editingID != nil && !stored.loaded {
        Form { SkeletonRows(count: 6) }.formStyle(.grouped).aglynListBackground()
      } else if editingID != nil && stored.doc == nil {
        AglynEmptyState("This org automation is gone", systemImage: "building.2")
      } else {
        form
      }
    }
    .navigationTitle(editingID == nil ? "Add org automation" : "Edit org automation")
    #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .toolbar {
      ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
      ToolbarItem(placement: .confirmationAction) {
        Button(saving ? "Saving…" : "Save org automation") { save() }
          .disabled(draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving)
          .accessibilityIdentifier("org-automation-save")
      }
    }
    .task(id: "\(context.orgID ?? "")|\(editingID ?? "new")") {
      guard let orgID = context.orgID else { return }
      sites.start(context)
      if let editingID { stored.start(context.firestore, AutomationPaths.orgAutomations(orgID) + [editingID]) }
      await pickers.loadOrg(context.firestore, orgID: orgID, placement: draft.placement)
    }
    .onChange(of: stored.loaded) { _, loaded in seed(loaded) }
    .onChange(of: draft.placement) { _, placement in pickers.place(placement) }
    .onAppear { seed(stored.loaded) }
    .onDisappear {
      stored.stop()
      sites.stop()
    }
  }

  private func seed(_ loaded: Bool) {
    guard !seeded else { return }
    if let editingID {
      guard loaded, let doc = stored.doc else { return }
      draft = OrgAutomationDraft(id: editingID, data: doc.data)
      pickers.place(draft.placement)
    }
    seeded = true
  }

  private var form: some View {
    EditorFrame {
      Form {
        if let notice { Section { AglynNotice(notice, tone: .warning) { self.notice = nil } } }
        Section {
          Text(
            "Runs on every site you place it on, as that site: its email goes from that site, its runs count on that site’s action runs, and the site can pause it for itself."
          )
          .font(AglynFont.subheadline).foregroundStyle(.secondary)
          if !pickers.truncated.isEmpty {
            AglynNotice(
              "Offering the first 100 rows, ordered by id, for: \(pickers.truncated.joined(separator: ", ")). The organization has more, so a step target may not be listed below.",
              tone: .info)
          }
          AglynLabeledField("Name", text: $draft.name).accessibilityIdentifier("org-automation-name")
        }
        Section("Trigger") {
          Picker("Trigger event", selection: $draft.event) {
            ForEach(orgAutomationTriggerEvents, id: \.self) { Text(hostEventLabel($0)).tag($0) }
          }
          .accessibilityIdentifier("org-automation-event")
          let problem = triggerFilterProblem(draft.filter)
          AglynLabeledField(
            "Filter (optional)", text: $draft.filter, placeholder: "subscribe",
            helper: problem ?? hostEventPayloadHint(draft.event), isError: problem != nil
          )
          .accessibilityIdentifier("org-automation-filter")
        }
        ConditionRowsSection(rows: $draft.conditionRows, combinator: $draft.combinator, forms: nil)
        Section("Runs on") {
          Picker("Runs on", selection: $draft.everySite) {
            Text("Every site").tag(true)
            Text("Chosen sites").tag(false)
          }
          .pickerStyle(.segmented)
          .accessibilityIdentifier("org-automation-placement")
          if !draft.everySite {
            if !sites.ready {
              ProgressView()
            } else if sites.sites.isEmpty {
              Text("This organization has no sites yet.").foregroundStyle(.secondary)
            } else {
              ForEach(sites.sites) { site in
                Toggle(
                  siteName(site.id, sites.sites),
                  isOn: Binding(
                    get: { draft.siteIDs.contains(site.id) },
                    set: { on in
                      if on { draft.siteIDs.append(site.id) } else { draft.siteIDs.removeAll { $0 == site.id } }
                    })
                )
                .accessibilityIdentifier("org-automation-site-\(site.id)")
              }
            }
            if draft.tooManySites {
              AglynHelperText("Choose \(maxScopeHosts) sites or fewer, or run it on every site.", isError: true)
            }
          }
        }
        ForEach($draft.steps) { $step in
          let index = draft.steps.firstIndex { $0.id == step.id } ?? 0
          StepSection(
            step: $step, index: index, kinds: orgStepKinds, pickers: pickers,
            reply: ReplyContext(event: draft.event, afterWait: stepRunsAfterWait(draft.steps.map(\.fields), index)),
            functionCall: nil, onRemove: { draft.steps.removeAll { $0.id == step.id } })
        }
        Section {
          Button {
            draft.steps.append(StepDraft(defaultAutomationStep("sendEmail")))
          } label: {
            Label("Add step", systemImage: "plus")
          }
          .disabled(draft.steps.count >= actionMaxSteps)
          .accessibilityIdentifier("org-automation-add-step")
          Toggle("Switched on", isOn: $draft.enabled).accessibilityIdentifier("org-automation-enabled")
        } header: {
          Text("Steps (run in order)")
        }
      }
    }
    .accessibilityIdentifier("org-automation-editor")
  }

  private func save() {
    guard let orgID = context.orgID else { return }
    let body = draft.body
    if case .problem(let problem) = readOrgAutomation(body) {
      notice = problem
      return
    }
    saving = true
    Task {
      do {
        try await context.automationAPI.saveOrgAutomation(orgID: orgID, id: editingID, automation: body)
        AutomationToasts.shared.show("Org automation saved")
        dismiss()
      } catch {
        notice = routeMessage(error)
      }
      saving = false
    }
  }
}

/// "Add webhook": a name, a direction, where it delivers or which workflow it
/// runs, and the generated secret — created through the resources route.
struct WebhookEditorScreen: View {
  let context: NativePluginContext
  let params: NativeParams
  @Environment(\.dismiss) private var dismiss
  @State private var workflows = LiveQuery()
  @State private var name = ""
  @State private var inbound = false
  @State private var url = ""
  @State private var workflowName = ""
  @State private var secret = randomHexSecret()
  @State private var saving = false
  @State private var notice: String?

  private var hostID: String? { params["hostId"] ?? context.hostID }

  var body: some View {
    let names = ceilinged(workflows.docs, AutomationCeilings.editorOptions).rows
      .filter { !isDeleted($0.data) && !(($0.data["name"] as? String) ?? "").isEmpty }
      .map { $0.data["name"] as! String }.sorted()
    EditorFrame {
      Form {
        if let notice { Section { AglynNotice(notice, tone: .warning) { self.notice = nil } } }
        Section {
          AglynLabeledField("Name", text: $name).accessibilityIdentifier("webhook-name")
          Picker("Direction", selection: $inbound) {
            Text("Outbound — send data to a URL").tag(false)
            Text("Inbound — receive data, run a workflow").tag(true)
          }
          .accessibilityIdentifier("webhook-direction")
          if inbound {
            Picker("Workflow to run", selection: $workflowName) {
              if workflowName.isEmpty { Text("Choose…").tag("") }
              ForEach(names, id: \.self) { Text($0).tag($0) }
            }
            .accessibilityIdentifier("webhook-workflow")
          } else {
            AglynLabeledField("Delivery URL", text: $url, placeholder: "https://example.com/hooks/aglyn")
              #if os(iOS)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
              #endif
              .autocorrectionDisabled()
              .accessibilityIdentifier("webhook-url")
          }
        }
        Section {
          LabeledContent("Secret") {
            Text(secret).font(AglynFont.caption.monospaced()).textSelection(.enabled).lineLimit(2)
          }
          .accessibilityIdentifier("webhook-secret")
        } footer: {
          Text(inbound ? "Callers send this in the x-aglyn-secret header" : "Signs deliveries (X-Aglyn-Signature, HMAC-SHA256)")
        }
      }
    }
    .navigationTitle("Add webhook")
    #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .toolbar {
      ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
      ToolbarItem(placement: .confirmationAction) {
        Button(saving ? "Saving…" : "Save webhook") { save() }
          .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving)
          .accessibilityIdentifier("webhook-save")
      }
    }
    .accessibilityIdentifier("webhook-editor")
    .task(id: hostID) {
      if let hostID {
        workflows.start(
          context.firestore, AutomationQueries.ceiling(AutomationPaths.workflows(hostID), AutomationCeilings.editorOptions))
      }
    }
    .onDisappear { workflows.stop() }
  }

  private func save() {
    guard let hostID else { return }
    if !inbound && !isPublicWebhookURL(url.trimmingCharacters(in: .whitespacesAndNewlines)) {
      notice = "Outbound URLs must be public https addresses"
      return
    }
    if inbound && workflowName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      notice = "Pick the workflow this endpoint runs"
      return
    }
    saving = true
    Task {
      do {
        try await context.automationAPI.createWebhook(
          hostID: hostID, name: name, inbound: inbound, target: inbound ? workflowName : url, secret: secret)
        AutomationToasts.shared.show("Webhook saved")
        dismiss()
      } catch {
        notice = routeMessage(error, fallback: "An error has occurred")
      }
      saving = false
    }
  }
}
