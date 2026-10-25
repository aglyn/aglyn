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
// and panels. The themes and accents themselves come from the theme contract (AGL-3950), applied by the app.

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
  /// The window's title bar (Figma Mac/Titlebar).
  public let titlebar: Color
  /// A recessed field's ground (the title bar's search, the site picker).
  public let sunken: Color
  /// A row under the pointer.
  public let hover: Color
  /// Captions and placeholders.
  public let textTertiary: Color
  /// A control's outline: a secondary button's or a field's border (Figma border/strong).
  public let borderStrong: Color

  public init(
    canvas: Color, surface: Color, rail: Color, railText: Color, border: Color, textPrimary: Color, textSecondary: Color,
    titlebar: Color? = nil, sunken: Color? = nil, hover: Color? = nil, textTertiary: Color? = nil, borderStrong: Color? = nil
  ) {
    self.canvas = canvas
    self.surface = surface
    self.rail = rail
    self.railText = railText
    self.border = border
    self.textPrimary = textPrimary
    self.textSecondary = textSecondary
    self.titlebar = titlebar ?? surface
    self.sunken = sunken ?? canvas
    self.hover = hover ?? canvas
    self.textTertiary = textTertiary ?? textSecondary
    self.borderStrong = borderStrong ?? border
  }
}

/// The accent's two shades the intents do not carry (`ThemeAccent.soft` and `.icon`): a selected row's fill, and an
/// icon on it.
public struct AglynAccentShades: Sendable {
  public let soft: Color
  public let icon: Color

  public init(soft: Color, icon: Color) {
    self.soft = soft
    self.icon = icon
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

  public init(id: String, light: AglynSurfaces, dark: AglynSurfaces, accent: String, alwaysDark: Bool) {
    self.id = id
    self.light = light
    self.dark = dark
    self.accent = accent
    self.alwaysDark = alwaysDark
  }
}

extension AglynThemeSpec {
  /// What is drawn before the app applies a theme from the contract: the console's own tokens.
  public static let console = AglynThemeSpec(
    id: "aglyn",
    light: AglynSurfaces(
      canvas: AglynTokens.light.background.default, surface: AglynTokens.light.background.paper,
      rail: AglynTokens.light.background.default, railText: AglynTokens.light.text.secondary, border: AglynTokens.light.divider,
      textPrimary: AglynTokens.light.text.primary, textSecondary: AglynTokens.light.text.secondary),
    dark: AglynSurfaces(
      canvas: AglynTokens.dark.background.default, surface: AglynTokens.dark.background.paper,
      rail: AglynTokens.dark.background.default, railText: AglynTokens.dark.text.secondary, border: AglynTokens.dark.divider,
      textPrimary: AglynTokens.dark.text.primary, textSecondary: AglynTokens.dark.text.secondary),
    accent: "", alwaysDark: false)
}

/// The theme in force, read by every shared color token when it is drawn.
public final class AglynThemeRuntime: @unchecked Sendable {
  public static let shared = AglynThemeRuntime()

  private let lock = NSLock()
  private var spec = AglynThemeSpec.console
  /// The accent's derived shades, light and dark; nil keeps the console's own primary.
  private var accent: (light: AglynIntent, dark: AglynIntent)?
  private var shades: (light: AglynAccentShades, dark: AglynAccentShades)?
  private var compact = false
  private var tintedSidebar = true
  private var scale: CGFloat = 1

  public init() {}

  /// Applies a choice: the theme's surfaces and its accent's shades for each appearance (both from the theme contract,
  /// `THEME_PALETTES` and `deriveAccent`).
  public func apply(
    theme: AglynThemeSpec, accent: (light: AglynIntent, dark: AglynIntent)?,
    shades: (light: AglynAccentShades, dark: AglynAccentShades)? = nil, compact: Bool, tintedSidebar: Bool,
    textScale: CGFloat
  ) {
    lock.withLock {
      spec = theme
      self.accent = accent
      self.shades = shades
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

  /// The accent's soft fill and icon shade for an appearance, or nil before a theme is applied.
  func accentShades(dark: Bool) -> AglynAccentShades? {
    lock.withLock { shades.map { dark || spec.alwaysDark ? $0.dark : $0.light } }
  }

  /// Whether the theme is dark in both appearances.
  public var alwaysDark: Bool { lock.withLock { spec.alwaysDark } }
}

/// Colour arithmetic the shared tokens use to blend two colors.
public enum AglynAccent {
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

extension AglynIntent {
  /// An accent's shades as the theme contract derives them (`ThemeAccent`): the fill, the words on it, the readable
  /// text for the appearance, and the pressed fill.
  public static func accent(fill: Color, on: Color, text: Color, pressed: Color) -> AglynIntent {
    AglynIntent(main: fill, contrastText: on, text: text, pressed: pressed)
  }
}
