// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import QuickLook
import SwiftUI

#if os(macOS)
  import AppKit
#endif

let mediaSiteRoles: Set<String> = ["admin", "editor", "author"]
let mediaOrgRoles: Set<String> = ["owner", "admin", "editor"]

/// The media library as a file browser (Figma "Media · file browser", AGL-4004): at rest the grid fills the content,
/// folders first, then files; picking a file splits the view and opens its details on the right (a phone pushes them).
/// The site's library and the workspace's (as this site sees it), folders and subfolders, search, one Filter (type,
/// sort, more), grid or list, upload from the photo library, the camera, files or a drop, several files at once (move,
/// tag, delete), and each file's details, privacy, move, replace and delete.
struct MediaScreen: View {
  let context: NativePluginContext
  let params: NativeParams
  @Environment(\.aglynAreaHead) private var head
  @State private var tab: Int

  init(context: NativePluginContext, params: NativeParams) {
    self.context = context
    self.params = params
    _tab = State(initialValue: params["tab"] == "org" || Self.orgOnly(context, params) ? 1 : 0)
  }

  /// The workspace's own library page (`/{org}/media`) shows it whole; a site's shows both libraries.
  static func orgOnly(_ context: NativePluginContext, _ params: NativeParams) -> Bool {
    context.hostID == nil || params["library"] == "org" || (params["orgSlug"] != nil && params["hostSlug"] == nil)
  }

  private var scope: MediaScope? {
    let orgOnly = Self.orgOnly(context, params)
    if tab == 0, let hostID = context.hostID { return .site(hostID: hostID) }
    if let orgID = context.orgID { return .org(orgID: orgID, forHostID: orgOnly ? nil : context.hostID) }
    return nil
  }

  var body: some View {
    Group {
      if let scope {
        MediaScopeGate(context: context, scope: scope) { scopeTokens in
          MediaLibrary(
            context: context, scope: scope, scopeTokens: scopeTokens, initialMediaID: params["media"],
            library: Self.orgOnly(context, params) ? nil : $tab, head: head)
        }
        .id(scope)
        .background(AglynColor.paper)
      } else {
        AglynEmptyState("Pick a workspace first", systemImage: SiteSymbols.media)
      }
    }
    .navigationTitle("Media")
    .aglynScreenTitle("Media")
    .aglynListColumnHead(head)
  }
}

/// Resolves who may read what in a workspace library before it loads: an
/// org-wide member reads it whole; a member limited to some sites reads it
/// through their scope tokens, as the rules require.
struct MediaScopeGate<Content: View>: View {
  let context: NativePluginContext
  let scope: MediaScope
  @ViewBuilder let content: (_ scopeTokens: [String]?) -> Content
  @State private var member = LiveDocument()

  var body: some View {
    switch scope {
    case .site:
      content(nil)
    case .org(_, let forHostID?):
      content([OrgAccess.orgScopeToken, OrgAccess.hostScopeToken(forHostID)])
    case .org(let orgID, nil):
      Group {
        switch member.state {
        case .loading: SkeletonGrid(count: 9)
        case .failed: content(nil)
        case .ready(let doc): content(OrgAccess.libraryScope(doc))
        }
      }
      .task(id: orgID) { await member.bind(context.firestore, ["orgs", orgID, "members", context.uid]) }
    }
  }
}

/// What a folder sheet is asking for.
enum FolderSheet: Identifiable {
  case create(parentID: String?)
  case rename(MediaFolder)

  var id: String {
    switch self {
    case .create(let parent): "create-\(parent ?? "")"
    case .rename(let folder): "rename-\(folder.id)"
    }
  }
}

struct MediaLibrary: View {
  let context: NativePluginContext
  let scope: MediaScope
  let scopeTokens: [String]?
  let initialMediaID: String?
  /// This site's page offers both libraries; nil on the workspace's own page.
  var library: Binding<Int>? = nil
  /// The area's head (title, crumbs, star) this screen draws itself; nil where the shell draws one.
  var head: AglynAreaHead? = nil
  /// The folder a phone pushed this library open at.
  var initialFolder: String? = nil
  @Environment(\.aglynWideChrome) private var wide
  @Environment(\.openURL) private var openURL
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var model = MediaListModel()
  @State private var folders = LiveQuery()
  @State private var runner = ActionRunner()
  /// The files picked: one opens its details beside the grid, several the bulk panel.
  @State private var selection: Set<String> = []
  /// Where a ⇧-click range starts.
  @State private var anchor: String?
  /// The folder the keyboard is on (arrows walk folders, then files).
  @State private var focusedFolder: String?
  /// Picking several on a touch screen (no ⌘-click there).
  @State private var selecting = false
  @State private var searchText = ""
  @State private var pickSource: PickSource?
  @State private var sourceChoice = false
  @State private var audioBatch: [PickedFile]?
  @State private var uploading: (done: Int, total: Int, name: String)?
  @State private var undo: (ids: [String], names: [String])?
  @State private var folderSheet: FolderSheet?
  @State private var filtersSheet = false
  @State private var deletingFolder: MediaFolder?
  @State private var bulkTag: Bool?
  @State private var bulkDeleting = false
  @State private var includeSubfolders = false
  @State private var counts: [String: Int] = [:]
  /// Bumped after a move, so the folder counts are read again.
  @State private var countsVersion = 0
  @State private var columns = 4
  @State private var quickLook: URL?
  @State private var dropFolder: String?
  @State private var dropCrumb: String??
  @FocusState private var gridFocused: Bool
  @AppStorage("aglyn.media.view") private var viewRaw = MediaViewMode.grid.rawValue
  /// Files staff have disabled among those on screen (AGL-1612), asked of the console after each change of the page.
  @State private var disabled: [String: MediaQuarantineNotice] = [:]

  private var api: MediaAPI { MediaAPI(api: context.api, scope: scope) }
  private var origin: String { context.api.origin }

  private var canEdit: Bool {
    scope.isOrg ? mediaOrgRoles.contains(context.orgRole ?? "") : mediaSiteRoles.contains(context.siteRole ?? "")
  }

  private var folderList: [MediaFolder] { sortedFolders((folders.state.value ?? []).map(MediaFolder.init)) }
  private var foldersByID: [String: MediaFolder] { Dictionary(folderList.map { ($0.id, $0) }) { first, _ in first } }
  private var currentFolderID: String? { model.folder.folderID }
  private var items: [MediaItem] { model.rows.value ?? [] }
  private var viewMode: MediaViewMode { wide ? MediaViewMode(rawValue: viewRaw) ?? .grid : .grid }
  private var phone: Bool { !wide }

  /// The open folder's path from the top: `[Catering, Wedding cakes]`.
  private var crumbs: [MediaFolder] {
    var path: [MediaFolder] = []
    var current = currentFolderID.flatMap { foldersByID[$0] }
    var seen = Set<String>()
    while let step = current, seen.insert(step.id).inserted {
      path.insert(step, at: 0)
      current = step.parentID.flatMap { foldersByID[$0] }
    }
    return path
  }

  /// The folders at this level, shown before the files (AGL-818); none while searching, as the console does.
  private var visibleFolders: [MediaFolder] {
    guard model.search.trimmed.isEmpty, model.folder != .root else { return [] }
    return folderList.filter { $0.parentID == currentFolderID }
  }

  private var selectedItems: [MediaItem] { items.filter { selection.contains($0.id) } }

  private var filtering: Bool { !model.search.isEmpty || model.type != nil || model.filters.count > 0 }

  private var uploadAction: AglynPrimaryAction {
    AglynPrimaryAction(
      id: "media-upload", title: "Upload media", systemImage: "square.and.arrow.up", enabled: canEdit && !runner.busy,
      shortcut: KeyboardShortcut("u", modifiers: .command), help: "Upload photos, videos and documents"
    ) { startUpload() }
  }

  var body: some View {
    VStack(spacing: 0) {
      if let head {
        if wide { wideHead(head) } else { AglynListColumnHeader(head, primary: uploadAction) { newFolderButton(icon: true) } }
      }
      HStack(spacing: 0) {
        browser
        if wide && !selection.isEmpty {
          AglynColumnHairline().ignoresSafeArea(edges: .bottom)
          inspector
            .frame(width: AglynMediaMetrics.inspectorWidth)
            .transition(.move(edge: .trailing).combined(with: .opacity))
        }
      }
      .animation(reduceMotion ? nil : AglynShellMotion.drill, value: selection.isEmpty)
    }
    .background(AglynColor.paper)
    .modifier(MediaShellActions(enabled: head == nil, upload: uploadAction, newFolder: newFolderButton(icon: false)))
    .task(id: searchText) {
      try? await Task.sleep(nanoseconds: 300_000_000)
      if !Task.isCancelled { model.search = searchText }
    }
    .aglynMediaPicker($pickSource, multiple: true) { files in
      // An audio file needs its uploader's rights confirmation first (AGL-3716).
      if files.contains(where: isAudioFile) { audioBatch = files } else { upload(files, rightsConfirmed: false) }
    }
    .confirmationDialog("Upload from", isPresented: $sourceChoice, titleVisibility: .visible) {
      ForEach(PickSource.available) { source in
        Button(source.label) { pickSource = source }.accessibilityIdentifier("media-upload-\(source.rawValue)")
      }
    }
    .sheet(isPresented: Binding(get: { audioBatch != nil }, set: { if !$0 { audioBatch = nil } })) {
      AudioRightsSheet(files: audioBatch ?? []) { confirmed in
        let files = audioBatch ?? []
        audioBatch = nil
        if confirmed { upload(files, rightsConfirmed: true) }
      }
    }
    .sheet(isPresented: $filtersSheet) {
      MediaFiltersSheet(context: context, filters: model.filters, scoped: scopeTokens != nil) { model.filters = $0 } close: {
        filtersSheet = false
      }
    }
    .sheet(item: $folderSheet) { sheet in
      FolderSheetView(sheet: sheet, api: api, runner: runner, byID: foldersByID) { folderSheet = nil }
    }
    .sheet(isPresented: Binding(get: { bulkTag != nil }, set: { if !$0 { bulkTag = nil } })) {
      MediaBulkTagSheet(
        add: bulkTag ?? true, count: selection.count, busy: runner.busy, error: runner.error, cancel: { bulkTag = nil }
      ) { tag in applyTag(tag, add: bulkTag ?? true) }
    }
    .confirmationDialog(
      "Delete \(deletingFolder?.name ?? "this folder")?",
      isPresented: Binding(get: { deletingFolder != nil }, set: { if !$0 { deletingFolder = nil } }),
      titleVisibility: .visible, presenting: deletingFolder
    ) { folder in
      Button("Delete folder", role: .destructive) {
        runner.run("Folder deleted.", onDone: { if currentFolderID == folder.id { open(folder.parentID) } }) {
          try await api.deleteFolder(folder.id)
        }
      }
    } message: { _ in
      Text("Its files and folders move up a level. No file is deleted.")
    }
    .confirmationDialog(
      "Delete \(mediaFilesCount(selection.count))?", isPresented: $bulkDeleting, titleVisibility: .visible
    ) {
      Button("Delete", role: .destructive) { deleteSelection() }
    } message: {
      Text("The files are removed from storage, and pages that show them stop showing them. You can undo this right after.")
    }
    .quickLookPreview($quickLook)
    .safeAreaInset(edge: .bottom) { banners }
    .task(id: scope) {
      if let initialFolder { model.folder = .one(initialFolder) }
      model.start(context.firestore, scope: scope, scopeTokens: scopeTokens)
      await folders.bind(
        context.firestore,
        FirestoreQuery(
          scope.path + ["mediaFolders"],
          filters: scopeTokens.map { [ListQueryConstraint(path: "visibleTo", op: .arrayContainsAny, value: $0)] } ?? [],
          limit: 500))
      model.stop()
    }
    .task(id: visibleFolders.map(\.id) + ["\(countsVersion)"]) {
      for folder in visibleFolders {
        if let count = await mediaFolderCount(context.firestore, scope: scope, folderID: folder.id, scopeTokens: scopeTokens) {
          counts[folder.id] = count
        }
      }
    }
    .onChange(of: includeSubfolders) { _, _ in syncSubtree() }
    .onChange(of: folderList) { _, _ in syncSubtree() }
    .onChange(of: model.folder) { _, _ in
      selection = []
      focusedFolder = nil
      syncSubtree()
    }
  }

  // MARK: Head

  /// The area's head across the content on the Mac and iPad (Figma Media 283:22621): crumbs, the title with its star,
  /// New folder and the filled Upload media.
  private func wideHead(_ head: AglynAreaHead) -> some View {
    AglynContentHeader(head.title) {
      head.crumbs
    } accessory: {
      head.star
      Spacer(minLength: AglynSpace.one)
      newFolderButton(icon: false).buttonStyle(AglynHeaderButtonStyle()).fixedSize()
      AglynPrimaryHeaderButton.blockable(uploadAction)
    }
  }

  private func newFolderButton(icon: Bool) -> some View {
    Button {
      runner.error = nil
      folderSheet = .create(parentID: currentFolderID)
    } label: {
      if icon {
        Label("New folder", systemImage: "folder.badge.plus").labelStyle(.iconOnly)
      } else {
        Label("New folder", systemImage: "folder.badge.plus").labelStyle(.titleAndIcon)
      }
    }
    .disabled(!canEdit)
    .help("New folder")
    .accessibilityIdentifier("media-new-folder")
  }

  /// Where Upload picks from: files on the Mac (photos can be dragged in); a choice of sources on iPhone and iPad.
  private func startUpload() {
    #if os(macOS)
      pickSource = .files
    #else
      sourceChoice = true
    #endif
  }

  // MARK: Browser

  private var browser: some View {
    VStack(alignment: .leading, spacing: 0) {
      AglynListToolbar(text: $searchText, prompt: "Search files") { filterMenu }
      MediaPathRow(
        library: library, crumbs: crumbs, open: { open($0) }, includeSubfolders: $includeSubfolders,
        view: Binding(get: { viewMode }, set: { viewRaw = $0.rawValue }), selecting: $selecting,
        dropTargetCrumb: dropCrumb
      )
      .modifier(MediaCrumbDrops(crumbs: crumbs, dropCrumb: $dropCrumb, onDrop: { ids, folder in move(ids, to: folder) }))
      .aglynContentEdges()
      .padding(.bottom, AglynSpace.oneAndHalf)
      notices
      content
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
  }

  private var filterActive: String? {
    let typeLabel = model.type.flatMap { type in mediaTypeChoices().first { $0.value == type }?.label }
    let more = model.filters.count
    if more == 0 { return typeLabel }
    return "Filters · \(more + (typeLabel == nil ? 0 : 1))"
  }

  private var filterMenu: some View {
    AglynFilterMenu(active: filterActive) {
      Picker("Type", selection: $model.type) {
        ForEach(mediaTypeChoices(), id: \.label) { choice in Text(choice.label).tag(choice.value) }
      }
      .pickerStyle(.inline)
      Picker("Sort", selection: $model.sort) {
        ForEach(ContractValues.shared.mediaSorts.filter { $0 != .unknown }, id: \.self) { sort in
          Text(ContractValues.shared.mediaSortLabels[sort.rawValue] ?? sort.rawValue).tag(sort)
        }
      }
      .pickerStyle(.inline)
      Divider()
      Button(model.filters.count == 0 ? "More filters…" : "More filters (\(model.filters.count))…") { filtersSheet = true }
        .accessibilityIdentifier("media-filters")
      if filtering {
        Button("Clear filters") { clearFilters() }
      }
    }
  }

  @ViewBuilder
  private var notices: some View {
    let lines =
      (scopeTokens != nil && !model.search.isEmpty ? [ContractValues.shared.mediaScopedSearchNotice] : []) + model.notices
    if !lines.isEmpty {
      VStack(alignment: .leading, spacing: AglynSpace.half) {
        ForEach(lines, id: \.self) { notice in
          Text(notice).font(AglynFont.caption).foregroundStyle(AglynColor.secondaryText)
            .accessibilityIdentifier("media-filter-notice")
        }
      }
      .aglynContentEdges()
      .padding(.bottom, AglynSpace.one)
    }
  }

  @ViewBuilder
  private var content: some View {
    switch model.rows {
    case .loading:
      SkeletonGrid(count: 12, minimum: AglynMediaMetrics.tileMinWidth)
    case .failed(let message):
      AglynEmptyState("Could not load the library", systemImage: SiteSymbols.error, message: message) {
        Button("Try again") { model.refresh() }
      }
    case .ready(let items) where items.isEmpty && visibleFolders.isEmpty:
      empty.modifier(MediaFileDrops(enabled: canEdit) { upload($0, rightsConfirmed: false) })
    case .ready(let items):
      GeometryReader { geometry in
        let width = geometry.size.width - 2 * (wide ? AglynContentInsets.horizontal : AglynContentInsets.phone)
        ScrollView {
          if viewMode == .list { listView(items) } else { gridView(items, width: width) }
        }
        .refreshable { model.refresh() }
        .accessibilityIdentifier("media-grid")
        .onAppear { columns = columnCount(width) }
        .onChange(of: width) { _, new in columns = columnCount(new) }
      }
      .contentShape(Rectangle())
      .onTapGesture { if wide { selection = [] } }
      .modifier(MediaFileDrops(enabled: canEdit) { upload($0, rightsConfirmed: false) })
      .modifier(
        MediaKeyboard(
          enabled: wide, focus: $gridFocused, move: step, open: openFocused, preview: previewFocused,
          clear: { selection = [] }))
      .sensoryFeedback(.selection, trigger: selection)
      .task(id: items.map(\.id)) {
        disabled = await api.quarantine(items.map(\.id))
        if wide, selection.isEmpty, let initialMediaID, items.contains(where: { $0.id == initialMediaID }) {
          selection = [initialMediaID]
        }
      }
    }
  }

  /// The console's three empty states, kept apart: a filter that matched nothing, and a library or folder with nothing
  /// in it yet (loading draws the skeleton).
  @ViewBuilder
  private var empty: some View {
    if filtering {
      AglynEmptyState(
        "No media matches these filters", systemImage: "line.3.horizontal.decrease.circle",
        message: "Try a different search, folder, or type — or clear the filters to see everything in this library."
      ) {
        Button("Clear filters") { clearFilters() }.accessibilityIdentifier("media-clear-filters")
      }
    } else {
      AglynEmptyState(
        "No media here yet", systemImage: "folder",
        message: "Upload images, video, PDFs and documents to use on your site. Drop them here or use Upload media above."
      ) {
        if canEdit {
          Button("Upload media") { startUpload() }.buttonStyle(.aglynProminent).accessibilityIdentifier("media-empty-upload")
        }
      }
    }
  }

  private func columnCount(_ width: CGFloat) -> Int {
    if phone { return 3 }
    return max(1, Int((width + AglynMediaMetrics.gap) / (AglynMediaMetrics.tileMinWidth + AglynMediaMetrics.gap)))
  }

  private func gridView(_ items: [MediaItem], width: CGFloat) -> some View {
    let gap: CGFloat = phone ? AglynMediaMetrics.phoneGap : AglynMediaMetrics.gap
    let fileColumns = Array(repeating: GridItem(.flexible(), spacing: gap, alignment: .top), count: max(1, columnCount(width)))
    let folderColumns = phone ? Array(repeating: GridItem(.flexible(), spacing: gap), count: 2) : fileColumns
    return VStack(alignment: .leading, spacing: AglynSpace.one) {
      if !visibleFolders.isEmpty {
        groupLabel("Folders")
        LazyVGrid(columns: folderColumns, spacing: gap) {
          ForEach(visibleFolders) { folder in folderTile(folder) }
        }
        .padding(.bottom, items.isEmpty ? 0 : AglynSpace.oneAndHalf)
      }
      if !items.isEmpty {
        groupLabel("Files")
        LazyVGrid(columns: fileColumns, spacing: phone ? AglynMediaMetrics.phoneFileRowGap : AglynMediaMetrics.fileRowGap) {
          ForEach(items) { item in fileTile(item) }
        }
      }
      if model.hasMore {
        AglynLoadMoreRow("Show more files") { model.loadMore() }.padding(.top, AglynSpace.one)
      }
    }
    .padding(.horizontal, wide ? AglynContentInsets.horizontal : AglynContentInsets.phone)
    .padding(.bottom, AglynSpace.three)
  }

  private func groupLabel(_ title: String) -> some View {
    Text(title)
      .font(.system(size: phone ? AglynMediaMetrics.phoneGroupLabel : AglynMediaMetrics.groupLabel, weight: .semibold))
      .foregroundStyle(AglynColor.secondaryText)
      .accessibilityAddTraits(.isHeader)
  }

  private func listView(_ items: [MediaItem]) -> some View {
    LazyVStack(alignment: .leading, spacing: AglynMediaMetrics.ring) {
      HStack(spacing: AglynSpace.oneAndHalf) {
        Text("Name").frame(maxWidth: .infinity, alignment: .leading)
          .padding(.leading, AglynMediaMetrics.rowThumb.width + AglynSpace.oneAndHalf)
        Text("Type").frame(width: AglynMediaMetrics.typeColumn, alignment: .leading)
        Text("Size").frame(width: AglynMediaMetrics.sizeColumn, alignment: .trailing)
        Text("Added").frame(width: AglynMediaMetrics.addedColumn, alignment: .trailing)
      }
      .font(.system(size: AglynMediaMetrics.groupLabel, weight: .semibold))
      .foregroundStyle(AglynColor.secondaryText)
      .padding(.horizontal, AglynSpace.one)
      .padding(.bottom, AglynSpace.half)
      ForEach(visibleFolders) { folder in
        Button {
          open(folder.id)
        } label: {
          HStack(spacing: AglynSpace.oneAndHalf) {
            Image(systemName: "folder.fill").font(.system(size: AglynMediaMetrics.rowFolderSymbol)).foregroundStyle(AglynColor.primary)
              .frame(width: AglynMediaMetrics.rowThumb.width, height: AglynMediaMetrics.rowThumb.height)
            Text(folder.name).font(.system(size: AglynMediaMetrics.name, weight: .semibold)).foregroundStyle(AglynColor.textPrimary)
              .frame(maxWidth: .infinity, alignment: .leading)
            Text(counts[folder.id].map(mediaFilesCount) ?? "").font(.system(size: AglynMediaMetrics.caption))
              .foregroundStyle(AglynColor.secondaryText)
          }
          .padding(.horizontal, AglynSpace.one).frame(minHeight: AglynMediaMetrics.rowHeight).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .modifier(MediaFolderDrop(folderID: folder.id, dropFolder: $dropFolder) { move($0, to: folder.id) })
        .accessibilityIdentifier("media-folder-\(folder.id)")
      }
      ForEach(items) { item in
        MediaFileRow(
          item: item, thumbnail: item.thumbnail(origin: origin, width: AglynMediaMetrics.cdnRow).flatMap(URL.init(string:)),
          selected: selection.contains(item.id), badge: mediaTileBadge(private: item.isPrivate, disabled: disabled[item.id] != nil)
        )
        .onTapGesture { click(item) }
        .modifier(MediaFileDrag(ids: dragIDs(item), enabled: canEdit))
        .contextMenu { fileMenu(item) }
        .accessibilityIdentifier("media-\(item.id)")
      }
      if model.hasMore { AglynLoadMoreRow("Show more files") { model.loadMore() }.padding(.top, AglynSpace.one) }
    }
    .padding(.horizontal, AglynContentInsets.horizontal - AglynSpace.one)
    .padding(.bottom, AglynSpace.three)
  }

  @ViewBuilder
  private func folderTile(_ folder: MediaFolder) -> some View {
    let tile = MediaFolderTile(
      name: folder.name, count: counts[folder.id], selected: focusedFolder == folder.id, dropTarget: dropFolder == folder.id,
      compactPhone: phone)
    Group {
      if phone {
        AglynPushLink(disclosure: false) {
          MediaLibrary(context: context, scope: scope, scopeTokens: scopeTokens, initialMediaID: nil, library: nil, head: nil, initialFolder: folder.id)
            .navigationTitle(folder.name)
            .aglynScreenTitle(folder.name)
        } label: {
          tile
        }
      } else {
        Button { open(folder.id) } label: { tile }
      }
    }
    .buttonStyle(AglynPressableStyle())
    .modifier(MediaFolderDrop(folderID: folder.id, dropFolder: $dropFolder) { move($0, to: folder.id) })
    .contextMenu {
      if canEdit {
        Button("New subfolder", systemImage: "folder.badge.plus") { folderSheet = .create(parentID: folder.id) }
        Button("Rename", systemImage: "pencil") { folderSheet = .rename(folder) }
        Divider()
        Button("Delete", systemImage: "trash", role: .destructive) { deletingFolder = folder }
      }
    }
    .accessibilityIdentifier("media-folder-\(folder.id)")
  }

  @ViewBuilder
  private func fileTile(_ item: MediaItem) -> some View {
    let state: MediaTileSelection =
      selecting ? (selection.contains(item.id) ? .checked : .unchecked)
      : selection.count > 1 ? (selection.contains(item.id) ? .checked : .none)
      : selection.contains(item.id) ? .selected : .none
    let tile = MediaFileTile(
      item: item, thumbnail: item.thumbnail(origin: origin).flatMap(URL.init(string:)), selection: state,
      badge: mediaTileBadge(private: item.isPrivate, disabled: disabled[item.id] != nil), compactPhone: phone)
    Group {
      if phone && !selecting {
        AglynPushLink(disclosure: false) {
          detail(item.id, inspector: false)
            .navigationTitle(item.fileName)
            .aglynScreenTitle(item.fileName)
        } label: {
          tile
        }
        .buttonStyle(AglynPressableStyle())
      } else {
        tile.onTapGesture { click(item) }
          .simultaneousGesture(TapGesture(count: 2).onEnded { if wide && !selecting { openFile(item) } })
      }
    }
    .modifier(MediaFileDrag(ids: dragIDs(item), enabled: canEdit && wide))
    .contextMenu { fileMenu(item) }
    .accessibilityIdentifier("media-\(item.id)")
  }

  @ViewBuilder
  private func fileMenu(_ item: MediaItem) -> some View {
    if !item.isPrivate, let src = item.src(origin: origin) {
      Button("Copy link", systemImage: "link") {
        AglynClipboard.copy(src)
        runner.notice = "Link copied."
      }
    }
    Button("Open file", systemImage: "arrow.down.circle") { openFile(item) }
    if canEdit {
      Menu("Move to folder", systemImage: "folder") {
        Button("No folder") { move(dragIDs(item), to: nil) }
        ForEach(folderList.sorted { folderPath($0, byID: foldersByID).lowercased() < folderPath($1, byID: foldersByID).lowercased() }) {
          folder in
          Button(folderPath(folder, byID: foldersByID)) { move(dragIDs(item), to: folder.id) }
        }
      }
      Divider()
      Button("Delete…", systemImage: "trash", role: .destructive) {
        if !selection.contains(item.id) { selection = [item.id] }
        bulkDeleting = true
      }
    }
  }

  /// What a drag or a menu acts on: the whole selection when the file is part of it (the console's rule), else the file.
  private func dragIDs(_ item: MediaItem) -> [String] {
    selection.contains(item.id) && selection.count > 1 ? items.map(\.id).filter(selection.contains) : [item.id]
  }

  // MARK: Selection and keys

  private func click(_ item: MediaItem) {
    focusedFolder = nil
    gridFocused = true
    if selecting {
      if selection.contains(item.id) { selection.remove(item.id) } else { selection.insert(item.id) }
      return
    }
    let (toggle, range) = clickModifiers()
    selection = mediaSelection(
      selection, anchor: anchor, clicked: item.id, toggle: toggle, range: range, order: items.map(\.id))
    if !range { anchor = item.id }
  }

  private func clickModifiers() -> (toggle: Bool, range: Bool) {
    #if os(macOS)
      let flags = NSEvent.modifierFlags
      return (flags.contains(.command), flags.contains(.shift))
    #else
      return (false, false)
    #endif
  }

  /// The grid's order for the keyboard: folders, then files (`f:` marks a folder).
  private var keyOrder: [String] { visibleFolders.map { "f:\($0.id)" } + items.map(\.id) }

  private func step(_ move: MediaGridMove) {
    let current = focusedFolder.map { "f:\($0)" } ?? (selection.count == 1 ? selection.first : nil)
    guard let next = mediaGridStep(keyOrder, from: current, columns: columns, move: move) else { return }
    if next.hasPrefix("f:") {
      focusedFolder = String(next.dropFirst(2))
      selection = []
    } else {
      focusedFolder = nil
      selection = [next]
      anchor = next
    }
  }

  private func openFocused() {
    if let focusedFolder { open(focusedFolder) } else if selection.count == 1, let item = selectedItems.first { openFile(item) }
  }

  /// Space: the picked file in Quick Look, fetched to a temporary file first.
  private func previewFocused() {
    guard selection.count == 1, let item = selectedItems.first else { return }
    let api = api
    runner.run {
      let link: String?
      if item.isPrivate && scope.isOrg { link = try await api.signedLink(item.id) } else { link = item.src(origin: origin) }
      guard let link, let url = URL(string: link) else { return }
      let (data, _) = try await URLSession.shared.data(from: url)
      let local = FileManager.default.temporaryDirectory.appendingPathComponent("aglyn-media-\(item.id)", isDirectory: true)
      try? FileManager.default.createDirectory(at: local, withIntermediateDirectories: true)
      let file = local.appendingPathComponent(item.fileName)
      try data.write(to: file)
      quickLook = file
    }
  }

  private func openFile(_ item: MediaItem) {
    if item.isPrivate && scope.isOrg {
      let (api, id) = (api, item.id)
      runner.run { if let link = try await api.signedLink(id), let url = URL(string: link) { openURL(url) } }
    } else if let src = item.src(origin: origin), let url = URL(string: src) {
      openURL(url)
    }
  }

  private func open(_ folderID: String?) {
    model.folder = folderID.map { .one($0) } ?? .all
  }

  private func syncSubtree() {
    if includeSubfolders, let id = currentFolderID {
      model.subtree = mediaFolderSubtree(id, folders: folderList)
    } else {
      model.subtree = []
    }
  }

  private func clearFilters() {
    searchText = ""
    model.search = ""
    model.type = nil
    model.filters = MediaFilters()
  }

  // MARK: Inspector

  @ViewBuilder
  private var inspector: some View {
    if selection.count == 1, let id = selection.first {
      detail(id, inspector: true).id(id)
    } else {
      MediaBulkPanel(
        items: selectedItems, origin: origin, folders: folderList, canEdit: canEdit, busy: runner.busy,
        move: { move(items.map(\.id).filter(selection.contains), to: $0) },
        tag: { add in
          runner.error = nil
          bulkTag = add
        },
        delete: { bulkDeleting = true }, clear: { selection = [] })
    }
  }

  private func detail(_ id: String, inspector: Bool) -> some View {
    MediaDetail(
      context: context, scope: scope, mediaID: id, api: api, runner: runner, folders: folderList, canEdit: canEdit,
      onDeleted: deleted, onClose: inspector ? { selection = [] } : nil)
  }

  // MARK: Actions

  @ViewBuilder
  private var banners: some View {
    VStack(spacing: AglynSpace.one) {
      if phone && selecting && !selection.isEmpty { phoneBulkBar }
      if let uploading {
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          HStack(spacing: AglynSpace.one) {
            Image(systemName: "square.and.arrow.up").font(.system(size: AglynMediaMetrics.control, weight: .medium))
            Text(uploading.total == 1 ? "Uploading \(uploading.name)…" : "Uploading \(uploading.done + 1) of \(uploading.total)…")
              .font(.system(size: AglynMediaMetrics.control, weight: .medium)).lineLimit(1)
          }
          .foregroundStyle(AglynColor.textPrimary)
          ProgressView(value: Double(uploading.done), total: Double(max(uploading.total, 1)))
            .progressViewStyle(.linear).tint(AglynColor.primary)
        }
        .padding(.horizontal, AglynSpace.of(1.75)).padding(.vertical, AglynSpace.of(1.25))
        .background(RoundedRectangle(cornerRadius: AglynMediaMetrics.tileRadius, style: .continuous).fill(AglynColor.accentSoft))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("media-uploading")
      }
      if let undo {
        AglynNotice(
          mediaDeletedMessage(undo.names), tone: .neutral, onDismiss: { self.undo = nil }, actionTitle: "Undo",
          action: {
            self.undo = nil
            let api = api
            runner.run(mediaRestoredMessage(undo.names)) { for id in undo.ids { try await api.restore(id) } }
          }
        )
        .accessibilityIdentifier("media-undo")
      }
      if folderSheet == nil, bulkTag == nil, let error = runner.error {
        AglynNotice(error, tone: .error) { runner.clear() }
      } else if let notice = runner.notice {
        AglynNotice(notice, tone: .success) { runner.clear() }
          .task(id: notice) {
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            if runner.notice == notice { runner.notice = nil }
          }
      }
    }
    .aglynContentEdges()
    .padding(.bottom, AglynSpace.one)
  }

  /// A phone's bulk actions while picking several: how many, and the console's actions in one menu.
  private var phoneBulkBar: some View {
    HStack(spacing: AglynSpace.oneAndHalf) {
      Text("\(selection.count) selected").font(.system(size: AglynMediaMetrics.panelTitle, weight: .semibold))
        .foregroundStyle(AglynColor.textPrimary)
      Spacer(minLength: AglynSpace.one)
      Menu {
        Menu("Move to folder…") {
          Button("No folder") { move(items.map(\.id).filter(selection.contains), to: nil) }
          ForEach(folderList.sorted { folderPath($0, byID: foldersByID).lowercased() < folderPath($1, byID: foldersByID).lowercased() }) {
            folder in
            Button(folderPath(folder, byID: foldersByID)) { move(items.map(\.id).filter(selection.contains), to: folder.id) }
          }
        }
        Button("Add tag…") { bulkTag = true }
        Button("Remove tag…") { bulkTag = false }
        Divider()
        Button("Delete…", role: .destructive) { bulkDeleting = true }
      } label: {
        Text("Actions").font(.system(size: AglynMediaMetrics.panelTitle, weight: .semibold))
      }
      .disabled(!canEdit || runner.busy)
      .accessibilityIdentifier("media-bulk-menu")
    }
    .padding(.horizontal, AglynSpace.two).padding(.vertical, AglynSpace.oneAndHalf)
    .aglynCardSurface()
  }

  private func deleted(_ id: String, _ name: String, _ restorable: Bool) {
    model.drop(id)
    selection.remove(id)
    undo = restorable ? ([id], [name]) : nil
    if !restorable { runner.notice = mediaDeletedMessage([name]) + "." }
  }

  private func deleteSelection() {
    let picked = items.filter { selection.contains($0.id) }
    let api = api
    runner.run {
      var gone: [String] = []
      var restorable: [(String, String)] = []
      var failed: [String] = []
      for item in picked {
        do {
          if try await api.delete(item.id) { restorable.append((item.id, item.fileName)) }
          gone.append(item.id)
        } catch {
          failed.append(item.fileName)
        }
      }
      model.drop(Set(gone))
      selection = []
      if !restorable.isEmpty { undo = (restorable.map { $0.0 }, restorable.map { $0.1 }) }
      if !failed.isEmpty {
        runner.error = failed.count == 1
          ? "Could not delete \"\(failed[0])\" — it is still in the library"
          : "Could not delete \(failed.count) files — they are still in the library"
      }
    }
  }

  private func applyTag(_ tag: String, add: Bool) {
    let normalized = tag.trimmed.lowercased()
    guard !normalized.isEmpty else { return }
    let picked = items.filter { selection.contains($0.id) }
    let api = api
    runner.run(add ? "Tagged \(mediaFilesCount(picked.count))" : "Untagged \(mediaFilesCount(picked.count))", onDone: { bulkTag = nil }) {
      for item in picked {
        let tags = add
          ? (item.tags.contains(normalized) ? item.tags : item.tags + [normalized])
          : item.tags.filter { $0 != normalized }
        if tags != item.tags { try await api.setTags(item.id, tags: tags) }
      }
    }
  }

  private func move(_ ids: [String], to folderID: String?) {
    guard canEdit, !ids.isEmpty else { return }
    let api = api
    let leaving = model.folder != .all && model.folder.folderID != folderID && !model.subtree.contains(folderID ?? "")
    runner.run("Moved.") {
      try await api.move(ids, folderID: folderID)
      if leaving { model.drop(Set(ids)) }
      selection.subtract(ids)
      countsVersion += 1
    }
  }

  private func upload(_ files: [PickedFile], rightsConfirmed: Bool) {
    guard canEdit, !files.isEmpty else { return }
    let folderID = model.folder.folderID
    let api = api
    runner.run(files.count == 1 ? "\(files[0].name) uploaded." : "\(files.count) files uploaded.") {
      defer { uploading = nil }
      for (index, file) in files.enumerated() {
        uploading = (index, files.count, file.name)
        try await api.upload(file, folderID: folderID, rightsConfirmed: rightsConfirmed)
      }
    }
  }
}

/// The head's actions where the shell draws the head (a library pushed over another screen): Upload media as the
/// filled button, New folder beside it; on a phone, in the navigation bar.
private struct MediaShellActions<NewFolder: View>: ViewModifier {
  let enabled: Bool
  let upload: AglynPrimaryAction
  let newFolder: NewFolder

  func body(content: Content) -> some View {
    if enabled {
      content
        .aglynPrimaryAction(upload)
        .aglynScreenToolbar(id: "media-new-folder") { newFolder }
    } else {
      content
    }
  }
}

/// Arrow keys walk the grid, Return opens, Space previews in Quick Look, Escape closes the details (Mac and iPad with
/// a keyboard).
private struct MediaKeyboard: ViewModifier {
  let enabled: Bool
  let focus: FocusState<Bool>.Binding
  let move: (MediaGridMove) -> Void
  let open: () -> Void
  let preview: () -> Void
  let clear: () -> Void

  func body(content: Content) -> some View {
    if enabled {
      content
        .focusable()
        .focused(focus)
        .focusEffectDisabled()
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow]) { press in
          switch press.key {
          case .leftArrow: move(.left)
          case .rightArrow: move(.right)
          case .upArrow: move(.up)
          default: move(.down)
          }
          return .handled
        }
        .onKeyPress(.return) {
          open()
          return .handled
        }
        .onKeyPress(.space) {
          preview()
          return .handled
        }
        .onKeyPress(.escape) {
          clear()
          return .handled
        }
    } else {
      content
    }
  }
}

/// The ids a dragged file carries (`aglyn-media:<id>`), so a folder or a crumb it is dropped on can move it.
private let mediaDragPrefix = "aglyn-media:"

/// A file that can be dragged onto a folder or a crumb (the whole selection when it is part of one).
private struct MediaFileDrag: ViewModifier {
  let ids: [String]
  let enabled: Bool

  func body(content: Content) -> some View {
    if enabled {
      content.draggable(ids.map { mediaDragPrefix + $0 }.joined(separator: "\n"))
    } else {
      content
    }
  }
}

/// The media ids in a drop, if it is files from this library.
private func mediaDroppedIDs(_ strings: [String]) -> [String] {
  strings.flatMap { $0.split(separator: "\n").map(String.init) }
    .filter { $0.hasPrefix(mediaDragPrefix) }
    .map { String($0.dropFirst(mediaDragPrefix.count)) }
}

/// A folder files can be dropped on to move them into it (it lights up while one is over it).
private struct MediaFolderDrop: ViewModifier {
  let folderID: String
  @Binding var dropFolder: String?
  let onDrop: ([String]) -> Void

  func body(content: Content) -> some View {
    content.dropDestination(for: String.self) { strings, _ in
      let ids = mediaDroppedIDs(strings)
      guard !ids.isEmpty else { return false }
      onDrop(ids)
      return true
    } isTargeted: { over in
      if over { dropFolder = folderID } else if dropFolder == folderID { dropFolder = nil }
    }
  }
}

/// The crumbs files can be dropped on (the console's crumb drop zones): All files and each folder above.
private struct MediaCrumbDrops: ViewModifier {
  let crumbs: [MediaFolder]
  @Binding var dropCrumb: String??
  let onDrop: ([String], String?) -> Void

  func body(content: Content) -> some View {
    // The path row as a whole takes a drop onto the folder one level up, the move a crumb drop most often means.
    let target: String? = crumbs.count > 1 ? crumbs[crumbs.count - 2].id : nil
    if crumbs.isEmpty {
      content
    } else {
      content.dropDestination(for: String.self) { strings, _ in
        let ids = mediaDroppedIDs(strings)
        guard !ids.isEmpty else { return false }
        onDrop(ids, target)
        return true
      } isTargeted: { over in
        dropCrumb = over ? .some(target) : nil
      }
    }
  }
}

/// Files dropped from Finder or Files onto the library are uploaded into the open folder.
private struct MediaFileDrops: ViewModifier {
  let enabled: Bool
  let upload: ([PickedFile]) -> Void

  func body(content: Content) -> some View {
    if enabled {
      content.dropDestination(for: URL.self) { urls, _ in
        let files = urls.filter(\.isFileURL).compactMap { url -> PickedFile? in
          let scoped = url.startAccessingSecurityScopedResource()
          defer { if scoped { url.stopAccessingSecurityScopedResource() } }
          guard let data = try? Data(contentsOf: url) else { return nil }
          return PickedFile(name: url.lastPathComponent, mimeType: PickedFile.mimeType(forExtension: url.pathExtension), data: data)
        }
        guard !files.isEmpty else { return false }
        upload(files)
        return true
      }
    } else {
      content
    }
  }
}

/// The one badge a tile carries. A disabled file is not serving to anyone, so it outranks the Private advisory.
func mediaTileBadge(private isPrivate: Bool, disabled: Bool) -> (text: String, tone: AglynTone)? {
  if disabled { return (text: "Disabled", tone: .error) }
  return isPrivate ? (text: "Private", tone: .warning) : nil
}

/// New folder and Rename folder.
struct FolderSheetView: View {
  let sheet: FolderSheet
  let api: MediaAPI
  let runner: ActionRunner
  let byID: [String: MediaFolder]
  let close: () -> Void
  @State private var name = ""
  @State private var loaded = false

  private var limit: Int { ContractValues.shared.mediaFolderNameMaxLength }

  var body: some View {
    Group {
      switch sheet {
      case .create(let parentID):
        AglynActionSheet(
          "New folder", message: parentID.flatMap { byID[$0] }.map { "Inside \(folderPath($0, byID: byID))." },
          confirmLabel: "Create folder", confirmEnabled: !name.trimmed.isEmpty, busy: runner.busy, error: runner.error,
          onCancel: close
        ) {
          let name = name.trimmed
          runner.run("Folder \(name) added.", onDone: close) { try await api.createFolder(name: name, parentID: parentID) }
        } fields: {
          field
        }
      case .rename(let folder):
        AglynActionSheet(
          "Rename folder", confirmLabel: "Save", confirmEnabled: !name.trimmed.isEmpty && name.trimmed != folder.name,
          busy: runner.busy, error: runner.error, onCancel: close
        ) {
          let name = name.trimmed
          runner.run("Folder renamed.", onDone: close) { try await api.renameFolder(folder.id, name: name) }
        } fields: {
          field
        }
      }
    }
    .onAppear {
      guard !loaded else { return }
      loaded = true
      if case .rename(let folder) = sheet { name = folder.name }
    }
  }

  private var field: some View {
    TextField("Folder name", text: Binding(get: { name }, set: { name = $0.capped(limit) }))
      .accessibilityIdentifier("folder-name")
  }
}

/// One file's details: preview, facts, the editable fields, and its actions. Beside the grid on the Mac and iPad (with
/// its name, ⋯ and × on top, Figma 283:24628), pushed on a phone.
struct MediaDetail: View {
  let context: NativePluginContext
  let scope: MediaScope
  let mediaID: String
  let api: MediaAPI
  let runner: ActionRunner
  let folders: [MediaFolder]
  let canEdit: Bool
  let onDeleted: (String, String, Bool) -> Void
  /// Closes the details beside the grid; nil where they are pushed.
  var onClose: (() -> Void)? = nil
  @State private var doc = LiveDocument()

  var body: some View {
    Group {
      switch doc.state {
      case .loading:
        List { SkeletonRows(count: 6) }.aglynListBackground()
      case .failed:
        AglynEmptyState(
          "Could not load this file", systemImage: SiteSymbols.error, message: "Check the connection and try again.")
      case .ready(let value):
        if let item = value.flatMap(MediaItem.init) {
          MediaDetailBody(
            context: context, scope: scope, item: item, api: api, runner: runner, folders: folders, canEdit: canEdit,
            onDeleted: onDeleted, onClose: onClose)
        } else {
          AglynEmptyState("This file is gone", systemImage: SiteSymbols.media, message: "It may have been deleted.")
        }
      }
    }
    .background(AglynColor.paper)
    .task(id: mediaID) { await doc.bind(context.firestore, scope.path + ["media", mediaID]) }
  }
}

/// A field in the details (Figma Media inspector: the label over a bordered box).
private struct MediaDetailField: View {
  let label: String
  @Binding var text: String
  var multiline = false
  var enabled = true
  var identifier: String? = nil

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      Text(label).font(.system(size: AglynMediaMetrics.fieldLabel, weight: .medium)).foregroundStyle(AglynColor.secondaryText)
      Group {
        if multiline {
          TextField("", text: $text, axis: .vertical).lineLimit(1...5)
        } else {
          TextField("", text: $text)
        }
      }
      .textFieldStyle(.plain)
      .font(.system(size: AglynMediaMetrics.field))
      .foregroundStyle(AglynColor.textPrimary)
      .padding(AglynMediaMetrics.fieldPadding)
      .background(RoundedRectangle(cornerRadius: AglynMediaMetrics.fieldRadius, style: .continuous).fill(AglynColor.paper))
      .overlay(RoundedRectangle(cornerRadius: AglynMediaMetrics.fieldRadius, style: .continuous).strokeBorder(AglynColor.divider))
      .disabled(!enabled)
      .accessibilityLabel(label)
      .accessibilityIdentifier(identifier ?? "")
    }
  }
}

struct MediaDetailBody: View {
  let context: NativePluginContext
  let scope: MediaScope
  let item: MediaItem
  let api: MediaAPI
  let runner: ActionRunner
  let folders: [MediaFolder]
  let canEdit: Bool
  let onDeleted: (String, String, Bool) -> Void
  var onClose: (() -> Void)? = nil
  @Environment(\.openURL) private var openURL
  @Environment(\.aglynWideChrome) private var wide
  @State private var fileName = ""
  @State private var alt = ""
  @State private var details = ""
  @State private var tags = ""
  @State private var moving = false
  @State private var moveTarget: String?
  @State private var deleting = false
  @State private var replaceSource: PickSource?
  @State private var audioReplacement: PickedFile?
  @State private var editingImage = false
  @State private var references: [MediaReference]?
  /// Why staff disabled this file, when they did (AGL-1612).
  @State private var disabled: MediaQuarantineNotice?

  private var origin: String { context.api.origin }
  private var altMax: Int { ContractValues.shared.mediaAltMaxLength }
  private var byID: [String: MediaFolder] { Dictionary(folders.map { ($0.id, $0) }) { first, _ in first } }
  private var parsedTags: [String] {
    tags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
  }
  private var dirty: Bool {
    fileName.trimmed != item.fileName || alt.trimmed != item.alt || details.trimmed != item.description
      || parsedTags.map { $0.lowercased() } != item.tags
  }
  /// Privacy is a workspace-wide setting: an owner or admin sets it on a workspace file.
  private var orgWideEditor: Bool { !scope.isOrg || ["owner", "admin"].contains(context.orgRole ?? "") }
  /// The details' side margin: the inspector's 24, or the column's content edge where they are pushed.
  private var inset: CGFloat {
    if onClose != nil { return AglynSpace.three }
    return wide ? AglynContentInsets.horizontal : AglynContentInsets.phone
  }

  private func replace(with file: PickedFile, rightsConfirmed: Bool) {
    runner.run("File replaced. Everywhere it is used now shows the new file.") {
      try await api.replace(item, with: file, rightsConfirmed: rightsConfirmed)
    }
  }

  private func reset() {
    fileName = item.fileName
    alt = item.alt
    details = item.description
    tags = item.tags.joined(separator: ", ")
  }

  private var facts: String {
    // Built step by step: the one-literal form crashed Swift 6.3's
    // diagnostics on GitHub's macOS image (AGL-3709).
    var parts: [String] = [formatBytes(item.sizeBytes)]
    if let width = item.width, let height = item.height {
      let size = "\(width) × \(height) px"
      if !size.hasPrefix("0 ×") { parts.append(size) }
    }
    if !item.contentType.isEmpty { parts.append(item.contentType) }
    if let createdAt = item.createdAt { parts.append("Added \(relativeTime(createdAt).lowercased())") }
    return parts.joined(separator: " · ")
  }

  private var moreMenu: some View {
    Menu {
      Button {
        moveTarget = item.folderID
        runner.error = nil
        moving = true
      } label: {
        Label("Move to folder", systemImage: "folder")
      }
      .disabled(!canEdit)
      Button(role: .destructive) {
        deleting = true
      } label: {
        Label("Delete file", systemImage: "trash")
      }
      .disabled(!canEdit)
    } label: {
      Image(systemName: "ellipsis").font(.system(size: AglynMediaMetrics.control, weight: .semibold)).frame(width: AglynMediaMetrics.button, height: AglynMediaMetrics.button)
    }
    .menuStyle(.button)
    .buttonStyle(AglynHeaderButtonStyle())
    .menuIndicator(.hidden)
    .fixedSize()
    .help("More actions")
    .accessibilityLabel("More actions")
    .accessibilityIdentifier("media-actions")
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: AglynSpace.two) {
        if let onClose {
          HStack(spacing: AglynSpace.of(0.75)) {
            Text(item.fileName)
              .font(.system(size: AglynMediaMetrics.panelTitle, weight: .semibold)).foregroundStyle(AglynColor.textPrimary)
              .lineLimit(1).truncationMode(.middle)
              .frame(maxWidth: .infinity, alignment: .leading)
              .accessibilityAddTraits(.isHeader)
            moreMenu
            Button(action: onClose) {
              Image(systemName: "xmark").font(.system(size: AglynMediaMetrics.symbol, weight: .semibold)).frame(width: AglynMediaMetrics.button, height: AglynMediaMetrics.button)
            }
            .buttonStyle(AglynHeaderButtonStyle())
            .keyboardShortcut(.cancelAction)
            .help("Close")
            .accessibilityLabel("Close")
            .accessibilityIdentifier("media-close")
          }
        }
        if let disabled {
          AglynNotice("\(disabled.title). \(disabled.message)", tone: .error)
            .accessibilityIdentifier("media-quarantine")
        }
        MediaPreview(
          item: item, url: item.thumbnail(origin: origin, width: AglynMediaMetrics.cdnInspector).flatMap(URL.init(string:)),
          maxPixel: AglynMediaMetrics.pixelsInspector, glyphSize: AglynMediaMetrics.glyphInspector
        )
        .aspectRatio(AglynMediaMetrics.previewAspect, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: AglynMediaMetrics.tileRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: AglynMediaMetrics.tileRadius, style: .continuous).strokeBorder(AglynColor.divider))
          .accessibilityLabel(item.alt.isEmpty ? item.fileName : item.alt)
        Text(facts).font(.system(size: wide ? AglynMediaMetrics.note : AglynMediaMetrics.phoneNote)).foregroundStyle(AglynColor.secondaryText)
          .fixedSize(horizontal: false, vertical: true)
        AglynWrapRow(spacing: AglynSpace.one, lineSpacing: AglynSpace.one) { fileButtons }
        if orgWideEditor {
          Toggle(
            isOn: Binding(
              get: { item.isPrivate },
              set: { next in
                runner.run(next ? "Only signed-in members can open it now." : "Anyone with the link can open it now.") {
                  try await api.setPrivate(item.id, next)
                }
              })
          ) {
            VStack(alignment: .leading, spacing: AglynMediaMetrics.ring) {
              Text("Private").font(.system(size: wide ? AglynMediaMetrics.switchLabel : AglynMediaMetrics.phoneSwitchLabel, weight: wide ? .medium : .regular))
                .foregroundStyle(AglynColor.textPrimary)
              Text("A private file has no public link; pages cannot show it.")
                .font(.system(size: wide ? AglynMediaMetrics.note : AglynMediaMetrics.phoneNote)).foregroundStyle(AglynColor.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
            }
          }
          .toggleStyle(.switch)
          #if os(macOS)
            .controlSize(.small)
          #endif
          .disabled(!canEdit || runner.busy)
          .accessibilityIdentifier("media-private")
        }
        AglynHairline()
        Text("Details").font(.system(size: AglynMediaMetrics.groupLabel, weight: .semibold)).foregroundStyle(AglynColor.secondaryText)
          .accessibilityAddTraits(.isHeader)
        MediaDetailField(
          label: "File name", text: Binding(get: { fileName }, set: { fileName = $0.capped(200) }), enabled: canEdit,
          identifier: "media-file-name")
        VStack(alignment: .trailing, spacing: AglynMediaMetrics.ring) {
          MediaDetailField(
            label: "Alt text", text: Binding(get: { alt }, set: { alt = $0.capped(altMax) }), multiline: true,
            enabled: canEdit, identifier: "media-alt")
          AglynCharacterCount(alt.count, of: altMax)
        }
        MediaDetailField(label: "Description", text: $details, multiline: true, enabled: canEdit)
        MediaDetailField(label: "Tags, separated by commas", text: $tags, enabled: canEdit, identifier: "media-tags")
          .autocorrectionDisabled()
        Button {
          moveTarget = item.folderID
          runner.error = nil
          moving = true
        } label: {
          HStack(spacing: AglynSpace.one) {
            Text("Folder").foregroundStyle(AglynColor.secondaryText)
            Spacer(minLength: AglynSpace.one)
            Text(item.folderID.flatMap { byID[$0] }.map { folderPath($0, byID: byID) } ?? "Not in a folder")
              .foregroundStyle(AglynColor.textPrimary).lineLimit(1)
            Image(systemName: "chevron.right").font(.system(size: AglynMediaMetrics.chevron, weight: .semibold)).foregroundStyle(AglynColor.textTertiary)
          }
          .font(.system(size: wide ? AglynMediaMetrics.detailText : AglynMediaMetrics.phoneDetailText))
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!canEdit)
        .accessibilityIdentifier("media-folder")
        HStack(spacing: AglynSpace.one) {
          Button("Save") {
            let (name, alt, details, tags) = (fileName.trimmed, alt.trimmed, details.trimmed, parsedTags)
            runner.run("Details saved.") {
              try await api.saveDetails(item.id, fileName: name, alt: alt, description: details, tags: tags)
            }
          }
          .buttonStyle(.aglynProminent)
          .disabled(!canEdit || !dirty || fileName.trimmed.isEmpty || runner.busy)
          .keyboardShortcut("s", modifiers: .command)
          .accessibilityIdentifier("media-save")
          if dirty {
            Button("Discard", action: reset).buttonStyle(.borderless)
          }
        }
        Text("The file name is a display name only — the link stays the same. Alt text describes the image for screen readers and search.")
          .font(.system(size: AglynMediaMetrics.note)).foregroundStyle(AglynColor.textTertiary)
          .fixedSize(horizontal: false, vertical: true)
        AglynHairline()
        HStack {
          Text("Used on").font(.system(size: AglynMediaMetrics.groupLabel, weight: .semibold)).foregroundStyle(AglynColor.secondaryText)
          Spacer()
          Button(references == nil ? "Check" : "Check again") {
            let api = api
            let id = item.id
            runner.run { references = try await api.references(id) }
          }
          .buttonStyle(.borderless)
          .disabled(runner.busy)
          .font(.system(size: AglynMediaMetrics.note, weight: .medium))
          .accessibilityIdentifier("media-references")
        }
        switch references {
        case nil:
          Text("See which pages and components show this file.").font(.system(size: AglynMediaMetrics.detailText)).foregroundStyle(AglynColor.secondaryText)
        case let found? where found.isEmpty:
          Text("Nothing uses this file yet.").font(.system(size: AglynMediaMetrics.detailText)).foregroundStyle(AglynColor.secondaryText)
        case let found?:
          ForEach(found, id: \.self) { reference in
            AglynRow(reference.name, subtitle: reference.kind.capitalized, systemImage: SiteSymbols.page) {
              if reference.live { StatusChip("Live", tone: .success) }
            }
          }
        }
      }
      .padding(.horizontal, inset)
      .padding(.top, onClose == nil ? AglynSpace.two : AglynMediaMetrics.ring)
      .padding(.bottom, AglynSpace.three)
    }
    .accessibilityIdentifier("media-detail")
    .toolbar {
      if onClose == nil, !wide {
        ToolbarItem(placement: .primaryAction) { moreMenu }
      }
    }
    .onChange(of: item, initial: true) { _, _ in reset() }
    .task(id: item.id) { disabled = await api.quarantine([item.id])[item.id] }
    .aglynMediaPicker($replaceSource, multiple: false) { files in
      guard let file = files.first else { return }
      // An audio file needs its uploader's rights confirmation first (AGL-3716).
      if isAudioFile(file) { audioReplacement = file } else { replace(with: file, rightsConfirmed: false) }
    }
    .sheet(
      isPresented: Binding(get: { audioReplacement != nil }, set: { if !$0 { audioReplacement = nil } })
    ) {
      AudioRightsSheet(files: audioReplacement.map { [$0] } ?? []) { confirmed in
        let file = audioReplacement
        audioReplacement = nil
        if confirmed, let file { replace(with: file, rightsConfirmed: true) }
      }
    }
    .sheet(isPresented: $moving) { moveSheet }
    .sheet(isPresented: $editingImage) { imageEditor }
    .confirmationDialog("Delete \(item.fileName)?", isPresented: $deleting, titleVisibility: .visible) {
      Button("Delete", role: .destructive) {
        let (id, name) = (item.id, item.fileName)
        runner.run {
          let restorable = try await api.delete(id)
          onDeleted(id, name, restorable)
        }
      }
    } message: {
      Text("Pages that show it stop showing it. You can undo this right after.")
    }
  }

  @ViewBuilder
  private var fileButtons: some View {
    if !item.isPrivate, let src = item.src(origin: origin) {
      Button {
        AglynClipboard.copy(src)
        runner.notice = "Link copied."
      } label: {
        Label("Copy link", systemImage: "link")
      }
      .buttonStyle(.aglynSecondary)
      .accessibilityIdentifier("media-copy-link")
    }
    Button {
      if item.isPrivate && scope.isOrg {
        let (api, id) = (api, item.id)
        runner.run {
          if let link = try await api.signedLink(id), let url = URL(string: link) { openURL(url) }
        }
      } else if let src = item.src(origin: origin), let url = URL(string: src) {
        openURL(url)
      }
    } label: {
      Label("Open file", systemImage: "arrow.down.circle")
    }
    .buttonStyle(.aglynSecondary)
    .accessibilityIdentifier("media-open")
    Button {
      replaceSource = .files
    } label: {
      Label("Replace file", systemImage: "arrow.triangle.2.circlepath")
    }
    .buttonStyle(.aglynSecondary)
    .disabled(!canEdit || runner.busy)
    .accessibilityIdentifier("media-replace")
    // Rotate, flip, crop and shrink are for pictures only: there is nothing to crop in a PDF.
    if item.contentType.hasPrefix("image/") {
      Button {
        runner.clear()
        editingImage = true
      } label: {
        Label("Edit image", systemImage: "crop.rotate")
      }
      .buttonStyle(.aglynSecondary)
      .disabled(!canEdit || runner.busy)
      .accessibilityIdentifier("media-edit-image")
    }
  }

  /// The image editor, over the file itself rather than the display copy the library shows, so "Replace original"
  /// never saves a shrunken copy over it.
  private var imageEditor: some View {
    let (api, item, scope, origin) = (api, item, scope, origin)
    return ImageEditorSheet(
      fileName: item.fileName,
      loadOriginal: {
        let link: String?
        if item.isPrivate && scope.isOrg { link = try? await api.signedLink(item.id) } else { link = item.src(origin: origin).map(mediaOriginalSrc) }
        guard let link, let url = URL(string: link), let (data, response) = try? await URLSession.shared.data(from: url),
          (response as? HTTPURLResponse)?.statusCode == 200
        else { return nil }
        return data
      },
      busy: runner.busy, error: runner.error,
      onCancel: { editingImage = false },
      onSave: { file, asCopy in
        if asCopy {
          runner.run("Saved an edited copy.", onDone: { editingImage = false }) { _ = try await api.upload(file, folderID: item.folderID) }
        } else {
          runner.run("Image replaced. Everywhere it is used now shows the edited image.", onDone: { editingImage = false }) {
            try await api.replace(item, with: file, rightsConfirmed: false)
          }
        }
      })
  }

  private var moveSheet: some View {
    AglynActionSheet(
      "Move to folder", confirmLabel: "Move", confirmEnabled: moveTarget != item.folderID, busy: runner.busy,
      error: runner.error, onCancel: { moving = false }
    ) {
      let (id, target) = (item.id, moveTarget)
      runner.run("Moved.", onDone: { moving = false }) { try await api.move([id], folderID: target) }
    } fields: {
      folderChoice("Not in a folder", systemImage: "tray", id: nil)
      ForEach(folders.sorted { folderPath($0, byID: byID).lowercased() < folderPath($1, byID: byID).lowercased() }) {
        folder in
        folderChoice(folderPath(folder, byID: byID), systemImage: "folder", id: folder.id)
      }
    }
  }

  private func folderChoice(_ label: String, systemImage: String, id: String?) -> some View {
    Button {
      moveTarget = id
    } label: {
      AglynRow(label, systemImage: systemImage) {
        if moveTarget == id { Image(systemName: "checkmark").foregroundStyle(AglynColor.tint) }
      }
    }
    .buttonStyle(.aglynRow)
    .accessibilityAddTraits(moveTarget == id ? .isSelected : [])
  }
}
