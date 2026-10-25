// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import ImageIO
import SwiftUI

// The media library's file-browser parts (Figma "Media · file browser", AGL-4004): its thumbnails, the folder and file
// tiles of its grid, the rows of its list view, the path row over them, and the panel a multi-selection opens.

// MARK: - Thumbnails

/// A decoded preview, kept by URL.
final class MediaThumbnailImage {
  let image: CGImage

  init(image: CGImage) { self.image = image }
}

/// Fetches media previews once per URL and decodes them at the size a tile draws. A preview that fails (the CDN's
/// variant still being made, a dropped connection, a request cancelled as the grid scrolled) is tried again after 1, 3
/// and 8 seconds, as a brand picture is (AGL-3991): `AsyncImage` gave up on the first failure and kept the tile's
/// placeholder until the grid was rebuilt, which is how one file showed a generic icon on the Mac (AGL-4004).
enum MediaThumbnailLoader {
  private static let cache: NSCache<NSURL, MediaThumbnailImage> = {
    let cache = NSCache<NSURL, MediaThumbnailImage>()
    cache.countLimit = 400
    return cache
  }()

  static let retryDelays: [Duration] = [.seconds(1), .seconds(3), .seconds(8)]

  static func cached(_ url: URL) -> MediaThumbnailImage? { cache.object(forKey: url as NSURL) }

  /// The preview at `url`, tried again after each of `delays` while it fails; nil once every try has, or when the
  /// view that asked has gone.
  static func loadRetrying(
    _ url: URL, maxPixel: Int, delays: [Duration] = retryDelays,
    load: (URL, Int) async -> MediaThumbnailImage? = { await MediaThumbnailLoader.load($0, maxPixel: $1) }
  ) async -> MediaThumbnailImage? {
    if let picture = await load(url, maxPixel) { return picture }
    for delay in delays {
      try? await Task.sleep(for: delay)
      if Task.isCancelled { return nil }
      if let picture = await load(url, maxPixel) { return picture }
    }
    return nil
  }

  /// The preview at `url`, decoded no larger than `maxPixel` on its longer side; nil when it cannot be fetched or is
  /// not an image.
  static func load(_ url: URL, maxPixel: Int) async -> MediaThumbnailImage? {
    if let hit = cached(url) { return hit }
    guard let (data, response) = try? await URLSession.shared.data(from: url) else { return nil }
    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { return nil }
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixel,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
      ?? CGImageSourceCreateImageAtIndex(source, 0, nil) else { return nil }
    let picture = MediaThumbnailImage(image: image)
    cache.setObject(picture, forKey: url as NSURL)
    return picture
  }
}

/// A file's preview, whole (aspect-fit) on the tile's sunken ground; the file's type glyph and label while there is
/// none, while it loads, or when it cannot.
struct MediaPreview: View {
  let item: MediaItem
  let url: URL?
  var maxPixel = AglynMediaMetrics.pixelsTile
  var glyphSize: CGFloat = AglynMediaMetrics.glyphTile
  @State private var loaded: (url: URL, picture: MediaThumbnailImage)?

  var body: some View {
    ZStack {
      AglynColor.sunken
      if let url, let picture = loaded?.url == url ? loaded?.picture : MediaThumbnailLoader.cached(url) {
        Image(decorative: picture.image, scale: 1).resizable().scaledToFit()
      } else {
        MediaTypeGlyph(item: item, size: glyphSize)
      }
      if item.kind == "video", url != nil {
        Image(systemName: "play.fill")
          .font(.system(size: AglynMediaMetrics.symbol, weight: .semibold))
          .foregroundStyle(AglynColor.onMediaScrim)
          .frame(width: AglynMediaMetrics.playBadge, height: AglynMediaMetrics.playBadge)
          .background(Circle().fill(AglynColor.mediaScrim))
          .accessibilityHidden(true)
      }
    }
    .task(id: url) {
      guard let url, MediaThumbnailLoader.cached(url) == nil,
            let picture = await MediaThumbnailLoader.loadRetrying(url, maxPixel: maxPixel) else { return }
      loaded = (url, picture)
    }
  }
}

/// A file's type, for a tile with no preview: the console's icon for it and its short label (`PDF`, `XLSX`).
struct MediaTypeGlyph: View {
  let item: MediaItem
  var size: CGFloat = AglynMediaMetrics.glyphTile

  var body: some View {
    let type = mediaFileType(item.contentType)
    VStack(spacing: AglynSpace.half) {
      Image(systemName: type.symbol).font(.system(size: size, weight: .light)).foregroundStyle(AglynColor.secondaryText)
      Text(type.label).font(.system(size: AglynMediaMetrics.typeLabel, weight: .semibold)).tracking(AglynMediaMetrics.typeTracking).foregroundStyle(AglynColor.textTertiary)
    }
    .accessibilityHidden(true)
  }
}

// MARK: - Tiles

/// A folder in the grid (Figma Media/Folder tile): the folder glyph, its name and how many files it holds.
struct MediaFolderTile: View {
  let name: String
  let count: Int?
  var selected = false
  var dropTarget = false
  var compactPhone = false

  var body: some View {
    HStack(spacing: AglynSpace.of(1.25)) {
      Image(systemName: "folder.fill")
        .font(.system(size: AglynMediaMetrics.folderSymbol))
        .foregroundStyle(AglynColor.primary)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 0) {
        Text(name)
          .font(.system(size: compactPhone ? AglynMediaMetrics.phoneName : AglynMediaMetrics.name, weight: .semibold))
          .foregroundStyle(AglynColor.textPrimary)
          .lineLimit(1)
        Text(count.map { $0 == 1 ? "1 file" : "\($0) files" } ?? " ")
          .font(.system(size: compactPhone ? AglynMediaMetrics.phoneCaption : AglynMediaMetrics.caption))
          .foregroundStyle(AglynColor.secondaryText)
          .lineLimit(1)
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, AglynSpace.oneAndHalf)
    .frame(height: compactPhone ? AglynMediaMetrics.phoneFolderHeight : AglynMediaMetrics.folderHeight)
    .background(
      RoundedRectangle(cornerRadius: AglynMediaMetrics.tileRadius, style: .continuous)
        .fill(dropTarget ? AglynColor.accentSoft : AglynColor.paper))
    .overlay(
      RoundedRectangle(cornerRadius: AglynMediaMetrics.tileRadius, style: .continuous)
        .strokeBorder(selected || dropTarget ? AglynColor.primary : AglynColor.divider, lineWidth: selected || dropTarget ? AglynMediaMetrics.ring : AglynMediaMetrics.hairline))
    .contentShape(RoundedRectangle(cornerRadius: AglynMediaMetrics.tileRadius, style: .continuous))
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
  }
}

/// How a file tile shows its selection (Figma Media/File tile, State).
enum MediaTileSelection {
  /// Not selected, nothing being picked.
  case none
  /// The one file the panel shows: the accent ring, never a wash.
  case selected
  /// Picking several: a box in the corner, ticked or not.
  case checked, unchecked
}

/// A file in the grid (Figma Media/File tile): its whole preview on the sunken tile, then its name and "TYPE · size".
struct MediaFileTile: View {
  let item: MediaItem
  let thumbnail: URL?
  let selection: MediaTileSelection
  let badge: (text: String, tone: AglynTone)?
  var compactPhone = false

  var body: some View {
    let ring = selection == .selected || selection == .checked
    VStack(alignment: .leading, spacing: 0) {
      Color.clear
        .aspectRatio(AglynMediaMetrics.previewAspect, contentMode: .fit)
        .overlay { MediaPreview(item: item, url: thumbnail) }
        .clipShape(RoundedRectangle(cornerRadius: AglynMediaMetrics.tileRadius, style: .continuous))
        .overlay(
          RoundedRectangle(cornerRadius: AglynMediaMetrics.tileRadius, style: .continuous)
            .strokeBorder(AglynColor.divider, lineWidth: AglynMediaMetrics.hairline))
        .overlay(
          RoundedRectangle(cornerRadius: AglynMediaMetrics.tileRadius + AglynMediaMetrics.ring, style: .continuous)
            .strokeBorder(ring ? AglynColor.primary : .clear, lineWidth: AglynMediaMetrics.ring)
            .padding(-AglynMediaMetrics.ring))
        .overlay(alignment: .topTrailing) {
          if let badge {
            StatusChip(badge.text, tone: badge.tone).background(AglynColor.paper, in: Capsule()).padding(AglynSpace.of(0.75))
          }
        }
        .overlay(alignment: .topLeading) {
          if selection == .checked || selection == .unchecked {
            Image(systemName: selection == .checked ? "checkmark.square.fill" : "square")
              .font(.system(size: AglynMediaMetrics.checkbox))
              .foregroundStyle(selection == .checked ? AglynColor.primary : AglynColor.secondaryText)
              .background(RoundedRectangle(cornerRadius: AglynTokens.radius).fill(AglynColor.paper).padding(AglynMediaMetrics.ring))
              .padding(AglynSpace.one)
              .accessibilityHidden(true)
          }
        }
      Text(item.fileName)
        .font(.system(size: compactPhone ? AglynMediaMetrics.phoneName : AglynMediaMetrics.name, weight: .medium))
        .foregroundStyle(AglynColor.textPrimary)
        .lineLimit(1)
        .truncationMode(.middle)
        .padding(.top, compactPhone ? AglynSpace.of(0.75) : AglynSpace.one)
      Text(item.caption)
        .font(.system(size: compactPhone ? AglynMediaMetrics.phoneCaption : AglynMediaMetrics.caption))
        .foregroundStyle(AglynColor.textTertiary)
        .lineLimit(1)
    }
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
    .accessibilityLabel([item.fileName, item.typeLabel, badge?.text].compactMap { $0 }.joined(separator: ", "))
    .accessibilityAddTraits(ring ? [.isButton, .isSelected] : .isButton)
  }
}

/// A file as a row of the list view (the console's List view): its small preview, name, type, size and when it was
/// added.
struct MediaFileRow: View {
  let item: MediaItem
  let thumbnail: URL?
  let selected: Bool
  let badge: (text: String, tone: AglynTone)?

  var body: some View {
    HStack(spacing: AglynSpace.oneAndHalf) {
      MediaPreview(item: item, url: thumbnail, maxPixel: AglynMediaMetrics.pixelsRow, glyphSize: AglynMediaMetrics.glyphRow)
        .frame(width: AglynMediaMetrics.rowThumb.width, height: AglynMediaMetrics.rowThumb.height)
        .clipShape(RoundedRectangle(cornerRadius: AglynMediaMetrics.rowThumbRadius, style: .continuous))
      Text(item.fileName)
        .font(.system(size: AglynMediaMetrics.name, weight: .medium))
        .foregroundStyle(AglynColor.textPrimary)
        .lineLimit(1).truncationMode(.middle)
        .frame(maxWidth: .infinity, alignment: .leading)
      if let badge { StatusChip(badge.text, tone: badge.tone) }
      Text(item.typeLabel).frame(width: AglynMediaMetrics.typeColumn, alignment: .leading)
      Text(formatBytes(item.sizeBytes ?? 0)).frame(width: AglynMediaMetrics.sizeColumn, alignment: .trailing)
      Text(item.createdAt.map { relativeTime($0) } ?? "—").frame(width: AglynMediaMetrics.addedColumn, alignment: .trailing)
    }
    .font(.system(size: AglynMediaMetrics.caption))
    .foregroundStyle(AglynColor.secondaryText)
    .padding(.horizontal, AglynSpace.one)
    .frame(minHeight: AglynMediaMetrics.rowHeight)
    .background(
      RoundedRectangle(cornerRadius: AglynMediaMetrics.rowRadius, style: .continuous).fill(selected ? AglynColor.accentSoft : .clear))
    .overlay(
      RoundedRectangle(cornerRadius: AglynMediaMetrics.rowRadius, style: .continuous)
        .strokeBorder(selected ? AglynColor.primary : .clear, lineWidth: AglynMediaMetrics.hairline))
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
  }
}

// MARK: - Path row

/// Grid or list (the console's view toggle).
enum MediaViewMode: String {
  case grid, list
}

/// The row over the grid (Figma Media · Path row): the library picker (This site / Workspace) on a site's library,
/// Back and the folder crumbs ("All files › Catering"), Include subfolders inside a folder, and Grid / List.
struct MediaPathRow: View {
  @Environment(\.aglynWideChrome) private var wide
  /// The library this site's page shows, when it offers both; nil on the workspace's own page.
  let library: Binding<Int>?
  let crumbs: [MediaFolder]
  let open: (String?) -> Void
  @Binding var includeSubfolders: Bool
  @Binding var view: MediaViewMode
  /// Select mode on a touch screen, where there is no ⌘-click; nil on the Mac.
  let selecting: Binding<Bool>?
  /// A folder or crumb a dragged file is over.
  var dropTargetCrumb: String?? = nil

  private var touch: Bool {
    #if os(macOS)
      false
    #else
      true
    #endif
  }

  var body: some View {
    HStack(spacing: AglynSpace.one) {
      if let library {
        Menu {
          Picker("Library", selection: library) {
            Text("This site").tag(0)
            Text("Workspace").tag(1)
          }
          .pickerStyle(.inline)
        } label: {
          HStack(spacing: AglynSpace.half) {
            Text(library.wrappedValue == 0 ? "This site" : "Workspace")
              .font(.system(size: AglynMediaMetrics.control, weight: .medium))
            Image(systemName: "chevron.down").font(.system(size: AglynMediaMetrics.chevron, weight: .semibold))
              .foregroundStyle(AglynColor.secondaryText)
          }
          .foregroundStyle(AglynColor.textPrimary)
          .padding(.leading, AglynSpace.of(1.25)).padding(.trailing, AglynSpace.one)
          .frame(height: AglynMediaMetrics.button)
          .background(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous).fill(AglynColor.paper))
          .overlay(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous).strokeBorder(AglynColor.divider))
          .contentShape(Rectangle())
        }
        .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
        .accessibilityLabel("Library")
        .accessibilityIdentifier("media-library")
      }
      if !crumbs.isEmpty {
        Button {
          open(crumbs.count > 1 ? crumbs[crumbs.count - 2].id : nil)
        } label: {
          Image(systemName: "chevron.left").font(.system(size: AglynMediaMetrics.symbol, weight: .semibold))
            .frame(width: AglynMediaMetrics.button, height: AglynMediaMetrics.button)
        }
        .buttonStyle(AglynHeaderButtonStyle())
        .keyboardShortcut(.upArrow, modifiers: .command)
        .help("Back")
        .accessibilityLabel("Back")
        .accessibilityIdentifier("media-back")
      }
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: AglynSpace.of(0.75)) {
          crumb("All files", id: nil, last: crumbs.isEmpty)
          ForEach(Array(crumbs.enumerated()), id: \.element.id) { index, folder in
            Image(systemName: "chevron.right").font(.system(size: AglynMediaMetrics.crumbChevron, weight: .semibold))
              .foregroundStyle(AglynColor.textTertiary).accessibilityHidden(true)
            crumb(folder.name, id: folder.id, last: index == crumbs.count - 1)
          }
        }
      }
      .scrollBounceBehavior(.basedOnSize)
      Spacer(minLength: AglynSpace.one)
      if !crumbs.isEmpty && wide {
        Toggle("Include subfolders", isOn: $includeSubfolders)
          .toggleStyle(.aglynCheckbox)
          .font(.system(size: AglynMediaMetrics.control))
          .fixedSize()
          .accessibilityIdentifier("media-subfolders")
      }
      if let selecting, touch {
        Button(selecting.wrappedValue ? "Done" : "Select") { selecting.wrappedValue.toggle() }
          .buttonStyle(AglynHeaderButtonStyle())
          .accessibilityIdentifier("media-select")
      }
      if wide {
        HStack(spacing: AglynMediaMetrics.ring) {
          viewButton(.grid, systemImage: "square.grid.2x2", label: "Grid")
          viewButton(.list, systemImage: "list.bullet", label: "List")
        }
        .padding(AglynMediaMetrics.ring)
        .background(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous).fill(AglynColor.sunken))
        .overlay(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous).strokeBorder(AglynColor.divider))
        .accessibilityIdentifier("media-view")
      }
    }
    .frame(minHeight: AglynMediaMetrics.button)
  }

  private func crumb(_ title: String, id: String?, last: Bool) -> some View {
    Button {
      if !last { open(id) }
    } label: {
      Text(title)
        .font(.system(size: AglynMediaMetrics.control, weight: last ? .semibold : .medium))
        .foregroundStyle(last ? AglynColor.textPrimary : AglynColor.secondaryText)
        .lineLimit(1)
        .padding(.horizontal, AglynMediaMetrics.ring)
        .background(
          RoundedRectangle(cornerRadius: AglynTokens.radius).fill(dropTargetCrumb == .some(id) ? AglynColor.accentSoft : .clear))
    }
    .buttonStyle(.plain)
    .disabled(last)
    .accessibilityIdentifier("media-crumb-\(id ?? "all")")
  }

  private func viewButton(_ mode: MediaViewMode, systemImage: String, label: String) -> some View {
    Button {
      view = mode
    } label: {
      Image(systemName: systemImage)
        .font(.system(size: AglynMediaMetrics.control))
        .foregroundStyle(view == mode ? AglynColor.textPrimary : AglynColor.secondaryText)
        .frame(width: AglynMediaMetrics.segment.width, height: AglynMediaMetrics.segment.height)
        .background(
          RoundedRectangle(cornerRadius: AglynTokens.radius, style: .continuous)
            .fill(view == mode ? AglynColor.paper : .clear))
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .help(label)
    .accessibilityLabel(label)
    .accessibilityAddTraits(view == mode ? .isSelected : [])
  }
}

// MARK: - Several files

/// What the panel shows while several files are selected (the console's selection bar): how many, their previews, and
/// Move to folder…, Add tag…, Remove tag…, Delete… and Clear.
struct MediaBulkPanel: View {
  let items: [MediaItem]
  let origin: String
  let folders: [MediaFolder]
  let canEdit: Bool
  let busy: Bool
  let move: (String?) -> Void
  let tag: (_ add: Bool) -> Void
  let delete: () -> Void
  let clear: () -> Void

  private var byID: [String: MediaFolder] { Dictionary(folders.map { ($0.id, $0) }) { first, _ in first } }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: AglynSpace.two) {
        HStack(spacing: AglynSpace.of(0.75)) {
          Text("\(items.count) selected")
            .font(.system(size: AglynMediaMetrics.panelTitle, weight: .semibold)).foregroundStyle(AglynColor.textPrimary)
            .accessibilityAddTraits(.isHeader)
          Spacer(minLength: 0)
          Button(action: clear) {
            Image(systemName: "xmark").font(.system(size: AglynMediaMetrics.symbol, weight: .semibold)).frame(width: AglynMediaMetrics.button, height: AglynMediaMetrics.button)
          }
          .buttonStyle(AglynHeaderButtonStyle())
          .keyboardShortcut(.cancelAction)
          .help("Clear")
          .accessibilityLabel("Clear")
          .accessibilityIdentifier("media-bulk-clear")
        }
        HStack(spacing: AglynSpace.one) {
          ForEach(items.prefix(3)) { item in
            MediaPreview(
              item: item, url: item.thumbnail(origin: origin).flatMap(URL.init(string:)), maxPixel: AglynMediaMetrics.pixelsBulk,
              glyphSize: AglynMediaMetrics.glyphBulk
            )
            .aspectRatio(AglynMediaMetrics.previewAspect, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous).strokeBorder(AglynColor.divider))
          }
        }
        VStack(spacing: AglynSpace.one) {
          Menu {
            Button("No folder") { move(nil) }
            if !folders.isEmpty { Divider() }
            ForEach(folders.sorted { folderPath($0, byID: byID).lowercased() < folderPath($1, byID: byID).lowercased() }) {
              folder in
              Button(folderPath(folder, byID: byID)) { move(folder.id) }
            }
          } label: {
            bulkLabel("Move to folder…", systemImage: "folder")
          }
          .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden)
          .accessibilityIdentifier("media-bulk-move")
          Button { tag(true) } label: { bulkLabel("Add tag…", systemImage: "tag") }
            .buttonStyle(.plain).accessibilityIdentifier("media-bulk-add-tag")
          Button { tag(false) } label: { bulkLabel("Remove tag…", systemImage: "tag.slash") }
            .buttonStyle(.plain).accessibilityIdentifier("media-bulk-remove-tag")
          Button(action: delete) { bulkLabel("Delete…", systemImage: "trash", destructive: true) }
            .buttonStyle(.plain).accessibilityIdentifier("media-bulk-delete")
        }
        .disabled(!canEdit || busy)
      }
      .padding(.horizontal, AglynSpace.three)
      .padding(.top, AglynMediaMetrics.ring)
      .padding(.bottom, AglynSpace.three)
    }
    .accessibilityIdentifier("media-bulk")
  }

  private func bulkLabel(_ title: String, systemImage: String, destructive: Bool = false) -> some View {
    HStack(spacing: AglynSpace.of(0.75)) {
      Image(systemName: systemImage).font(.system(size: AglynMediaMetrics.bulkLabel - 1, weight: .medium))
      Text(title).font(.system(size: AglynMediaMetrics.bulkLabel, weight: .semibold))
    }
    .foregroundStyle(destructive ? AglynColor.primaryContrast : AglynColor.textPrimary)
    .frame(maxWidth: .infinity)
    .frame(height: AglynMediaMetrics.bulkButton)
    .background(
      RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous)
        .fill(destructive ? AnyShapeStyle(AglynColor.error) : AnyShapeStyle(AglynColor.paper)))
    .overlay {
      if !destructive {
        RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous).strokeBorder(AglynColor.divider)
      }
    }
    .contentShape(Rectangle())
  }
}

/// The tag a bulk Add tag… or Remove tag… asks for (the console's dialog: "Add a tag to 3 files", Tag, Apply).
struct MediaBulkTagSheet: View {
  let add: Bool
  let count: Int
  let busy: Bool
  let error: String?
  let cancel: () -> Void
  let apply: (String) -> Void
  @State private var tag = ""

  var body: some View {
    AglynActionSheet(
      add ? "Add a tag to \(mediaFilesCount(count))" : "Remove a tag from \(mediaFilesCount(count))",
      confirmLabel: "Apply", confirmEnabled: !tag.trimmed.isEmpty, busy: busy, error: error, onCancel: cancel
    ) {
      apply(tag.trimmed)
    } fields: {
      TextField("Tag", text: $tag)
        .autocorrectionDisabled()
        .accessibilityIdentifier("media-bulk-tag")
    }
  }
}

/// "1 file", "3 files".
func mediaFilesCount(_ count: Int) -> String { count == 1 ? "1 file" : "\(count) files" }

/// What a bulk delete says it did, naming the files (the console's `deletedMediaMessage`, AGL-1461): up to three by
/// name, then how many more.
func mediaDeletedMessage(_ names: [String]) -> String {
  mediaNamedMessage("Deleted", names, none: "Nothing was deleted")
}

/// What a bulk restore says it did (the console's `restoredMediaMessage`).
func mediaRestoredMessage(_ names: [String]) -> String {
  mediaNamedMessage("Restored", names, none: "Nothing was restored")
}

private func mediaNamedMessage(_ verb: String, _ names: [String], none: String) -> String {
  let quote = { (name: String) in "\"\(name)\"" }
  if names.isEmpty { return none }
  if names.count == 1 { return "\(verb) \(quote(names[0]))" }
  let shown = Array(names.prefix(3)).map(quote)
  let hidden = names.count - shown.count
  let list =
    hidden > 0
    ? "\(shown.joined(separator: ", ")) and \(hidden) more"
    : "\(shown.dropLast().joined(separator: ", ")) and \(shown[shown.count - 1])"
  return "\(verb) \(names.count) files: \(list)"
}
