// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// What a person picked in the chooser: the file and the library it came from.
public struct ChosenMedia: Equatable, Sendable {
  public let item: MediaItem
  public let scope: MediaScope

  private var hostID: String? {
    switch scope {
    case .site(let hostID): hostID
    case .org(_, let forHostID): forHostID
    }
  }

  /// What the console's picker stores (`mediaNodeSrc`): the asset by identity
  /// (`media:{scope}/{mediaId}`), so replacing or moving the file never breaks
  /// what names it, and for a workspace file shared with only some sites, the
  /// form that names this site (`hostQualifiedCdnPath`).
  public var reference: String {
    mediaNodeSrc(
      url: item.url, cdnPath: hostQualifiedCDNPath(item.cdnPath, visibleTo: item.visibleTo, hostID: hostID),
      isPrivate: item.isPrivate) ?? "media:\(scope.cdnScope)/\(item.id)"
  }
}

/// Why a private file cannot be placed, as the console's picker says it.
public let privateFileRefusal =
  "That file is private, so it cannot be placed on a page. Turn off Private in the media library to use it here."

/// The media library as a chooser, the native side of the console's media
/// picker (`pickMedia`): this site's files and the workspace's, filtered to
/// one kind (nil: every kind), one tap to choose. Upload adds a file from this
/// device to the library being shown, as the console picker's library does, and
/// chooses it as soon as it lands. A private file is refused unless `allowPrivate` (the console's
/// `pickMedia` option for paid media, which only a private file can be). Shown in a sheet by whoever needs a file.
public struct MediaChooserSheet: View {
  let context: NativePluginContext
  let kind: String?
  let allowPrivate: Bool
  let workspaceOnly: Bool
  let onChoose: (ChosenMedia) -> Void
  @State private var tab = 0
  @Environment(\.dismiss) private var dismiss

  /// `workspaceOnly` shows the workspace's library alone, whichever site is picked: a workspace setting (its logo,
  /// its favicon) is chosen from the workspace's files, as the console's org media browser does.
  public init(
    context: NativePluginContext, kind: String? = "image", allowPrivate: Bool = false, workspaceOnly: Bool = false,
    onChoose: @escaping (ChosenMedia) -> Void
  ) {
    self.context = context
    self.kind = kind
    self.allowPrivate = allowPrivate
    self.workspaceOnly = workspaceOnly
    self.onChoose = onChoose
  }

  private var scope: MediaScope? {
    if !workspaceOnly, context.hostID != nil, tab == 0 { return context.hostID.map { .site(hostID: $0) } }
    return context.orgID.map { .org(orgID: $0, forHostID: workspaceOnly ? nil : context.hostID) }
  }

  public var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        if context.hostID != nil, !workspaceOnly {
          Picker("Library", selection: $tab) {
            Text("This site").tag(0)
            Text("Workspace").tag(1)
          }
          .pickerStyle(.segmented)
          .labelsHidden()
          .aglynContentEdges()
          .padding(.vertical, AglynSpace.one)
        }
        if let scope {
          MediaScopeGate(context: context, scope: scope) { scopeTokens in
            MediaChooserGrid(context: context, scope: scope, scopeTokens: scopeTokens, kind: kind, allowPrivate: allowPrivate) { chosen in
              onChoose(chosen)
              dismiss()
            }
          }
          .id(scope)
        } else {
          AglynEmptyState("Pick a workspace first", systemImage: SiteSymbols.media)
        }
      }
      .background(AglynColor.page)
      .navigationTitle("Choose from media")
      .aglynScreenTitle("Choose from media")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
      }
    }
    .aglynSheetMinimumSize(width: 420, height: 480)
    .accessibilityIdentifier("media-chooser")
  }
}

private struct MediaChooserGrid: View {
  let context: NativePluginContext
  let scope: MediaScope
  let scopeTokens: [String]?
  let kind: String?
  let allowPrivate: Bool
  let onChoose: (ChosenMedia) -> Void
  @State private var model = MediaListModel()
  @State private var searchText = ""
  @State private var refusal: String?
  @State private var pickSource: PickSource?
  @State private var audioBatch: [PickedFile]?
  @State private var uploading: String?
  /// The file just uploaded here, chosen once the library lists it.
  @State private var uploaded: String?
  @State private var runner = ActionRunner()

  private var canUpload: Bool {
    scope.isOrg ? mediaOrgRoles.contains(context.orgRole ?? "") : mediaSiteRoles.contains(context.siteRole ?? "")
  }

  private var listedIDs: [String] {
    if case .ready(let items) = model.rows { return items.map(\.id) }
    return []
  }

  private func choose(_ item: MediaItem) {
    if item.isPrivate && !allowPrivate { refusal = privateFileRefusal } else { onChoose(ChosenMedia(item: item, scope: scope)) }
  }

  private func upload(_ files: [PickedFile], rightsConfirmed: Bool) {
    let api = MediaAPI(api: context.api, scope: scope)
    refusal = nil
    runner.run {
      defer { uploading = nil }
      var last: String?
      for (index, file) in files.enumerated() {
        uploading = files.count == 1 ? "Uploading \(file.name)…" : "Uploading \(index + 1) of \(files.count)…"
        last = try await api.upload(file, folderID: nil, rightsConfirmed: rightsConfirmed) ?? last
      }
      uploaded = last
    }
  }

  var body: some View {
    Group {
      switch model.rows {
      case .loading:
        SkeletonGrid(count: 12)
      case .failed(let message):
        AglynEmptyState("Could not load the library", systemImage: SiteSymbols.error, message: message) {
          Button("Try again") { model.refresh() }
        }
      case .ready(let items) where items.isEmpty:
        AglynEmptyState(
          model.search.isEmpty ? "No files here yet" : "No files match", systemImage: SiteSymbols.media,
          message: model.search.isEmpty && canUpload ? "Upload a file from this device to choose it." : nil)
        {
          if model.search.isEmpty && canUpload {
            Button("Upload") { pickSource = PickSource.available.first }.buttonStyle(.aglynProminent)
          }
        }
      case .ready(let items):
        ScrollView {
          LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: AglynSpace.one)], spacing: AglynSpace.one) {
            ForEach(items) { item in
              Button {
                choose(item)
              } label: {
                AglynMediaTile(
                  item.fileName, imageURL: item.thumbnail(origin: context.api.origin).flatMap(URL.init(string:)),
                  systemImage: mediaKindSymbol(item.kind),
                  badge: item.isPrivate ? (text: "Private", tone: AglynTone.warning) : nil)
              }
              .buttonStyle(AglynPressableStyle())
              .accessibilityIdentifier("media-choice-\(item.id)")
            }
          }
          .padding(AglynSpace.two)
          if model.hasMore {
            AglynLoadMoreRow("Show more files") { model.loadMore() }.padding(.bottom, AglynSpace.two)
          }
        }
        .refreshable { model.refresh() }
      }
    }
    .safeAreaInset(edge: .top) {
      VStack(spacing: AglynSpace.one) {
        if let refusal {
          AglynNotice(refusal, tone: .warning).accessibilityIdentifier("chooser-private-refusal")
        }
        if let uploading {
          AglynNotice(uploading, tone: .info).accessibilityIdentifier("chooser-uploading")
        } else if let error = runner.error {
          AglynNotice(error, tone: .error) { runner.clear() }.accessibilityIdentifier("chooser-upload-error")
        }
      }
      .aglynContentEdges()
    }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Menu {
          ForEach(PickSource.available) { source in
            Button {
              pickSource = source
            } label: {
              Label(source.label, systemImage: source.systemImage)
            }
            .accessibilityIdentifier("chooser-upload-\(source.rawValue)")
          }
        } label: {
          Label("Upload", systemImage: "square.and.arrow.up")
        } primaryAction: {
          pickSource = PickSource.available.first
        }
        .disabled(!canUpload || runner.busy)
        .help("Upload a file from this device")
        .accessibilityIdentifier("chooser-upload")
      }
    }
    .aglynMediaPicker($pickSource, multiple: false) { files in
      // An audio file needs its uploader's rights confirmation first (AGL-3716).
      if files.contains(where: isAudioFile) { audioBatch = files } else { upload(files, rightsConfirmed: false) }
    }
    .sheet(isPresented: Binding(get: { audioBatch != nil }, set: { if !$0 { audioBatch = nil } })) {
      AudioRightsSheet(files: audioBatch ?? []) { confirmed in
        let files = audioBatch ?? []
        audioBatch = nil
        if confirmed { upload(files, rightsConfirmed: true) }
      }
    }
    .onChange(of: [uploaded ?? ""] + listedIDs) {
      // The upload is chosen the moment the library lists it (a file of another kind never appears here).
      guard let uploaded, case .ready(let items) = model.rows, let item = items.first(where: { $0.id == uploaded }) else { return }
      self.uploaded = nil
      choose(item)
    }
    .aglynSearchable(text: $searchText, prompt: "Search files")
    .task(id: searchText) {
      try? await Task.sleep(nanoseconds: 300_000_000)
      if !Task.isCancelled { model.search = searchText }
    }
    .task(id: scope) {
      model.type = kind
      model.start(context.firestore, scope: scope, scopeTokens: scopeTokens)
    }
    .onDisappear { model.stop() }
  }
}
