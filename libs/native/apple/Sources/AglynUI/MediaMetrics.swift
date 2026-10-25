// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// The media library's measured sizes (Figma "Media · file browser", Components Media/Folder tile and Media/File tile,
/// Size Compact / Touch, AGL-4004): Mac-native on the Mac, touch sizes on iPad and phones, and a phone's smaller grid
/// text where a three-column grid needs it. Spacing comes from ``AglynSpace`` and corners from ``AglynRadius``; this
/// holds only what those scales do not.
public enum AglynMediaMetrics {
  #if os(macOS)
    /// A tile's or row's file name.
    public static let name: CGFloat = 13
    /// A tile's "TYPE · size", a folder's count, a list row's columns.
    public static let caption: CGFloat = 12
    /// The path row's crumbs and library picker, an inspector row's text.
    public static let control: CGFloat = 13
    /// A detail field's typed text.
    public static let field: CGFloat = 13
    /// A field's label over it.
    public static let fieldLabel: CGFloat = 12
    /// The folder glyph on a folder tile.
    public static let folderSymbol: CGFloat = 22
    /// The narrowest a grid column may be before the grid drops one.
    public static let tileMinWidth: CGFloat = 160
    /// A folder tile's height.
    public static let folderHeight: CGFloat = 56
    /// A square control on the path row and in the inspector head (Back, ×, ⋯), and the path row's height.
    public static let button: CGFloat = 28
    /// One segment of the Grid / List toggle.
    public static let segment = CGSize(width: 28, height: 22)
    /// The library picker's and the toggle's chevron.
    public static let chevron: CGFloat = 10
    /// The detail column the inspector opens beside the grid.
    public static let inspectorWidth: CGFloat = 360
    /// A field's inner padding.
    public static let fieldPadding = EdgeInsets(top: 5, leading: 8, bottom: 5, trailing: 8)
    /// A field's corner.
    public static let fieldRadius: CGFloat = 6
  #else
    public static let name: CGFloat = 15
    public static let caption: CGFloat = 13
    public static let control: CGFloat = 15
    public static let field: CGFloat = 17
    public static let fieldLabel: CGFloat = 13
    public static let folderSymbol: CGFloat = 25
    public static let tileMinWidth: CGFloat = 180
    public static let folderHeight: CGFloat = 64
    public static let button: CGFloat = 36
    public static let segment = CGSize(width: 36, height: 30)
    public static let chevron: CGFloat = 11
    public static let inspectorWidth: CGFloat = 400
    public static let fieldPadding = EdgeInsets(top: 11, leading: 12, bottom: 11, trailing: 12)
    public static let fieldRadius: CGFloat = 10
  #endif

  /// The inspector beside the grid (the Mac and iPad) and the pushed details (a phone): a row's text, the small print
  /// (facts, help, a switch's note) and a switch's own label.
  public static let detailText: CGFloat = 13
  public static let phoneDetailText: CGFloat = 15
  public static let note: CGFloat = 12
  public static let phoneNote: CGFloat = 13
  public static let switchLabel: CGFloat = 13
  public static let phoneSwitchLabel: CGFloat = 17
  /// A bulk action's label in the side panel.
  public static let bulkLabel: CGFloat = 14
  /// A phone's three-column grid: the file name, its caption and a folder tile's height.
  public static let phoneName: CGFloat = 13
  public static let phoneCaption: CGFloat = 12
  public static let phoneFolderHeight: CGFloat = 56
  /// The "Folders" / "Files" group labels, the list view's column heads and the inspector's section heads.
  public static let groupLabel: CGFloat = 12
  public static let phoneGroupLabel: CGFloat = 13
  /// A heading in the side panel ("3 selected", the file's name) and the phone's selection bar.
  public static let panelTitle: CGFloat = 15
  /// A file type's short label under its glyph (`PDF`), and its tracking.
  public static let typeLabel: CGFloat = 11
  public static let typeTracking: CGFloat = 0.4
  /// The glyph standing in for a preview: on a tile, a list row, a bulk thumbnail and the inspector.
  public static let glyphTile: CGFloat = 28
  public static let glyphRow: CGFloat = 14
  public static let glyphBulk: CGFloat = 18
  public static let glyphInspector: CGFloat = 40
  /// Small symbols: ×, ‹ and ⋯ in buttons, the play mark, a row's folder glyph, the selection box, a crumb's ›.
  public static let symbol: CGFloat = 12
  public static let rowFolderSymbol: CGFloat = 18
  public static let checkbox: CGFloat = 18
  public static let crumbChevron: CGFloat = 9
  /// A bulk action's button in the side panel (Move to folder…, Add tag…, Delete…).
  public static let bulkButton: CGFloat = 36
  /// The play mark's disc over a film's poster.
  public static let playBadge: CGFloat = 32
  /// A file tile's and the inspector preview's corner, and the selected ring around it.
  public static let tileRadius: CGFloat = 8
  public static let ring: CGFloat = 2
  public static let hairline: CGFloat = 1
  /// The preview box's shape on a tile, a bulk thumbnail and the inspector.
  public static let previewAspect: CGFloat = 4 / 3
  /// The gap between grid columns, and between rows of file tiles (a phone's grid is tighter).
  public static let gap: CGFloat = 16
  public static let phoneGap: CGFloat = 12
  public static let fileRowGap: CGFloat = 20
  public static let phoneFileRowGap: CGFloat = 16
  /// A list-view row: its height, its preview, its corner and its fixed columns.
  public static let rowHeight: CGFloat = 40
  public static let rowThumb = CGSize(width: 40, height: 30)
  public static let rowThumbRadius: CGFloat = 4
  public static let rowRadius: CGFloat = 6
  public static let typeColumn: CGFloat = 56
  public static let sizeColumn: CGFloat = 72
  public static let addedColumn: CGFloat = 110
  /// The pixel size a preview is decoded at, by where it is drawn.
  public static let pixelsTile = 640
  public static let pixelsRow = 160
  public static let pixelsBulk = 320
  public static let pixelsInspector = 1280
  /// The CDN width a preview is asked for, by where it is drawn.
  public static let cdnRow = 160
  public static let cdnInspector = 640
}

extension AglynColor {
  /// The veil under a mark drawn over a picture (a film's play mark): dark in both appearances, so it reads on any
  /// frame.
  public static let mediaScrim = AglynTokens.dark.background.default.opacity(0.55)
  /// A mark on that veil.
  public static let onMediaScrim = AglynTokens.dark.text.primary
}
