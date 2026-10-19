// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

// The pieces the native shell is drawn from (AGL-3945, Figma "Aglyn Native App — Navigation", Components 2:2): the
// workspace rail's tiles, the account photo, the sidebar's group header and the badge. Shared, so the Aglyn and
// Aglyn POS shells and every device draw them the same way.

extension AglynColor {
  /// The workspace rail's ground: the slate of the palette, faint over the page, so the rail reads as the frame and
  /// never as content.
  public static let rail = adaptive(
    light: AglynTokens.light.tertiary.main.opacity(0.09), dark: AglynTokens.dark.background.default.opacity(0.6))
  /// The sidebar's ground beside the rail.
  public static let sidebar = adaptive(light: AglynTokens.light.background.paper, dark: AglynTokens.dark.background.paper)
  /// A tile with no color of its own: the palette's slate.
  public static let neutralTile = adaptive(light: AglynTokens.light.tertiary.main, dark: AglynTokens.dark.grey[700] ?? .gray)
  /// A count that asks for action (unread, waiting): the secondary intent's fill.
  public static let badge = intent({ $0.secondary }, \.main)
  public static let badgeText = intent({ $0.secondary }, \.contrastText)
  /// Secondary text, the palette's own.
  public static let secondaryText = adaptive(light: AglynTokens.light.text.secondary, dark: AglynTokens.dark.text.secondary)
}

extension Color {
  /// A picked or brand color stored as `#RRGGBB`; nil when it is not one.
  public init?(aglynHex hex: String?) {
    guard let hex, hex.range(of: "^#[0-9A-Fa-f]{6}$", options: .regularExpression) != nil else { return nil }
    self.init(aglynCSS: hex)
  }

  /// Whether white text reads on this color (WCAG relative luminance below the midpoint).
  public static func aglynPrefersLightText(_ hex: String?) -> Bool {
    guard let hex, let (r, g, b, _) = AglynCSSColor.parse(hex) else { return true }
    func linear(_ c: Double) -> Double { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
    let luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
    // White wins where its contrast beats black's: (1.05) / (L + 0.05) > (L + 0.05) / 0.05.
    return 1.05 / (luminance + 0.05) > (luminance + 0.05) / 0.05
  }
}

/// The initials a name shows when it has no picture ("JS" for Juniper Street Co., "A" for Aglyn).
public func aglynInitials(_ name: String, limit: Int = 2) -> String {
  let words = name.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).filter { !$0.isEmpty }
  guard let first = words.first else { return "?" }
  if limit == 1 || words.count == 1 { return String(first.prefix(1)).uppercased() }
  let skip: Set<String> = ["co", "llc", "inc", "ltd", "the", "and", "of"]
  let meaningful = words.filter { !skip.contains($0.lowercased()) }
  let picked = meaningful.count >= 2 ? [meaningful[0], meaningful[1]] : [first]
  return picked.map { String($0.prefix(1)) }.joined().uppercased()
}

/// A count badge: only for something waiting on the person (Calm rule "counts mean act"); 99+ past ninety-nine.
public struct AglynCountBadge: View {
  let count: Int

  public init(_ count: Int) { self.count = count }

  public var body: some View {
    if count > 0 {
      Text(count > 99 ? "99+" : "\(count)")
        .font(.system(size: 10, weight: .bold, design: .rounded))
        .monospacedDigit()
        .foregroundStyle(AglynColor.badgeText)
        .padding(.horizontal, count > 9 ? 4 : 0)
        .frame(minWidth: 17, minHeight: 17)
        .background(Capsule().fill(AglynColor.badge))
        .overlay(Capsule().strokeBorder(AglynColor.paper, lineWidth: 1.5))
        .accessibilityLabel("\(count) waiting")
    }
  }
}

/// One workspace on the rail: its logo, else its initials on its color (the person's pick, its brand color or one taken
/// from its logo), a ring while it is the one in use, and its unread count.
public struct AglynWorkspaceTile: View {
  let name: String
  let logoURL: URL?
  let darkLogoURL: URL?
  let colorHex: String?
  let selected: Bool
  let unread: Int
  let size: CGFloat

  public init(
    name: String, logoURL: URL?, darkLogoURL: URL? = nil, colorHex: String?, selected: Bool, unread: Int = 0,
    size: CGFloat = 40
  ) {
    self.name = name
    self.logoURL = logoURL
    self.darkLogoURL = darkLogoURL
    self.colorHex = colorHex
    self.selected = selected
    self.unread = unread
    self.size = size
  }

  private var radius: CGFloat { size * 0.25 }

  public var body: some View {
    ZStack(alignment: .topTrailing) {
      AglynBrandPicture(logoURL, darkURL: darkLogoURL, size: size, cornerRadius: radius) { initials }
        .frame(width: size, height: size)
        .background(
          RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(logoURL == nil ? Color.clear : AglynColor.paper))
        .overlay(
          RoundedRectangle(cornerRadius: radius, style: .continuous)
            .strokeBorder(AglynColor.divider, lineWidth: logoURL == nil ? 0 : 1))
        .padding(3)
        .overlay(
          RoundedRectangle(cornerRadius: radius + 3, style: .continuous)
            .strokeBorder(selected ? (Color(aglynHex: colorHex) ?? AglynColor.primary) : .clear, lineWidth: 2))
      AglynCountBadge(unread).offset(x: 4, y: -4)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(name)
    .accessibilityValue(unread > 0 ? "\(unread) unread" : "")
    .accessibilityAddTraits(selected ? [.isSelected, .isButton] : [.isButton])
  }

  private var initials: some View {
    let fill = Color(aglynHex: colorHex) ?? AglynColor.neutralTile
    return Text(aglynInitials(name))
      .font(.system(size: size * (aglynInitials(name).count > 1 ? 0.36 : 0.44), weight: .semibold, design: .rounded))
      .foregroundStyle(colorHex == nil || Color.aglynPrefersLightText(colorHex) ? AglynTokens.light.primary.contrastText : AglynTokens.light.text.primary)
      .frame(width: size, height: size)
      .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(fill))
  }
}

/// A square rail button (All workspaces, Admin): a symbol on a faint tile, with a caption under it.
public struct AglynRailButton: View {
  let systemImage: String
  let caption: String?
  let filled: Bool
  let size: CGFloat

  public init(systemImage: String, caption: String? = nil, filled: Bool = false, size: CGFloat = 40) {
    self.systemImage = systemImage
    self.caption = caption
    self.filled = filled
    self.size = size
  }

  public var body: some View {
    VStack(spacing: 3) {
      Image(systemName: systemImage)
        .font(.system(size: size * 0.42, weight: .semibold))
        .foregroundStyle(filled ? AglynColor.primaryContrast : AglynColor.secondaryText)
        .frame(width: size, height: size)
        .background(
          RoundedRectangle(cornerRadius: size * 0.25, style: .continuous)
            .fill(filled ? AglynColor.tint : AglynColor.paper.opacity(0.7)))
      if let caption {
        Text(caption).font(.system(size: 11, weight: .medium)).monospacedDigit()
          .foregroundStyle(AglynColor.secondaryText).lineLimit(1)
      }
    }
  }
}

/// The person's photo: their initials on the slate circle (the apps keep no profile picture of their own).
public struct AglynAccountAvatar: View {
  let initials: String
  let size: CGFloat
  let colorHex: String?

  public init(initials: String, size: CGFloat = 32, colorHex: String? = nil) {
    self.initials = initials
    self.size = size
    self.colorHex = colorHex
  }

  public var body: some View {
    Text(initials)
      .font(.system(size: size * 0.38, weight: .semibold, design: .rounded))
      .foregroundStyle(AglynTokens.light.primary.contrastText)
      .frame(width: size, height: size)
      .background(Circle().fill(Color(aglynHex: colorHex) ?? AglynColor.neutralTile))
      .accessibilityHidden(true)
  }
}

/// A sidebar group's heading: folds its rows away when it can, and carries the count of rows it hides while folded.
public struct AglynSidebarGroupHeader: View {
  let title: String
  let foldable: Bool
  let open: Bool
  let hiddenCount: Int
  let action: () -> Void

  public init(_ title: String, foldable: Bool, open: Bool, hiddenCount: Int = 0, action: @escaping () -> Void = {}) {
    self.title = title
    self.foldable = foldable
    self.open = open
    self.hiddenCount = hiddenCount
    self.action = action
  }

  public var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        if foldable {
          Image(systemName: "chevron.right")
            .font(.system(size: 10, weight: .semibold))
            .rotationEffect(.degrees(open ? 90 : 0))
            .frame(width: 12)
        }
        Text(title).font(AglynFont.strongSubheadline)
        Spacer(minLength: 4)
        if foldable && !open && hiddenCount > 0 {
          Text("\(hiddenCount)").font(AglynFont.caption).monospacedDigit()
        }
      }
      .foregroundStyle(AglynColor.secondaryText)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(!foldable)
    .accessibilityLabel(title)
    .accessibilityValue(foldable ? (open ? "Open" : "Folded") : "")
    .accessibilityHint(foldable ? (open ? "Folds the group" : "Opens the group") : "")
    .animation(.easeOut(duration: 0.15), value: open)
  }
}

/// The colors a person can pick for a workspace (Figma "Color swatch" 65:1785): the brand palette's blue, violet, pink
/// and slate, and a green and a warm orange beside them. Stored on the account as `#RRGGBB`.
public enum AglynWorkspaceSwatches {
  public static let all: [(id: String, label: String, hex: String)] = [
    ("blue", "Blue", "#00B0FF"),
    ("violet", "Violet", "#7A5CF0"),
    ("pink", "Pink", "#E040FB"),
    ("green", "Green", "#2E7D5B"),
    ("warm", "Warm", "#C2571A"),
    ("slate", "Slate", "#404C5C"),
  ]
}

/// One swatch: a filled circle, ringed while picked; `nil` draws Automatic.
public struct AglynColorSwatch: View {
  let hex: String?
  let selected: Bool
  let size: CGFloat

  public init(hex: String?, selected: Bool, size: CGFloat = 28) {
    self.hex = hex
    self.selected = selected
    self.size = size
  }

  public var body: some View {
    ZStack {
      Circle().fill(Color(aglynHex: hex) ?? AglynColor.page)
      if hex == nil {
        Image(systemName: "arrow.counterclockwise").font(.system(size: size * 0.4, weight: .semibold))
          .foregroundStyle(AglynColor.secondaryText)
      }
      if selected {
        Image(systemName: "checkmark").font(.system(size: size * 0.42, weight: .bold))
          .foregroundStyle(hex == nil || Color.aglynPrefersLightText(hex) ? AglynTokens.light.primary.contrastText : AglynTokens.light.text.primary)
          .opacity(hex == nil ? 0 : 1)
      }
    }
    .frame(width: size, height: size)
    .overlay(Circle().strokeBorder(AglynColor.divider, lineWidth: 1))
    .padding(3)
    .overlay(Circle().strokeBorder(selected ? AglynColor.tint : .clear, lineWidth: 2))
  }
}
