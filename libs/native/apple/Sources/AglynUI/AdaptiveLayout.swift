// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// The narrowest pane that holds a list beside its detail: the list column's
/// 320 points and a detail wide enough for a label beside its value (an
/// address row), 360 points.
public let listDetailMinimumWidth: CGFloat = 680

/// Whether the pane is wide enough for side-by-side panes: a regular width
/// class on iPhone and iPad, and on every platform at least `minimumWidth`
/// points across (by default `listDetailMinimumWidth`). A narrow Mac window,
/// or an iPad split that leaves a screen little room beside the sidebar, gets
/// the list alone and pushes the detail at the pane's full width, so no
/// detail is ever squeezed until its values are cut off. With `minimumWidth`
/// nil (the app's own sidebar-or-tabs choice) only the width class decides.
public struct WideLayoutReader<Content: View>: View {
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif
  let minimumWidth: CGFloat?
  let content: (Bool) -> Content

  public init(
    minimumWidth: CGFloat? = listDetailMinimumWidth, @ViewBuilder content: @escaping (_ isWide: Bool) -> Content
  ) {
    self.minimumWidth = minimumWidth
    self.content = content
  }

  private var regular: Bool {
    #if os(iOS)
      sizeClass == .regular
    #else
      true
    #endif
  }

  public var body: some View {
    if let minimumWidth {
      GeometryReader { proxy in content(regular && proxy.size.width >= minimumWidth) }
    } else {
      content(regular)
    }
  }
}

/// A list beside its selected item's detail when the window is wide, and the
/// list alone (pushing the detail) when it is not. The list column holds its
/// pinned header (filter chips, a search scope) at the top and its rows or
/// empty state below; with `showsDetail` false (an empty list) the detail
/// column folds away and the list takes the width.
public struct ListDetailLayout<List: View, Detail: View>: View {
  let list: List
  let detail: Detail
  let listWidth: CGFloat
  let showsDetail: Bool

  public init(
    listWidth: CGFloat = 360, showsDetail: Bool = true, @ViewBuilder list: () -> List, @ViewBuilder detail: () -> Detail
  ) {
    self.list = list()
    self.detail = detail()
    self.listWidth = listWidth
    self.showsDetail = showsDetail
  }

  public var body: some View {
    WideLayoutReader { wide in
      if wide {
        AglynListDetailColumns(listWidth: listWidth, showsDetail: showsDetail) { list } detail: { detail }
      } else {
        list
      }
    }
  }
}

/// A wide window's list column and detail column side by side (spec 4: the
/// list 320–440 points wide, a hairline between, the list's header pinned to
/// its top). With `showsDetail` false (an empty list, nothing to pick) the
/// detail column folds away and the list, its empty state centered, takes
/// the width.
public struct AglynListDetailColumns<List: View, Detail: View>: View {
  /// The screen's list toolbar (`aglynSearchable`), drawn atop the list column rather than across both columns.
  @Environment(\.aglynListColumnToolbar) private var toolbar
  /// The area's head, when the shell offers it to the list column (Figma 13:483).
  @Environment(\.aglynColumnHeadOffer) private var headOffer
  let list: List
  let detail: Detail
  let listWidth: CGFloat
  let showsDetail: Bool

  public init(
    listWidth: CGFloat = 360, showsDetail: Bool = true, @ViewBuilder list: () -> List, @ViewBuilder detail: () -> Detail
  ) {
    self.list = list()
    self.detail = detail()
    self.listWidth = listWidth
    self.showsDetail = showsDetail
  }

  public var body: some View {
    HStack(spacing: 0) {
      // Both columns stand on the content surface (never a grey ground): the list's rows on E, and the
      // detail's forms plain (`AglynGroupedForm`), its sections on the surface with no cards.
      if showsDetail {
        listColumn
          .frame(
            minWidth: max(320, listWidth - 40), idealWidth: listWidth, maxWidth: max(440, listWidth), maxHeight: .infinity,
            alignment: .top)
          .background(AglynColor.paper)
        // The 1-point hairline in the border token between the list and its detail, the full height of the columns
        // (with every column on the same surface, the hairline is what says where one ends).
        AglynColumnHairline()
        detail
          .environment(\.aglynDetailColumn, true)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(AglynColor.paper)
      } else {
        listColumn.aglynListColumn()
      }
    }
    .preference(key: AglynListToolbarPlacedKey.self, value: toolbar != nil)
    .preference(key: AglynListColumnHeadPlacedKey.self, value: headOffer != nil)
    .animation(.snappy(duration: 0.2), value: showsDetail)
    #if os(iOS)
      // Two scroll views side by side leave the bar no single one to collapse a large title into, so the title
      // would sit over the rows as they scroll: a split screen's title is inline on a bar that keeps its background,
      // as Mail's columns are.
      .navigationBarTitleDisplayMode(.inline)
      .toolbarBackground(.visible, for: .navigationBar)
    #endif
  }

  /// The list, its toolbar atop it; the toolbar is not handed further down. With the area's head offered (Figma
  /// 13:483), the list column holds the head's room (the shell draws the head in it, with the screen's actions), then
  /// the area's section chips, then the toolbar, and the hairline beside it runs from the top of the column.
  private var listColumn: some View {
    list
      .environment(\.aglynListColumn, true)
      .safeAreaInset(edge: .top, spacing: 0) {
        VStack(spacing: 0) {
          if let headOffer {
            Color.clear
              .frame(maxWidth: .infinity)
              .frame(height: AglynListColumnHeader<EmptyView>.columnHeight)
              .background(AglynColor.paper)
              .transformAnchorPreference(key: AglynScreenChromeKey.self, value: .bounds) { chrome, slot in
                chrome.columnHeadSlot = slot
              }
            if !headOffer.sections.isEmpty {
              AglynAreaSectionChips(headOffer.sections, inset: AglynListColumnHeader<EmptyView>.inset)
            }
          }
          toolbar
        }
      }
      .environment(\.aglynListColumnToolbar, nil)
      .environment(\.aglynColumnHeadOffer, nil)
  }
}

/// The 1-point vertical hairline between two columns (the list and its detail), in the border token.
public struct AglynColumnHairline: View {
  public init() {}

  public var body: some View {
    Rectangle().fill(AglynColor.divider).frame(width: 1).frame(maxHeight: .infinity).accessibilityHidden(true)
  }
}
