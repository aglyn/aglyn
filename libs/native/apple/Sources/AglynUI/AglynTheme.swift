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

  /// The brand tint: the primary intent's readable text color, so a control
  /// on the page background meets contrast in both modes.
  public static let tint = intent({ $0.primary }, \.text)
  public static let primary = intent({ $0.primary }, \.main)
  public static let success = intent({ $0.success }, \.text)
  public static let warning = intent({ $0.warning }, \.text)
  public static let error = intent({ $0.error }, \.text)
  public static let info = intent({ $0.info }, \.text)
  public static let secondary = intent({ $0.secondary }, \.text)

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
  public static let page = adaptive(light: AglynTokens.light.background.default, dark: AglynTokens.dark.background.default)
  /// A card or sheet surface: the console's `background.paper`.
  public static let paper = adaptive(light: AglynTokens.light.background.paper, dark: AglynTokens.dark.background.paper)
  public static let divider = adaptive(light: AglynTokens.light.divider, dark: AglynTokens.dark.divider)
}
