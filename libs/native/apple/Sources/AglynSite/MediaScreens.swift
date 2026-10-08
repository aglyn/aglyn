// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

let mediaSiteRoles: Set<String> = ["admin", "editor", "author"]
let mediaOrgRoles: Set<String> = ["owner", "admin", "editor"]

/// The media library, a file's details beside the grid in a wide window: the
/// site's library and the workspace's (as this site sees it), folders,
/// search, type and order, upload from the photo library, the camera or
/// files, and each file's details, privacy, move, replace and delete.
struct MediaScreen: View {
  let context: NativePluginContext
  let params: NativeParams
  @State private var tab: Int

  init(context: NativePluginContext, params: NativeParams) {
    self.context = context
    self.params = params
    _tab = State(initialValue: params["tab"] == "org" || Self.orgOnly(context, params) ? 1 : 0)
  }

  /// The workspace's own library page (`/{org}/media`) shows it whole; a site's shows both tabs.
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
        VStack(spacing: 0) {
          if !Self.orgOnly(context, params) {
            Picker("Library", selection: $tab) {
              Text("This site").tag(0)
              Text("Workspace").tag(1)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, AglynSpace.two)
            .padding(.top, AglynSpace.one)
            .accessibilityIdentifier("media-tabs")
          }
          MediaScopeGate(context: context, scope: scope, initialMediaID: params["media"]).id(scope)
        }
        .background(AglynColor.page)
      } else {
        AglynEmptyState("Pick a workspace first", systemImage: SiteSymbols.media)
      }
    }
    .navigationTitle("Media")
  }
}

/// Resolves who may read what in a workspace library before it loads: an
/// org-wide member reads it whole; a member limited to some sites reads it
/// through their scope tokens, as the rules require.
struct MediaScopeGate: View {
  let context: NativePluginContext
  let scope: MediaScope
  let initialMediaID: String?
  @State private var member = LiveDocument()

  var body: some View {
    switch scope {
    case .site:
      MediaLibrary(context: context, scope: scope, scopeTokens: nil, initialMediaID: initialMediaID)
    case .org(_, let forHostID?):
      MediaLibrary(
        context: context, scope: scope,
        scopeTokens: [OrgAccess.orgScopeToken, OrgAccess.hostScopeToken(forHostID)], initialMediaID: initialMediaID)
    case .org(let orgID, nil):
      Group {
        switch member.state {
        case .loading: SkeletonGrid(count: 9)
        case .failed:
          MediaLibrary(context: context, scope: scope, scopeTokens: nil, initialMediaID: initialMediaID)
        case .ready(let doc):
          MediaLibrary(
            context: context, scope: scope, scopeTokens: OrgAccess.libraryScope(doc), initialMediaID: initialMediaID)
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
  @State private var model = MediaListModel()
  @State private var folders = LiveQuery()
  @State private var runner = ActionRunner()
  @State private var selection: String?
  @State private var searchText = ""
  @State private var pickSource: PickSource?
  @State private var uploading: String?
  @State private var undo: (id: String, name: String)?
  @State private var folderSheet: FolderSheet?
  @State private var deletingFolder: MediaFolder?

  private var api: MediaAPI { MediaAPI(api: context.api, scope: scope) }

  private var canEdit: Bool {
    scope.isOrg ? mediaOrgRoles.contains(context.orgRole ?? "") : mediaSiteRoles.contains(context.siteRole ?? "")
  }

  private var folderList: [MediaFolder] { sortedFolders((folders.state.value ?? []).map(MediaFolder.init)) }
  private var foldersByID: [String: MediaFolder] { Dictionary(folderList.map { ($0.id, $0) }) { first, _ in first } }

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          library(selectable: true).frame(minWidth: 360, idealWidth: 460, maxWidth: 560)
          Divider()
          Group {
            if let selection {
              MediaDetail(
                context: context, scope: scope, mediaID: selection, api: api, runner: runner, folders: folderList,
                canEdit: canEdit, onDeleted: deleted
              )
              .id(selection)
            } else {
              AglynEmptyState("Pick a file to see its details", systemImage: SiteSymbols.media)
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        library(selectable: false)
      }
    }
    .searchable(text: $searchText, prompt: "Search files")
    .task(id: searchText) {
      try? await Task.sleep(nanoseconds: 300_000_000)
      if !Task.isCancelled { model.search = searchText }
    }
    .toolbar { toolbar }
    .aglynMediaPicker($pickSource, multiple: true) { files in upload(files) }
    .sheet(item: $folderSheet) { sheet in
      FolderSheetView(sheet: sheet, api: api, runner: runner, byID: foldersByID) { folderSheet = nil }
    }
    .confirmationDialog(
      "Delete \(deletingFolder?.name ?? "this folder")?",
      isPresented: Binding(get: { deletingFolder != nil }, set: { if !$0 { deletingFolder = nil } }),
      titleVisibility: .visible, presenting: deletingFolder
    ) { folder in
      Button("Delete folder", role: .destructive) {
        runner.run("Folder deleted.", onDone: { model.folder = .all }) { try await api.deleteFolder(folder.id) }
      }
    } message: { _ in
      Text("Its files and folders move up a level. No file is deleted.")
    }
    .safeAreaInset(edge: .bottom) { banners }
    .task(id: scope) {
      model.start(context.firestore, scope: scope, scopeTokens: scopeTokens)
      await folders.bind(
        context.firestore,
        FirestoreQuery(
          scope.path + ["mediaFolders"],
          filters: scopeTokens.map { [ListQueryConstraint(path: "visibleTo", op: .arrayContainsAny, value: $0)] } ?? [],
          limit: 500))
      model.stop()
    }
  }

  @ToolbarContentBuilder
  private var toolbar: some ToolbarContent {
    ToolbarItemGroup(placement: .primaryAction) {
      Menu {
        Picker("Sort", selection: $model.sort) {
          ForEach(ContractValues.shared.mediaSorts.filter { $0 != .unknown }, id: \.self) { sort in
            Text(ContractValues.shared.mediaSortLabels[sort.rawValue] ?? sort.rawValue).tag(sort)
          }
        }
        .pickerStyle(.inline)
        Section("Folder") {
          Button {
            runner.error = nil
            folderSheet = .create(parentID: model.folder.folderID)
          } label: {
            Label("New folder", systemImage: "folder.badge.plus")
          }
          .disabled(!canEdit)
          if let id = model.folder.folderID, let folder = foldersByID[id] {
            Button {
              runner.error = nil
              folderSheet = .rename(folder)
            } label: {
              Label("Rename folder", systemImage: "pencil")
            }
            .disabled(!canEdit)
            Button(role: .destructive) {
              deletingFolder = folder
            } label: {
              Label("Delete folder", systemImage: "trash")
            }
            .disabled(!canEdit)
          }
        }
      } label: {
        Label("Sort and folders", systemImage: "ellipsis.circle")
      }
      .accessibilityIdentifier("media-more")
      Menu {
        ForEach(PickSource.available) { source in
          Button {
            pickSource = source
          } label: {
            Label(source.label, systemImage: source.systemImage)
          }
          .accessibilityIdentifier("media-upload-\(source.rawValue)")
        }
      } label: {
        Label("Upload", systemImage: "square.and.arrow.up")
      } primaryAction: {
        #if os(macOS)
          pickSource = .files
        #else
          pickSource = .photos
        #endif
      }
      .disabled(!canEdit || runner.busy)
      .keyboardShortcut("u", modifiers: .command)
      .help("Upload photos, videos and documents")
      .accessibilityIdentifier("media-upload")
    }
  }

  @ViewBuilder
  private var banners: some View {
    VStack(spacing: AglynSpace.one) {
      if let uploading { AglynNotice(uploading, tone: .info) }
      if let undo {
        AglynNotice(
          "\(undo.name) deleted.", tone: .neutral, onDismiss: { self.undo = nil }, actionTitle: "Undo",
          action: {
            self.undo = nil
            runner.run("\(undo.name) is back.") { try await api.restore(undo.id) }
          }
        )
        .accessibilityIdentifier("media-undo")
      }
      if folderSheet == nil, let error = runner.error {
        AglynNotice(error, tone: .error) { runner.clear() }
      } else if let notice = runner.notice {
        AglynNotice(notice, tone: .success) { runner.clear() }
          .task(id: notice) {
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            if runner.notice == notice { runner.notice = nil }
          }
      }
    }
    .padding(.horizontal, AglynSpace.two)
    .padding(.bottom, AglynSpace.one)
  }

  private func deleted(_ id: String, _ name: String, _ restorable: Bool) {
    model.drop(id)
    if selection == id { selection = nil }
    undo = restorable ? (id, name) : nil
    if !restorable { runner.notice = "\(name) deleted." }
  }

  private func upload(_ files: [PickedFile]) {
    let folderID = model.folder.folderID
    let api = api
    runner.run(files.count == 1 ? "\(files[0].name) uploaded." : "\(files.count) files uploaded.") {
      defer { uploading = nil }
      for (index, file) in files.enumerated() {
        uploading = files.count == 1 ? "Uploading \(file.name)…" : "Uploading \(index + 1) of \(files.count)…"
        try await api.upload(file, folderID: folderID)
      }
    }
  }

  private var folderLabel: String {
    switch model.folder {
    case .all: "All files"
    case .root: "Not in a folder"
    case .one(let id): foldersByID[id].map { folderPath($0, byID: foldersByID) } ?? "Folder"
    }
  }

  private var filters: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: AglynSpace.one) {
        Menu {
          Button("All files") { model.folder = .all }
          Button("Not in a folder") { model.folder = .root }
          if !folderList.isEmpty { Divider() }
          ForEach(folderList.sorted { folderPath($0, byID: foldersByID).lowercased() < folderPath($1, byID: foldersByID).lowercased() }) { folder in
            Button {
              model.folder = .one(folder.id)
            } label: {
              Label(folderPath(folder, byID: foldersByID), systemImage: "folder")
            }
          }
        } label: {
          Label(folderLabel, systemImage: "folder").lineLimit(1)
        }
        .menuIndicator(.visible)
        .fixedSize()
        .accessibilityIdentifier("media-folder")
        Spacer(minLength: 0)
        Text(ContractValues.shared.mediaSortLabels[model.sort.rawValue] ?? "")
          .font(AglynFont.caption).foregroundStyle(.secondary)
          .accessibilityLabel("Sorted by \(ContractValues.shared.mediaSortLabels[model.sort.rawValue] ?? "")")
      }
      .padding(.horizontal, AglynSpace.two)
      .padding(.top, AglynSpace.one)
      AglynChipRow(
        mediaTypeChoices().map { AglynChipOption($0.value ?? "all", $0.label) }, selected: model.type ?? "all"
      ) { model.type = $0 == "all" ? nil : $0 }
      if scopeTokens != nil && !model.search.isEmpty {
        Text(ContractValues.shared.mediaScopedSearchNotice)
          .font(AglynFont.caption).foregroundStyle(.secondary)
          .padding(.horizontal, AglynSpace.two)
      }
    }
  }

  private func library(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      filters
      grid(selectable: selectable)
    }
    .background(AglynColor.page)
  }

  @ViewBuilder
  private func grid(selectable: Bool) -> some View {
    switch model.rows {
    case .loading:
      SkeletonGrid(count: 12)
    case .failed(let message):
      AglynEmptyState("Could not load the library", systemImage: SiteSymbols.error, message: message) {
        Button("Try again") { model.refresh() }
      }
    case .ready(let items) where items.isEmpty:
      AglynEmptyState(
        model.search.isEmpty && model.type == nil ? "No files here yet" : "No files match",
        systemImage: SiteSymbols.media,
        message: canEdit ? "Upload photos, videos and documents to use on your pages." : nil
      ) {
        if canEdit && model.search.isEmpty && model.type == nil {
          Button("Upload") { pickSource = PickSource.available.first }.buttonStyle(.borderedProminent)
        }
      }
    case .ready(let items):
      ScrollView {
        LazyVGrid(
          columns: [GridItem(.adaptive(minimum: 120), spacing: AglynSpace.one)], spacing: AglynSpace.one
        ) {
          ForEach(items) { item in
            tile(item, selectable: selectable)
          }
        }
        .padding(AglynSpace.two)
        if model.hasMore {
          AglynLoadMoreRow("Show more files") { model.loadMore() }.padding(.bottom, AglynSpace.two)
        }
      }
      .refreshable { model.refresh() }
      .accessibilityIdentifier("media-grid")
      .onChange(of: items, initial: true) { _, items in
        guard selectable else { return }
        if selection == nil || !items.contains(where: { $0.id == selection }) {
          selection = items.first { $0.id == initialMediaID }?.id ?? items.first?.id
        }
      }
      .sensoryFeedback(.selection, trigger: selection)
    }
  }

  @ViewBuilder
  private func tile(_ item: MediaItem, selectable: Bool) -> some View {
    let label = AglynMediaTile(
      item.fileName, imageURL: item.thumbnail(origin: context.api.origin).flatMap(URL.init(string:)),
      systemImage: mediaKindSymbol(item.kind), badge: item.isPrivate ? (text: "Private", tone: AglynTone.warning) : nil,
      selected: selectable && item.id == selection)
    Group {
      if selectable {
        Button {
          selection = item.id
        } label: {
          label
        }
      } else {
        NavigationLink {
          MediaDetail(
            context: context, scope: scope, mediaID: item.id, api: api, runner: runner, folders: folderList,
            canEdit: canEdit, onDeleted: deleted
          )
          .navigationTitle(item.fileName)
        } label: {
          label
        }
      }
    }
    .buttonStyle(AglynPressableStyle())
    .accessibilityIdentifier("media-\(item.id)")
  }
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

/// One file's details: preview, facts, the editable fields, and its actions.
struct MediaDetail: View {
  let context: NativePluginContext
  let scope: MediaScope
  let mediaID: String
  let api: MediaAPI
  let runner: ActionRunner
  let folders: [MediaFolder]
  let canEdit: Bool
  let onDeleted: (String, String, Bool) -> Void
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
            onDeleted: onDeleted)
        } else {
          AglynEmptyState("This file is gone", systemImage: SiteSymbols.media, message: "It may have been deleted.")
        }
      }
    }
    .task(id: mediaID) { await doc.bind(context.firestore, scope.path + ["media", mediaID]) }
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
  @Environment(\.openURL) private var openURL
  @State private var fileName = ""
  @State private var alt = ""
  @State private var details = ""
  @State private var tags = ""
  @State private var moving = false
  @State private var moveTarget: String?
  @State private var deleting = false
  @State private var replaceSource: PickSource?
  @State private var references: [MediaReference]?

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

  private func reset() {
    fileName = item.fileName
    alt = item.alt
    details = item.description
    tags = item.tags.joined(separator: ", ")
  }

  private var facts: String {
    [
      formatBytes(item.sizeBytes),
      item.width.flatMap { width in item.height.map { "\(width) × \($0) px" } }.flatMap { $0.hasPrefix("0 ×") ? nil : $0 },
      item.contentType.isEmpty ? nil : item.contentType,
      item.createdAt.map { "Added \(relativeTime($0).lowercased())" },
    ].compactMap { $0 }.joined(separator: " · ")
  }

  var body: some View {
    Form {
      Section {
        AglynRemoteImage(
          item.thumbnail(origin: origin, width: 640).flatMap(URL.init(string:)), systemImage: mediaKindSymbol(item.kind),
          contentMode: .fit, label: item.alt.isEmpty ? item.fileName : item.alt
        )
        .frame(maxWidth: .infinity)
        .frame(height: 260)
        .clipShape(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
        HStack(alignment: .firstTextBaseline) {
          Text(item.fileName).font(AglynFont.title2).lineLimit(2).accessibilityAddTraits(.isHeader)
          Spacer(minLength: AglynSpace.one)
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
            Label("More actions", systemImage: "ellipsis.circle").labelStyle(.iconOnly).imageScale(.large)
          }
          .menuIndicator(.hidden)
          .buttonStyle(.borderless)
          .fixedSize()
          .accessibilityIdentifier("media-actions")
        }
        Text(facts).font(AglynFont.caption).foregroundStyle(.secondary)
        ViewThatFits(in: .horizontal) {
          HStack(spacing: AglynSpace.one) { fileButtons }
          VStack(alignment: .leading, spacing: AglynSpace.one) { fileButtons }
        }
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
            VStack(alignment: .leading, spacing: 2) {
              Text("Private")
              Text("A private file has no public link; pages cannot show it.")
                .font(AglynFont.caption).foregroundStyle(.secondary)
            }
          }
          .disabled(!canEdit || runner.busy)
          .accessibilityIdentifier("media-private")
        }
      }
      Section {
        TextField("File name", text: Binding(get: { fileName }, set: { fileName = $0.capped(200) }))
          .disabled(!canEdit)
          .accessibilityIdentifier("media-file-name")
        VStack(alignment: .trailing, spacing: 2) {
          TextField("Alt text", text: Binding(get: { alt }, set: { alt = $0.capped(altMax) }), axis: .vertical)
            .lineLimit(1...4)
            .disabled(!canEdit)
            .accessibilityIdentifier("media-alt")
          AglynCharacterCount(alt.count, of: altMax)
        }
        TextField("Description", text: $details, axis: .vertical)
          .lineLimit(1...4)
          .disabled(!canEdit)
        TextField("Tags, separated by commas", text: $tags)
          .autocorrectionDisabled()
          .disabled(!canEdit)
          .accessibilityIdentifier("media-tags")
        AglynDetailRow(
          "Folder", value: item.folderID.flatMap { byID[$0] }.map { folderPath($0, byID: byID) },
          placeholder: "Not in a folder")
        HStack {
          Button("Save") {
            let (name, alt, details, tags) = (fileName.trimmed, alt.trimmed, details.trimmed, parsedTags)
            runner.run("Details saved.") {
              try await api.saveDetails(item.id, fileName: name, alt: alt, description: details, tags: tags)
            }
          }
          .buttonStyle(.borderedProminent)
          .disabled(!canEdit || !dirty || fileName.trimmed.isEmpty || runner.busy)
          .keyboardShortcut("s", modifiers: .command)
          .accessibilityIdentifier("media-save")
          if dirty {
            Button("Discard", action: reset).buttonStyle(.borderless)
          }
        }
      } header: {
        Text("Details")
      } footer: {
        Text("The file name is a display name only — the link stays the same. Alt text describes the image for screen readers and search.")
      }
      Section {
        switch references {
        case nil:
          Text("See which pages and components show this file.").foregroundStyle(.secondary)
        case let found? where found.isEmpty:
          Text("Nothing uses this file yet.").foregroundStyle(.secondary)
        case let found?:
          ForEach(found, id: \.self) { reference in
            AglynRow(reference.name, subtitle: reference.kind.capitalized, systemImage: SiteSymbols.page) {
              if reference.live { StatusChip("Live", tone: .success) }
            }
          }
        }
      } header: {
        HStack {
          Text("Used on")
          Spacer()
          Button(references == nil ? "Check" : "Check again") {
            let api = api
            let id = item.id
            runner.run { references = try await api.references(id) }
          }
          .disabled(runner.busy)
          .font(AglynFont.caption)
          .accessibilityIdentifier("media-references")
        }
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .accessibilityIdentifier("media-detail")
    .onChange(of: item, initial: true) { _, _ in reset() }
    .aglynMediaPicker($replaceSource, multiple: false) { files in
      guard let file = files.first else { return }
      runner.run("File replaced. Everywhere it is used now shows the new file.") {
        try await api.replace(item, with: file)
      }
    }
    .sheet(isPresented: $moving) { moveSheet }
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
      .buttonStyle(.bordered)
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
    .buttonStyle(.bordered)
    .accessibilityIdentifier("media-open")
    Button {
      replaceSource = .files
    } label: {
      Label("Replace file", systemImage: "arrow.triangle.2.circlepath")
    }
    .buttonStyle(.bordered)
    .disabled(!canEdit || runner.busy)
    .accessibilityIdentifier("media-replace")
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
    .buttonStyle(.plain)
    .accessibilityAddTraits(moveTarget == id ? .isSelected : [])
  }
}
