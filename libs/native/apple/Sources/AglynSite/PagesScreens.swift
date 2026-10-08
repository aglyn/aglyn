// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// Roles the rules let change a page's document; the routing map needs `pagePublishRoles`.
let pageContentRoles: Set<String> = ["admin", "editor", "author"]
let pagePublishRoles: Set<String> = ["admin", "editor"]

/// The site's pages, live: the screens window and the host's routing map.
@MainActor
@Observable
final class SitePagesModel {
  let host = LiveDocument()
  let window = LiveQuery()

  var routing: SiteRouting { SiteRouting(host: host.state.value ?? nil) }

  var pages: [PageNode] { (window.state.value ?? []).prefix(pagesWindow).compactMap(PageNode.init) }

  var rows: LiveValue<[PageTreeRow]> {
    switch window.state {
    case .loading: .loading
    case .failed(let message): .failed(message)
    case .ready: .ready(pageTree(pages, routing: routing))
    }
  }

  var truncated: Bool { (window.state.value?.count ?? 0) > pagesWindow }

  func row(_ id: String?) -> PageTreeRow? {
    guard let id, case .ready(let rows) = rows else { return nil }
    return rows.first { $0.page.id == id }
  }

  func bind(_ reader: FirestoreReader, hostID: String) async {
    let (host, window) = (self.host, self.window)
    async let hostDoc: Void = host.bind(reader, ["hosts", hostID])
    async let screens: Void = window.bind(
      reader, FirestoreQuery(["hosts", hostID, "screens"], order: [.init("__name__")], limit: pagesWindow + 1))
    _ = await (hostDoc, screens)
  }
}

/// What a page sheet is asking for.
enum PageSheet: Identifiable {
  case newPage, newGroup
  case rename(PageNode)
  case publish(PageNode, currentSlug: String)
  case duplicate(PageNode)
  case move(PageNode)

  var id: String {
    switch self {
    case .newPage: "new-page"
    case .newGroup: "new-group"
    case .rename(let page): "rename-\(page.id)"
    case .publish(let page, _): "publish-\(page.id)"
    case .duplicate(let page): "duplicate-\(page.id)"
    case .move(let page): "move-\(page.id)"
    }
  }
}

/// A change that only needs a yes.
enum PageConfirm {
  case unpublish(PageNode)
  case delete(PageNode, livePath: String?)

  var page: PageNode {
    switch self {
    case .unpublish(let page), .delete(let page, _): page
    }
  }
}

/// The site's pages as the console's Pages hub lists them, the picked page
/// beside the list in a wide window: add a page or a group, open a page in
/// the Besigner, publish it at an address, unpublish, rename, duplicate,
/// move, make a saved version live, and delete.
struct PagesScreen: View {
  let context: NativePluginContext
  var initialPageID: String?
  @State private var model = SitePagesModel()
  @State private var runner = ActionRunner()
  @State private var selection: String?
  @State private var sheet: PageSheet?

  private var canEdit: Bool { pageContentRoles.contains(context.siteRole ?? "") }
  private var canPublish: Bool { pagePublishRoles.contains(context.siteRole ?? "") }

  var body: some View {
    Group {
      if let hostID = context.hostID {
        let api = PagesAPI(api: context.api, writer: context.writer, hostID: hostID)
        WideLayoutReader { wide in
          if wide {
            HStack(spacing: 0) {
              list(hostID: hostID, api: api, selectable: true).frame(minWidth: 300, idealWidth: 360, maxWidth: 440)
              Divider()
              Group {
                if let row = model.row(selection) {
                  PageDetail(
                    context: context, hostID: hostID, pageID: row.id, model: model, api: api, runner: runner,
                    canEdit: canEdit, canPublish: canPublish)
                } else {
                  AglynEmptyState("Pick a page to see it here", systemImage: SiteSymbols.page)
                }
              }
              .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
          } else {
            list(hostID: hostID, api: api, selectable: false)
          }
        }
        .sheet(item: $sheet) { sheet in
          PageSheetView(sheet: sheet, model: model, api: api, runner: runner) { id in
            context.navigate(sitePagesScreen, ["page": id])
          } close: {
            self.sheet = nil
          }
        }
        .task(id: hostID) { await model.bind(context.firestore, hostID: hostID) }
      } else {
        AglynEmptyState("Pick a site first", systemImage: SiteSymbols.site)
      }
    }
    .navigationTitle("Pages")
    .toolbar {
      ToolbarItemGroup(placement: .primaryAction) {
        Button {
          open(.newGroup)
        } label: {
          Label("New group", systemImage: "folder.badge.plus")
        }
        .disabled(!canEdit)
        .keyboardShortcut("n", modifiers: [.command, .shift])
        .accessibilityIdentifier("add-group")
        Button {
          open(.newPage)
        } label: {
          Label("New page", systemImage: "plus")
        }
        .disabled(!canEdit)
        .keyboardShortcut("n", modifiers: .command)
        .accessibilityIdentifier("add-page")
      }
    }
    .safeAreaInset(edge: .bottom) { banner }
  }

  private func open(_ next: PageSheet) {
    runner.error = nil
    sheet = next
  }

  @ViewBuilder
  private var banner: some View {
    if sheet == nil, let error = runner.error {
      AglynNotice(error, tone: .error) { runner.clear() }.padding(AglynSpace.two)
    } else if let notice = runner.notice {
      AglynNotice(notice, tone: .success) { runner.clear() }.padding(AglynSpace.two)
        .task(id: notice) {
          try? await Task.sleep(nanoseconds: 6_000_000_000)
          if runner.notice == notice { runner.notice = nil }
        }
    }
  }

  @ViewBuilder
  private func list(hostID: String, api: PagesAPI, selectable: Bool) -> some View {
    switch model.rows {
    case .loading:
      List { SkeletonRows(count: 6) }.aglynListBackground()
    case .failed:
      AglynEmptyState(
        "Could not load this site's pages", systemImage: SiteSymbols.error,
        message: "Check the connection and try again.")
    case .ready(let rows) where rows.isEmpty:
      AglynEmptyState(
        "No pages yet", systemImage: SiteSymbols.page, message: "Add a page, then design it in the Besigner."
      ) {
        if canEdit { Button("New page") { open(.newPage) }.buttonStyle(.borderedProminent) }
      }
    case .ready(let rows):
      Group {
        if selectable {
          List(selection: $selection) {
            truncatedNotice
            ForEach(rows) { row in
              PageListRow(row: row).tag(row.id).aglynListRow()
                .accessibilityIdentifier("page-\(row.id)")
            }
          }
          .onChange(of: rows, initial: true) { _, rows in
            if selection == nil || !rows.contains(where: { $0.id == selection }) {
              selection = rows.first { $0.id == initialPageID }?.id ?? rows.first { !$0.page.isGroup }?.id
            }
          }
          .sensoryFeedback(.selection, trigger: selection)
        } else {
          List {
            truncatedNotice
            ForEach(rows) { row in
              NavigationLink {
                PageDetail(
                  context: context, hostID: hostID, pageID: row.id, model: model, api: api, runner: runner,
                  canEdit: canEdit, canPublish: canPublish
                )
                .navigationTitle(row.page.name)
              } label: {
                PageListRow(row: row)
              }
              .aglynListRow()
              .accessibilityIdentifier("page-\(row.id)")
            }
          }
        }
      }
      .aglynListBackground()
      .accessibilityIdentifier("pages-list")
    }
  }

  @ViewBuilder
  private var truncatedNotice: some View {
    if model.truncated {
      AglynNotice("This site has more than \(pagesWindow) pages; the first \(pagesWindow) are listed.", tone: .warning)
        .accessibilityIdentifier("pages-truncated")
    }
  }
}

struct PageListRow: View {
  let row: PageTreeRow

  var body: some View {
    let status = pageStatus(row)
    let subtitle: String =
      if row.page.isGroup { row.childCount == 1 ? "1 page" : "\(row.childCount) pages" }
      else if let live = row.livePath { live }
      else { row.page.slug.map { "/\($0) · not published" } ?? "No address yet" }
    AglynTreeIndent(depth: row.depth) {
      AglynRow(
        row.page.name, subtitle: subtitle,
        systemImage: row.page.isGroup ? SiteSymbols.group : row.home ? SiteSymbols.home : SiteSymbols.page
      ) {
        HStack(spacing: AglynSpace.half) {
          if row.home { StatusChip("Home", tone: .info) }
          if !row.page.isGroup { StatusChip(status.label, tone: status.live ? .success : .neutral) }
        }
      }
    }
  }
}

/// One page: its status, the Besigner, publishing, its details and saved versions.
struct PageDetail: View {
  let context: NativePluginContext
  let hostID: String
  let pageID: String
  let model: SitePagesModel
  let api: PagesAPI
  let runner: ActionRunner
  let canEdit: Bool
  let canPublish: Bool
  @Environment(\.openURL) private var openURL
  @State private var sheet: PageSheet?
  @State private var confirm: PageConfirm?

  var body: some View {
    if let row = model.row(pageID) {
      content(row)
        .sheet(item: $sheet) { sheet in
          PageSheetView(sheet: sheet, model: model, api: api, runner: runner) { id in
            context.navigate(sitePagesScreen, ["page": id])
          } close: {
            self.sheet = nil
          }
        }
        .confirmationDialog(
          confirmTitle, isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
          titleVisibility: .visible, presenting: confirm
        ) { pending in
          switch pending {
          case .unpublish(let page):
            Button("Unpublish", role: .destructive) {
              runner.run("Page unpublished.") { try await api.unpublish(page.id) }
            }
          case .delete(let page, _):
            Button("Delete", role: .destructive) {
              runner.run(page.isGroup ? "Group deleted." : "Page deleted.") {
                if page.isGroup { try await api.deleteGroup(page.id) } else { try await api.delete(page.id) }
              }
            }
          }
        } message: { pending in
          Text(confirmMessage(pending))
        }
    } else {
      AglynEmptyState("This page is gone", systemImage: SiteSymbols.page, message: "It may have been deleted.")
    }
  }

  private var confirmTitle: String {
    switch confirm {
    case .unpublish(let page)?: "Unpublish \(page.name)?"
    case .delete(let page, _)?: page.isGroup ? "Delete group \(page.name)?" : "Delete \(page.name)?"
    case nil: ""
    }
  }

  private func confirmMessage(_ pending: PageConfirm) -> String {
    switch pending {
    case .unpublish: return "Visitors can no longer reach it. Pages inside it keep their addresses."
    case .delete(let page, let livePath):
      if page.isGroup { return "Its pages move up a level and keep their addresses." }
      return [livePath.map { "It is live at \($0) and stops answering there." }, "Pages inside it keep their addresses."]
        .compactMap { $0 }.joined(separator: " ")
    }
  }

  private func open(_ next: PageSheet) {
    runner.error = nil
    sheet = next
  }

  @ViewBuilder
  private func actionsMenu(_ row: PageTreeRow) -> some View {
    let page = row.page
    Menu {
      Button { open(.rename(page)) } label: {
        Label(page.isGroup ? "Rename group" : "Rename", systemImage: "pencil")
      }
      .disabled(!canEdit)
      if !page.isGroup {
        Button { open(.duplicate(page)) } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
          .disabled(!canEdit)
        Button { open(.move(page)) } label: { Label("Move", systemImage: "folder") }
          .disabled(!canPublish)
        if row.livePath != nil {
          Button { confirm = .unpublish(page) } label: { Label("Unpublish", systemImage: "eye.slash") }
            .disabled(!canPublish)
        }
      }
      Divider()
      Button(role: .destructive) {
        confirm = .delete(page, livePath: row.livePath)
      } label: {
        Label(page.isGroup ? "Delete group" : "Delete", systemImage: "trash")
      }
      .disabled(!canPublish)
    } label: {
      Label("More actions", systemImage: "ellipsis.circle").labelStyle(.iconOnly).imageScale(.large)
    }
    .menuIndicator(.hidden)
    .buttonStyle(.borderless)
    .fixedSize()
    .accessibilityIdentifier("page-actions")
  }

  @ViewBuilder
  private func primaryButtons(_ row: PageTreeRow) -> some View {
    let page = row.page
    Button {
      if let version = page.versionID {
        context.openBesigner(DeepLinks.besignerScreen(page.id, versionID: version), scope: .site)
      }
    } label: {
      Label("Edit in the Besigner", systemImage: "paintbrush.pointed")
    }
    .buttonStyle(.borderedProminent)
    .disabled(page.versionID == nil)
    .keyboardShortcut("e", modifiers: .command)
    .accessibilityIdentifier("page-edit-besigner")
    Button(row.livePath != nil ? "Change address" : "Publish") {
      open(.publish(page, currentSlug: row.home ? "/" : page.slug ?? ""))
    }
    .buttonStyle(.bordered)
    .disabled(!canPublish || page.kind == screenKindTemplate)
    .accessibilityIdentifier("page-publish")
    if let live = row.livePath, let link = livePageURL(model.routing, livePath: live), let url = URL(string: link) {
      Button {
        openURL(url)
      } label: {
        Label("Open live page", systemImage: "arrow.up.right.square")
      }
      .buttonStyle(.bordered)
      .accessibilityIdentifier("page-open-live")
    }
  }

  private func content(_ row: PageTreeRow) -> some View {
    let page = row.page
    let status = pageStatus(row)
    return Form {
      Section {
        HStack(alignment: .firstTextBaseline) {
          Text(page.name).font(AglynFont.title2).accessibilityAddTraits(.isHeader)
          Spacer(minLength: AglynSpace.one)
          actionsMenu(row)
        }
        HStack(spacing: AglynSpace.one) {
          if row.home { StatusChip("Home page", tone: .info) }
          StatusChip(status.label, tone: status.live ? .success : .neutral)
        }
        if let description = page.description {
          Text(description).font(AglynFont.subheadline).foregroundStyle(.secondary)
        }
        if !page.isGroup {
          ViewThatFits(in: .horizontal) {
            HStack(spacing: AglynSpace.one) { primaryButtons(row) }
            VStack(alignment: .leading, spacing: AglynSpace.one) { primaryButtons(row) }
          }
        }
      }
      if !page.isGroup {
        Section("Details") {
          AglynDetailRow(
            "Address", value: row.livePath ?? page.slug.map { "/\($0) (not published)" }, placeholder: "No address yet")
          AglynDetailRow("Published", value: page.publishedAt.map { relativeTime($0) }, placeholder: "Not published")
          AglynDetailRow("Updated", value: page.updatedAt.map { relativeTime($0) })
          AglynDetailRow("Page id", value: page.id)
        }
        PageVersionsSection(
          context: context, hostID: hostID, page: page, api: api, runner: runner, canPublish: canPublish)
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .accessibilityIdentifier("page-detail")
  }
}

/// A page's saved versions, newest first: open one in the Besigner, or make it the one the page serves.
struct PageVersionsSection: View {
  let context: NativePluginContext
  let hostID: String
  let page: PageNode
  let api: PagesAPI
  let runner: ActionRunner
  let canPublish: Bool
  @State private var versions = LiveQuery()

  var body: some View {
    Section("Versions") {
      switch versions.state {
      case .loading:
        SkeletonRows(count: 2)
      case .failed:
        Text("Versions could not be loaded.").foregroundStyle(.secondary)
      case .ready(let docs):
        let rows = docs.map(PageVersion.init)
        if rows.isEmpty { Text("No saved versions yet.").foregroundStyle(.secondary) }
        ForEach(Array(rows.enumerated()), id: \.element.id) { index, version in
          AglynRow(
            version.name ?? "Version \(rows.count - index)",
            subtitle: version.createdAt.map { "Saved \(relativeTime($0).lowercased())" },
            systemImage: "clock.arrow.circlepath"
          ) {
            if version.id == page.versionID {
              StatusChip("Current", tone: .success)
            } else {
              HStack(spacing: AglynSpace.one) {
                Button("Open") {
                  context.openBesigner(DeepLinks.besignerScreen(page.id, versionID: version.id), scope: .site)
                }
                Button("Use") {
                  runner.run("This version is now the page's working version.") {
                    try await api.makeVersionLive(page.id, versionID: version.id)
                  }
                }
                .disabled(!canPublish || runner.busy)
              }
              .buttonStyle(.borderless)
            }
          }
          .accessibilityIdentifier("page-version-\(version.id)")
        }
      }
    }
    .task(id: page.id) {
      await versions.bind(
        context.firestore,
        FirestoreQuery(
          ["hosts", hostID, "screens", page.id, "versions"], order: [.init("createdAt", descending: true)], limit: 20))
    }
  }
}

/// Every page sheet: new page, new group, rename, publish, duplicate and move.
struct PageSheetView: View {
  let sheet: PageSheet
  let model: SitePagesModel
  let api: PagesAPI
  let runner: ActionRunner
  let onSelectNew: (String) -> Void
  let close: () -> Void
  @State private var name = ""
  @State private var text = ""
  @State private var parent: String?
  @State private var loaded = false

  var body: some View {
    form
      .onAppear {
        guard !loaded else { return }
        loaded = true
        switch sheet {
        case .rename(let page):
          name = page.name
          text = page.description ?? ""
        case .publish(_, let slug): text = slug
        case .duplicate(let page): name = "\(page.name) copy".capped(pageNameMax)
        case .move(let page): parent = page.parentID
        case .newPage, .newGroup: break
        }
      }
  }

  private var nameField: some View {
    LabeledContent {
      AglynCharacterCount(name.count, of: pageNameMax)
    } label: {
      TextField("Name", text: Binding(get: { name }, set: { name = $0.capped(pageNameMax) }))
        .accessibilityIdentifier("page-name")
    }
  }

  @ViewBuilder
  private var form: some View {
    switch sheet {
    case .newPage:
      AglynActionSheet(
        "New page", message: "It starts as a draft; publish it at an address when it is ready.",
        confirmLabel: "Create page", confirmEnabled: !name.trimmed.isEmpty, busy: runner.busy, error: runner.error,
        onCancel: close
      ) {
        let (name, description) = (name, text)
        runner.run("\(name.trimmed) was added as a draft.", onDone: close) {
          try await api.createPage(name: name, description: description)
        }
      } fields: {
        nameField
        TextField(
          "Description (optional)", text: Binding(get: { text }, set: { text = $0.capped(pageDescriptionMax) }),
          axis: .vertical)
      }
    case .newGroup:
      AglynActionSheet(
        "New group", message: "A group holds pages together in this list. It has no address of its own.",
        confirmLabel: "Create group", confirmEnabled: !name.trimmed.isEmpty, busy: runner.busy, error: runner.error,
        onCancel: close
      ) {
        let top = model.pages.filter { $0.parentID == nil }.compactMap(\.order).min() ?? 0
        let name = name
        runner.run("Group \(name.trimmed) added.", onDone: close) { try await api.createGroup(name: name, topOrder: top) }
      } fields: {
        nameField
      }
    case .rename(let page):
      AglynActionSheet(
        page.isGroup ? "Rename group" : "Rename page", confirmLabel: "Save", confirmEnabled: !name.trimmed.isEmpty,
        busy: runner.busy, error: runner.error, onCancel: close
      ) {
        let (name, description) = (name, text)
        runner.run("Saved.", onDone: close) {
          try await api.rename(page.id, name: name, description: page.isGroup ? nil : description)
        }
      } fields: {
        nameField
        if !page.isGroup {
          TextField(
            "Description", text: Binding(get: { text }, set: { text = $0.capped(pageDescriptionMax) }), axis: .vertical)
        }
      }
    case .publish(let page, _):
      AglynActionSheet(
        model.routing.routes[page.id] != nil ? "Change this page's address" : "Publish this page",
        message: "Visitors reach it at this address. Use / for the home page.", confirmLabel: "Publish",
        confirmEnabled: !text.trimmed.isEmpty, busy: runner.busy, error: runner.error, onCancel: close
      ) {
        let slug = text
        runner.run(onDone: close) {
          let path = try await api.publish(page.id, slug: slug)
          runner.notice = "Published at \(path ?? "/" + slug.trimmingCharacters(in: CharacterSet(charactersIn: "/")))"
        }
      } fields: {
        HStack(spacing: 2) {
          if !text.hasPrefix("/") { Text("/").foregroundStyle(.secondary) }
          TextField("Address", text: $text)
            .autocorrectionDisabled()
            #if os(iOS)
              .textInputAutocapitalization(.never)
              .keyboardType(.URL)
            #endif
            .accessibilityIdentifier("publish-slug")
        }
      }
    case .duplicate(let page):
      AglynActionSheet(
        "Duplicate \(page.name)", message: "The copy is a draft with its own address to set.",
        confirmLabel: "Duplicate", confirmEnabled: !name.trimmed.isEmpty, busy: runner.busy, error: runner.error,
        onCancel: close
      ) {
        let name = name
        runner.run("Copy added as a draft.", onDone: close) {
          if let id = try await api.duplicate(sourceID: page.id, name: name) { onSelectNew(id) }
        }
      } fields: {
        TextField("Name of the copy", text: Binding(get: { name }, set: { name = $0.capped(pageNameMax) }))
      }
    case .move(let page):
      AglynActionSheet(
        "Move \(page.name)",
        message: "Inside a page, its address starts with that page's. A group changes no address.",
        confirmLabel: "Move", confirmEnabled: parent != page.parentID, busy: runner.busy, error: runner.error,
        onCancel: close
      ) {
        let target = parent
        let siblings = model.pages.filter { $0.parentID == target && $0.id != page.id }.count
        runner.run("Moved.", onDone: close) { try await api.move(page.id, parentID: target, index: siblings) }
      } fields: {
        moveChoice("Top level", systemImage: SiteSymbols.home, id: nil)
        ForEach(movableParents(model.pages, pageID: page.id)) { choice in
          moveChoice(choice.name, systemImage: choice.isGroup ? SiteSymbols.group : SiteSymbols.page, id: choice.id)
        }
      }
    }
  }

  private func moveChoice(_ label: String, systemImage: String, id: String?) -> some View {
    Button {
      parent = id
    } label: {
      AglynRow(label, systemImage: systemImage) {
        if parent == id { Image(systemName: "checkmark").foregroundStyle(AglynColor.tint) }
      }
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(parent == id ? .isSelected : [])
  }
}
