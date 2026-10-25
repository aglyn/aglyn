// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// The shell's measured sizes (AGL-3945 fidelity pass; Figma Components, Size variants): Mac-native on the Mac (a compact
/// rail, 28-point sidebar rows, 13-point text, 16-point icons), touch sizes on iPad. Phones have no rail.
public enum AglynShellMetrics {
  #if os(macOS)
    /// The rail's width.
    public static let railWidth: CGFloat = 56
    /// A workspace tile's side and radius.
    public static let tile: CGFloat = 32
    public static let tileRadius: CGFloat = 8
    /// The unread badge's height.
    public static let badge: CGFloat = 14
    /// The selection ring's box around a tile (its radius is the tile's plus half the difference).
    public static let ringBox: CGFloat = 38
    /// The selected workspace's bar at the rail's leading edge.
    public static let railBar = CGSize(width: 3, height: 18)
    /// The initials on a tile without a logo.
    public static let tileInitials: CGFloat = 13
    /// A logo's box on its tile's paper plate (Figma Rail/Workspace tile, Type=Logo, Compact 97:899: 22 on 32).
    public static let tileLogo: CGFloat = 22
    /// The account photo at the rail's foot.
    public static let avatar: CGFloat = 24
    /// The rail's section labels ("PINNED"): 9 points, tracked 4% (Figma Rail 97:14728).
    public static let railCaption: CGFloat = 9
    public static let railCaptionTracking: CGFloat = 0.36
    /// The space between rail tiles, labels and dividers.
    public static let railGap: CGFloat = 8
    /// A divider between the rail's sections: a 24-point hairline in border/strong.
    public static let railDivider: CGFloat = 24
    /// The All workspaces tile: its box (the ring box's height, Figma 97:14737), the gap to its total, the total's size.
    public static let allTileHeight: CGFloat = 66
    public static let allTileGap: CGFloat = 3
    public static let allTileTotal: CGFloat = 10
    public static let allTileTotalWeight: Font.Weight = .bold
    /// The brand mark atop the rail.
    public static let railMark: CGFloat = 20
    /// Create new and the account photo at the rail's foot.
    public static let utility: CGFloat = 28
    /// A sidebar row: height, text, icon, the selected pill's radius and its inset from the column's edges.
    public static let rowHeight: CGFloat = 28
    public static let rowText: CGFloat = 13
    public static let rowIcon: CGFloat = 16
    public static let pillRadius: CGFloat = 6
    public static let rowInset: CGFloat = 8
    /// A sidebar row's inner padding and the gap between its icon and label (Figma Sidebar/Row, Compact).
    public static let rowPadding: CGFloat = 8
    public static let rowGap: CGFloat = 8
    /// A group's rows sit this much further in than its heading, per level (Figma Sidebar, grouped rows: 20 = 8 + 12).
    public static let groupIndent: CGFloat = 12
    /// A group heading's chevron.
    public static let groupChevron: CGFloat = 12
    /// A divider's space above and below its hairline.
    public static let dividerGap: CGFloat = 4
    /// The header block's padding, and the scope head's own inside it (Figma Sidebar/Scope header 98:1023).
    public static let headerPadding = EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8)
    public static let scopeHeadPadding = EdgeInsets(top: 6, leading: 8, bottom: 6, trailing: 8)
    /// The workspace's logo, name and plan in its header; the site's name; a settings mode's title; the way back.
    public static let workspaceLogo: CGFloat = 20
    public static let workspaceLogoRadius: CGFloat = 5
    public static let workspaceName: CGFloat = 13
    public static let siteName: CGFloat = 15
    public static let modeTitle: CGFloat = 17
    public static let backText: CGFloat = 12
    /// A group heading's height and text.
    public static let groupHeight: CGFloat = 24
    public static let groupText: CGFloat = 11
    /// The workspace or site picture in the sidebar's header.
    public static let headerLogo: CGFloat = 20
    public static let headerLogoRadius: CGFloat = 5
    /// The sidebar's width.
    public static let sidebarWidth: CGFloat = 248
    /// The title bar's height, and the space the window's own buttons take at its leading edge.
    public static let titlebarHeight: CGFloat = 52
    public static let trafficLights: CGFloat = 78
    /// A title-bar button's side and radius; controls, cards and sheets.
    public static let barButton: CGFloat = 28
    /// The title bar's search field's height (Figma Titlebar/Search field 8:90, Compact).
    public static let searchField: CGFloat = 28
    public static let controlRadius: CGFloat = 6
    public static let cardRadius: CGFloat = 10
    public static let sheetRadius: CGFloat = 12
  #else
    public static let railWidth: CGFloat = 68
    public static let tile: CGFloat = 40
    public static let tileRadius: CGFloat = 10
    public static let badge: CGFloat = 18
    public static let ringBox: CGFloat = 48
    public static let railBar = CGSize(width: 3, height: 22)
    public static let tileInitials: CGFloat = 15
    /// A logo's box on its tile's paper plate (Figma Rail/Workspace tile, Type=Logo, Touch 5:47: 28 on 40).
    public static let tileLogo: CGFloat = 28
    public static let avatar: CGFloat = 32
    /// The rail's section labels: 11 points, tracked 0.6 (Figma Rail 12:295).
    public static let railCaption: CGFloat = 11
    public static let railCaptionTracking: CGFloat = 0.6
    public static let railGap: CGFloat = 8
    public static let railDivider: CGFloat = 28
    public static let allTileHeight: CGFloat = 66
    public static let allTileGap: CGFloat = 4
    public static let allTileTotal: CGFloat = 12
    public static let allTileTotalWeight: Font.Weight = .semibold
    /// The brand mark atop the rail.
    public static let railMark: CGFloat = 24
    public static let utility: CGFloat = 36
    public static let rowHeight: CGFloat = 36
    public static let rowText: CGFloat = 15
    public static let rowIcon: CGFloat = 18
    public static let pillRadius: CGFloat = 8
    public static let rowInset: CGFloat = 12
    public static let rowPadding: CGFloat = 10
    public static let rowGap: CGFloat = 10
    public static let groupIndent: CGFloat = 12
    public static let groupChevron: CGFloat = 14
    public static let dividerGap: CGFloat = 6
    public static let headerPadding = EdgeInsets(top: 12, leading: 12, bottom: 8, trailing: 12)
    public static let scopeHeadPadding = EdgeInsets(top: 6, leading: 10, bottom: 8, trailing: 10)
    public static let workspaceLogo: CGFloat = 28
    public static let workspaceLogoRadius: CGFloat = 8
    public static let workspaceName: CGFloat = 14
    public static let siteName: CGFloat = 16
    public static let modeTitle: CGFloat = 18
    public static let backText: CGFloat = 12
    public static let groupHeight: CGFloat = 28
    public static let groupText: CGFloat = 11
    public static let headerLogo: CGFloat = 20
    public static let headerLogoRadius: CGFloat = 6
    public static let sidebarWidth: CGFloat = 248
    public static let titlebarHeight: CGFloat = 52
    public static let trafficLights: CGFloat = 0
    public static let barButton: CGFloat = 34
    public static let searchField: CGFloat = 30
    public static let controlRadius: CGFloat = 8
    public static let cardRadius: CGFloat = 12
    public static let sheetRadius: CGFloat = 14
  #endif
}

/// One row of the shell's sidebar (Figma Sidebar/Row): a line icon in the secondary text color and the label in the
/// primary, at the shell's row metrics; selected, a soft accent pill with the icon in the accent and the label semibold;
/// a faint fill under the pointer.
public struct AglynSidebarRow<Leading: View, Trailing: View>: View {
  let title: String
  let selected: Bool
  let leading: Leading
  let trailing: Trailing
  /// How deep the row sits under group headers: each level is 12 points (Figma Sidebar, grouped rows).
  let indent: Int
  /// The selection pill moves between rows when the rows share this namespace.
  let pill: Namespace.ID?
  let action: () -> Void
  @State private var hovered = false

  public init(
    _ title: String, selected: Bool, indent: Int = 0, pill: Namespace.ID? = nil, action: @escaping () -> Void,
    @ViewBuilder leading: () -> Leading, @ViewBuilder trailing: () -> Trailing = { EmptyView() }
  ) {
    self.title = title
    self.selected = selected
    self.indent = indent
    self.pill = pill
    self.action = action
    self.leading = leading()
    self.trailing = trailing()
  }

  public var body: some View {
    Button(action: action) {
      HStack(spacing: AglynShellMetrics.rowGap) {
        leading
          .frame(width: AglynShellMetrics.rowIcon, height: AglynShellMetrics.rowIcon)
          .foregroundStyle(selected ? AglynColor.accentIcon : AglynColor.secondaryText)
        Text(title)
          .font(.system(size: AglynShellMetrics.rowText, weight: selected ? .semibold : .regular))
          .foregroundStyle(AglynColor.textPrimary)
          .lineLimit(1)
        Spacer(minLength: 4)
        trailing
      }
      .padding(.leading, AglynShellMetrics.rowPadding + CGFloat(indent) * AglynShellMetrics.groupIndent)
      .padding(.trailing, AglynShellMetrics.rowPadding)
      .frame(maxWidth: .infinity, minHeight: AglynShellMetrics.rowHeight, alignment: .leading)
      .background { pillView }
      .contentShape(RoundedRectangle(cornerRadius: AglynShellMetrics.pillRadius, style: .continuous))
    }
    .buttonStyle(.plain)
    .onHover { hovered = $0 }
    .padding(.horizontal, AglynShellMetrics.rowInset)
    .accessibilityAddTraits(selected ? [.isSelected] : [])
  }
}

extension AglynSidebarRow {
  @ViewBuilder
  fileprivate var pillView: some View {
    let shape = RoundedRectangle(cornerRadius: AglynShellMetrics.pillRadius, style: .continuous)
    if selected, let pill {
      shape.fill(AglynColor.accentSoft).matchedGeometryEffect(id: "sidebar-pill", in: pill)
    } else {
      shape.fill(selected ? AglynColor.accentSoft : hovered ? AglynColor.hover : .clear)
    }
  }
}

/// The shell's motion (Figma Motion 121:6714): drilling in and out of a scope, folding a group, the selection pill.
public enum AglynShellMotion {
  /// Drill in or out: a slide with a fade, about 250 ms on a spring.
  public static let drill = Animation.spring(duration: 0.25, bounce: 0.1)
  /// Folding or opening a group: about 200 ms.
  public static let fold = Animation.easeOut(duration: 0.2)
  /// The selection pill moving to another row.
  public static let pill = Animation.spring(duration: 0.25, bounce: 0.15)
  /// Another workspace: a short cross-fade.
  public static let crossFade = Animation.easeInOut(duration: 0.15)
  /// A screen's content stepping in over its loading state (the in-app Besigner, AGL-4002): about 200 ms.
  public static let reveal = Animation.easeOut(duration: 0.2)
}

/// The sidebar's hairline (Figma Sidebar/Divider): the border token, inset to the rows' padding.
public struct AglynSidebarDivider: View {
  public init() {}

  public var body: some View {
    Rectangle().fill(AglynColor.divider).frame(height: 1)
      .padding(.vertical, AglynShellMetrics.dividerGap)
      .padding(.horizontal, AglynShellMetrics.rowPadding)
      .padding(.horizontal, AglynShellMetrics.rowInset)
      .accessibilityHidden(true)
  }
}

/// A sidebar row's line icon, sized for the shell.
public struct AglynSidebarIcon: View {
  let systemImage: String

  public init(_ systemImage: String) { self.systemImage = systemImage }

  public var body: some View {
    Image(systemName: systemImage)
      .font(.system(size: AglynShellMetrics.rowIcon - 3, weight: .regular))
      .symbolRenderingMode(.monochrome)
  }
}

/// A title-bar or toolbar symbol on its square (Figma Titlebar/Icon button): a line symbol in the secondary text color,
/// faintly filled under the pointer, with no glass of its own.
public struct AglynBarSymbol: View {
  let systemImage: String
  @State private var hovered = false

  public init(systemImage: String) { self.systemImage = systemImage }

  public var body: some View {
    Image(systemName: systemImage)
      .font(.system(size: AglynShellMetrics.rowIcon - 1, weight: .regular))
      .foregroundStyle(AglynColor.secondaryText)
      .frame(width: AglynShellMetrics.barButton, height: AglynShellMetrics.barButton)
      .background(
        RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous)
          .fill(hovered ? AglynColor.hover : .clear))
      .contentShape(Rectangle())
      .onHover { hovered = $0 }
  }
}

extension ToolbarContent {
  /// No glass capsule around the item: the title bar is one plain surface, as Figma draws it.
  @ToolbarContentBuilder
  public func aglynPlainToolbarBackground() -> some ToolbarContent {
    if #available(macOS 26.0, iOS 26.0, *) {
      self.sharedBackgroundVisibility(.hidden)
    } else {
      self
    }
  }
}

/// A count beside a sidebar row (Figma Sidebar/Row count): unread or waiting things, a filled accent pill.
public struct AglynSidebarCount: View {
  let count: Int
  let more: Bool

  public init(_ count: Int, more: Bool = false) {
    self.count = count
    self.more = more
  }

  public var body: some View {
    Text(more ? "\(count)+" : "\(count)")
      .font(.system(size: AglynShellMetrics.rowText - 2, weight: .semibold))
      .monospacedDigit()
      .foregroundStyle(AglynColor.primaryContrast)
      .padding(.horizontal, 5)
      .frame(minWidth: 18, minHeight: 18)
      .background(Capsule().fill(AglynColor.primary))
      .accessibilityLabel("\(count) unread")
      .preference(key: AglynCountKey.self, value: count)
  }
}

/// The count a row's count view shows (Inbox's unread), handed up so a phone's tab can wear it as its badge.
public struct AglynCountKey: PreferenceKey {
  public static let defaultValue: Int? = nil
  public static func reduce(value: inout Int?, nextValue: () -> Int?) { value = nextValue() ?? value }
}
