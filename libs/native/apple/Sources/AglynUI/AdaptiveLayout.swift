// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// Whether the window is wide enough for a sidebar and side-by-side panes:
/// a regular width class on iPhone and iPad, always on the Mac.
public struct WideLayoutReader<Content: View>: View {
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif
  let content: (Bool) -> Content

  public init(@ViewBuilder content: @escaping (_ isWide: Bool) -> Content) {
    self.content = content
  }

  public var body: some View {
    #if os(iOS)
      content(sizeClass == .regular)
    #else
      content(true)
    #endif
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
      if showsDetail {
        list
          .frame(
            minWidth: max(320, listWidth - 40), idealWidth: listWidth, maxWidth: max(440, listWidth), maxHeight: .infinity,
            alignment: .top)
        Divider()
        detail.frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        list.aglynListColumn()
      }
    }
    .animation(.snappy(duration: 0.2), value: showsDetail)
  }
}
