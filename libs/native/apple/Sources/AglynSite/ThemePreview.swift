// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

// The theme picker's preview of a theme the site is not using yet (the console's `ThemeLibraryCard` and `ThemePreview`,
// AGL-3668): what `/api/hosts/theme` `preview` answers, read off the very theme the console renders the preview under
// (`themePreviewKit` in libs/shared/ui/theme). The Kotlin kit's ThemePreview.kt reads the same answer.

/// One accent as the preview draws it: its fill, the ink on it, and its darker shade.
public struct ThemePreviewAccent: Equatable, Sendable {
  public let main: String
  public let contrastText: String
  public let dark: String
}

/// One rung of the type ramp: the variant, its size at the widest breakpoint in points, as written, and its weight.
public struct ThemePreviewTypeRung: Equatable, Identifiable, Sendable {
  public let key: String
  public let sizePx: Double
  public let raw: String
  public let weight: Int?
  public var id: String { key }
}

/// A theme in one scheme, as the preview kit draws it.
public struct ThemePreviewKit: Equatable, Sendable {
  public let fontFamily: String
  public let background: (default: String, paper: String)
  public let text: (primary: String, secondary: String, disabled: String)
  public let divider: String
  public let primary: ThemePreviewAccent
  public let secondary: ThemePreviewAccent
  public let tertiary: ThemePreviewAccent
  public let error: ThemePreviewAccent
  public let warning: ThemePreviewAccent
  public let info: ThemePreviewAccent
  public let success: ThemePreviewAccent
  public let surface: (main: String, contrastText: String)
  public let tint: (primary: String, secondary: String, tertiary: String)
  public let selected: String
  public let radius: Double
  public let typography: [ThemePreviewTypeRung]

  public static func == (a: ThemePreviewKit, b: ThemePreviewKit) -> Bool {
    a.fontFamily == b.fontFamily && a.background == b.background && a.text == b.text && a.divider == b.divider
      && a.primary == b.primary && a.secondary == b.secondary && a.tertiary == b.tertiary && a.error == b.error
      && a.warning == b.warning && a.info == b.info && a.success == b.success && a.surface == b.surface && a.tint == b.tint
      && a.selected == b.selected && a.radius == b.radius && a.typography == b.typography
  }
}

/// What the route answers: the theme's name, whether edits stashed on it are laid over, and the kit in each scheme.
public struct ThemePreviewAnswer: Equatable, Sendable {
  public let name: String
  public let edited: Bool
  public let light: ThemePreviewKit
  public let dark: ThemePreviewKit

  public func kit(dark: Bool) -> ThemePreviewKit { dark ? self.dark : light }
}

private func accent(_ json: JSONValue?) -> ThemePreviewAccent {
  let main = json?["main"]?.stringValue ?? ""
  return ThemePreviewAccent(
    main: main, contrastText: json?["contrastText"]?.stringValue ?? "", dark: json?["dark"]?.stringValue ?? main)
}

/// One scheme's kit from the route's answer; missing values read as empty, which the drawing treats as unset.
public func themePreviewKit(of json: JSONValue?) -> ThemePreviewKit {
  let text = { (key: String) in json?["text"]?[key]?.stringValue ?? "" }
  let tint = { (key: String) in json?["tint"]?[key]?.stringValue ?? "" }
  return ThemePreviewKit(
    fontFamily: json?["fontFamily"]?.stringValue ?? "",
    background: (json?["background"]?["default"]?.stringValue ?? "", json?["background"]?["paper"]?.stringValue ?? ""),
    text: (text("primary"), text("secondary"), text("disabled")),
    divider: json?["divider"]?.stringValue ?? "",
    primary: accent(json?["primary"]), secondary: accent(json?["secondary"]), tertiary: accent(json?["tertiary"]),
    error: accent(json?["error"]), warning: accent(json?["warning"]), info: accent(json?["info"]),
    success: accent(json?["success"]),
    surface: (json?["surface"]?["main"]?.stringValue ?? "", json?["surface"]?["contrastText"]?.stringValue ?? ""),
    tint: (tint("primary"), tint("secondary"), tint("tertiary")),
    selected: json?["selected"]?.stringValue ?? "",
    radius: json?["radius"]?.numberValue ?? 0,
    typography: json?["typography"]?.arrayValue?.compactMap { rung in
      guard let key = rung["key"]?.stringValue, let size = rung["sizePx"]?.numberValue else { return nil }
      return ThemePreviewTypeRung(
        key: key, sizePx: size, raw: rung["raw"]?.stringValue ?? "", weight: rung["weight"]?.numberValue.map { Int($0) })
    } ?? [])
}

public func themePreviewAnswer(of json: JSONValue?) -> ThemePreviewAnswer {
  ThemePreviewAnswer(
    name: json?["name"]?.stringValue ?? "", edited: json?["edited"]?.boolValue == true,
    light: themePreviewKit(of: json?["light"]), dark: themePreviewKit(of: json?["dark"]))
}

/// The sentence above the preview, as the console's picker words it.
public func themePreviewLead(name: String, edited: Bool) -> String {
  edited ? "Previewing \(name) with the edits you made to it." : "Previewing \(name)."
}

/// The note under the preview, as the console's picker words it: using a theme repaints the live site, the theme in
/// use stays in the list (with its edits), and unsaved editor changes are dropped.
public func themePreviewNotice(candidate: String, current: String?, currentEdited: Bool) -> String {
  "Using \(candidate) repaints the live site now. \(current ?? "The current theme") stays in this list"
    + (currentEdited ? " with your edits to it," : ",") + " so you can switch back. Unsaved changes in the editor below are discarded."
}
