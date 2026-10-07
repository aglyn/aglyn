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
/// list alone (pushing the detail) when it is not.
public struct ListDetailLayout<List: View, Detail: View>: View {
  let list: List
  let detail: Detail
  let listWidth: CGFloat

  public init(listWidth: CGFloat = 340, @ViewBuilder list: () -> List, @ViewBuilder detail: () -> Detail) {
    self.list = list()
    self.detail = detail()
    self.listWidth = listWidth
  }

  public var body: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          list.frame(width: listWidth)
          Divider()
          detail.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        list
      }
    }
  }
}
