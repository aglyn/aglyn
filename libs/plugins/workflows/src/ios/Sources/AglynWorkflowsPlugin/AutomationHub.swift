// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Observation
import SwiftUI

/// What an editor tells the hub when it closes ("Workflow saved"): the hub shows it.
@MainActor
@Observable
final class AutomationToasts {
  static let shared = AutomationToasts()
  var toast: AglynToast?

  func show(_ message: String, _ tone: AglynTone = .success) { toast = AglynToast(message, tone: tone) }
}

/// The hub's sections: a site's own three, and the organization's four.
enum HubSection: String, CaseIterable, Identifiable {
  case workflows, actions, webhooks
  case orgAutomations = "org", orgWorkflows = "org-workflows", orgActions = "org-actions", orgWebhooks = "org-webhooks"

  var id: String { rawValue }

  var title: String {
    switch self {
    case .workflows: "Workflows"
    case .actions: "Actions"
    case .webhooks: "Webhooks"
    case .orgAutomations: "Org automations"
    case .orgWorkflows: "Workflows on every site"
    case .orgActions: "Actions on every site"
    case .orgWebhooks: "Webhooks on every site"
    }
  }

  /// The short name a segmented control has room for.
  var shortTitle: String {
    switch self {
    case .workflows, .orgWorkflows: "Workflows"
    case .actions, .orgActions: "Actions"
    case .webhooks, .orgWebhooks: "Webhooks"
    case .orgAutomations: "Org"
    }
  }

  var icon: String {
    switch self {
    case .workflows, .orgWorkflows: "point.3.connected.trianglepath.dotted"
    case .actions, .orgActions: "bolt"
    case .webhooks, .orgWebhooks: "link"
    case .orgAutomations: "building.2"
    }
  }

  static let site: [HubSection] = [.workflows, .actions, .webhooks]
  static let org: [HubSection] = [.orgAutomations, .orgWorkflows, .orgActions, .orgWebhooks]
}

/// Automation: a site's workflows, actions and webhooks, and its organization's
/// automations and every site's lists — the console's Automation hub. With no
/// site picked (or `scope=org`), the organization's hub.
struct AutomationHubScreen: View {
  let context: NativePluginContext
  let params: NativeParams
  @State private var selection: HubSection?
  @State private var entitlements = EntitlementsLoader()
  @State private var orgEntitlements = EntitlementsLoader()
  @State private var orgSites = OrgSites()
  @Bindable private var toasts = AutomationToasts.shared

  private var hostID: String? { params["scope"] == "org" ? nil : params["hostId"] ?? context.hostID }
  private var sections: [HubSection] { hostID == nil ? HubSection.org : HubSection.site }
  private var current: HubSection {
    selection ?? params["section"].flatMap { HubSection(rawValue: $0) }.flatMap { section in
      hostID == nil ? (HubSection.org.contains(section) ? section : nil) : section
    } ?? sections[0]
  }

  var body: some View {
    WideLayoutReader { wide in
      Group {
        if hostID == nil && context.orgID == nil {
          AglynEmptyState("Pick a workspace", systemImage: "building.2", message: "Automation shows one workspace at a time.")
        } else if wide {
          HStack(spacing: 0) {
            sidebar.frame(width: 260)
            Divider()
            content(current).frame(maxWidth: .infinity, maxHeight: .infinity)
          }
        } else {
          content(current)
            .safeAreaInset(edge: .top, spacing: 0) {
              Picker("Section", selection: Binding(get: { current }, set: { selection = $0 })) {
                ForEach(sections) { Text($0.shortTitle).tag($0) }
              }
              .pickerStyle(.segmented)
              .padding(.horizontal, AglynSpace.two)
              .padding(.vertical, AglynSpace.one)
              .background(.bar)
              .accessibilityIdentifier("automation-sections")
            }
        }
      }
      .toolbar {
        if !wide, hostID != nil, context.orgID != nil {
          ToolbarItem(placement: .primaryAction) {
            Button {
              context.navigate(automationScreen, ["scope": "org"])
            } label: {
              Label("Organization", systemImage: "building.2")
            }
            .accessibilityIdentifier("open-org-automation")
          }
        }
      }
    }
    .navigationTitle(hostID == nil ? "Org automation" : "Automation")
    .aglynToast($toasts.toast)
    .task(id: "\(hostID ?? "")|\(context.orgID ?? "")") {
      orgSites.start(context)
      if let hostID {
        await entitlements.load(context.api, hostID: hostID, orgID: nil)
      }
      if context.orgID != nil {
        await orgEntitlements.load(context.api, hostID: nil, orgID: context.orgID)
      }
    }
    .onDisappear { orgSites.stop() }
  }

  private var sidebar: some View {
    List(selection: Binding(get: { current }, set: { selection = $0 })) {
      if hostID != nil {
        Section(siteTitle) {
          ForEach(HubSection.site) { Label($0.title, systemImage: $0.icon).tag($0) }
        }
      }
      if context.orgID != nil {
        Section("Organization") {
          ForEach(HubSection.org) { Label($0.title, systemImage: $0.icon).tag($0) }
        }
      }
    }
    .aglynListBackground()
    .accessibilityIdentifier("automation-sidebar")
  }

  private var siteTitle: String {
    guard let hostID else { return "This site" }
    let name = siteName(hostID, orgSites.sites)
    return name == hostID ? "This site" : name
  }

  @ViewBuilder
  private func content(_ section: HubSection) -> some View {
    switch section {
    case .workflows:
      if let hostID { WorkflowsSection(context: context, hostID: hostID, entitlements: entitlements.value) }
    case .actions:
      if let hostID { ActionsSection(context: context, hostID: hostID, entitlements: entitlements.value) }
    case .webhooks:
      if let hostID { WebhooksSection(context: context, hostID: hostID, entitlements: entitlements.value) }
    case .orgAutomations:
      if let orgID = context.orgID {
        OrgAutomationsSection(context: context, orgID: orgID, sites: orgSites, entitlements: orgEntitlements.value)
      }
    case .orgWorkflows:
      OrgSiteListSection(context: context, kind: .workflows, sites: orgSites, entitlements: orgEntitlements.value)
    case .orgActions:
      OrgSiteListSection(context: context, kind: .actions, sites: orgSites, entitlements: orgEntitlements.value)
    case .orgWebhooks:
      OrgSiteListSection(context: context, kind: .webhooks, sites: orgSites, entitlements: orgEntitlements.value)
    }
  }
}

// MARK: - Shared pieces

/// A row in an automation list: the name, its caption, and a warning line.
struct AutomationRowLabel: View {
  let title: String
  let caption: String
  var detail: String? = nil
  var warning: String? = nil

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(title.isEmpty ? "Untitled" : title).font(AglynFont.body).lineLimit(2)
      Text(caption).font(AglynFont.caption).foregroundStyle(.secondary).lineLimit(2)
      if let detail { Text(detail).font(AglynFont.caption).foregroundStyle(.secondary).lineLimit(2) }
      if let warning {
        Label(warning, systemImage: "exclamationmark.triangle.fill")
          .font(AglynFont.caption).foregroundStyle(AglynColor.warning)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}

/// `1,284 action runs this month · 500,000 included`, once the counter and the plan are read.
struct RunQuotaLineView: View {
  let context: NativePluginContext
  let counter: RunCounter
  let orgID: String?
  let hostID: String?
  let entitlements: AutomationEntitlements?
  @State private var doc = LiveDoc()

  var body: some View {
    let line = runQuotaLine(
      counter: counter, counterDoc: doc.doc?.data, counterRead: doc.loaded && !doc.failed,
      limit: entitlements?.quota(counter.limitKey))
    ZStack(alignment: .leading) {
      Color.clear.frame(width: 1, height: 1)
      if let line {
        Label(line, systemImage: "gauge.with.dots.needle.33percent")
          .font(AglynFont.caption).foregroundStyle(.secondary)
          .accessibilityIdentifier("run-quota-\(counter.rawValue)")
      }
    }
    .task(id: "\(orgID ?? "")|\(hostID ?? "")|\(counter.rawValue)") {
      if let path = AutomationPaths.counter(orgID: orgID, hostID: hostID, counter.rawValue) {
        doc.start(context.firestore, path)
      }
    }
    .onDisappear { doc.stop() }
  }
}

/// A list section's header: its title, and a line under it (the run quota).
struct HubSectionHeader<Line: View>: View {
  let title: String
  @ViewBuilder let line: () -> Line

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      Text(title)
      line()
    }
    .textCase(nil)
  }
}

/// A confirm the hub asks before a destructive or surprising write.
struct PendingConfirm: Identifiable {
  let id = UUID()
  let title: String
  let message: String
  let action: String
  var destructive = true
  let run: () -> Void
}

extension View {
  func automationConfirm(_ pending: Binding<PendingConfirm?>) -> some View {
    alert(
      pending.wrappedValue?.title ?? "", isPresented: Binding(get: { pending.wrappedValue != nil }, set: { if !$0 { pending.wrappedValue = nil } }),
      presenting: pending.wrappedValue
    ) { confirm in
      Button(confirm.action, role: confirm.destructive ? .destructive : nil) { confirm.run() }
        .accessibilityIdentifier("confirm-action")
      Button("Cancel", role: .cancel) {}
    } message: { confirm in
      Text(confirm.message)
    }
  }
}

/// Runs a write and reports it: success words, or the error's.
@MainActor
func report(_ success: String?, failure: String = "An error has occurred", _ work: @escaping () async throws -> Void) {
  Task {
    do {
      try await work()
      if let success { AutomationToasts.shared.show(success) }
    } catch {
      let message = (error as? ConsoleAPIError).map { routeMessage($0, fallback: $0.message) } ?? failure
      AutomationToasts.shared.show(message, .error)
    }
  }
}

// MARK: - Workflows

struct WorkflowsSection: View {
  let context: NativePluginContext
  let hostID: String
  let entitlements: AutomationEntitlements?
  @State private var live = LiveQuery()
  @State private var serverCount: Int?
  @State private var scanning: String?
  @State private var confirm: PendingConfirm?
  @State private var duplicating: WorkflowRow?

  private var api: AutomationAPI { context.automationAPI }

  var body: some View {
    let (window, truncated) = ceilinged(live.docs, AutomationCeilings.workflows)
    let rows = visibleWorkflows(window)
    let used = serverCount ?? rows.count
    List {
      Section {
        if live.docs == nil {
          SkeletonRows(count: 3)
        } else if live.failed && rows.isEmpty {
          AglynNotice("Could not load this site’s workflows.", tone: .error)
        } else if rows.isEmpty {
          Text("Chain your functions into multi-step pipelines — each step feeds the next. Site-event triggers are coming next.")
            .font(AglynFont.subheadline).foregroundStyle(.secondary)
            .accessibilityIdentifier("workflows-empty")
        }
        ForEach(rows) { row in
          HStack(spacing: AglynSpace.one) {
            Button {
              context.navigate(workflowScreen, ["id": row.id, "hostId": hostID])
            } label: {
              AutomationRowLabel(title: row.name, caption: row.caption)
            }
            .buttonStyle(.plain)
            trailingMenu(row)
          }
          .contextMenu { menu(row) }
          .swipeActions { Button("Delete", role: .destructive) { delete(row) } }
          .accessibilityIdentifier("workflow-\(row.id)")
        }
      } header: {
        HubSectionHeader(title: "Workflows") {
          RunQuotaLineView(
            context: context, counter: .workflowRuns, orgID: context.orgID, hostID: hostID, entitlements: entitlements)
        }
      } footer: {
        if truncated {
          Text(
            "Showing 100 workflows, ordered by id. This site has more — the duplicate-name check below only covers the ones listed here, so a name may already be taken by one that is not."
          )
        }
      }
      Section {
        Button {
          add(used: used)
        } label: {
          Label("Add workflow", systemImage: "plus")
        }
        .accessibilityIdentifier("add-workflow")
      } footer: {
        AglynQuotaReadout(
          ready: entitlements != nil, used: used, limit: entitlements?.quota("workflowsPerHost")?.cap, noun: "workflow")
      }
    }
    .aglynListBackground()
    .accessibilityIdentifier("workflows-list")
    .automationConfirm($confirm)
    .sheet(item: $duplicating) { row in
      DuplicateWorkflowSheet(row: row) { name in
        let key = createResourceUID()
        try await api.duplicateWorkflow(hostID: hostID, sourceID: row.id, name: name, attemptKey: key)
      }
    }
    .task(id: hostID) {
      live.start(context.firestore, AutomationQueries.workflows(hostID))
      serverCount = try? await context.firestore.count(FirestoreQuery(AutomationPaths.workflows(hostID)))
    }
    .onDisappear { live.stop() }
  }

  private func trailingMenu(_ row: WorkflowRow) -> some View {
    Menu {
      menu(row)
    } label: {
      Image(systemName: scanning == row.id ? "hourglass" : "ellipsis.circle")
        .imageScale(.large).foregroundStyle(AglynColor.tint)
        .frame(width: 44, height: 44)
        .contentShape(Rectangle())
    }
    .buttonStyle(.borderless)
    .accessibilityLabel("Actions for \(row.name)")
    .accessibilityIdentifier("workflow-\(row.id)-menu")
  }

  @ViewBuilder
  private func menu(_ row: WorkflowRow) -> some View {
    Button { usage(row) } label: { Label(scanning == row.id ? "Scanning…" : "Usage", systemImage: "point.topleft.down.to.point.bottomright.curvepath") }
      .disabled(scanning == row.id)
    Button {
      context.navigate(runsScreen, ["targetId": row.id, "name": row.name, "hostId": hostID])
    } label: {
      Label("Runs", systemImage: "clock.arrow.circlepath")
    }
    Button {
      context.navigate(workflowScreen, ["id": row.id, "hostId": hostID])
    } label: {
      Label("Edit", systemImage: "pencil")
    }
    Button { duplicating = row } label: { Label("Duplicate…", systemImage: "plus.square.on.square") }
    Button(role: .destructive) { delete(row) } label: { Label("Delete", systemImage: "trash") }
  }

  private func add(used: Int) {
    guard let entitlements else { return }
    if !entitlements.has("workflows") {
      return AutomationToasts.shared.show("Workflows require a Starter plan — see Billing to upgrade", .warning)
    }
    if !entitlements.allows("workflowsPerHost", used: used) {
      let cap = entitlements.quota("workflowsPerHost")?.cap.map { jsNumberString($0) } ?? ""
      return AutomationToasts.shared.show("Workflow limit reached (\(cap)) — upgrade in Billing", .warning)
    }
    context.navigate(workflowScreen, ["id": "new", "hostId": hostID])
  }

  private func usage(_ row: WorkflowRow) {
    scanning = row.id
    Task {
      let result = await api.whereUsed(hostID: hostID, id: row.id, name: row.name)
      scanning = nil
      AutomationToasts.shared.show(result.usageMessage(row.name), .info)
    }
  }

  private func delete(_ row: WorkflowRow) {
    scanning = row.id
    Task {
      let scan = await api.whereUsed(hostID: hostID, id: row.id, name: row.name)
      scanning = nil
      confirm = PendingConfirm(title: "Delete this workflow?", message: scan.deleteMessage(row.name), action: "Delete") {
        report("Workflow deleted") { try await api.softDelete(AutomationPaths.workflows(hostID) + [row.id]) }
      }
    }
  }
}

/// The console's Duplicate dialog: a name (taken names get a number), and what the copy carries.
struct DuplicateWorkflowSheet: View {
  @Environment(\.dismiss) private var dismiss
  let row: WorkflowRow
  let perform: (String) async throws -> String
  @State private var name: String
  @State private var busy = false
  @State private var error: String?

  init(row: WorkflowRow, perform: @escaping (String) async throws -> String) {
    self.row = row
    self.perform = perform
    let source = row.name.trimmingCharacters(in: .whitespacesAndNewlines)
    let base = source.isEmpty ? "Untitled" : source
    _name = State(initialValue: jsSliceText(base.hasPrefix("Copy of ") ? base : "Copy of \(base)", 200))
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          AglynLabeledField(
            "Name", text: Binding(get: { name }, set: { name = jsSliceText($0, 200) }),
            helper: "A name another workflow already has gets a number.")
            .accessibilityIdentifier("duplicate-name")
        }
        Section("What the copy carries") {
          Label("Every step and the return value", systemImage: "checkmark")
          Label("The trigger is cleared, so the copy runs nothing until you arm it", systemImage: "bolt.slash")
        }
        if let error { Section { AglynNotice(error, tone: .error) } }
      }
      .formStyle(.grouped)
      .navigationTitle("Duplicate workflow")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
        ToolbarItem(placement: .confirmationAction) {
          Button(busy ? "Duplicating…" : "Duplicate") {
            busy = true
            error = nil
            Task {
              do {
                let copy = try await perform(name.trimmingCharacters(in: .whitespacesAndNewlines))
                AutomationToasts.shared.show("Duplicated as “\(copy)” — arm its trigger to run it")
                dismiss()
              } catch {
                self.error = routeMessage(error, fallback: "Duplicate failed")
              }
              busy = false
            }
          }
          .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
          .accessibilityIdentifier("duplicate-confirm")
        }
      }
    }
    .presentationDetents([.medium, .large])
  }
}

// MARK: - Actions

struct ActionsSection: View {
  let context: NativePluginContext
  let hostID: String
  let entitlements: AutomationEntitlements?
  @State private var live = LiveQuery()
  @State private var confirm: PendingConfirm?
  @State private var testing: String?
  @State private var orgLive = LiveQuery()

  private var api: AutomationAPI { context.automationAPI }

  var body: some View {
    let (window, truncated) = ceilinged(live.docs, AutomationCeilings.actions)
    let (rows, elements) = visibleActions(window)
    List {
      Section {
        Text(
          "When a site event fires, run automations in order — trigger a workflow, show the visitor an alert, chain a custom event, or write to a dataset. Pro plans and up."
        )
        .font(AglynFont.subheadline).foregroundStyle(.secondary)
        if live.docs == nil {
          SkeletonRows(count: 3)
        } else if live.failed && rows.isEmpty {
          AglynNotice("Could not load this site’s actions.", tone: .error)
        }
        ForEach(rows) { row in
          HStack(spacing: AglynSpace.oneAndHalf) {
            Toggle("Switched on", isOn: Binding(get: { row.enabled }, set: { toggle(row, on: $0) }))
              .labelsHidden()
              .accessibilityLabel("Switch \(row.name) on or off")
              .accessibilityIdentifier("action-\(row.id)-switch")
            Button {
              context.navigate(actionScreen, ["id": row.id, "hostId": hostID])
            } label: {
              AutomationRowLabel(title: row.name, caption: row.caption, warning: placeholderLine(row.placeholders.count))
            }
            .buttonStyle(.plain)
            Menu {
              menu(row)
            } label: {
              Image(systemName: testing == row.id ? "hourglass" : "ellipsis.circle").imageScale(.large)
                .foregroundStyle(AglynColor.tint).frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Actions for \(row.name)")
            .accessibilityIdentifier("action-\(row.id)-menu")
          }
          .contextMenu { menu(row) }
          .swipeActions { Button("Delete", role: .destructive) { delete(row) } }
          .accessibilityIdentifier("action-\(row.id)")
        }
      } header: {
        HubSectionHeader(title: "Actions") {
          RunQuotaLineView(
            context: context, counter: .actionRuns, orgID: context.orgID, hostID: hostID, entitlements: entitlements)
        }
      } footer: {
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          if truncated {
            Text(
              "Showing the first 100 rows of this site’s automations, ordered by id. There are more — both the list above and the interaction count below describe only what was read."
            )
          }
          if let line = elementInteractionLine(elements) { Text(line).accessibilityIdentifier("element-interactions") }
        }
      }
      Section {
        Button {
          add()
        } label: {
          Label("Add action", systemImage: "plus")
        }
        .accessibilityIdentifier("add-action")
      }
      SiteOrgAutomationsPanel(context: context, hostID: hostID, rows: sortedOrgAutomations(orgLive.docs ?? []))
    }
    .aglynListBackground()
    .accessibilityIdentifier("actions-list")
    .automationConfirm($confirm)
    .task(id: hostID) {
      live.start(context.firestore, AutomationQueries.actions(hostID))
      if let orgID = context.orgID {
        orgLive.start(context.firestore, AutomationQueries.orgAutomationsOnSite(orgID, hostID: hostID))
      }
    }
    .onDisappear {
      live.stop()
      orgLive.stop()
    }
  }

  @ViewBuilder
  private func menu(_ row: ActionRow) -> some View {
    Button {
      context.navigate(actionScreen, ["id": row.id, "hostId": hostID])
    } label: {
      Label("Edit", systemImage: "pencil")
    }
    if row.testable {
      Button { test(row) } label: { Label("Test", systemImage: "play") }.disabled(testing == row.id)
    }
    Button {
      context.navigate(runsScreen, ["targetId": row.id, "name": row.name, "hostId": hostID])
    } label: {
      Label("Runs", systemImage: "clock.arrow.circlepath")
    }
    Button(role: .destructive) { delete(row) } label: { Label("Delete", systemImage: "trash") }
  }

  private func add() {
    guard let entitlements else { return }
    guard entitlements.has("actions") else {
      return AutomationToasts.shared.show("The actions builder requires a Pro plan — see Billing to upgrade", .warning)
    }
    context.navigate(actionScreen, ["id": "new", "hostId": hostID])
  }

  private func toggle(_ row: ActionRow, on: Bool) {
    let write = { report(nil) { try await api.setActionEnabled(hostID: hostID, id: row.id, enabled: on) } }
    let missing = on ? row.placeholders : []
    guard !missing.isEmpty else { return write() }
    confirm = PendingConfirm(
      title: "Switch on with placeholders?", message: placeholderConfirmMessage(name: row.name, missing),
      action: "Switch on anyway", destructive: false, run: write)
  }

  private func test(_ row: ActionRow) {
    testing = row.id
    Task {
      do {
        AutomationToasts.shared.show(try await api.testAction(hostID: hostID, actionID: row.id))
      } catch {
        AutomationToasts.shared.show(testRunRefusal(error), .warning)
      }
      testing = nil
    }
  }

  private func delete(_ row: ActionRow) {
    confirm = PendingConfirm(title: "Delete this action?", message: "\"\(row.name)\" stops running on its trigger.", action: "Delete") {
      report(nil) { try await api.softDelete(AutomationPaths.actions(hostID) + [row.id]) }
    }
  }
}

/// "Org automations on this site": what the organization runs here, and the site's pause for each.
struct SiteOrgAutomationsPanel: View {
  let context: NativePluginContext
  let hostID: String
  let rows: [OrgAutomationRow]
  @State private var busy: String?

  var body: some View {
    Group {
      if !rows.isEmpty {
        Section {
          ForEach(rows) { row in
            let paused = row.pausedHostIDs.contains(hostID)
            let (chip, tone) = orgAutomationSiteChip(row, hostID: hostID)
            HStack(spacing: AglynSpace.one) {
              AutomationRowLabel(title: row.name, caption: row.caption)
              StatusChip(chip, tone: tone.uiTone)
              Menu {
                Button {
                  setPaused(row, !paused)
                } label: {
                  Label(paused ? "Resume here" : "Pause here", systemImage: paused ? "play" : "pause")
                }
                .disabled(busy == row.id)
                Button {
                  context.navigate(
                    runsScreen, ["targetId": row.id, "name": row.name, "hostId": hostID, "hostScope": "site"])
                } label: {
                  Label("Runs", systemImage: "clock.arrow.circlepath")
                }
              } label: {
                Image(systemName: "ellipsis.circle").imageScale(.large).foregroundStyle(AglynColor.tint)
                  .frame(width: 44, height: 44).contentShape(Rectangle())
              }
              .buttonStyle(.borderless)
              .accessibilityLabel("Actions for \(row.name)")
              .accessibilityIdentifier("site-org-\(row.id)-menu")
            }
            .accessibilityIdentifier("site-org-\(row.id)")
          }
        } header: {
          Text("Org automations on this site")
        } footer: {
          Text(
            "Your organization runs these on this site beside the site’s own actions. Each run sends from this site and counts on its action runs. Pausing one stops it here — and anyone waiting inside it here — and leaves every other site alone."
          )
        }
      }
    }
  }

  private func setPaused(_ row: OrgAutomationRow, _ paused: Bool) {
    busy = row.id
    Task {
      do {
        try await context.automationAPI.pause(hostID: hostID, automationID: row.id, paused: paused)
        AutomationToasts.shared.show(paused ? "“\(row.name)” is paused on this site" : "“\(row.name)” runs on this site again")
      } catch {
        AutomationToasts.shared.show(routeMessage(error), .warning)
      }
      busy = nil
    }
  }
}

extension AglynToneName {
  var uiTone: AglynTone {
    switch self {
    case .neutral: .neutral
    case .success: .success
    case .warning: .warning
    case .error: .error
    case .info: .info
    }
  }
}

// MARK: - Webhooks

struct WebhooksSection: View {
  let context: NativePluginContext
  let hostID: String
  let entitlements: AutomationEntitlements?
  @State private var live = LiveQuery()
  @State private var host = LiveDoc()
  @State private var confirm: PendingConfirm?

  var body: some View {
    let rows = visibleWebhooks(ceilinged(live.docs, AutomationCeilings.webhooks).rows)
    let siteBase = HostStatus.publicOrigin(host.doc?.data) ?? ""
    List {
      Section {
        Text("Send signed JSON to outside systems from the actions builder, or accept calls that run a workflow. Business plans.")
          .font(AglynFont.subheadline).foregroundStyle(.secondary)
        if live.docs == nil {
          SkeletonRows(count: 2)
        } else if live.failed && rows.isEmpty {
          AglynNotice("Only a site admin or editor can see this site’s webhooks.", tone: .info)
        }
        ForEach(rows) { row in
          HStack(spacing: AglynSpace.one) {
            Image(systemName: row.inbound ? "arrow.down.circle" : "arrow.up.circle").foregroundStyle(AglynColor.tint)
              .accessibilityHidden(true)
            AutomationRowLabel(title: row.name, caption: row.caption(siteBase: siteBase, hostID: hostID))
            Menu {
              menu(row, siteBase: siteBase)
            } label: {
              Image(systemName: "ellipsis.circle").imageScale(.large).foregroundStyle(AglynColor.tint)
                .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Actions for \(row.name)")
            .accessibilityIdentifier("webhook-\(row.id)-menu")
          }
          .contextMenu { menu(row, siteBase: siteBase) }
          .swipeActions { Button("Delete", role: .destructive) { delete(row) } }
          .accessibilityIdentifier("webhook-\(row.id)")
        }
      } header: {
        Text("Webhooks")
      }
      Section {
        Button {
          add(count: rows.count)
        } label: {
          Label("Add webhook", systemImage: "plus")
        }
        .accessibilityIdentifier("add-webhook")
      }
    }
    .aglynListBackground()
    .accessibilityIdentifier("webhooks-list")
    .automationConfirm($confirm)
    .task(id: hostID) {
      live.start(context.firestore, AutomationQueries.webhooks(hostID))
      host.start(context.firestore, AutomationPaths.host(hostID))
    }
    .onDisappear {
      live.stop()
      host.stop()
    }
  }

  @ViewBuilder
  private func menu(_ row: WebhookRow, siteBase: String) -> some View {
    if row.inbound {
      Button {
        AglynPasteboard.copy(row.endpoint(siteBase: siteBase, hostID: hostID))
        AutomationToasts.shared.show("Endpoint URL copied — send the secret in x-aglyn-secret")
      } label: {
        Label("Copy URL", systemImage: "link")
      }
    }
    Button {
      AglynPasteboard.copy(row.secret)
      AutomationToasts.shared.show("Secret copied")
    } label: {
      Label("Secret", systemImage: "key")
    }
    Button(role: .destructive) { delete(row) } label: { Label("Delete", systemImage: "trash") }
  }

  private func add(count: Int) {
    guard let entitlements else { return }
    if !entitlements.has("webhooks") {
      return AutomationToasts.shared.show("Webhooks require a Business plan — see Billing to upgrade", .warning)
    }
    if count >= webhookMaxPerHost {
      return AutomationToasts.shared.show("Webhooks are capped at \(webhookMaxPerHost) per site", .warning)
    }
    context.navigate(webhookScreen, ["hostId": hostID])
  }

  private func delete(_ row: WebhookRow) {
    confirm = PendingConfirm(
      title: "Delete this webhook?",
      message: "\"\(row.name)\" stops \(row.inbound ? "accepting calls" : "delivering") immediately.", action: "Delete"
    ) {
      report(nil) { try await context.automationAPI.softDelete(AutomationPaths.webhooks(hostID) + [row.id]) }
    }
  }
}
