/*
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */
package com.aglyn.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The media library's measured sizes (Figma "Media · file browser", Components Media/Folder tile and Media/File tile,
 * Size Compact / Touch, AGL-4004): Compact on the desktop, Touch on tablets, and a phone's own where its three-column
 * grid needs them. Spacing comes from [space] and corners from [ShellMetrics]; this holds only what those do not.
 */
@Immutable
data class MediaMetrics(
  /** A tile's or row's file name, and its "TYPE · size" or count. */
  val name: TextUnit,
  val caption: TextUnit,
  /** The path row's crumbs, library picker and Include subfolders. */
  val control: TextUnit,
  /** A folder tile's height and its folder glyph. */
  val folderHeight: Dp,
  val folderSymbol: Dp,
  /** The narrowest a grid column may be before the grid drops one. */
  val tileMinWidth: Dp,
  /** A square control on the path row (Back, the library picker's height). */
  val button: Dp,
  /** One segment of the Grid / List toggle. */
  val segment: DpSize,
  /** The detail column the inspector opens beside the grid. */
  val inspectorWidth: Dp,
  /** The gap between grid tracks. */
  val gap: Dp,
  /** The "Folders" / "Files" labels, the list view's column heads and the inspector's section heads. */
  val groupLabel: TextUnit,
  /** The small print under a file tile's name. */
  val nameGap: Dp,
) {
  /** A heading in the side panel ("3 selected", the file's name) and the phone's selection bar. */
  val panelTitle: TextUnit get() = 15.sp
  /** A file type's short label under its glyph (`PDF`), its tracking, and the smallest glyph that carries one. */
  val typeLabel: TextUnit get() = 11.sp
  val typeTracking: TextUnit get() = 0.4.sp
  val labelledGlyph: Dp get() = 24.dp
  /** The glyph standing in for a preview: on a tile, a list row, a bulk thumbnail and the inspector. */
  val glyphTile: Dp get() = 30.dp
  val glyphRow: Dp get() = 16.dp
  val glyphBulk: Dp get() = 18.dp
  val glyphInspector: Dp get() = 40.dp
  /** Icons on the path row and in bulk buttons, a crumb's ›, the selection box, a list row's folder glyph. */
  val icon: Dp get() = 16.dp
  /** An icon inside a Material button (the touch Filter button), Material's own 18. */
  val buttonIcon: Dp get() = 18.dp
  val crumbChevron: Dp get() = 12.dp
  val checkbox: Dp get() = 22.dp
  val includeBox: Dp get() = 20.dp
  val rowFolderSymbol: Dp get() = 20.dp
  /** The play mark and its disc over a film's poster. */
  val playBadge: Dp get() = 32.dp
  val playIcon: Dp get() = 18.dp
  /** A file tile's and the inspector preview's corner, the selected ring and the hairline around a tile. */
  val tileRadius: Dp get() = 8.dp
  val ring: Dp get() = 2.dp
  val hairline: Dp get() = 1.dp
  /** The preview box's shape. */
  val previewAspect: Float get() = 4f / 3f
  /** A list-view row: its height, its preview, its corner, and its fixed columns. */
  val rowHeight: Dp get() = 40.dp
  val rowThumb: DpSize get() = DpSize(40.dp, 30.dp)
  val rowThumbRadius: Dp get() = 4.dp
  val rowRadius: Dp get() = 6.dp
  val typeColumn: Dp get() = 56.dp
  val sizeColumn: Dp get() = 72.dp
  val addedColumn: Dp get() = 110.dp
  /** A phone title row's square action and its icon (Figma 22:499). */
  val squareAction: Dp get() = 40.dp
  val squareIcon: Dp get() = 20.dp
  /** The folder picker's list, at most this tall. */
  val pickerMaxHeight: Dp get() = 360.dp
  /** The CDN width a preview is asked for: a list row, the inspector. */
  val cdnRow: Int get() = 160
  val cdnInspector: Int get() = 640
  /** The desktop head's title (Figma Mac/Head: 22 on 28). */
  val headTitle: TextUnit get() = 22.sp
  val headTitleLine: TextUnit get() = 28.sp
  /** A disabled control's strength (Material's 38%). */
  val disabledAlpha: Float get() = 0.38f
  /** The veil under the play mark: the scrim at this strength, dark in both themes. */
  val scrimAlpha: Float get() = 0.45f
}

val CompactMediaMetrics = MediaMetrics(
  name = 13.sp, caption = 12.sp, control = 13.sp, folderHeight = 56.dp, folderSymbol = 26.dp, tileMinWidth = 160.dp,
  button = 28.dp, segment = DpSize(28.dp, 22.dp), inspectorWidth = 360.dp, gap = 16.dp, groupLabel = 12.sp, nameGap = 8.dp,
)

val TouchMediaMetrics = MediaMetrics(
  name = 15.sp, caption = 13.sp, control = 15.sp, folderHeight = 64.dp, folderSymbol = 30.dp, tileMinWidth = 180.dp,
  button = 36.dp, segment = DpSize(36.dp, 30.dp), inspectorWidth = 400.dp, gap = 16.dp, groupLabel = 12.sp, nameGap = 8.dp,
)

/** A phone's three-across grid: the tablet's controls with smaller tile text and a tighter grid. */
val PhoneMediaMetrics = TouchMediaMetrics.copy(
  name = 13.sp, caption = 12.sp, folderHeight = 56.dp, folderSymbol = 26.dp, gap = 12.dp, groupLabel = 13.sp, nameGap = 6.dp,
)

/** The media metrics for this window: Compact on the desktop, Touch on a tablet, the phone's on a phone. */
@Composable
@ReadOnlyComposable
fun mediaMetrics(phone: Boolean): MediaMetrics = when {
  phone -> PhoneMediaMetrics
  LocalShellMetrics.current.compact -> CompactMediaMetrics
  else -> TouchMediaMetrics
}

/** A mark drawn on the media scrim (a film's play mark): light in both themes, as the scrim is dark in both. */
val OnMediaScrim: Color get() = AglynTokens.dark.textPrimary
