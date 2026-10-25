// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

// The pieces the native shell is drawn from (AGL-3945, Figma "Aglyn Native App — Navigation", Components 2:2): the
// workspace rail's tiles, the account photo, the sidebar's group header and the badge. Shared, so the Aglyn and
// Aglyn POS shells and every device draw them the same way.

extension AglynColor {
  /// The workspace rail's ground: the slate of the palette, faint over the page, so the rail reads as the frame and
  /// never as content.
  public static let rail = themed { AglynThemeRuntime.shared.surfaces(dark: $0).rail }
  /// Words and symbols on the rail.
  public static let railText = themed { AglynThemeRuntime.shared.surfaces(dark: $0).railText }
  /// The sidebar's ground beside the rail: the surface, tinted with the accent when the sidebar style is Tinted and a
  /// theme other than the console's is in force.
  public static let sidebar = themed { dark in
    let runtime = AglynThemeRuntime.shared
    let surface = runtime.surfaces(dark: dark).surface
    guard runtime.sidebarTinted, runtime.theme.id != "aglyn", let accent = runtime.accentIntent(dark: dark) else { return surface }
    return blend(surface, accent.main, 0.05)
  }
  /// A tile with no color of its own: the palette's slate.
  public static let neutralTile = adaptive(light: AglynTokens.light.tertiary.main, dark: AglynTokens.dark.grey[700] ?? .gray)
  /// A count that asks for action (unread, waiting): the secondary intent's fill.
  public static let badge = intent({ $0.secondary }, \.main)
  public static let badgeText = intent({ $0.secondary }, \.contrastText)
  /// Secondary text, the theme's own.
  public static let secondaryText = themed { AglynThemeRuntime.shared.surfaces(dark: $0).textSecondary }

  /// `a` with `t` of `b` mixed in, both opaque.
  static func blend(_ a: Color, _ b: Color, _ t: Double) -> Color {
    let (x, y) = (AglynAccent.rgb(a), AglynAccent.rgb(b))
    return AglynAccent.color(AglynAccent.mix(x, y, t))
  }
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
        .font(.system(size: AglynShellMetrics.badge * 0.6, weight: .bold, design: .rounded))
        .monospacedDigit()
        .foregroundStyle(AglynColor.badgeText)
        .padding(.horizontal, count > 9 ? 3 : 0)
        .frame(minWidth: AglynShellMetrics.badge, minHeight: AglynShellMetrics.badge)
        .background(Capsule().fill(AglynColor.badge))
        .overlay(Capsule().strokeBorder(AglynColor.paper, lineWidth: 1.5))
        .accessibilityLabel("\(count) waiting")
    }
  }
}

/// One workspace on the rail: its logo, else its initials on its color (the person's pick, its brand color or one taken
/// from its logo), a ring while it is the one in use, and its unread count.
///
/// The logo follows Figma's Rail/Workspace tile (Components 2:2): a picture (opaque art, or a badge that already fits
/// the tile's shape) covers the tile (Type=Picture, 109:1419 / 109:1408); a mark on a transparent ground sits on the
/// paper plate, its ink fitted whole in the logo slot (Type=Logo, 97:899 / 5:47: 22 on 32, 28 on 40). Every place a
/// workspace's picture shows (the rail, the sidebar's header, Home, the switcher, the pin lists) draws this tile, so
/// they all follow the one rule.
public struct AglynWorkspaceTile: View {
  @Environment(\.colorScheme) private var scheme
  let name: String
  let logoURL: URL?
  let darkLogoURL: URL?
  let colorHex: String?
  let selected: Bool
  let unread: Int
  let size: CGFloat
  let cornerRadius: CGFloat?

  public init(
    name: String, logoURL: URL?, darkLogoURL: URL? = nil, colorHex: String?, selected: Bool, unread: Int = 0,
    size: CGFloat = AglynShellMetrics.tile, cornerRadius: CGFloat? = nil
  ) {
    self.name = name
    self.logoURL = logoURL
    self.darkLogoURL = darkLogoURL
    self.colorHex = colorHex
    self.selected = selected
    self.unread = unread
    self.size = size
    self.cornerRadius = cornerRadius
  }

  /// The gap between a tile and its selection ring: half the ring box's extra width.
  private var ringPadding: CGFloat {
    size == AglynShellMetrics.tile ? (AglynShellMetrics.ringBox - AglynShellMetrics.tile) / 2 : 3
  }

  /// The rail's tile takes the shell's radius; any other size keeps the same proportion unless it is given one.
  private var radius: CGFloat {
    if let cornerRadius { return cornerRadius }
    return size == AglynShellMetrics.tile
      ? AglynShellMetrics.tileRadius : size * AglynShellMetrics.tileRadius / AglynShellMetrics.tile
  }

  /// A mark's slot on the plate (Figma Rail/Workspace tile, Type=Logo: 22 on 32 Compact, 28 on 40 Touch), so a mark
  /// keeps the plate's margin round it rather than filling the tile; any other size keeps the proportion.
  private var logoBox: CGFloat { size * AglynShellMetrics.tileLogo / AglynShellMetrics.tile }

  public var body: some View {
    ZStack(alignment: .topTrailing) {
      picture
        .frame(width: size, height: size)
        .padding(ringPadding)
        // Selected: a 2-point ring in the accent on the ring box (the rail draws the 3-point bar at its edge).
        .overlay(
          RoundedRectangle(cornerRadius: radius + ringPadding, style: .continuous)
            .strokeBorder(selected ? AglynColor.accentIcon : .clear, lineWidth: 2))
      AglynCountBadge(unread).offset(x: 3, y: -3)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(name)
    .accessibilityValue(unread > 0 ? "\(unread) unread" : "")
    .accessibilityAddTraits(selected ? [.isSelected, .isButton] : [.isButton])
  }

  @ViewBuilder
  private var picture: some View {
    if let shown = (scheme == .dark ? darkLogoURL : nil) ?? logoURL {
      AglynBrandLoaded(url: shown, fit: .tile(side: size, cornerRadius: radius, slot: logoBox)) { picture, layout in
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        AglynBrandDrawn(picture: picture, layout: layout, side: size, cornerRadius: radius)
          .background(shape.fill(layout.plate ? AglynColor.paper : Color.clear))
          .overlay(shape.strokeBorder(AglynColor.divider, lineWidth: layout.plate ? 1 : 0))
      } fallback: {
        initials
      }
    } else {
      initials
    }
  }

  private var initials: some View {
    let fill = Color(aglynHex: colorHex) ?? AglynColor.neutralTile
    return Text(aglynInitials(name))
      .font(
        .system(
          size: size == AglynShellMetrics.tile
            ? AglynShellMetrics.tileInitials : size * (aglynInitials(name).count > 1 ? 0.36 : 0.44),
          weight: .semibold))
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

  public init(systemImage: String, caption: String? = nil, filled: Bool = false, size: CGFloat = AglynShellMetrics.tile) {
    self.systemImage = systemImage
    self.caption = caption
    self.filled = filled
    self.size = size
  }

  public var body: some View {
    VStack(spacing: 3) {
      Image(systemName: systemImage)
        .font(.system(size: size == AglynShellMetrics.utility ? AglynShellMetrics.rowIcon - 2 : size * 0.42, weight: .semibold))
        .foregroundStyle(filled ? AglynColor.primaryContrast : AglynColor.railText)
        .frame(width: size, height: size)
        .background(
          RoundedRectangle(
            cornerRadius: size == AglynShellMetrics.utility
              ? AglynShellMetrics.controlRadius : size * AglynShellMetrics.tileRadius / AglynShellMetrics.tile,
            style: .continuous)
            .fill(filled ? AglynColor.primary : AglynColor.paper.opacity(0.7)))
      if let caption {
        Text(caption).font(.system(size: AglynShellMetrics.railCaption + 1, weight: .medium)).monospacedDigit()
          .foregroundStyle(AglynColor.railText).lineLimit(1)
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
      // A small label with its chevron after it (Figma Sidebar/Group header 6:84), its count on the right while folded.
      HStack(spacing: 4) {
        Text(title)
          .font(.system(size: AglynShellMetrics.groupText, weight: .semibold))
          .foregroundStyle(AglynColor.secondaryText)
        if foldable {
          Image(systemName: "chevron.right")
            .font(.system(size: AglynShellMetrics.groupChevron * 0.7, weight: .semibold))
            .foregroundStyle(AglynColor.secondaryText)
            .frame(width: AglynShellMetrics.groupChevron, height: AglynShellMetrics.groupChevron)
            .rotationEffect(.degrees(open ? 90 : 0))
        }
        Spacer(minLength: 4)
        // While folded, how many rows it holds, right-aligned in the secondary color (Figma Sidebar/Group header).
        if foldable && !open && hiddenCount > 0 {
          Text("\(hiddenCount)").font(.system(size: AglynShellMetrics.groupText + 1)).monospacedDigit()
            .foregroundStyle(AglynColor.secondaryText)
            .padding(.horizontal, 6)
        }
      }
      .padding(.horizontal, AglynShellMetrics.rowPadding)
      .frame(maxWidth: .infinity, minHeight: AglynShellMetrics.groupHeight, alignment: .leading)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(!foldable)
    .padding(.horizontal, AglynShellMetrics.rowInset)
    .accessibilityLabel(title)
    .accessibilityValue(foldable ? (open ? "Open" : "Folded") : "")
    .accessibilityHint(foldable ? (open ? "Folds the group" : "Opens the group") : "")
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
    // Figma Color swatch, Selected=Yes: a 2 pt text/primary ring, which reads around any swatch, the blue one too.
    .overlay(Circle().strokeBorder(selected ? AglynColor.textPrimary : .clear, lineWidth: 2))
  }
}

/// The lines on screen in Home's "Needs you", by id: a line is there only while something waits, so Home says "Nothing
/// needs you right now" when none is (the Kotlin kit's `NeedsYouLines`).
@MainActor
@Observable
public final class AglynNeedsYouLines {
  public private(set) var shown: Set<String> = []
  public init() {}
  public var any: Bool { !shown.isEmpty }
  func appear(_ id: String) { shown.insert(id) }
  func disappear(_ id: String) { shown.remove(id) }
}

private struct NeedsYouLinesKey: EnvironmentKey {
  static let defaultValue: AglynNeedsYouLines? = nil
}

extension EnvironmentValues {
  /// Home's "Needs you" lines, for the lines to report themselves to.
  public var aglynNeedsYou: AglynNeedsYouLines? {
    get { self[NeedsYouLinesKey.self] }
    set { self[NeedsYouLinesKey.self] = newValue }
  }
}

/// One thing waiting on the person (Home's "Needs you"): what it is ("3 orders to get ready"), the list it opens,
/// already filtered. A plugin draws one only while something waits; nothing is drawn for nothing.
public struct AglynNeedsYouLine: View {
  @Environment(\.aglynNeedsYou) private var lines
  let id: String
  let systemImage: String
  let text: String
  let place: String
  let tone: AglynTone
  let action: () -> Void

  public init(
    id: String, systemImage: String, text: String, place: String, tone: AglynTone = .neutral, action: @escaping () -> Void
  ) {
    self.id = id
    self.systemImage = systemImage
    self.text = text
    self.place = place
    self.tone = tone
    self.action = action
  }

  public var body: some View {
    Button(action: action) {
      HStack(spacing: 12) {
        IconBadge(systemImage, tone: tone == .neutral ? .info : tone, size: 28)
        Text(text).font(AglynFont.body).foregroundStyle(.primary).multilineTextAlignment(.leading)
        Spacer(minLength: 8)
        Text(place).font(AglynFont.caption).foregroundStyle(.secondary)
        Image(systemName: "chevron.forward").font(.caption).foregroundStyle(.tertiary)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 10)
      .contentShape(Rectangle())
    }
    .buttonStyle(.aglynRow)
    .onAppear { lines?.appear(id) }
    .onDisappear { lines?.disappear(id) }
    .accessibilityIdentifier("needs-you-\(id)")
  }
}
