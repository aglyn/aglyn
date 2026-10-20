// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import AuthenticationServices
import SwiftUI
import UniformTypeIdentifiers

#if canImport(UIKit)
  import UIKit
#elseif canImport(AppKit)
  import AppKit
#endif

/// Draws a console screen from its spec: grouped sections on every size,
/// list and detail side by side on a wide window when the spec asks for it,
/// pull to refresh, skeleton, empty and error states, and every action with
/// its confirmation, inputs, re-auth and result.
public struct SpecScreenView: View {
  let spec: ScreenSpec
  let plugin: NativePluginContext
  let params: NativeParams
  /// Inside a list's detail pane: no split of its own.
  var embedded = false

  @Environment(\.aglynScreenSession) private var session
  @Environment(\.webAuthenticationSession) private var webAuthentication
  @Environment(\.authorizationController) private var authorizationController
  @State private var model: ScreenModel?
  @State private var selection: ListSelection?

  public init(spec: ScreenSpec, context: NativePluginContext, params: NativeParams = [:]) {
    self.spec = spec
    self.plugin = context
    self.params = params
  }

  init(spec: ScreenSpec, context: NativePluginContext, params: NativeParams, embedded: Bool) {
    self.spec = spec
    self.plugin = context
    self.params = params
    self.embedded = embedded
  }

  private var baseContext: JSONValue { session.context(plugin, params: params) }

  public var body: some View {
    Group {
      if !ScreenValues.condition(spec.requires, in: baseContext) {
        AglynEmptyState(
          spec.scope == "staff" ? "Staff only" : "Not available to your role", systemImage: "lock",
          message: spec.scope == "staff"
            ? "This page is for Aglyn staff."
            : "Ask an owner or admin of this workspace for access.")
      } else if let model {
        if !embedded, splitBlock != nil {
          WideLayoutReader { wide in
            if wide {
              ListDetailLayout(listWidth: 380, showsDetail: splitListHasRows(model)) {
                SpecScreenBody(model: model, plugin: plugin, selection: $selection, splitting: true, embedded: embedded)
              } detail: {
                detail
              }
            } else {
              SpecScreenBody(model: model, plugin: plugin, selection: $selection, splitting: false, embedded: embedded)
            }
          }
        } else {
          SpecScreenBody(model: model, plugin: plugin, selection: $selection, splitting: false, embedded: embedded)
        }
      } else {
        AglynGroupedForm { SkeletonRows(count: 6) }
      }
    }
    .environment(\.aglynPluginContext, plugin)
    .onChange(of: session.claims) { _, _ in model?.rebase(baseContext) }
    .navigationTitle(ScreenValues.render(spec.title, in: model?.context ?? baseContext))
    .aglynScreenTitle(ScreenValues.render(spec.title, in: model?.context ?? baseContext))
    .task(id: "\(plugin.orgID ?? ""):\(plugin.hostID ?? ""):\(params.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" })") {
      let fresh = ScreenModel(
        spec: spec, context: baseContext, api: plugin.api, reader: plugin.firestore, writer: plugin.writer,
        account: session.account)
      fresh.authenticate = { [webAuthentication] url, scheme in
        try await webAuthentication.authenticate(using: url, callbackURLScheme: scheme, preferredBrowserSession: .shared)
      }
      if session.passkeyRelyingParty != nil {
        fresh.createPasskey = { [authorizationController] options in
          try await SystemPasskeys.create(options, using: authorizationController)
        }
      }
      model = fresh
      selection = nil
      await fresh.load()
    }
  }

  /// Whether the split list has a row to pick: an empty list folds the detail column away (spec 4), so a short Team or
  /// Roles list never sits beside half a window of "Nothing selected".
  private func splitListHasRows(_ model: ScreenModel) -> Bool {
    guard let block = splitBlock else { return true }
    switch model.phase {
    case .loading: return true
    // A failure or an upsell is the whole screen's answer: nothing to pick beside it.
    case .failed, .planRefused: return false
    case .ready: break
    }
    let items = block["items"]?.stringValue ?? ""
    if let through = block["flatten"]?.stringValue {
      return !ScreenValues.flatten(ScreenValues.rows(ScreenValues.lookup(items, in: model.context)), through: through).isEmpty
    }
    return !ScreenValues.scopes(
      items: items, within: block["within"]?.stringValue, filter: block["filter"]?.stringValue, in: model.context
    ).isEmpty
  }

  private var splitBlock: BlockSpec? {
    spec.blocks.first { $0.type == "list" && $0["split"] == .bool(true) && $0["open"] != nil }
  }

  @ViewBuilder
  private var detail: some View {
    if let selection, let detailSpec = ScreenCatalog.shared.spec(selection.screen) {
      NavigationStack {
        SpecScreenView(spec: detailSpec, context: plugin, params: selection.params, embedded: true)
          .id(selection)
      }
    } else {
      AglynSelectionPlaceholder("Nothing selected")
    }
  }
}

/// A row picked in a split list: the detail screen and its params.
struct ListSelection: Hashable {
  let screen: String
  let params: NativeParams
}

/// One action waiting on its confirmation, inputs or a re-auth.
struct PendingAction: Identifiable {
  let id = UUID()
  let action: ActionSpec
  let scope: JSONValue
  var reauthMessage: String?
}

/// An action whose route refused for something another screen settles: that screen, drawn over this one.
struct GatedAction: Identifiable {
  let id = UUID()
  let action: ActionSpec
  let scope: JSONValue
  let spec: ScreenSpec
}

struct SpecScreenBody: View {
  @Bindable var model: ScreenModel
  let plugin: NativePluginContext
  @Binding var selection: ListSelection?
  let splitting: Bool
  /// Shown in another screen's detail column (or a sheet): its actions sit at the top of its own column, never in the
  /// head, which already holds the list's (one More per head).
  var embedded = false

  @Environment(\.aglynScreenSession) private var session
  @Environment(\.webAuthenticationSession) private var webAuthentication
  @Environment(\.openURL) private var openURL
  @Environment(\.dismiss) private var dismiss
  @Environment(\.aglynGateResolve) private var gateResolve
  @Environment(\.aglynWideChrome) private var wide
  @State private var confirming: PendingAction?
  @State private var prompting: PendingAction?
  @State private var reauthing: PendingAction?
  @State private var gating: GatedAction?
  @State private var gatedAgain: GatedAction?
  @State private var gateResolved = false
  @State private var notice: (text: String, tone: AglynTone)?
  @State private var revealed: (title: String, value: String)?
  @State private var exporting: ExportedDownload?
  @State private var exportSheet: TransferExportRequest?
  @State private var running: String?
  @State private var searchText = ""
  @State private var started = false
  /// Each conditional zone screen's own read (its `showWhen`), keyed by screen and params. It is loaded here, by the
  /// screen that is always on screen, never by the row: a row that draws nothing until its read is in has no view for
  /// the read to run on, so it never appeared (GroupTaskTests).
  @State private var zoneReads: [String: ScreenModel] = [:]

  private var context: JSONValue { model.context }

  /// The zone screens listed only while their own condition holds, with the params they open with.
  private var conditionalZoneScreens: [(key: String, spec: ScreenSpec, params: NativeParams)] {
    guard isReady else { return [] }
    return model.spec.blocks
      .filter { $0.type == "zone" && ScreenValues.condition($0.when, in: context) }
      .flatMap { block -> [(key: String, spec: ScreenSpec, params: NativeParams)] in
        let params = renderParams(block["params"], in: context)
        return ScreenCatalog.shared.zone(block["name"]?.stringValue ?? "")
          .filter { $0.showWhen != nil && ScreenValues.condition($0.requires, in: context) }
          .map { (key: Self.zoneKey($0, params), spec: $0, params: params) }
      }
  }

  private static func zoneKey(_ spec: ScreenSpec, _ params: NativeParams) -> String {
    spec.id + "?" + params.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: "&")
  }

  /// Whether a zone lists this screen: at once without a condition, else once its read is in and the condition holds.
  private func zoneShows(_ spec: ScreenSpec, _ params: NativeParams) -> Bool {
    guard spec.showWhen != nil else { return true }
    guard let read = zoneReads[Self.zoneKey(spec, params)], read.phase == .ready else { return false }
    return ScreenValues.condition(spec.showWhen, in: read.context)
  }

  /// Reads every conditional zone screen not read yet, side by side.
  private func loadZoneReads() async {
    let pending = conditionalZoneScreens.filter { zoneReads[$0.key] == nil }
    guard !pending.isEmpty else { return }
    await withTaskGroup(of: Void.self) { group in
      for zone in pending {
        let read = ScreenModel(
          spec: zone.spec, context: session.context(plugin, params: zone.params), api: plugin.api,
          reader: plugin.firestore, writer: nil, account: session.account)
        zoneReads[zone.key] = read
        group.addTask { @MainActor in await read.load() }
      }
    }
  }

  private var isReady: Bool {
    if case .ready = model.phase { return true }
    return false
  }

  var body: some View {
    content
      .safeAreaInset(edge: .top) {
        if let notice {
          AglynNotice(notice.text, tone: notice.tone) { self.notice = nil }
            .aglynContentEdges().padding(.top, AglynSpace.one)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
      }
      .animation(.default, value: notice?.text)
      // On the Mac and iPad the screen's first action is its head's one primary button and the rest are in More; a
      // phone keeps them in its navigation bar.
      .toolbar { if !wide { toolbar } }
      .aglynPrimaryAction(wide && !embedded ? headPrimary : nil)
      .aglynScreenToolbar(id: "spec-\(model.spec.id)") { if wide && !embedded { headMore } }
      // A detail column's own head only when it has actions: Refresh alone is the screen head's More already, and a
      // row holding only a More leaves a strip above the detail (Zach, 2026-10-19).
      .safeAreaInset(edge: .top, spacing: 0) { if wide && embedded && hasOwnActions { embeddedHead } }
      // The zones' conditional screens are read here, where the screen always is (`zoneReads`).
      .task(id: conditionalZoneScreens.map(\.key)) { await loadZoneReads() }
      // A screen that names a `start` action runs it once, as soon as its data is in: the action's own `when` decides
      // whether there is anything to do (a link's `?notice=` that names a notice that cannot be reviewed does nothing).
      .task(id: isReady) {
        guard isReady, !started, let id = model.spec.startAction else { return }
        started = true
        guard let action = model.spec.raw["actions"].array.compactMap(ActionSpec.init).first(where: { $0.id == id }),
          ScreenValues.condition(action.when, in: context)
        else { return }
        trigger(action, scope: context)
      }
      .confirmationDialog(
        confirming.map { $0.action.confirmText(in: $0.scope) ?? ScreenValues.render($0.action.label, in: $0.scope) } ?? "",
        isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
        titleVisibility: .visible
      ) {
        if let pending = confirming {
          Button(pending.action.label, role: pending.action.destructive ? .destructive : nil) {
            confirming = nil
            Task { await execute(pending.action, scope: pending.scope) }
          }
          Button("Cancel", role: .cancel) { confirming = nil }
        }
      }
      .sheet(item: $prompting) { pending in
        ActionInputSheet(pending: pending, context: context, search: { group, words in try await model.lookup(group, words: words) }) { filled in
          prompting = nil
          Task { await execute(pending.action, scope: filled) }
        }
      }
      .sheet(
        item: $gating,
        onDismiss: {
          // The gate's screen closed: if it did what the gate asked, send the same action again, once.
          guard gateResolved, let again = gatedAgain else { return }
          gateResolved = false
          gatedAgain = nil
          Task { await execute(again.action, scope: again.scope, afterGate: true) }
        }
      ) { gated in
        NavigationStack {
          SpecScreenView(spec: gated.spec, context: plugin, params: [:], embedded: true)
            .environment(\.aglynGateResolve, { gateResolved = true })
        }
      }
      .sheet(item: $reauthing) { pending in
        ReauthSheet(email: session.email, message: pending.reauthMessage) { password in
          try await session.reauthenticate(password)
          reauthing = nil
          await session.refreshClaims()
          await execute(pending.action, scope: pending.scope)
        }
      }
      .fileExporter(
        isPresented: Binding(get: { exporting != nil }, set: { if !$0 { exporting = nil } }),
        document: exporting.map { ExportedDocument(data: $0.data) },
        contentType: exporting?.type ?? .data, defaultFilename: exporting?.name
      ) { result in
        if case .failure(let error) = result { show(error.localizedDescription, .error) }
      }
      .sheet(item: $exportSheet) { request in
        TransferExportSheet(context: plugin, request: request) { message in
          exportSheet = nil
          if let message { show(message, .success) }
        }
      }
      .alert(
        revealed?.title ?? "",
        isPresented: Binding(get: { revealed != nil }, set: { if !$0 { revealed = nil } })
      ) {
        Button("Copy") {
          if let value = revealed?.value { copyToClipboard(value) }
          revealed = nil
        }
        Button("Done", role: .cancel) { revealed = nil }
      } message: {
        Text(revealed?.value ?? "")
      }
  }

  @ViewBuilder
  private var content: some View {
    switch model.phase {
    case .loading:
      AglynGroupedForm { SkeletonRows(count: 6) }
    case .failed(let message):
      // On the page's own ground, as the loaded screen is: a bare state shows the window behind it (black in dark).
      AglynEmptyState("This did not load", systemImage: "exclamationmark.triangle", message: message) {
        Button("Try again") { Task { await model.load() } }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(AglynGround())
    case .planRefused(let message):
      AglynUpsellState(
        "Add this to your plan", message: message, systemImage: "sparkles", actionTitle: "See add-ons"
      ) {
        plugin.navigate("core.billing.addons", [:])
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(AglynGround())
    case .ready:
      let blocks = model.spec.blocks.filter { ScreenValues.condition($0.when, in: context) }
      // Fills its column: the Mac draws its own grouped sections (`AglynGroupedForm`), the cards on the content edges.
      // A list screen on the Mac and iPad is a content list instead (Figma Mac Sites 13:3): no card and no grey ground,
      // its rows edge to edge with their content on E, and its search and one Filter in its list toolbar.
      let form = AglynGroupedForm(plain: wide && screenList != nil ? true : nil) {
        ForEach(blocks) { block in
          blockView(block)
        }
      }
      .refreshable { await model.load() }
      if let list = toolbarList {
        form
          .aglynSearchable(text: $searchText, prompt: "Search", onSubmit: submitSearch) {
            SpecListFilter(
              block: list, model: model, context: context, filters: filterActions,
              trigger: { action, scope in trigger(action, scope: scope) })
          }
          .onChange(of: searchText) { _, now in if now.isEmpty { submitSearch() } }
      } else {
        form.modifier(SearchModifier(enabled: searchLoad != nil, text: $searchText, submit: submitSearch))
      }
    }
  }

  private func submitSearch() {
    if let key = searchLoad {
      model.search[key] = searchText
      Task { await model.load() }
    }
  }

  private var searchLoad: String? {
    model.spec.blocks.first { $0.type == "list" && $0["search"] == .bool(true) }?["load"]?.stringValue
  }

  /// The screen's one list, when everything else it shows is a notice: a list screen (the staff lists, Activity).
  private var screenList: BlockSpec? {
    let shown = model.spec.blocks.filter { $0.type != "notice" && ScreenValues.condition($0.when, in: context) }
    guard shown.count == 1, let only = shown.first, only.type == "list" else { return nil }
    return only
  }

  /// A list screen that searches: on the Mac and iPad its list toolbar holds the search and the one Filter, so the
  /// list has no header row of its own and the screen's filter action leaves its head.
  private var toolbarList: BlockSpec? {
    guard wide, let list = screenList, list["search"] == .bool(true) else { return nil }
    return list
  }

  /// The screen's actions that apply now.
  private var actions: [ActionSpec] {
    model.spec.raw["actions"].array.compactMap(ActionSpec.init).filter { ScreenValues.condition($0.when, in: context) }
  }

  /// The screen's own filter actions: they open this screen again with the person's choices ("Filter the list").
  private var filterActions: [ActionSpec] {
    actions.filter { $0.navigate?.screen == model.spec.id && !$0.prompt.isEmpty }
  }

  /// The actions the head offers: a filter action is the list toolbar's Filter, never a primary (Zach, 2026-10-19).
  private var headActions: [ActionSpec] {
    guard toolbarList != nil else { return actions }
    let filters = Set(filterActions.map(\.id))
    return actions.filter { !filters.contains($0.id) }
  }

  /// Whether a detail column has actions of its own to head it.
  private var hasOwnActions: Bool { !headActions.isEmpty }

  /// The head's primary button: the screen's first action, unless it is destructive.
  private var headPrimary: AglynPrimaryAction? {
    guard let first = headActions.first, !first.destructive else { return nil }
    let scope = context
    return AglynPrimaryAction(
      id: "spec-action-\(first.id)", title: first.label, systemImage: first.icon ?? "plus", enabled: running == nil
    ) { trigger(first, scope: scope) }
  }

  /// A detail column's own actions on the Mac and iPad, at its top right as Figma draws a detail's (Orders 13:483):
  /// its first action as the filled button, the rest and Refresh in its More.
  @ViewBuilder
  private var embeddedHead: some View {
    HStack(spacing: 8) {
      Spacer(minLength: 0)
      headMore
        .buttonStyle(AglynHeaderButtonStyle())
        .menuStyle(.button)
        .fixedSize()
      if let primary = headPrimary { AglynPrimaryHeaderButton.blockable(primary) }
    }
    .padding(.horizontal, AglynContentInsets.horizontal)
    .padding(.top, 16)
    .padding(.bottom, 4)
  }

  /// The head's More menu: the other actions, and Refresh on the Mac.
  @ViewBuilder
  private var headMore: some View {
    let rest = headPrimary == nil ? headActions : Array(headActions.dropFirst())
    #if os(macOS)
      let refresh = true
    #else
      let refresh = false
    #endif
    if !rest.isEmpty || refresh {
      AglynMoreMenu {
        ForEach(rest) { action in
          Button(role: action.destructive ? .destructive : nil) { trigger(action, scope: context) } label: {
            Label(action.label, systemImage: action.icon ?? "circle")
          }
          .disabled(running != nil)
        }
        if refresh {
          if !rest.isEmpty { Divider() }
          Button { Task { await model.load() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
            .keyboardShortcut("r", modifiers: .command)
        }
      }
    }
  }

  @ToolbarContentBuilder
  private var toolbar: some ToolbarContent {
    let actions = actions
    if let first = actions.first {
      ToolbarItem(placement: .primaryAction) {
        if actions.count == 1 {
          Button { trigger(first, scope: context) } label: { Label(first.label, systemImage: first.icon ?? "plus") }
            .disabled(running != nil)
        } else {
          Menu {
            ForEach(actions) { action in
              Button(role: action.destructive ? .destructive : nil) { trigger(action, scope: context) } label: {
                Label(action.label, systemImage: action.icon ?? "circle")
              }
            }
          } label: {
            Label("Actions", systemImage: "ellipsis.circle")
          }
        }
      }
    }
    #if os(macOS)
      ToolbarItem(placement: .automatic) {
        Button { Task { await model.load() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
          .keyboardShortcut("r", modifiers: .command)
      }
    #endif
  }

  // MARK: Blocks

  @ViewBuilder
  private func blockView(_ block: BlockSpec) -> some View {
    let title = block.title.map { ScreenValues.render($0, in: context) }
    let footer = block.footer.map { ScreenValues.render($0, in: context) }
    switch block.type {
    case "fields":
      section(title, footer) { FieldsBlock(block: block, context: context, copy: copyToClipboard) }
    case "meters":
      section(title, footer) { MetersBlock(block: block, context: context) }
    case "list":
      ListBlock(
        block: block, title: title, footer: footer, model: model, context: context,
        selection: splitting ? $selection : nil,
        open: { screen, params in openScreen(screen, params) },
        trigger: { action, scope in trigger(action, scope: scope) },
        toolbarControls: toolbarList?.id == block.id)
    case "form":
      section(title, footer) {
        FormBlock(block: block, context: context, busy: running != nil) { action, scope in
          trigger(action, scope: scope)
        }
      }
    case "actions":
      // A card whose every action is hidden (the photo's Remove with no photo) draws nothing, not an empty card.
      let shownActions = block["items"].array.compactMap(ActionSpec.init).filter { ScreenValues.condition($0.when, in: context) }
      if !shownActions.isEmpty {
      section(title, footer) {
        ForEach(shownActions) { action in
          // A plain row in the accent text color (red for a destructive one), never a bordered pill or a tinted wash.
          Button(role: action.destructive ? .destructive : nil) { trigger(action, scope: context) } label: {
            HStack {
              Label(ScreenValues.render(action.label, in: context), systemImage: action.icon ?? "arrow.forward.circle")
                .foregroundStyle(action.destructive ? AglynColor.error : AglynColor.tint)
              Spacer()
              if running == action.id { ProgressView().controlSize(.small) }
            }
          }
          .buttonStyle(.aglynRow)
          .disabled(running != nil)
          .accessibilityIdentifier("action-\(action.id)")
        }
      }
      }
    case "links":
      section(title, footer) {
        ForEach(Array(block["items"].array.enumerated()), id: \.offset) { _, link in
          if ScreenValues.condition(link["when"]?.stringValue, in: context), let screen = link["screen"]?.stringValue {
            Button {
              openScreen(screen, renderParams(link["params"], in: context))
            } label: {
              AglynRow(
                ScreenValues.render(link["title"]?.stringValue ?? screen, in: context),
                subtitle: link["subtitle"]?.stringValue.map { ScreenValues.render($0, in: context) },
                systemImage: ScreenSpec.appleIcon(link["icon"]?.stringValue)
              ) {
                Image(systemName: "chevron.forward").font(.caption).foregroundStyle(.tertiary)
              }
            }
            .buttonStyle(.aglynRow)
            .accessibilityIdentifier("link-\(screen)")
          }
        }
      }
    case "zone":
      // A core screen's zone: whatever plugin screens contribute to it, never named here.
      let name = block["name"]?.stringValue ?? ""
      let contributions = ScreenCatalog.shared.zone(name)
        .filter { ScreenValues.condition($0.requires, in: context) }
      // Native widgets other plugins put in the same slot sit beside the spec screens.
      let widgets = plugin.slotWidgets(name)
      if !contributions.isEmpty {
        let params = renderParams(block["params"], in: context)
        let listed = contributions.filter { zoneShows($0, params) }
        if !listed.isEmpty {
          section(title, footer) {
            ForEach(listed) { spec in
              ZoneRow(spec: spec, params: params) { openScreen(spec.id, $0) }
            }
          }
        }
      }
      let slotParams = renderParams(block["params"], in: context)
      ForEach(widgets) { widget in
        Section {
          widget.make(plugin)
            .environment(\.aglynSlotParams, slotParams)
            .accessibilityIdentifier("zone-widget-\(widget.id)")
        }
      }
      // `empty`: what to say when no plugin has put anything in the zone.
      if contributions.isEmpty, widgets.isEmpty, let empty = block["empty"]?.stringValue {
        Section {
          AglynNotice(ScreenValues.render(empty, in: context), tone: .info)
            .aglynFormBare()
        }
      }
    case "image":
      // `{ "type": "image", "src": "{item.url}", "caption": "…" }`: a picture the route hands over (a staff media preview).
      let source = ScreenValues.render(block["src"]?.stringValue ?? "", in: context)
      if !source.isEmpty {
        Section {
          AglynRemoteImage(URL(string: source), contentMode: .fit, label: block["caption"]?.stringValue.map { ScreenValues.render($0, in: context) })
            .frame(maxWidth: .infinity, minHeight: 160, maxHeight: 320)
            .listRowInsets(EdgeInsets())
        } header: {
          if let title { Text(title) }
        } footer: {
          if let footer, !footer.isEmpty { Text(footer) }
        }
      }
    case "html":
      // `{ "type": "html", "source": "{data.message.html}", "empty": "…" }`: a message's HTML, drawn as styled text.
      // Scripts, styles, frames, forms and images never reach the importer, and a link opens in the system handler.
      let source = ScreenValues.render(block["source"]?.stringValue ?? "", in: context)
      section(title, footer) {
        if source.isEmpty {
          Text(block["empty"]?.stringValue.map { ScreenValues.render($0, in: context) } ?? "Nothing to show.").foregroundStyle(.secondary)
        } else {
          Text(EmailHTML.attributed(source))
            .font(AglynFont.body)
            .textSelection(.enabled)
        }
      }
    case "notice":
      Section {
        AglynNotice(ScreenValues.render(block["text"]?.stringValue ?? "", in: context), tone: tone(block["tone"]?.stringValue))
          .aglynFormBare()
      } header: {
        if let title { Text(title) }
      }
    default:
      EmptyView()
    }
  }

  private func section<Content: View>(_ title: String?, _ footer: String?, @ViewBuilder _ content: () -> Content) -> some View {
    Section {
      content()
    } header: {
      if let title, !title.isEmpty { Text(title) }
    } footer: {
      if let footer, !footer.isEmpty { Text(footer) }
    }
  }

  // MARK: Actions

  private func openScreen(_ screen: String, _ params: NativeParams) {
    if splitting, ScreenCatalog.shared.spec(screen) != nil {
      selection = ListSelection(screen: screen, params: params)
    } else {
      plugin.navigate(screen, params)
    }
  }

  private func trigger(_ action: ActionSpec, scope: JSONValue) {
    if action.asksInputs(in: scope) {
      prompting = PendingAction(action: action, scope: scope)
    } else if action.asksConfirmation, ScreenValues.condition(action.confirmWhen, in: scope) {
      confirming = PendingAction(action: action, scope: scope)
    } else {
      Task { await execute(action, scope: scope) }
    }
  }

  private func execute(_ action: ActionSpec, scope: JSONValue, afterGate: Bool = false) async {
    if let request = action.exportRequest(in: scope) {
      exportSheet = request
      return
    }
    if let copy = action.copy {
      copyToClipboard(ScreenValues.render(copy, in: scope))
      show("Copied", .success)
      return
    }
    if let path = action.besigner {
      if !plugin.openBesigner(ScreenValues.render(path, in: scope), scope: .absolute) {
        show("That page does not open in the app.", .warning)
      }
      return
    }
    if let route = action.route {
      let path = ScreenValues.render(route, in: scope)
      if path.isEmpty || !plugin.openLink(path) { show("That page does not open in the app.", .warning) }
      return
    }
    if let link = action.link {
      let rendered = ScreenValues.render(link, in: scope)
      guard let url = URL(string: rendered.hasPrefix("/") ? session.origin + rendered : rendered) else { return }
      // A plain page (the live site, a preview, a docs link) shows in the in-app browser screen the app's root installs;
      // the sign-in session is for OAuth and hosted payment steps only.
      openURL(url)
      return
    }
    // A route is asked first what the action would do; its answer is `preview` in the confirmation.
    if let check = action.check?.action, ScreenValues.lookup("preview", in: scope) == nil {
      running = action.id
      let checked = await model.run(check, in: scope)
      running = nil
      switch checked {
      case .done(_, let response):
        confirming = PendingAction(action: action, scope: ScreenContext.with(scope, "preview", response ?? .object([:])))
      case .needsReauth(let message):
        reauthing = PendingAction(action: action, scope: scope, reauthMessage: message)
      case .failed(let message), .gated(_, let message):
        show(message, .error)
      case .file:
        break  // a check asks a question; it never answers with a file
      }
      return
    }
    running = action.id
    let outcome = await model.run(action, in: scope)
    running = nil
    switch outcome {
    case .needsReauth(let message):
      reauthing = PendingAction(action: action, scope: scope, reauthMessage: message)
    case .gated(let screen, let message):
      // Asked about once: a second refusal after the gate's screen is answered as it stands.
      if !afterGate, let spec = ScreenCatalog.shared.spec(screen) {
        let gated = GatedAction(action: action, scope: scope, spec: spec)
        gatedAgain = gated
        gateResolved = false
        gating = gated
      } else {
        show(message, .error)
      }
    case .failed(let message):
      show(message, .error)
      #if os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(.error)
      #endif
    case .file(let file, let name, let message):
      exporting = ExportedDownload(name: name, data: file.data, contentType: file.contentType)
      if let message, !message.isEmpty { show(message, .success) }
    case .done(let message, let response):
      #if os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
      #endif
      let after = ScreenContext.with(scope, "response", response ?? .null)
      if let instead = action.insteadEntry(in: after) {
        revealed = (
          instead["title"]?.stringValue.map { ScreenValues.render($0, in: after) } ?? action.label,
          ScreenValues.render(instead["text"]?.stringValue ?? "", in: after)
        )
        // The entry may also open a page the route named (an invoice the bank has to confirm).
        if let key = instead["open"]?.stringValue, let link = ScreenValues.lookup(key, in: response ?? .null)?.stringValue,
          let url = URL(string: link)
        {
          await webAuthentication.openHostedPage(url)
        }
      } else if let message, !message.isEmpty {
        show(message, .success)
      }
      // A path the route's answer does not hold is read from the screen (`item.body`): an action that only shows a value.
      if let reveal = action.reveal, let value = ScreenValues.lookup(reveal, in: response ?? .null) ?? ScreenValues.lookup(reveal, in: after) {
        revealed = (action.label, ScreenValues.text(value))
      }
      if let file = action.file, let made = file.contents(in: after) {
        exporting = ExportedDownload(name: made.name, data: Data(made.text.utf8), contentType: file.type)
      }
      if let openPath = action.openURL, let link = ScreenValues.lookup(openPath, in: response ?? .null)?.stringValue,
        let url = URL(string: link)
      {
        await webAuthentication.openHostedPage(url)
      }
      if let impersonate = action.impersonate {
        // The route minted a custom token for the customer; the app signs in with it. The token goes to the session
        // and is shown, logged and kept nowhere else.
        guard let (token, tenantId) = impersonate.resolve(in: response) else {
          show("The support session could not be opened.", .error)
          return
        }
        do {
          try await session.impersonate(token, tenantId)
        } catch {
          show("The support session could not be opened. Try again.", .error)
        }
        return
      }
      if let navigate = action.navigate {
        plugin.navigate(navigate.screen, navigate.params.mapValues { ScreenValues.render($0, in: after) })
      }
      if action.resume { gateResolve?() }
      if action.back {
        dismiss()
        return
      }
      if let follow = model.followUp {
        model.followUp = nil
        prompting = PendingAction(action: follow.action, scope: follow.scope)
      }
      if action.reload { await model.load() }
    }
  }

  private func show(_ text: String, _ tone: AglynTone) {
    notice = (text, tone)
    let shown = text
    Task {
      try? await Task.sleep(nanoseconds: 4_000_000_000)
      if notice?.text == shown { notice = nil }
    }
  }

  private func copyToClipboard(_ text: String) {
    #if canImport(UIKit)
      UIPasteboard.general.string = text
    #elseif canImport(AppKit)
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(text, forType: .string)
    #endif
  }
}

func renderParams(_ params: JSONValue?, in context: JSONValue) -> NativeParams {
  params.objectEntries.reduce(into: [:]) { out, entry in
    out[entry.key] = ScreenValues.render(entry.value.stringValue ?? ScreenValues.text(entry.value), in: context)
  }
}

func tone(_ name: String?) -> AglynTone {
  switch name {
  case "success": .success
  case "warning": .warning
  case "error": .error
  case "info": .info
  default: .neutral
  }
}

/// `.searchable` only for a screen whose list searches through its route.
struct SearchModifier: ViewModifier {
  let enabled: Bool
  @Binding var text: String
  let submit: () -> Void

  func body(content: Content) -> some View {
    if enabled {
      content
        .aglynSearchable(text: $text, prompt: "Search")
        .onSubmit(of: .search, submit)
        .onChange(of: text) { _, now in if now.isEmpty { submit() } }
    } else {
      content
    }
  }
}

/// A file a route answered with, waiting for the person to choose where it goes.
struct ExportedDownload {
  let name: String
  let data: Data
  let contentType: String

  var type: UTType {
    UTType(mimeType: contentType.split(separator: ";").first.map(String.init) ?? contentType)
      ?? UTType(filenameExtension: (name as NSString).pathExtension) ?? .data
  }
}

/// The bytes a save panel or the Files app writes.
struct ExportedDocument: FileDocument {
  static var readableContentTypes: [UTType] { [.data] }
  let data: Data

  init(data: Data) { self.data = data }
  init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

/// One screen's row in a zone: it opens the screen. Whether a conditional one is listed is the zone's to decide
/// (`SpecScreenBody.zoneReads`), so the row never waits on a read of its own.
struct ZoneRow: View {
  let spec: ScreenSpec
  let params: NativeParams
  let open: (NativeParams) -> Void

  var body: some View {
    Button {
      open(params)
    } label: {
      AglynRow(spec.label, subtitle: spec.subtitle, systemImage: spec.icon) {
        Image(systemName: "chevron.forward").font(.caption).foregroundStyle(.tertiary)
      }
    }
    .buttonStyle(.aglynRow)
    .accessibilityIdentifier("zone-\(spec.id)")
  }
}
