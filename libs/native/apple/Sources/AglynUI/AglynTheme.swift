// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

#if canImport(UIKit)
  import UIKit
#elseif canImport(AppKit)
  import AppKit
#endif

/// The semantic colors the app paints with: each follows light and dark mode.
public enum AglynColor {
  public static func intent(_ pick: @escaping @Sendable (AglynPalette) -> AglynIntent, _ part: KeyPath<AglynIntent, Color>) -> Color {
    adaptive(light: pick(AglynTokens.light)[keyPath: part], dark: pick(AglynTokens.dark)[keyPath: part])
  }

  /// The brand tint: the accent's readable text color, so a control on the page background meets contrast in both
  /// modes. The theme's accent when one is chosen (Theming), else the console's primary.
  public static let tint = accent(\.text)
  public static let primary = accent(\.main)
  public static let success = intent({ $0.success }, \.text)
  public static let warning = intent({ $0.warning }, \.text)
  public static let error = intent({ $0.error }, \.text)
  public static let info = intent({ $0.info }, \.text)
  public static let secondary = intent({ $0.secondary }, \.text)

  /// The accent in force, part by part: the runtime theme's, else the console's primary intent.
  public static func accent(_ part: KeyPath<AglynIntent, Color>) -> Color {
    themed { dark in
      AglynThemeRuntime.shared.accentIntent(dark: dark)?[keyPath: part]
        ?? (dark ? AglynTokens.dark.primary : AglynTokens.light.primary)[keyPath: part]
    }
  }

  /// A color resolved when it is drawn, from the runtime theme and the appearance.
  public static func themed(_ resolve: @escaping @Sendable (_ dark: Bool) -> Color) -> Color {
    #if canImport(UIKit)
      Color(uiColor: UIColor { traits in UIColor(resolve(traits.userInterfaceStyle == .dark)) })
    #elseif canImport(AppKit)
      Color(nsColor: NSColor(name: nil) { appearance in
        NSColor(resolve(appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua))
      })
    #endif
  }

  public static func adaptive(light: Color, dark: Color) -> Color {
    #if canImport(UIKit)
      Color(
        uiColor: UIColor { traits in
          traits.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light)
        })
    #elseif canImport(AppKit)
      Color(
        nsColor: NSColor(name: nil) { appearance in
          appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(dark) : NSColor(light)
        })
    #endif
  }
}

extension Color {
  /// A CSS color as the theme tokens spell it: `#rgb`, `#rrggbb[aa]`, `rgb()` or `rgba()`.
  public init(aglynCSS css: String) {
    let (r, g, b, a) = AglynCSSColor.parse(css) ?? (0, 0, 0, 1)
    self.init(.sRGB, red: r, green: g, blue: b, opacity: a)
  }
}

public enum AglynCSSColor {
  public static func parse(_ css: String) -> (Double, Double, Double, Double)? {
    let value = css.trimmingCharacters(in: .whitespaces).lowercased()
    if value.hasPrefix("#") {
      var hex = String(value.dropFirst())
      if hex.count == 3 || hex.count == 4 { hex = hex.map { "\($0)\($0)" }.joined() }
      guard hex.count == 6 || hex.count == 8, let raw = UInt64(hex, radix: 16) else { return nil }
      let hasAlpha = hex.count == 8
      let rgb = hasAlpha ? raw >> 8 : raw
      let alpha = hasAlpha ? Double(raw & 0xFF) / 255 : 1
      return (
        Double((rgb >> 16) & 0xFF) / 255, Double((rgb >> 8) & 0xFF) / 255, Double(rgb & 0xFF) / 255,
        alpha
      )
    }
    guard let open = value.firstIndex(of: "("), value.hasSuffix(")"),
      value.hasPrefix("rgb")
    else { return nil }
    let parts = value[value.index(after: open)..<value.index(before: value.endIndex)]
      .split(separator: ",").map { Double($0.trimmingCharacters(in: .whitespaces)) }
    guard parts.count >= 3, parts.allSatisfy({ $0 != nil }) else { return nil }
    return (parts[0]! / 255, parts[1]! / 255, parts[2]! / 255, parts.count > 3 ? parts[3]! : 1)
  }
}

extension AglynColor {
  /// The page behind cards: the console's `background.default`.
  public static let page = themed { AglynThemeRuntime.shared.surfaces(dark: $0).canvas }
  /// A card or sheet surface: the console's `background.paper`.
  public static let paper = themed { AglynThemeRuntime.shared.surfaces(dark: $0).surface }
  /// Text on a primary fill (a prominent button), the console's `primary.contrastText`.
  public static let primaryContrast = accent(\.contrastText)
  public static let divider = themed { AglynThemeRuntime.shared.surfaces(dark: $0).border }
  /// Figma border/strong, from the theme: a control's outline (a secondary button's border; never white in dark), and a
  /// divider on a tinted ground where `divider` would vanish (the rail's).
  public static let borderStrong = themed { AglynThemeRuntime.shared.surfaces(dark: $0).borderStrong }
  /// The window's title bar.
  public static let titlebar = themed { AglynThemeRuntime.shared.surfaces(dark: $0).titlebar }
  /// A recessed field's ground.
  public static let sunken = themed { AglynThemeRuntime.shared.surfaces(dark: $0).sunken }
  /// A row under the pointer, from the theme.
  public static let hover = themed { AglynThemeRuntime.shared.surfaces(dark: $0).hover }
  /// Primary text, from the theme.
  public static let textPrimary = themed { AglynThemeRuntime.shared.surfaces(dark: $0).textPrimary }
  /// Captions and placeholders, from the theme.
  public static let textTertiary = themed { AglynThemeRuntime.shared.surfaces(dark: $0).textTertiary }
  /// A selected row's fill: the accent at 16%.
  public static let accentSoft = themed { dark in
    AglynThemeRuntime.shared.accentShades(dark: dark)?.soft
      ?? (dark ? AglynTokens.dark.primary.main : AglynTokens.light.primary.main).opacity(0.16)
  }
  /// An icon on a selected row: the accent, readable at 3:1.
  public static let accentIcon = themed { dark in
    AglynThemeRuntime.shared.accentShades(dark: dark)?.icon ?? (dark ? AglynTokens.dark.primary.main : AglynTokens.light.primary.main)
  }
}
