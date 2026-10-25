// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// Roles the rules let change a page's document; the routing map needs `pagePublishRoles`.
let pageContentRoles: Set<String> = ["admin", "editor", "author"]
let pagePublishRoles: Set<String> = ["admin", "editor"]

/// The site's pages: the host's routing map, live, and the pages tree, read a level at a time (AGL-3896).
@MainActor
@Observable
final class SitePagesModel {
  let host = LiveDocument()
  private(set) var tree: PagesTree?
  private var reader: FirestoreReader?
  /// The search the list is filtered by; while there is one, every window is read so it finds any page.
  var search = ""

  var routing: SiteRouting { SiteRouting(host: host.state.value ?? nil) }

  /// Every page read so far.
  var pages: [PageNode] { tree.map { Array($0.nodes.values) } ?? [] }

  var hasMore: Bool { tree.map { !$0.exhausted } ?? false }

  var rows: LiveValue<[PageTreeRow]> {
    guard let tree, tree.started, !(tree.loading && tree.nodes.isEmpty) else { return .loading }
    if let failure = tree.failure, tree.nodes.isEmpty { return .failed(failure) }
    let text = search.trimmingCharacters(in: .whitespacesAndNewlines)
    return .ready(text.isEmpty ? tree.rows(routing: routing) : tree.matches(text, routing: routing))
  }

  func row(_ id: String?) -> PageTreeRow? {
    guard let id, let tree, let node = tree.nodes[id] else { return nil }
    let live = routing.routes[id]
    return PageTreeRow(page: node, depth: 0, livePath: live.map(routeURL), home: live == "/", childCount: tree.childCount(id))
  }

  func bind(_ reader: FirestoreReader, hostID: String) async {
    self.reader = reader
    let tree = PagesTree(hostID: hostID) { [reader] query in try await reader.readOnce(query) }
    self.tree = tree
    async let hostDoc: Void = host.bind(reader, ["hosts", hostID])
    await tree.start()
    _ = await hostDoc
  }

  func loadMore() async { await tree?.loadMore() }

  func toggle(_ id: String) async { await tree?.toggle(id) }

  /// A search, or a choice over every page (Move), reads the windows still unread.
  func loadAll() async { await tree?.loadAll() }

  /// After a change: the pages it touched read again and placed where they now belong.
  func reread(_ ids: [String?]) async {
    guard let tree, let reader else { return }
    await tree.reread(ids.compactMap { $0 }) { path in try await reader.readOnce(path) }
  }

  /// A page a link names: read if it is not yet, and its parents opened so its row is on screen.
  func reveal(_ id: String) async {
    guard let tree else { return }
    if tree.nodes[id] == nil { await reread([id]) }
    var parent = tree.nodes[id]?.parentID
    var guardSteps = 0
    while let next = parent, guardSteps < 16 {
      guardSteps += 1
      if tree.nodes[next] == nil { await reread([next]) }
      await tree.expand(next)
      parent = tree.nodes[next]?.parentID
    }
  }
}

/// What a page sheet is asking for.
enum PageSheet: Identifiable {
  case newPage, newGroup
  case rename(PageNode)
  case publish(PageNode, currentSlug: String)
  case duplicate(PageNode)
  case move(PageNode)
  /// The page templates to start a new page from, then the one chosen.
  case fromTemplate
  case useTemplate(ArtifactRow)
  case saveTemplate(PageNode)

  var id: String {
    switch self {
    case .fromTemplate: "from-template"
    case .useTemplate(let row): "use-template-\(row.id)"
    case .saveTemplate(let page): "save-template-\(page.id)"
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
  /// Opens New page on arrival (Create new's Page, `new=1`).
  var startNew = false
  @State private var model = SitePagesModel()
  @State private var runner = ActionRunner()
  @State private var selection: String?
  /// The page a link named, pushed once on a phone, where the list has no selection to set.
  @State private var linkedPage: String?
  @State private var linkSeeded = false
  @State private var sheet: PageSheet?

  private var canEdit: Bool { pageContentRoles.contains(context.siteRole ?? "") }
  private var canPublish: Bool { pagePublishRoles.contains(context.siteRole ?? "") }

  var body: some View {
    Group {
      if let hostID = context.hostID {
        let api = PagesAPI(api: context.api, writer: context.writer, hostID: hostID)
        WideLayoutReader { wide in
          if wide {
            AglynListDetailColumns {
              list(hostID: hostID, api: api, selectable: true)
            } detail: {
              if let row = model.row(selection) {
                PageDetail(
                  context: context, hostID: hostID, pageID: row.id, model: model, api: api, runner: runner,
                  canEdit: canEdit, canPublish: canPublish)
              } else {
                AglynSelectionPlaceholder("No page selected", systemImage: SiteSymbols.page)
              }
            }
          } else {
            list(hostID: hostID, api: api, selectable: false)
          }
        }
        .sheet(item: $sheet) { sheet in
          PageSheetRouter(context: context, hostID: hostID, sheet: sheet, model: model, api: api, runner: runner, open: { self.sheet = $0 }) {
            self.sheet = nil
          }
        }
        .task(id: hostID) {
          if startNew && canEdit { sheet = .newPage }
          await model.bind(context.firestore, hostID: hostID)
          if let initialPageID { await model.reveal(initialPageID) }
        }
        .aglynSearchable(text: $model.search, prompt: "Search pages")
        .task(id: model.search) {
          // A search finds any page: the windows still unread are read, only while searching.
          guard !model.search.trimmingCharacters(in: .whitespaces).isEmpty else { return }
          try? await Task.sleep(nanoseconds: 300_000_000)
          if !Task.isCancelled { await model.loadAll() }
        }
      } else {
        AglynEmptyState("Pick a site first", systemImage: SiteSymbols.site)
      }
    }
    .navigationTitle("Pages")
    .aglynScreenTitle("Pages")
    // New page is the one primary action; a template and a group are in the More menu on the Mac and iPad.
    .aglynPrimaryAction(id: "add-page", "New page", systemImage: "plus", enabled: canEdit, shortcut: KeyboardShortcut("n", modifiers: .command), help: AglynRoleReason.site("creating pages")) { open(.newPage) }
    .aglynScreenToolbar(id: "pages") {
      AglynSecondaryActions {
        Button {
          open(.fromTemplate)
        } label: {
          Label("From a template", systemImage: "square.grid.2x2")
        }
        .disabled(!canEdit)
        .accessibilityIdentifier("page-from-template")
        Button {
          open(.newGroup)
        } label: {
          Label("New group", systemImage: "folder.badge.plus")
        }
        .disabled(!canEdit)
        .keyboardShortcut("n", modifiers: [.command, .shift])
        .accessibilityIdentifier("add-group")
      }
      // Create with AI and anything else a plugin puts beside New page (the console's `hostScreens` zone).
      SlotWidgets(context: context, slot: ListCreateZone.pages, placement: .header)
    }
    .safeAreaInset(edge: .bottom) { banner }
  }

  private func open(_ next: PageSheet) {
    runner.error = nil
    sheet = next
  }

  private var banner: some View { PagesRunnerBanner(runner: runner, sheetOpen: sheet != nil) }

  @ViewBuilder
  private func list(hostID: String, api: PagesAPI, selectable: Bool) -> some View {
    switch model.rows {
    case .loading:
      List { SkeletonRows(count: 6) }.aglynListBackground()
    case .failed:
      AglynEmptyState(
        "Could not load this site's pages", systemImage: SiteSymbols.error,
        message: "Check the connection and try again.")
    case .ready(let rows) where rows.isEmpty && searching:
      if model.tree?.loading == true || model.hasMore {
        List { SkeletonRows(count: 4) }.aglynListBackground()
      } else {
        AglynEmptyState("No pages match", systemImage: "magnifyingglass", message: "Try another name or address.")
      }
    case .ready(let rows) where rows.isEmpty:
      AglynEmptyState(
        "No pages yet", systemImage: SiteSymbols.page, message: "Add a page, then design it in the Besigner."
      ) {
        if canEdit { Button("New page") { open(.newPage) }.buttonStyle(.borderedProminent) }
        SlotWidgets(context: context, slot: ListCreateZone.pages)
      }
    case .ready(let rows):
      Group {
        if selectable {
          List {
            ForEach(rows) { row in
              PageListRow(row: row, expanded: model.tree?.expanded.contains(row.id) == true, onToggle: searching ? nil : {
                Task { await model.toggle(row.id) }
              })
              .aglynSelectableRow(row.id, selection: $selection)
              .accessibilityIdentifier("page-\(row.id)")
            }
            moreRow
          }
          .aglynSelectableListStyle()
          .aglynSelectionKeys(rows.map(\.id), selection: $selection)
          .onChange(of: rows, initial: true) { _, rows in
            // The page a link named wins once it is listed, even when the first rows (from the cache) came without
            // it, as a page a job has just drafted can.
            if !linkSeeded, let initialPageID, rows.contains(where: { $0.id == initialPageID }) {
              linkSeeded = true
              selection = initialPageID
            } else if selection == nil || !rows.contains(where: { $0.id == selection }) {
              selection = rows.first { !$0.page.isGroup }?.id
            }
          }
          .sensoryFeedback(.selection, trigger: selection)
        } else {
          List {
            ForEach(rows) { row in
              AglynPushLink {
                PageDetail(
                  context: context, hostID: hostID, pageID: row.id, model: model, api: api, runner: runner,
                  canEdit: canEdit, canPublish: canPublish, pushed: true
                )
                .navigationTitle(row.page.name)
                .aglynScreenTitle(row.page.name)
              } label: {
                PageListRow(row: row, expanded: model.tree?.expanded.contains(row.id) == true, onToggle: searching ? nil : {
                  Task { await model.toggle(row.id) }
                })
              }
              .aglynListRow()
              .accessibilityIdentifier("page-\(row.id)")
            }
            moreRow
          }
          // A link to one page (a notification, a job's draft) opens it, as the wide layout selects it.
          .aglynPushDestination(item: $linkedPage) { id in
            if let row = rows.first(where: { $0.id == id }) {
              PageDetail(
                context: context, hostID: hostID, pageID: id, model: model, api: api, runner: runner,
                canEdit: canEdit, canPublish: canPublish, pushed: true
              )
              .navigationTitle(row.page.name)
              .aglynScreenTitle(row.page.name)
            }
          }
          .onChange(of: rows, initial: true) { _, rows in
            guard !linkSeeded, let initialPageID, rows.contains(where: { $0.id == initialPageID }) else { return }
            linkSeeded = true
            linkedPage = initialPageID
          }
          // The pushed list's look; the selectable one keeps its own (its rows already sit on the content edges).
          .aglynListBackground()
        }
      }
      .accessibilityIdentifier("pages-list")
    }
  }

  private var searching: Bool { !model.search.trimmingCharacters(in: .whitespaces).isEmpty }

  /// The next 25 top-level pages as the list scrolls to its end.
  @ViewBuilder
  private var moreRow: some View {
    if model.hasMore && model.search.trimmingCharacters(in: .whitespaces).isEmpty {
      AglynLoadMoreRow("Show more pages") { Task { await model.loadMore() } }
        .accessibilityIdentifier("pages-more")
    }
  }
}

struct PageListRow: View {
  let row: PageTreeRow
  var expanded = false
  var onToggle: (() -> Void)?

  var body: some View {
    let status = pageStatus(row)
    let subtitle: String =
      if row.page.isGroup || row.childCount > 0 {
        [row.page.isGroup ? nil : row.livePath, row.childCount == 1 ? "1 page inside" : "\(row.childCount) pages inside"]
          .compactMap { $0 }.joined(separator: " · ")
      }
      else if let live = row.livePath { live }
      else { row.page.slug.map { "/\($0) · not published" } ?? "No address yet" }
    AglynTreeIndent(depth: row.depth) {
      // A chevron on a row with children opens it in place; the list starts collapsed, like the console's.
      Group {
        if row.childCount > 0, let onToggle {
          Button(action: onToggle) {
            Image(systemName: "chevron.right")
              .font(.caption.weight(.semibold))
              .rotationEffect(.degrees(expanded ? 90 : 0))
              .animation(.snappy(duration: 0.15), value: expanded)
              .frame(width: 20, height: 28)
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .foregroundStyle(.secondary)
          .help(expanded ? "Hide the pages inside" : "Show the pages inside")
          .accessibilityLabel(expanded ? "Collapse \(row.page.name)" : "Expand \(row.page.name)")
          .accessibilityValue("\(row.childCount) inside")
          .accessibilityIdentifier("page-toggle-\(row.page.id)")
        } else {
          Color.clear.frame(width: 20, height: 1).accessibilityHidden(true)
        }
      }
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

/// What the last page action did, or why it failed: under the list, and under a page pushed over it on a phone,
/// where the list's own banner is out of sight.
struct PagesRunnerBanner: View {
  let runner: ActionRunner
  var sheetOpen = false

  var body: some View {
    if !sheetOpen, let error = runner.error {
      AglynNotice(error, tone: .error) { runner.clear() }.padding(AglynSpace.two)
    } else if let notice = runner.notice {
      AglynNotice(notice, tone: .success) { runner.clear() }.padding(AglynSpace.two)
        .task(id: notice) {
          // A banner that leaves (a deleted page's own screen) cancels its wait; it must not take the notice with it,
          // or the list it returns to never shows it.
          do { try await Task.sleep(nanoseconds: 6_000_000_000) } catch { return }
          if runner.notice == notice { runner.notice = nil }
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
  /// Pushed over the list on a phone: it shows the actions' banner itself, and a deleted page leaves.
  var pushed = false
  @Environment(\.openURL) private var openURL
  @Environment(\.dismiss) private var dismiss
  @State private var sheet: PageSheet?
  @State private var confirm: PageConfirm?

  var body: some View {
    if let row = model.row(pageID) {
      content(row)
        .safeAreaInset(edge: .bottom) {
          if pushed { PagesRunnerBanner(runner: runner, sheetOpen: sheet != nil) }
        }
        .sheet(item: $sheet) { sheet in
          PageSheetRouter(context: context, hostID: hostID, sheet: sheet, model: model, api: api, runner: runner, open: { self.sheet = $0 }) {
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
              runner.run("Page unpublished.") {
                try await api.unpublish(page.id)
                await model.reread([page.id])
              }
            }
          case .delete(let page, _):
            Button("Delete", role: .destructive) {
              runner.run(page.isGroup ? "Group deleted." : "Page deleted.", onDone: { if pushed { dismiss() } }) {
                let inside = model.tree?.children[page.id] ?? []
                if page.isGroup { try await api.deleteGroup(page.id) } else { try await api.delete(page.id) }
                // The page leaves the cache; a deleted group's pages move up a level.
                await model.reread([page.id] + inside)
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
    // The pages inside are spoken of only when there are some.
    let inside = (model.row(pending.page.id)?.childCount ?? 0) > 0 ? "Pages inside it keep their addresses." : nil
    switch pending {
    case .unpublish: return ["Visitors can no longer reach it.", inside].compactMap { $0 }.joined(separator: " ")
    case .delete(let page, let livePath):
      if page.isGroup {
        return inside == nil ? "The group is removed. It has no address of its own." : "Its pages move up a level and keep their addresses."
      }
      return [livePath.map { "It is live at \($0) and stops answering there." } ?? "It is not live.", inside]
        .compactMap { $0 }.joined(separator: " ")
    }
  }

  private func open(_ next: PageSheet) {
    runner.error = nil
    sheet = next
  }

  /// The page's acts (the calmer screens): its next step as the one filled button (a page nobody can visit yet is
  /// published; a live one is edited in the Besigner), and every other act in ⋯, Delete last.
  private func actions(_ row: PageTreeRow) -> (primary: AglynRecordAction?, more: [AglynRecordAction]) {
    let page = row.page
    let canPublishHere = canPublish && page.kind != screenKindTemplate
    let edit = AglynRecordAction(
      "page-edit-besigner", "Edit in the Besigner", systemImage: "paintbrush.pointed", enabled: page.versionID != nil
    ) {
      if let version = page.versionID {
        context.openBesigner(DeepLinks.besignerScreen(page.id, versionID: version), scope: .site)
      }
    }
    let publish = AglynRecordAction(
      "page-publish", row.livePath != nil ? "Change address" : "Publish", systemImage: "paperplane", enabled: canPublishHere
    ) { open(.publish(page, currentSlug: row.home ? "/" : page.slug ?? "")) }
    let primary: AglynRecordAction? = page.isGroup ? nil : row.livePath == nil && canPublishHere ? publish : edit
    var more: [AglynRecordAction] = []
    if !page.isGroup {
      if primary?.id != edit.id { more.append(edit) }
      if primary?.id != publish.id { more.append(publish) }
      if let live = row.livePath, let link = livePageURL(model.routing, livePath: live), let url = URL(string: link) {
        more.append(AglynRecordAction("page-open-live", "Open live page", systemImage: "arrow.up.right.square") { openURL(url) })
      }
    }
    more.append(
      AglynRecordAction("page-rename", page.isGroup ? "Rename group" : "Rename", systemImage: "pencil", enabled: canEdit) {
        open(.rename(page))
      })
    if !page.isGroup {
      more.append(
        AglynRecordAction("page-duplicate", "Duplicate", systemImage: "plus.square.on.square", enabled: canEdit) {
          open(.duplicate(page))
        })
      more.append(
        AglynRecordAction("page-save-template", "Save as template", systemImage: "bookmark", enabled: canEdit) {
          open(.saveTemplate(page))
        })
      more.append(AglynRecordAction("page-move", "Move", systemImage: "folder", enabled: canPublish) { open(.move(page)) })
      if row.livePath != nil {
        more.append(
          AglynRecordAction("page-unpublish", "Unpublish", systemImage: "eye.slash", enabled: canPublish) {
            confirm = .unpublish(page)
          })
      }
    }
    more.append(
      AglynRecordAction(
        "page-delete", page.isGroup ? "Delete group" : "Delete", systemImage: "trash", destructive: true, enabled: canPublish
      ) { confirm = .delete(page, livePath: row.livePath) })
    return (primary, more)
  }

  private func content(_ row: PageTreeRow) -> some View {
    let page = row.page
    let status = pageStatus(row)
    return Form {
      Section {
        let acts = actions(row)
        AglynRecordHeader(
          page.name, subtitle: row.home ? "Home page" : nil, systemImage: page.isGroup ? "folder" : SiteSymbols.page,
          status: (status.label, status.live ? .success : .neutral), primary: acts.primary, more: acts.more)
        if let description = page.description {
          Text(description).font(AglynFont.subheadline).foregroundStyle(.secondary)
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
          context: context, hostID: hostID, page: page, model: model, api: api, runner: runner, canPublish: canPublish)
        // What the page is doing, then who touched it (the console's page view, AGL-4011): its traffic above its activity.
        Section {
          PageTrafficCard(reader: context.firestore, api: context.api, hostID: hostID, screenID: page.id) {
            context.navigate("core.billing.plans")
          }
        }
        .aglynBareFormRow()
        Section {
          SiteActivityCard(reader: context.firestore, api: context.api, hostID: hostID, targetID: page.id, title: "Page Activity")
        }
        .aglynBareFormRow()
      }
    }
    .formStyle(.aglynGrouped)
    .aglynListBackground()
    // Back from the Besigner: the tree reads a page once, so what its publish changed (Published, Updated, the
    // live version) is read again now rather than shown stale until the list is reopened.
    .onReceive(NotificationCenter.default.publisher(for: RestFirestoreReader.rereadNotification)) { _ in
      Task { await model.reread([pageID]) }
    }
    #if os(iOS)
      // The record's head already shows the page's name large.
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .accessibilityIdentifier("page-detail")
  }
}

/// A page's saved versions, newest first: open one in the Besigner, or make it the one the page serves.
struct PageVersionsSection: View {
  let context: NativePluginContext
  let hostID: String
  let page: PageNode
  let model: SitePagesModel
  let api: PagesAPI
  let runner: ActionRunner
  let canPublish: Bool
  @State private var versions = LiveQuery()

  private var versionCount: Int? {
    if case .ready(let docs) = versions.state { return docs.count }
    return nil
  }

  var body: some View {
    AglynFoldedSection("Versions", count: versionCount, identifier: "page-fold-versions") {
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
                    await model.reread([page.id])
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
/// The sheet for a page action: the template sheets, which need the site, or the page form.
struct PageSheetRouter: View {
  let context: NativePluginContext
  let hostID: String
  let sheet: PageSheet
  let model: SitePagesModel
  let api: PagesAPI
  let runner: ActionRunner
  let open: (PageSheet) -> Void
  let close: () -> Void

  var body: some View {
    switch sheet {
    case .fromTemplate:
      TemplateGallerySheet(context: context, hostID: hostID, kind: "page", onChoose: { open(.useTemplate($0)) }, close: close)
    case .useTemplate(let row):
      UseTemplateSheet(context: context, hostID: hostID, row: row, onDone: { _, id in
        close()
        context.navigate(sitePagesScreen, ["page": id])
      }, close: close)
    case .saveTemplate(let page):
      SaveAsTemplateSheet(
        context: context, hostID: hostID, kind: "page", defaultName: page.name,
        load: { templates in try await templates.pageSource(page.id, versionID: page.versionID) },
        onSaved: { message in
          runner.notice = message
          close()
        }, close: close)
    default:
      PageSheetView(sheet: sheet, model: model, api: api, runner: runner) { id in
        context.navigate(sitePagesScreen, ["page": id])
      } close: {
        close()
      }
    }
  }
}

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
        case .move(let page):
          parent = page.parentID
          // The choice is over every page, so the windows still unread are read first.
          Task { await model.loadAll() }
        case .newPage, .newGroup, .fromTemplate, .useTemplate, .saveTemplate: break
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
          let made = try await api.createPage(name: name, description: description)
          await model.reread([made.id])
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
        runner.run("Group \(name.trimmed) added.", onDone: close) {
          let id = try await api.createGroup(name: name, topOrder: top)
          await model.reread([id])
        }
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
          await model.reread([page.id])
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
          await model.reread([page.id])
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
          if let id = try await api.duplicate(sourceID: page.id, name: name) {
            await model.reread([id])
            onSelectNew(id)
          }
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
        runner.run("Moved.", onDone: close) {
          try await api.move(page.id, parentID: target, index: siblings)
          await model.reread([page.id])
          if let target { await model.tree?.expand(target) }
        }
      } fields: {
        moveChoice("Top level", systemImage: SiteSymbols.home, id: nil)
        ForEach(movableParents(model.pages, pageID: page.id)) { choice in
          moveChoice(choice.name, systemImage: choice.isGroup ? SiteSymbols.group : SiteSymbols.page, id: choice.id)
        }
      }
    case .fromTemplate, .useTemplate, .saveTemplate:
      EmptyView()
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
    .buttonStyle(.aglynRow)
    .accessibilityAddTraits(parent == id ? .isSelected : [])
  }
}
