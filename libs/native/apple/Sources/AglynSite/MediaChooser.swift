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
/// one kind (nil: every kind), one tap to choose. A private file is refused unless `allowPrivate` (the console's
/// `pickMedia` option for paid media, which only a private file can be). Shown in a sheet by whoever needs a file.
public struct MediaChooserSheet: View {
  let context: NativePluginContext
  let kind: String?
  let allowPrivate: Bool
  let onChoose: (ChosenMedia) -> Void
  @State private var tab = 0
  @Environment(\.dismiss) private var dismiss

  public init(
    context: NativePluginContext, kind: String? = "image", allowPrivate: Bool = false, onChoose: @escaping (ChosenMedia) -> Void
  ) {
    self.context = context
    self.kind = kind
    self.allowPrivate = allowPrivate
    self.onChoose = onChoose
  }

  private var scope: MediaScope? {
    if context.hostID != nil, tab == 0 { return context.hostID.map { .site(hostID: $0) } }
    return context.orgID.map { .org(orgID: $0, forHostID: context.hostID) }
  }

  public var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        if context.hostID != nil {
          Picker("Library", selection: $tab) {
            Text("This site").tag(0)
            Text("Workspace").tag(1)
          }
          .pickerStyle(.segmented)
          .labelsHidden()
          .padding(.horizontal, AglynSpace.two)
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
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
      }
    }
    .frame(minWidth: 420, minHeight: 480)
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
          message: model.search.isEmpty ? "Upload photos in the Media library, then choose them here." : nil)
      case .ready(let items):
        ScrollView {
          LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: AglynSpace.one)], spacing: AglynSpace.one) {
            ForEach(items) { item in
              Button {
                if item.isPrivate && !allowPrivate { refusal = privateFileRefusal } else { onChoose(ChosenMedia(item: item, scope: scope)) }
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
      if let refusal {
        AglynNotice(refusal, tone: .warning).padding(.horizontal, AglynSpace.two).accessibilityIdentifier("chooser-private-refusal")
      }
    }
    .searchable(text: $searchText, prompt: "Search files")
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
