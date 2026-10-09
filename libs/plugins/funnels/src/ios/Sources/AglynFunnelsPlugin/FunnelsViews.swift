// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

private func planGranting(_ feature: String) -> String? {
  let order = ["free", "starter", "pro", "business", "scale", "advanced", "agency", "enterprise"]
  for plan in order where PlanFeatureDefaults.byPlan[plan]?[feature] == true {
    return plan.prefix(1).uppercased() + plan.dropFirst()
  }
  return nil
}

private func grouped(_ value: Int) -> String { value.formatted(.number.grouping(.automatic)) }

/// The site's funnels (the console's Funnels card on the Analytics page): each
/// funnel's steps, the visits that reached them over a range, and where they
/// dropped off. In a wide window the list sits beside the selected funnel.
/// New and edit with the card's own checks, Create with AI, Activate for a
/// draft, delete, and "Act on this drop-off", all through `/api/funnels/...`.
struct FunnelsScreen: View {
  let context: NativePluginContext
  @State private var model = HostFunnelsModel()
  @State private var access = FunnelsAccess()
  @State private var selection: FunnelRow.ID?
  @State private var editor: FunnelsEditor?

  var body: some View {
    Group {
      if !access.org.ready {
        List { SkeletonRows(count: 4) }.aglynListBackground()
      } else if !access.state.entitled {
        AglynEmptyState(
          "Funnels come with analytics", systemImage: FunnelsSymbols.funnel,
          message:
            "Funnels come with per-page analytics, included from \(planGranting(ContractValues.shared.funnelFeature) ?? "a paid plan"). Change the plan under Billing to use them."
        )
        .accessibilityIdentifier("funnels-locked")
      } else {
        content
      }
    }
    .navigationTitle("Funnels")
    .task(id: context.hostID) {
      access.start(context)
      editor = context.hostID.map {
        FunnelsEditor(api: ConsoleFunnelsAPI(api: context.api, reader: context.firestore, hostID: $0))
      }
      model.start(context.firestore, hostID: context.hostID)
    }
    .onDisappear {
      model.stop()
      access.stop()
    }
  }

  @ViewBuilder
  private var content: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          list(selectable: true).frame(minWidth: 300, idealWidth: 360, maxWidth: 420)
          Divider()
          if let row = model.rows.first(where: { $0.id == selection }), let editor {
            FunnelDetail(row: row, editor: editor, canManage: access.state.canManage).id(row.id)
              .frame(maxWidth: .infinity, maxHeight: .infinity)
          } else {
            AglynEmptyState("Pick a funnel to see its results", systemImage: FunnelsSymbols.funnel)
              .frame(maxWidth: .infinity, maxHeight: .infinity)
          }
        }
      } else {
        list(selectable: false)
      }
    }
    .toolbar {
      if access.state.canManage, let editor {
        ToolbarItemGroup(placement: .primaryAction) {
          Button { editor.askPropose() } label: { Label("Create with AI", systemImage: FunnelsSymbols.ai) }
            .disabled(model.rows.count >= ContractValues.shared.funnelsMaxPerSite)
            .accessibilityIdentifier("funnels-propose")
          Button { Task { await editor.add() } } label: { Label("New funnel", systemImage: "plus") }
            .disabled(model.rows.count >= ContractValues.shared.funnelsMaxPerSite || editor.busy)
            .accessibilityIdentifier("funnels-add")
        }
      }
    }
    .safeAreaInset(edge: .bottom) {
      VStack(spacing: AglynSpace.one) {
        if let editor, editor.draft == nil, !editor.proposing, editor.deleting == nil, editor.dropOff == nil {
          if let error = editor.error { AglynNotice(error, tone: .error) }
          if let notice = editor.notice { AglynNotice(notice, tone: .success) { editor.notice = nil } }
        }
      }
      .padding(.horizontal, AglynSpace.two)
    }
    .sheet(isPresented: Binding(get: { editor?.draft != nil }, set: { if !$0 { editor?.close() } })) {
      if let editor { FunnelEditorSheet(editor: editor) }
    }
    .sheet(isPresented: Binding(get: { editor?.proposing == true }, set: { if !$0 { editor?.close() } })) {
      if let editor { FunnelProposeSheet(editor: editor) }
    }
    .sheet(isPresented: Binding(get: { editor?.dropOff != nil }, set: { if !$0 { editor?.close() } })) {
      if let editor { DropOffSheet(editor: editor) }
    }
    .confirmationDialog(
      "Delete this funnel?", isPresented: Binding(get: { editor?.deleting != nil }, set: { if !$0 { editor?.close() } }),
      titleVisibility: .visible
    ) {
      Button("Delete", role: .destructive) { Task { await editor?.confirmDelete() } }
    } message: {
      Text("\(editor?.deleting?.name ?? "This funnel") and its results are removed. Recorded visits are kept until they expire.")
    }
  }

  @ViewBuilder
  private func list(selectable: Bool) -> some View {
    if !model.ready {
      List { SkeletonRows(count: 4) }.aglynListBackground()
    } else if model.failed {
      AglynEmptyState("Could not load this site's funnels", systemImage: "exclamationmark.triangle")
    } else if model.rows.isEmpty {
      AglynEmptyState(
        "No funnels yet", systemImage: FunnelsSymbols.funnel,
        message:
          "A funnel is the steps you expect a visitor to take, such as a page, then a form, then a booking. It shows how many visits reached each step and where they dropped off. Recording starts when you save the first one."
          + (access.state.canManage ? "" : " A site admin or editor can create one.")
      ) {
        if access.state.canManage {
          Button("New funnel") { Task { await editor?.add() } }.buttonStyle(.borderedProminent)
        }
      }
    } else if selectable {
      List(model.rows, selection: $selection) { row in
        FunnelListRow(row: row).tag(row.id)
      }
      .onChange(of: model.rows, initial: true) { _, rows in
        if selection == nil || !rows.contains(where: { $0.id == selection }) { selection = rows.first?.id }
      }
      .aglynListBackground()
      .accessibilityIdentifier("funnels-list")
    } else {
      List(model.rows) { row in
        NavigationLink {
          if let editor { FunnelDetail(row: row, editor: editor, canManage: access.state.canManage) }
        } label: {
          FunnelListRow(row: row)
        }
        .accessibilityIdentifier("funnel-\(row.id)")
        .aglynListRow()
      }
      .aglynListBackground()
      .accessibilityIdentifier("funnels-list")
    }
  }
}

struct FunnelListRow: View {
  let row: FunnelRow

  var body: some View {
    AglynRow(row.name, subtitle: "\(row.steps.count) steps", systemImage: FunnelsSymbols.funnel) {
      if row.draft { StatusChip("Draft", tone: .info) }
    }
  }
}

private enum ResultState {
  case loading
  case ready(FunnelResult)
  case failed(String)
}

struct FunnelDetail: View {
  let row: FunnelRow
  let editor: FunnelsEditor
  let canManage: Bool
  @State private var days = 30
  @State private var state: ResultState = .loading

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: AglynSpace.two) {
        header
        if row.draft {
          draftReview
        } else {
          results
        }
        Text("A visit is one browser tab, recorded only when the visitor\u{2019}s consent allows analytics.")
          .font(AglynFont.caption).foregroundStyle(.secondary)
      }
      .padding(AglynSpace.two)
    }
    .background(AglynColor.page)
    .navigationTitle(row.name)
    .task(id: "\(row.id)|\(row.version)|\(days)|\(editor.refreshKey)") {
      guard !row.draft else { return }
      state = .loading
      do {
        state = .ready(try await editor.result(for: row, days: days, nowMs: Int(Date().timeIntervalSince1970 * 1000)))
      } catch let failure as ConsoleAPIError where failure.status != 0 {
        state = .failed(failure.message)
      } catch {
        state = .failed("Could not load this funnel's results. Check the connection and try again.")
      }
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      HStack {
        Text(row.name).font(AglynFont.title).accessibilityAddTraits(.isHeader)
        if row.draft { StatusChip("Draft", tone: .info) }
        Spacer()
        if !row.draft {
          Button { editor.refresh() } label: { Label("Refresh", systemImage: "arrow.clockwise") }
            .labelStyle(.iconOnly).accessibilityIdentifier("funnel-refresh")
        }
      }
      if !row.draft {
        Picker("Range", selection: $days) {
          ForEach(funnelRanges, id: \.self) { Text("\($0) days").tag($0) }
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("funnel-range")
      }
      if canManage {
        HStack {
          Button { Task { await editor.edit(row) } } label: { Label("Edit", systemImage: "pencil") }
            .buttonStyle(.borderedProminent).disabled(editor.busy).accessibilityIdentifier("funnel-edit")
          Button(role: .destructive) { editor.askDelete(row) } label: { Label("Delete", systemImage: "trash") }
            .buttonStyle(.bordered).accessibilityIdentifier("funnel-delete")
        }
      }
    }
  }

  private var draftReview: some View {
    AglynCard("Draft, set up for you to review") {
      VStack(alignment: .leading, spacing: AglynSpace.one) {
        Text(
          "It is not measured, and the site does not record visits for it, until "
            + (canManage ? "you activate it." : "a site admin or editor activates it."))
        ForEach(Array(row.steps.enumerated()), id: \.offset) { index, step in
          Text("\(index + 1). \(funnelStepTitle(step))")
        }
        if canManage {
          Button("Activate") { Task { await editor.activate(row) } }
            .buttonStyle(.borderedProminent).disabled(editor.busy).accessibilityIdentifier("funnel-activate")
        }
      }
    }
  }

  @ViewBuilder
  private var results: some View {
    switch state {
    case .loading: ProgressView().frame(maxWidth: .infinity)
    case .failed(let message): AglynNotice(message, tone: .error)
    case .ready(let result):
      FunnelResultView(
        result: result,
        onActOnDropOff: canManage
          ? { reached in
            editor.askDropOff(
              DropOffRequest(
                funnelID: row.id, reachedStep: reached,
                stepLabel: row.steps.indices.contains(reached - 1) ? funnelStepTitle(row.steps[reached - 1]) : "",
                nextStepLabel: row.steps.indices.contains(reached) ? funnelStepTitle(row.steps[reached]) : ""))
          } : nil)
    }
  }
}

struct FunnelResultView: View {
  let result: FunnelResult
  var onActOnDropOff: ((Int) -> Void)?

  var body: some View {
    if result.entered == 0 {
      Text(
        result.journeysRead > 0
          ? "No visit in this range reached the first step yet."
          : "No visits recorded in this range yet. Visits are recorded from when the first funnel was saved, for visitors whose consent allows analytics."
      )
      .foregroundStyle(.secondary)
      .accessibilityIdentifier("funnel-result-empty")
    } else {
      AglynCard("Results") {
        VStack(alignment: .leading, spacing: AglynSpace.two) {
          HStack {
            AglynFigureTile("Entered", value: grouped(result.entered))
            AglynFigureTile("Completed", value: grouped(result.completed), caption: formatShare(result.overall))
          }
          Text("\(grouped(result.completed)) of \(grouped(result.entered)) visitors completed every step (\(formatShare(result.overall))).")
          ForEach(result.steps, id: \.index) { step in
            VStack(alignment: .leading, spacing: AglynSpace.half) {
              HStack {
                Text("\(step.index + 1). \(step.label)").font(AglynFont.subheadline.weight(.semibold))
                Spacer()
                Text("\(grouped(step.visitors)) \u{00B7} \(formatShare(step.fromStart))")
              }
              ProgressView(value: Double(step.visitors), total: Double(max(1, result.entered)))
              if step.index > 0 {
                Text(
                  "\(formatShare(step.fromPrevious)) of the previous step \u{00B7} \(grouped(step.dropOff)) dropped off \u{00B7} median \(formatDuration(step.medianMsFromPrevious)) from the previous step"
                )
                .font(AglynFont.caption).foregroundStyle(.secondary)
                if let onActOnDropOff {
                  Button("Act on this drop-off") { onActOnDropOff(step.index) }
                    .accessibilityIdentifier("funnel-act-\(step.index)")
                }
              }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("funnel-step-\(step.index)")
          }
          if !result.sources.isEmpty {
            Divider()
            Text("By source").font(AglynFont.subheadline.weight(.semibold))
            ForEach(result.sources, id: \.source) { source in
              HStack {
                Text(source.source)
                Spacer()
                Text("\(grouped(source.entered)) in \u{00B7} \(grouped(source.completed)) done \u{00B7} \(formatShare(source.conversion))")
                  .font(AglynFont.caption)
              }
            }
          }
          if result.capped {
            Text("Measured over the \(grouped(result.journeysRead)) most recent visits in this range.")
              .font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
      }
      .accessibilityIdentifier("funnel-result")
    }
  }
}

/// Adding or editing one funnel: a name and 2 to 8 steps, each picked from what the site really has.
struct FunnelEditorSheet: View {
  @Bindable var editor: FunnelsEditor

  var body: some View {
    NavigationStack {
      Form {
        if let error = editor.error { Section { AglynNotice(error, tone: .error) } }
        if let notice = editor.notice { Section { AglynNotice(notice, tone: .info) } }
        Section {
          TextField("Name", text: nameBinding).accessibilityIdentifier("funnel-name")
        }
        ForEach(Array((editor.draft?.steps ?? []).enumerated()), id: \.offset) { index, step in
          Section("Step \(index + 1)") {
            Picker("Step", selection: typeBinding(index)) {
              ForEach(funnelStepTypes, id: \.self) { Text(funnelStepTypeLabel($0)).tag($0) }
            }
            StepKeyField(step: step, inventory: editor.inventory) { updated in
              editor.draft?.steps[index] = updated
            }
            TextField("Label (optional)", text: labelBinding(index))
            HStack {
              Button { move(index, -1) } label: { Label("Move up", systemImage: "chevron.up") }
                .disabled(index == 0)
              Button { move(index, 1) } label: { Label("Move down", systemImage: "chevron.down") }
                .disabled(index >= (editor.draft?.steps.count ?? 0) - 1)
              Spacer()
              Button(role: .destructive) { editor.draft?.steps.remove(at: index) } label: { Label("Remove", systemImage: "trash") }
                .disabled((editor.draft?.steps.count ?? 0) <= ContractValues.shared.funnelMinSteps)
            }
            .labelStyle(.iconOnly).buttonStyle(.borderless)
          }
        }
        Section {
          Button {
            editor.draft?.steps.append(starterStep(.page, editor.inventory))
          } label: {
            Label("Add a step", systemImage: "plus")
          }
          .disabled((editor.draft?.steps.count ?? 0) >= ContractValues.shared.funnelMaxSteps)
          .accessibilityIdentifier("funnel-add-step")
        }
      }
      .formStyle(.grouped)
      .navigationTitle(editor.draft?.id == nil ? "New funnel" : "Edit funnel")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { editor.close() }.disabled(editor.busy) }
        ToolbarItem(placement: .confirmationAction) {
          Button {
            Task { await editor.save() }
          } label: {
            if editor.busy { ProgressView() } else { Text("Save") }
          }
          .disabled(editor.busy || editor.inventory == nil)
          .accessibilityIdentifier("funnel-save")
        }
      }
    }
    .frame(minWidth: 460, minHeight: 520)
  }

  private var nameBinding: Binding<String> {
    Binding(
      get: { editor.draft?.name ?? "" },
      set: { editor.draft?.name = String($0.prefix(ContractValues.shared.funnelNameMax)) })
  }

  private func typeBinding(_ index: Int) -> Binding<SiteJourneyStepType> {
    Binding(
      get: { editor.draft?.steps[index].type ?? .page },
      set: { editor.draft?.steps[index] = starterStep($0, editor.inventory) })
  }

  private func labelBinding(_ index: Int) -> Binding<String> {
    Binding(
      get: { editor.draft?.steps[index].label ?? "" },
      set: { editor.draft?.steps[index].label = String($0.prefix(ContractValues.shared.funnelLabelMax)) })
  }

  private func move(_ index: Int, _ by: Int) {
    guard var steps = editor.draft?.steps, steps.indices.contains(index + by) else { return }
    steps.swapAt(index, index + by)
    editor.draft?.steps = steps
  }
}

/// The picker a step's kind needs: a page, a record, an event's name or an email outcome.
struct StepKeyField: View {
  let step: StepDraft
  let inventory: FunnelInventory?
  let onChange: (StepDraft) -> Void

  var body: some View {
    switch step.type {
    case .order:
      EmptyView()
    case .email:
      Picker("What they did", selection: keyBinding) {
        ForEach(funnelEmailKeys, id: \.self) { Text($0 == "opened" ? "Opened an email from the site" : "Clicked a link in one").tag($0) }
      }
      Text("Counted only for people who submitted a form on this site").font(AglynFont.caption).foregroundStyle(.secondary)
    case .event:
      TextField("Event name", text: keyBinding).autocorrectionDisabled()
      #if os(iOS)
        .textInputAutocapitalization(.never)
      #endif
      Text("As the interaction\u{2019}s Send an analytics event step names it").font(AglynFont.caption).foregroundStyle(.secondary)
    case .page:
      let pages = inventory?.pages ?? []
      Picker("Page", selection: keyBinding) {
        if !pages.contains(step.key) { Text("Pick a page").tag(step.key) }
        ForEach(pages, id: \.self) { Text($0).tag($0) }
      }
      Picker(
        "Match",
        selection: Binding(get: { step.match }, set: { var next = step; next.match = $0; onChange(next) })
      ) {
        Text("This page only").tag(FunnelPageMatch.exact)
        Text("This page and everything under it").tag(FunnelPageMatch.prefix)
      }
    default:
      let list = inventory.flatMap { funnelInventoryList($0, step.type) } ?? []
      Picker("Which", selection: keyBinding) {
        Text("Any").tag("")
        ForEach(list, id: \.id) { Text($0.name).tag($0.id) }
      }
    }
  }

  private var keyBinding: Binding<String> {
    Binding(get: { step.key }, set: { var next = step; next.key = $0; next.label = ""; onChange(next) })
  }
}

/// "Create with AI": a description becomes a checked draft that opens in the editor. Nothing is saved.
struct FunnelProposeSheet: View {
  @Bindable var editor: FunnelsEditor
  @State private var brief = ""

  var body: some View {
    NavigationStack {
      Form {
        if let error = editor.error { Section { AglynNotice(error, tone: .error) } }
        Section {
          TextField("Describe the funnel", text: $brief, axis: .vertical)
            .lineLimit(3...8).accessibilityIdentifier("funnel-brief")
        } footer: {
          Text("Describe the journey you want to measure. The draft is checked against the pages and records your site has, and opens in the editor. Nothing is saved until you save it.")
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Create a funnel with AI")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { editor.close() }.disabled(editor.busy) }
        ToolbarItem(placement: .confirmationAction) {
          Button {
            Task { await editor.propose(String(brief.prefix(1_000))) }
          } label: {
            if editor.busy { ProgressView() } else { Text("Create draft") }
          }
          .disabled(editor.busy || brief.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
      }
    }
    .frame(minWidth: 420, minHeight: 320)
  }
}

/// "Act on this drop-off": a follow-up on people who reached a step and did not go on, drafted switched off.
struct DropOffSheet: View {
  @Bindable var editor: FunnelsEditor
  @State private var hours = 24
  @State private var action: DropOffAction = .email

  var body: some View {
    NavigationStack {
      Form {
        if let error = editor.error { Section { AglynNotice(error, tone: .error) } }
        Section {
          Picker("Wait", selection: $hours) {
            ForEach(dropOffWaits(), id: \.self) { Text("After \(waitLabel($0))").tag($0) }
          }
          Picker("Then", selection: $action) {
            Text("Send an email").tag(DropOffAction.email)
            Text("Create a task").tag(DropOffAction.task)
          }
          .pickerStyle(.segmented)
        } footer: {
          Text(
            "For people who identified themselves with a form and reached \u{201C}\(editor.dropOff?.stepLabel ?? "")\u{201D} but not \u{201C}\(editor.dropOff?.nextStepLabel ?? "")\u{201D}. The automation is drafted switched off; nothing runs until you switch it on."
          )
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Act on this drop-off")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { editor.close() }.disabled(editor.busy) }
        ToolbarItem(placement: .confirmationAction) {
          Button {
            Task { await editor.draftDropOff(afterHours: hours, action: action) }
          } label: {
            if editor.busy { ProgressView() } else { Text("Draft automation") }
          }
          .disabled(editor.busy)
        }
      }
    }
    .frame(minWidth: 420, minHeight: 320)
  }
}
