// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import SwiftUI

#if canImport(UIKit)
  import UIKit
#elseif canImport(AppKit)
  import AppKit
#endif

// Whole-app theming (AGL-3945, Phase 4; Figma Themes 2:8, variable collections "Aglyn / Theme", "Aglyn / Accent",
// "Aglyn / Density"). One runtime theme every shared color token reads when it is drawn, so a theme reaches every
// surface of both apps without a screen naming a color: the rail, sidebar, title bar, lists, buttons, selection, sheets
// and panels. The Aglyn theme is the console's own tokens, unchanged.

/// The surfaces a theme sets for one appearance.
public struct AglynSurfaces: Sendable {
  public let canvas: Color
  public let surface: Color
  public let rail: Color
  /// Words and symbols on the rail (a dark rail takes light ones).
  public let railText: Color
  public let border: Color
  public let textPrimary: Color
  public let textSecondary: Color

  public init(canvas: Color, surface: Color, rail: Color, railText: Color, border: Color, textPrimary: Color, textSecondary: Color) {
    self.canvas = canvas
    self.surface = surface
    self.rail = rail
    self.railText = railText
    self.border = border
    self.textPrimary = textPrimary
    self.textSecondary = textSecondary
  }
}

/// A theme: its surfaces in light and dark, and its own accent.
public struct AglynThemeSpec: Sendable {
  public let id: String
  public let light: AglynSurfaces
  public let dark: AglynSurfaces
  /// `#RRGGBB`: the theme's own accent, from which the fill, readable text and pressed shades are derived.
  public let accent: String
  /// Whether the theme is dark in both appearances (Night).
  public let alwaysDark: Bool
}

private func hex(_ value: String) -> Color { Color(aglynCSS: value) }

/// The themes the apps offer, in the order the picker lists them (`APP_THEME_NAMES`). Values are Figma's
/// "Aglyn / Theme" modes; Ocean and Warm are its theme previews, carried to dark from the Aglyn theme's dark.
public enum AglynThemes {
  public static let aglyn = AglynThemeSpec(
    id: "aglyn",
    light: AglynSurfaces(
      canvas: AglynTokens.light.background.default, surface: AglynTokens.light.background.paper, rail: hex("#E6EAF0"),
      railText: hex("#5E6773"), border: AglynTokens.light.divider, textPrimary: AglynTokens.light.text.primary,
      textSecondary: AglynTokens.light.text.secondary),
    dark: AglynSurfaces(
      canvas: AglynTokens.dark.background.default, surface: AglynTokens.dark.background.paper, rail: hex("#0F1418"),
      railText: hex("#B3BCC6"), border: AglynTokens.dark.divider, textPrimary: AglynTokens.dark.text.primary,
      textSecondary: AglynTokens.dark.text.secondary),
    accent: "#00B0FF", alwaysDark: false)

  public static let quiet = AglynThemeSpec(
    id: "quiet",
    light: AglynSurfaces(
      canvas: hex("#F4F4F2"), surface: hex("#FFFFFF"), rail: hex("#EAEAE7"), railText: hex("#5F5F5A"), border: hex("#E2E2DE"),
      textPrimary: hex("#222220"), textSecondary: hex("#5F5F5A")),
    dark: AglynSurfaces(
      canvas: hex("#1A1A19"), surface: hex("#222221"), rail: hex("#121211"), railText: hex("#B5B5AF"), border: hex("#353533"),
      textPrimary: hex("#F2F2EF"), textSecondary: hex("#B5B5AF")),
    accent: "#404C5C", alwaysDark: false)

  public static let night = AglynThemeSpec(
    id: "night",
    light: AglynSurfaces(
      canvas: hex("#0B1120"), surface: hex("#121A2B"), rail: hex("#050913"), railText: hex("#A9B4CB"), border: hex("#222C42"),
      textPrimary: hex("#EEF2FA"), textSecondary: hex("#A9B4CB")),
    dark: AglynSurfaces(
      canvas: hex("#0B1120"), surface: hex("#121A2B"), rail: hex("#050913"), railText: hex("#A9B4CB"), border: hex("#222C42"),
      textPrimary: hex("#EEF2FA"), textSecondary: hex("#A9B4CB")),
    accent: "#00B0FF", alwaysDark: true)

  public static let ocean = AglynThemeSpec(
    id: "ocean",
    light: AglynSurfaces(
      canvas: hex("#E3EEF4"), surface: hex("#F2F8FB"), rail: hex("#0B3954"), railText: hex("#D4E6F0"), border: hex("#CFE0EA"),
      textPrimary: hex("#14232E"), textSecondary: hex("#4C6474")),
    dark: AglynSurfaces(
      canvas: hex("#0C1B24"), surface: hex("#12252F"), rail: hex("#07151D"), railText: hex("#A9C6D6"), border: hex("#1F3746"),
      textPrimary: hex("#EEF6FA"), textSecondary: hex("#A9C6D6")),
    accent: "#087E8B", alwaysDark: false)

  public static let warm = AglynThemeSpec(
    id: "warm",
    light: AglynSurfaces(
      canvas: hex("#F5ECE0"), surface: hex("#FFFAF3"), rail: hex("#E9DCCB"), railText: hex("#6B5A47"), border: hex("#E6D7C4"),
      textPrimary: hex("#2B2118"), textSecondary: hex("#6B5A47")),
    dark: AglynSurfaces(
      canvas: hex("#1E1813"), surface: hex("#271F18"), rail: hex("#15110D"), railText: hex("#C7B39C"), border: hex("#3A2F25"),
      textPrimary: hex("#F7EFE6"), textSecondary: hex("#C7B39C")),
    accent: "#C2571A", alwaysDark: false)

  public static let highContrast = AglynThemeSpec(
    id: "highContrast",
    light: AglynSurfaces(
      canvas: hex("#FFFFFF"), surface: hex("#FFFFFF"), rail: hex("#EFEFEF"), railText: hex("#000000"), border: hex("#6B6B6B"),
      textPrimary: hex("#000000"), textSecondary: hex("#1F1F1F")),
    dark: AglynSurfaces(
      canvas: hex("#000000"), surface: hex("#000000"), rail: hex("#0F0F0F"), railText: hex("#FFFFFF"), border: hex("#9A9A9A"),
      textPrimary: hex("#FFFFFF"), textSecondary: hex("#EDEDED")),
    accent: "#0058A3", alwaysDark: false)

  public static let all: [AglynThemeSpec] = [aglyn, quiet, night, ocean, warm, highContrast]

  public static func spec(_ id: String) -> AglynThemeSpec { all.first { $0.id == id } ?? aglyn }

  /// The accents a person can pick beside the theme's own (Figma "Aglyn / Accent"): blue, violet and pink.
  public static let accentSwatches: [(id: String, label: String, hex: String)] = [
    ("blue", "Blue", "#00B0FF"), ("violet", "Violet", "#7A5CF0"), ("pink", "Pink", "#E040FB"),
    ("green", "Green", "#2E7D5B"), ("warm", "Warm", "#C2571A"), ("slate", "Slate", "#404C5C"),
  ]
}

/// The theme in force, read by every shared color token when it is drawn.
public final class AglynThemeRuntime: @unchecked Sendable {
  public static let shared = AglynThemeRuntime()

  private let lock = NSLock()
  private var spec = AglynThemes.aglyn
  /// The accent's derived shades, light and dark; nil keeps the console's own primary.
  private var accent: (light: AglynIntent, dark: AglynIntent)?
  private var compact = false
  private var tintedSidebar = true
  private var scale: CGFloat = 1

  public init() {}

  /// Applies a choice. `accentHex` nil uses the theme's own accent (the console's tokens for the Aglyn theme).
  public func apply(theme: String, accentHex: String?, compact: Bool, tintedSidebar: Bool, textScale: CGFloat) {
    lock.withLock {
      spec = AglynThemes.spec(theme)
      let wanted = accentHex ?? (spec.id == "aglyn" ? nil : spec.accent)
      accent = wanted.map { AglynAccent.derive($0, on: spec) }
      self.compact = compact
      self.tintedSidebar = tintedSidebar
      scale = textScale
    }
  }

  public var theme: AglynThemeSpec { lock.withLock { spec } }
  public var isCompact: Bool { lock.withLock { compact } }
  public var sidebarTinted: Bool { lock.withLock { tintedSidebar } }
  public var textScale: CGFloat { lock.withLock { scale } }

  func surfaces(dark: Bool) -> AglynSurfaces {
    lock.withLock { dark || spec.alwaysDark ? spec.dark : spec.light }
  }

  /// The accent's intent for an appearance, or nil for the console's own primary.
  func accentIntent(dark: Bool) -> AglynIntent? {
    lock.withLock { accent.map { dark || spec.alwaysDark ? $0.dark : $0.light } }
  }

  /// Whether the theme is dark in both appearances.
  public var alwaysDark: Bool { lock.withLock { spec.alwaysDark } }
}

/// An accent's shades, contrast-checked: the fill is the color picked; the readable text is darkened (light) or
/// lightened (dark) until it reads at 4.5:1 on the theme's canvas; the pressed shade is the readable one; and the words
/// on the fill are white or near-black, whichever reads.
public enum AglynAccent {
  public static func derive(_ hexValue: String, on spec: AglynThemeSpec) -> (light: AglynIntent, dark: AglynIntent) {
    let base = rgb(hexValue)
    func intent(canvas: Color, darkMode: Bool) -> AglynIntent {
      let ground = rgb(canvas)
      var text = base
      var steps = 0
      while contrast(text, ground) < 4.5 && steps < 40 {
        text = darkMode ? mix(text, (1, 1, 1), 0.06) : mix(text, (0, 0, 0), 0.06)
        steps += 1
      }
      let onFill: (Double, Double, Double) = contrast((1, 1, 1), base) >= contrast((0.08, 0.08, 0.08), base) ? (1, 1, 1) : (0.08, 0.08, 0.08)
      return AglynIntent(main: color(base), contrastText: color(onFill), text: color(text), pressed: color(text))
    }
    return (intent(canvas: spec.light.canvas, darkMode: spec.alwaysDark), intent(canvas: spec.dark.canvas, darkMode: true))
  }

  /// WCAG contrast of two sRGB colors.
  public static func contrast(_ a: (Double, Double, Double), _ b: (Double, Double, Double)) -> Double {
    let (la, lb) = (luminance(a), luminance(b))
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
  }

  static func luminance(_ c: (Double, Double, Double)) -> Double {
    func linear(_ v: Double) -> Double { v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * linear(c.0) + 0.7152 * linear(c.1) + 0.0722 * linear(c.2)
  }

  static func mix(_ a: (Double, Double, Double), _ b: (Double, Double, Double), _ t: Double) -> (Double, Double, Double) {
    (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t, a.2 + (b.2 - a.2) * t)
  }

  static func rgb(_ hexValue: String) -> (Double, Double, Double) {
    let (r, g, b, _) = AglynCSSColor.parse(hexValue) ?? (0, 0.69, 1, 1)
    return (r, g, b)
  }

  static func rgb(_ color: Color) -> (Double, Double, Double) {
    #if canImport(UIKit)
      var (r, g, b, a): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
      UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
      return (Double(r), Double(g), Double(b))
    #else
      let ns = NSColor(color).usingColorSpace(.sRGB) ?? .white
      return (Double(ns.redComponent), Double(ns.greenComponent), Double(ns.blueComponent))
    #endif
  }

  static func color(_ c: (Double, Double, Double)) -> Color { Color(.sRGB, red: c.0, green: c.1, blue: c.2, opacity: 1) }
}
