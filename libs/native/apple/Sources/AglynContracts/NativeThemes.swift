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
  // A key that refines a broader one is never held without it, and follows it where neither layer set the key; a key
  // that only follows one takes its verdict where neither layer set the key, and nothing more. Broader keys first, so a
  // chain settles in one pass; a refinement that loops is left alone.
  var broader: [String: String] = [:]
  var followsOnly = Set<String>()
  for entry in catalog.permissions {
    if let parent = entry.refines, out[parent] != nil {
      broader[entry.key] = parent
    } else if let parent = entry.follows, out[parent] != nil {
      broader[entry.key] = parent
      followsOnly.insert(entry.key)
    }
  }
  func depth(_ key: String) -> Int {
    var seen = Set<String>()
    var steps = 0
    var current = key
    while let parent = broader[current] {
      if !seen.insert(current).inserted { return -1 }
      current = parent
      steps += 1
    }
    return steps
  }
  let ordered = broader.keys.map { (key: $0, steps: depth($0)) }.filter { $0.steps > 0 }.sorted { $0.steps < $1.steps }
  for (key, _) in ordered {
    var stored: Bool?
    for layer in [customRole, overrides] {
      if let values = layer?["permissions"] as? [String: Any], let value = values[key], let flag = looseBool(value) { stored = flag }
    }
    let held = broader[key].flatMap { out[$0] } == true
    out[key] = followsOnly.contains(key) ? (stored ?? held) : (held && (stored ?? true))
  }
  return out
}

/// The signed-in member's verdict on every catalog key, as the Firestore rules and the routes read it: `resolvedPermissions`
/// on their member row (every layer applied) where it has the key; else their role's grants, custom role and own overrides
/// (`rolePermissions`). Until the row is read, the role the membership index names answers, so a screen does not flash a
/// refusal at someone who holds the key. No row and no role holds nothing.
public func memberPermissions(
  _ catalog: OrgRoleGrants, member: [String: Any]?, orgRole: String?, customRole: [String: Any]? = nil
) -> [String: Bool] {
  if member == nil && orgRole == nil { return [:] }
  let role = member?["role"] as? String ?? orgRole
  var out = rolePermissions(catalog, role: role, customRole: member?["roleId"] as? String != nil ? customRole : nil, overrides: member)
  for (key, value) in member?["resolvedPermissions"] as? [String: Any] ?? [:] {
    if let flag = looseBool(value) { out[key] = flag }
  }
  return out
}

/// The verdict on one site: the site's own stamp for this member (`hosts/{hostId}.memberPermissions[uid]`, which holds
/// the per-site keys and the keys a site can narrow, decided for that site) over their workspace verdict.
public func sitePermissions(_ workspace: [String: Bool], siteStamp: [String: Any]?) -> [String: Bool] {
  var out = workspace
  for (key, value) in siteStamp ?? [:] {
    if let flag = looseBool(value) { out[key] = flag }
  }
  return out
}

/// One row of a permission editor (`groupOrgPermissions`, `offeredOrgPermissions`): a key the workspace is offered, under
/// its group's heading. `first` marks the group's first row, where the heading goes.
public struct PermissionEditorRow: Equatable, Sendable {
  public let key: String
  public let label: String
  public let description: String
  public let group: String
  public let groupLabel: String
  public let first: Bool
}

/// The keys an editor offers, in the groups' display order: every core key, and a plugin's keys while the plugin is on for
/// the workspace (nil: no filter). `narrowable` keeps only the keys a site can narrow. A key stored for a plugin that is now
/// off is not offered and not dropped: the save writes back the stored map.
public func permissionEditorRows(_ catalog: OrgRoleGrants, enabledPlugins: [String]?, narrowable: Bool = false) -> [PermissionEditorRow] {
  let groups = catalog.groups ?? []
  let offered = catalog.permissions.filter { entry in
    (!narrowable || entry.narrowable == true)
      && (entry.pluginId == nil || enabledPlugins == nil || enabledPlugins?.contains(entry.pluginId ?? "") == true)
  }
  var order = groups.map(\.id)
  for entry in offered where !order.contains(entry.group ?? "") { order.append(entry.group ?? "") }
  return order.flatMap { id -> [PermissionEditorRow] in
    let label = groups.first { $0.id == id }?.label ?? id
    return offered.filter { ($0.group ?? "") == id }.enumerated().map { index, entry in
      PermissionEditorRow(key: entry.key, label: entry.label, description: entry.description, group: id, groupLabel: label, first: index == 0)
    }
  }
}

/// What a refusal says when a member lacks a key (`permissionRefusalText`): it names the permission, never a role.
public func permissionRefusalText(_ catalog: OrgRoleGrants, key: String) -> String {
  let label = catalog.permissions.first { $0.key == key }?.label ?? key
  return "Your role does not include \"\(label)\" — ask an organization admin"
}

/// A JSON boolean as Foundation bridges it: `true`/`false` arrive as `NSNumber` booleans, never as 0 or 1.
private func looseBool(_ value: Any) -> Bool? {
  if let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue }
  return value as? Bool
}
