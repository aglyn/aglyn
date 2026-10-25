// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// The theme contract's rules (AGL-3950, native-themes.ts): the colour arithmetic, an accent from any brand color, a
// theme from a four-color preview, and the workspace role grants. Ported so the apps derive exactly what the console
// and the Kotlin apps derive; `NavContractsTests` replays the TypeScript's own cases.

// MARK: Colour arithmetic

/// `[r, g, b]` in 0–255, or nil for anything that is not `#RRGGBB(AA)`.
private func themeChannels(_ color: String?) -> [Double]? {
  guard let color, color.hasPrefix("#"), color.count == 7 || color.count == 9 else { return nil }
  let hex = color.dropFirst()
  guard hex.allSatisfy(\.isHexDigit) else { return nil }
  let digits = Array(hex.prefix(6))
  return stride(from: 0, to: 6, by: 2).map { Double(Int(String(digits[$0...$0 + 1]), radix: 16) ?? 0) }
}

private func themeHex(_ rgb: [Double]) -> String {
  "#" + rgb.map { String(format: "%02x", Int(jsRound(min(255, max(0, $0))))) }.joined()
}

/// JavaScript's `Math.round`: halves round up, toward +∞.
private func jsRound(_ value: Double) -> Double { (value + 0.5).rounded(.down) }

/// Whether a value is `#RRGGBB`.
public func isThemeColor(_ value: Any?) -> Bool {
  guard let text = value as? String, text.hasPrefix("#"), text.count == 7 else { return false }
  return text.dropFirst().allSatisfy(\.isHexDigit)
}

private func themeLinear(_ channel: Double) -> Double {
  let value = channel / 255
  return value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
}

private func themeLuminance(_ rgb: [Double]) -> Double {
  0.2126 * themeLinear(rgb[0]) + 0.7152 * themeLinear(rgb[1]) + 0.0722 * themeLinear(rgb[2])
}

/// WCAG 2 contrast between two `#RRGGBB` colors, as the console's `contrastRatio` measures it.
public func themeContrast(_ a: String, _ b: String) -> Double {
  guard let x = themeChannels(a), let y = themeChannels(b) else { return 1 }
  let pair = [themeLuminance(x), themeLuminance(y)].sorted(by: >)
  return (pair[0] + 0.05) / (pair[1] + 0.05)
}

private func themeToHsl(_ rgb: [Double]) -> (Double, Double, Double) {
  let (red, green, blue) = (rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
  let high = max(red, green, blue)
  let low = min(red, green, blue)
  let lightness = (high + low) / 2
  if high == low { return (0, 0, lightness) }
  let delta = high - low
  let saturation = lightness > 0.5 ? delta / (2 - high - low) : delta / (high + low)
  var hue: Double
  if high == red {
    hue = (green - blue) / delta + (green < blue ? 6 : 0)
  } else if high == green {
    hue = (blue - red) / delta + 2
  } else {
    hue = (red - green) / delta + 4
  }
  return (hue / 6, saturation, lightness)
}

private func themeFromHsl(_ hue: Double, _ saturation: Double, _ lightness: Double) -> String {
  let l = min(1, max(0, lightness))
  if saturation == 0 { return themeHex([l * 255, l * 255, l * 255]) }
  let q = l < 0.5 ? l * (1 + saturation) : l + saturation - l * saturation
  let p = 2 * l - q
  func channel(_ t: Double) -> Double {
    var x = t
    if x < 0 { x += 1 }
    if x > 1 { x -= 1 }
    if x < 1 / 6 { return p + (q - p) * 6 * x }
    if x < 1 / 2 { return q }
    if x < 2 / 3 { return p + (q - p) * (2 / 3 - x) * 6 }
    return p
  }
  return themeHex([channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255])
}

/// `color` with its HSL lightness moved by `delta` (−1 to 1).
private func themeShiftLightness(_ color: String, _ delta: Double) -> String {
  guard let rgb = themeChannels(color) else { return color }
  let (h, s, l) = themeToHsl(rgb)
  return themeFromHsl(h, s, l + delta)
}

/// `color` walked in 2% HSL-lightness steps (darker, or lighter) until it reaches `minContrast` against `against`;
/// the pole when nothing reaches it.
private func themeWalkToContrast(_ color: String, against: String, _ minContrast: Double, _ direction: Double) -> String {
  var candidate = color
  for step in 0...50 {
    candidate = themeShiftLightness(color, direction * 0.02 * Double(step))
    if themeContrast(candidate, against) >= minContrast { return candidate }
  }
  return candidate
}

/// `from` moved `amount` (0–1) of the way to `to`, per sRGB channel.
public func themeLerp(_ from: String, _ to: String, _ amount: Double) -> String {
  guard let a = themeChannels(from), let b = themeChannels(to) else { return from }
  return themeHex(zip(a, b).map { $0 + ($1 - $0) * amount })
}

/// `color` with an alpha byte: `#RRGGBBAA`.
private func themeWithAlpha(_ color: String, _ alpha: Double) -> String {
  guard let rgb = themeChannels(color) else { return color }
  return themeHex(rgb) + String(format: "%02x", Int(jsRound(alpha * 255)))
}

// MARK: Accents

/// An accent from any brand color, as the console derives it: a retired blue reads as the color that replaced it
/// (`THEME_RETIRED_ACCENTS`), and a color one of Figma's Accent modes rings returns that mode exactly. Otherwise the fill
/// keeps the color while white reads on it at 3:1, else it darkens in 2% steps until white reads at 4.5:1; the content
/// on the fill is always white. Hover and pressed are 4% and 8% darker, soft is the color at 16% alpha, ring is the
/// color, the icon walks to 3:1 on the light page and the two text shades to 4.5:1 on each page. Nil for anything that
/// is not `#RRGGBB`.
public func deriveAccent(_ color: String) -> ThemeAccent? {
  guard isThemeColor(color) else { return nil }
  let values = ContractValues.shared
  let raw = values.themeRetiredAccents[color.lowercased()] ?? color.lowercased()
  if let named = values.themeAccents.first(where: { $0.accent.ring == raw }) { return named.accent }
  let text = Double(values.themeTextContrast)
  let nonText = Double(values.themeNonTextContrast)
  let aglyn = themePalette("aglyn")
  let white = "#ffffff"
  let fill = themeContrast(raw, white) >= nonText ? raw : themeWalkToContrast(raw, against: white, text, -1)
  return ThemeAccent(
    fill: fill, hover: themeShiftLightness(fill, -0.04),
    icon: themeWalkToContrast(raw, against: aglyn.light.surface, nonText, -1), on: white,
    pressed: themeShiftLightness(fill, -0.08), ring: raw, soft: themeWithAlpha(raw, 0.16),
    textDark: themeWalkToContrast(raw, against: aglyn.dark.surface, text, 1),
    textLight: themeWalkToContrast(raw, against: aglyn.light.surface, text, -1))
}

// MARK: Themes

/// A theme by id, Aglyn for anything unknown.
public func themePalette(_ id: String?) -> ThemePalette {
  let palettes = ContractValues.shared.themePalettes
  return palettes.first { $0.id.rawValue == id } ?? palettes[0]
}

/// A theme's full palette from a four-color preview, over Figma's Aglyn mode (`THEME_FIGMA_BASE`), by the same rules as
/// the console's `deriveThemeFromPreview`: light keeps the preview's canvas, surface and rail and blends the rest toward
/// the rail; dark tints the base dark toward `darkRailSeed`.
public func deriveThemeFromPreview(_ preview: ThemePreview, darkRailSeed: String) -> ThemeColorsPair {
  let base = ContractValues.shared.themeFigmaBase
  var light = base.light
  light.canvas = preview.canvas
  light.surface = preview.surface
  light.raised = preview.surface
  light.rail = preview.rail
  light.sunken = themeLerp(preview.canvas, preview.rail, 0.25)
  light.hover = themeLerp(preview.surface, preview.rail, 0.1)
  light.titlebar = themeLerp(preview.surface, preview.canvas, 0.35)
  light.borderSubtle = themeLerp(base.light.borderSubtle, preview.rail, 0.18)
  light.borderStrong = themeLerp(base.light.borderStrong, preview.rail, 0.22)
  var dark = base.dark
  dark.canvas = themeLerp(base.dark.canvas, darkRailSeed, 0.22)
  dark.surface = themeLerp(base.dark.surface, darkRailSeed, 0.18)
  dark.raised = themeLerp(base.dark.raised, darkRailSeed, 0.18)
  dark.rail = themeLerp(base.dark.rail, darkRailSeed, 0.45)
  return ThemeColorsPair(dark: dark, light: light)
}

// MARK: Workspace role grants

/// A workspace role's permissions from the catalog's grants (`ORG_ROLE_GRANTS`), then a custom role's and the member's
/// own overrides, later layers winning key by key over the catalog's keys only. A missing role reads as viewer; a role
/// the catalog does not know holds nothing.
public func rolePermissions(
  _ catalog: OrgRoleGrants, role: String?, customRole: [String: Any]? = nil, overrides: [String: Any]? = nil
) -> [String: Bool] {
  let keys = catalog.permissions.map(\.key)
  let held = Set(catalog.grants[role ?? "viewer"] ?? [])
  var out = Dictionary(keys.map { ($0, held.contains($0)) }, uniquingKeysWith: { a, _ in a })
  for layer in [customRole, overrides] {
    guard let values = layer?["permissions"] as? [String: Any] else { continue }
    for key in keys {
      if let value = values[key], let flag = looseBool(value) { out[key] = flag }
    }
  }
  return out
}

/// A JSON boolean as Foundation bridges it: `true`/`false` arrive as `NSNumber` booleans, never as 0 or 1.
private func looseBool(_ value: Any) -> Bool? {
  if let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue }
  return value as? Bool
}
