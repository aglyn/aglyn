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
    /// The account photo at the rail's foot.
    public static let avatar: CGFloat = 24
    /// The rail's section labels ("PINNED").
    public static let railCaption: CGFloat = 9
    /// The space between rail tiles.
    public static let railGap: CGFloat = 8
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
    public static let controlRadius: CGFloat = 6
    public static let cardRadius: CGFloat = 10
    public static let sheetRadius: CGFloat = 12
  #else
    public static let railWidth: CGFloat = 64
    public static let tile: CGFloat = 40
    public static let tileRadius: CGFloat = 10
    public static let badge: CGFloat = 18
    public static let ringBox: CGFloat = 48
    public static let railBar = CGSize(width: 3, height: 22)
    public static let tileInitials: CGFloat = 15
    public static let avatar: CGFloat = 32
    public static let railCaption: CGFloat = 10
    public static let railGap: CGFloat = 8
    /// The brand mark atop the rail.
    public static let railMark: CGFloat = 24
    public static let utility: CGFloat = 36
    public static let rowHeight: CGFloat = 36
    public static let rowText: CGFloat = 15
    public static let rowIcon: CGFloat = 18
    public static let pillRadius: CGFloat = 8
    public static let rowInset: CGFloat = 10
    public static let groupHeight: CGFloat = 30
    public static let groupText: CGFloat = 13
    public static let headerLogo: CGFloat = 24
    public static let headerLogoRadius: CGFloat = 6
    public static let sidebarWidth: CGFloat = 280
    public static let titlebarHeight: CGFloat = 52
    public static let trafficLights: CGFloat = 0
    public static let barButton: CGFloat = 34
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
  let action: () -> Void
  @State private var hovered = false

  public init(
    _ title: String, selected: Bool, action: @escaping () -> Void, @ViewBuilder leading: () -> Leading,
    @ViewBuilder trailing: () -> Trailing = { EmptyView() }
  ) {
    self.title = title
    self.selected = selected
    self.action = action
    self.leading = leading()
    self.trailing = trailing()
  }

  public var body: some View {
    Button(action: action) {
      HStack(spacing: 8) {
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
      .padding(.horizontal, 8)
      .frame(maxWidth: .infinity, minHeight: AglynShellMetrics.rowHeight, alignment: .leading)
      .background(
        RoundedRectangle(cornerRadius: AglynShellMetrics.pillRadius, style: .continuous)
          .fill(selected ? AglynColor.accentSoft : hovered ? AglynColor.hover : .clear))
      .contentShape(RoundedRectangle(cornerRadius: AglynShellMetrics.pillRadius, style: .continuous))
    }
    .buttonStyle(.plain)
    .onHover { hovered = $0 }
    .padding(.horizontal, AglynShellMetrics.rowInset)
    .accessibilityAddTraits(selected ? [.isSelected] : [])
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
  }
}
