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
              ListDetailLayout(listWidth: 380) {
                SpecScreenBody(model: model, plugin: plugin, selection: $selection, splitting: true)
              } detail: {
                detail
              }
            } else {
              SpecScreenBody(model: model, plugin: plugin, selection: $selection, splitting: false)
            }
          }
        } else {
          SpecScreenBody(model: model, plugin: plugin, selection: $selection, splitting: false)
        }
      } else {
        Form { SkeletonRows(count: 6) }.formStyle(.grouped)
      }
    }
    .onChange(of: session.claims) { _, _ in model?.rebase(baseContext) }
    .navigationTitle(ScreenValues.render(spec.title, in: model?.context ?? baseContext))
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
      AglynEmptyState("Nothing selected", systemImage: "sidebar.right", message: "Pick a row to see it here.")
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

  @Environment(\.aglynScreenSession) private var session
  @Environment(\.webAuthenticationSession) private var webAuthentication
  @Environment(\.openURL) private var openURL
  @Environment(\.dismiss) private var dismiss
  @Environment(\.aglynGateResolve) private var gateResolve
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

  private var context: JSONValue { model.context }

  var body: some View {
    content
      .safeAreaInset(edge: .top) {
        if let notice {
          AglynNotice(notice.text, tone: notice.tone) { self.notice = nil }
            .padding(.horizontal).padding(.top, AglynSpace.one)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
      }
      .animation(.default, value: notice?.text)
      .toolbar { toolbar }
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
        ActionInputSheet(pending: pending, context: context) { filled in
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
      Form { SkeletonRows(count: 6) }.formStyle(.grouped)
    case .failed(let message):
      AglynEmptyState("This did not load", systemImage: "exclamationmark.triangle", message: message) {
        Button("Try again") { Task { await model.load() } }
      }
    case .ready:
      let blocks = model.spec.blocks.filter { ScreenValues.condition($0.when, in: context) }
      Form {
        ForEach(blocks) { block in
          blockView(block)
        }
      }
      .formStyle(.grouped)
      .aglynListBackground()
      .refreshable { await model.load() }
      .modifier(SearchModifier(enabled: searchLoad != nil, text: $searchText) {
        if let key = searchLoad {
          model.search[key] = searchText
          Task { await model.load() }
        }
      })
    }
  }

  private var searchLoad: String? {
    model.spec.blocks.first { $0.type == "list" && $0["search"] == .bool(true) }?["load"]?.stringValue
  }

  @ToolbarContentBuilder
  private var toolbar: some ToolbarContent {
    let actions = model.spec.raw["actions"].array.compactMap(ActionSpec.init)
      .filter { ScreenValues.condition($0.when, in: context) }
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
        trigger: { action, scope in trigger(action, scope: scope) })
    case "form":
      section(title, footer) {
        FormBlock(block: block, context: context, busy: running != nil) { action, scope in
          trigger(action, scope: scope)
        }
      }
    case "actions":
      section(title, footer) {
        ForEach(block["items"].array.compactMap(ActionSpec.init).filter { ScreenValues.condition($0.when, in: context) }) { action in
          Button(role: action.destructive ? .destructive : nil) { trigger(action, scope: context) } label: {
            HStack {
              Label(ScreenValues.render(action.label, in: context), systemImage: action.icon ?? "arrow.forward.circle")
              Spacer()
              if running == action.id { ProgressView().controlSize(.small) }
            }
          }
          .disabled(running != nil)
          .accessibilityIdentifier("action-\(action.id)")
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
            .buttonStyle(.plain)
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
        section(title, footer) {
          ForEach(contributions) { spec in
            Button {
              openScreen(spec.id, renderParams(block["params"], in: context))
            } label: {
              AglynRow(spec.label, subtitle: spec.subtitle, systemImage: spec.icon) {
                Image(systemName: "chevron.forward").font(.caption).foregroundStyle(.tertiary)
              }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("zone-\(spec.id)")
          }
        }
      }
      ForEach(widgets) { widget in
        Section {
          widget.make(plugin)
            .accessibilityIdentifier("zone-widget-\(widget.id)")
        }
      }
    case "notice":
      Section {
        AglynNotice(ScreenValues.render(block["text"]?.stringValue ?? "", in: context), tone: tone(block["tone"]?.stringValue))
          .listRowInsets(EdgeInsets())
          .listRowBackground(Color.clear)
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
    if !action.inputs.isEmpty {
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
    if let link = action.link {
      let rendered = ScreenValues.render(link, in: scope)
      guard let url = URL(string: rendered.hasPrefix("/") ? session.origin + rendered : rendered) else { return }
      if url.scheme == "https" || url.scheme == "http" {
        await webAuthentication.openHostedPage(url)
      } else {
        openURL(url)
      }
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
      if let reveal = action.reveal, let value = ScreenValues.lookup(reveal, in: response ?? .null) {
        revealed = (action.label, ScreenValues.text(value))
      }
      if let openPath = action.openURL, let link = ScreenValues.lookup(openPath, in: response ?? .null)?.stringValue,
        let url = URL(string: link)
      {
        await webAuthentication.openHostedPage(url)
      }
      if let navigate = action.navigate {
        plugin.navigate(navigate.screen, navigate.params.mapValues { ScreenValues.render($0, in: after) })
      }
      if action.resume { gateResolve?() }
      if action.back {
        dismiss()
        return
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
        .searchable(text: $text)
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
