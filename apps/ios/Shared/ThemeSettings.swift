// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

#if os(iOS)
  import UIKit
#endif

// Whole-app theming (AGL-3945, Phase 4; Figma Themes 2:8): the look saved on the account (`appTheme`, synced like the
// notification sound), with a per-device override kept on the device only.

/// The theme this device draws: its own override when it keeps one, else the account's.
enum DeviceTheme {
  private static let key = "aglyn.theme.device"

  static func override() -> AppThemePrefs? {
    guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
    return try? JSONDecoder().decode(AppThemePrefs.self, from: data)
  }

  static func setOverride(_ prefs: AppThemePrefs?) {
    if let prefs, let data = try? JSONEncoder().encode(prefs) {
      UserDefaults.standard.set(data, forKey: key)
    } else {
      UserDefaults.standard.removeObject(forKey: key)
    }
  }
}

/// The theme in force for the app, and pushing it to the shared tokens.
@MainActor
enum ThemeApplier {
  /// The effective choice: this device's override, else the account's.
  static func effective(_ model: AppModel, deviceOverride: AppThemePrefs?) -> AppThemePrefs {
    deviceOverride ?? model.preferences?.appTheme ?? ContractValues.shared.defaultAppTheme
  }

  /// Applies a choice to the shared tokens and returns a key that changes whenever what is drawn changes.
  @discardableResult
  static func apply(_ prefs: AppThemePrefs, model: AppModel) -> String {
    let workspace = model.workspaceColor(model.workspace?.org?.id)
    // A white-label workspace's brand color is the accent while you are in it (switch-off-able); your own accent wins.
    let accent: String? =
      prefs.accent != "theme"
      ? prefs.accent
      : (workspace.source == .brand && workspace.tintsApp ? workspace.color : nil)
    let scale: CGFloat =
      switch prefs.textSize {
      case .small: 0.92
      case .large: 1.1
      case .extraLarge: 1.22
      default: 1
      }
    AglynThemeRuntime.shared.apply(
      theme: prefs.theme == .unknown ? "aglyn" : prefs.theme.rawValue, accentHex: accent, compact: prefs.density == .compact,
      tintedSidebar: prefs.sidebarStyle != .plain, textScale: scale)
    return [prefs.theme.rawValue, accent ?? "theme", prefs.density.rawValue, prefs.sidebarStyle.rawValue, prefs.textSize.rawValue]
      .joined(separator: "|")
  }

  /// The color scheme a window takes: Night is dark in both; otherwise the appearance's.
  static func scheme(_ prefs: AppThemePrefs) -> ColorScheme? {
    prefs.theme == .night ? .dark : prefs.appearance.colorScheme
  }
}

/// Theme settings ("Theme settings…" from the account menu's Theme ▸).
struct ThemeSettingsView: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @State private var deviceOnly = DeviceTheme.override() != nil
  @State private var local = DeviceTheme.override()
  @State private var customAccent = Color.clear

  private var prefs: AppThemePrefs { ThemeApplier.effective(model, deviceOverride: deviceOnly ? local : nil) }

  private func update(_ change: (inout AppThemePrefs) -> Void) {
    var next = prefs
    change(&next)
    if deviceOnly {
      local = next
      DeviceTheme.setOverride(next)
      navigation.themeNonce += 1
    } else {
      model.preferences?.setAppTheme(next)
    }
  }

  var body: some View {
    Form {
      Section("Appearance") {
        Picker("Appearance", selection: Binding(get: { prefs.appearance }, set: { value in update { $0.appearance = value } })) {
          Text("Light").tag(AppAppearance.light)
          Text("Dark").tag(AppAppearance.dark)
          Text("Match system").tag(AppAppearance.system)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .accessibilityIdentifier("theme-appearance")
      }
      Section("Theme") {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 12)], spacing: 12) {
          ForEach(AppThemeName.allCases.filter { $0 != .unknown }, id: \.self) { name in
            ThemeTile(name: name, selected: prefs.theme == name) { update { $0.theme = name } }
          }
        }
        .padding(.vertical, 4)
      }
      Section {
        HStack(spacing: 8) {
          Button { update { $0.accent = "theme" } } label: { AglynColorSwatch(hex: nil, selected: prefs.accent == "theme") }
            .buttonStyle(.plain)
            .accessibilityLabel("The theme's own accent")
          ForEach(AglynThemes.accentSwatches, id: \.id) { swatch in
            Button { update { $0.accent = swatch.hex } } label: {
              AglynColorSwatch(hex: swatch.hex, selected: prefs.accent.uppercased() == swatch.hex)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(swatch.label)
            .accessibilityIdentifier("theme-accent-\(swatch.id)")
          }
        }
        ColorPicker("Custom…", selection: $customAccent, supportsOpacity: false)
          .onChange(of: customAccent) { _, color in if let hex = color.aglynHexString { update { $0.accent = hex } } }
      } header: {
        Text("Accent")
      } footer: {
        Text("Hover, pressed, selected and the words on the accent are worked out for you, and checked so they read.")
      }
      Section {
        Picker("Density", selection: Binding(get: { prefs.density }, set: { value in update { $0.density = value } })) {
          Text("Comfortable").tag(AppDensity.comfortable)
          Text("Compact").tag(AppDensity.compact)
        }
        #if os(macOS)
          Picker("Text size", selection: Binding(get: { prefs.textSize }, set: { value in update { $0.textSize = value } })) {
            Text("Standard").tag(AppTextSize.system)
            Text("Small").tag(AppTextSize.small)
            Text("Large").tag(AppTextSize.large)
            Text("Extra large").tag(AppTextSize.extraLarge)
          }
        #else
          LabeledContent("Text size", value: "Matches the system")
        #endif
        Picker("Sidebar", selection: Binding(get: { prefs.sidebarStyle }, set: { value in update { $0.sidebarStyle = value } })) {
          Text("Tinted").tag(AppSidebarStyle.tinted)
          Text("Plain").tag(AppSidebarStyle.plain)
        }
        AppIconPicker(selection: prefs.appIcon) { id in update { $0.appIcon = id } }
      }
      Section {
        Toggle("Use each workspace's brand", isOn: Binding(get: { prefs.useWorkspaceBrand }, set: { value in update { $0.useWorkspaceBrand = value } }))
          .accessibilityIdentifier("theme-workspace-brand")
        ForEach(colorTargets, id: \.id) { org in
          Button {
            navigation.colorFor = ColorPickTarget(orgID: org.id, name: org.name)
          } label: {
            HStack {
              Text(org.name)
              Spacer()
              Circle().fill(Color(aglynHex: model.workspaceColor(org.id).color) ?? AglynColor.neutralTile).frame(width: 14, height: 14)
            }
          }
          .buttonStyle(.aglynRow)
        }
      } header: {
        Text("Workspaces")
      } footer: {
        Text("A white-label workspace's brand color tints the app while you are in it. Your pick for a workspace comes first, then its brand color, then a color from its logo.")
      }
      Section {
        Toggle("Apply to this device only", isOn: $deviceOnly)
          .onChange(of: deviceOnly) { _, on in
            if on {
              local = model.preferences?.appTheme ?? ContractValues.shared.defaultAppTheme
              DeviceTheme.setOverride(local)
            } else {
              local = nil
              DeviceTheme.setOverride(nil)
            }
            navigation.themeNonce += 1
          }
          .accessibilityIdentifier("theme-device-only")
      } footer: {
        Text("Your theme is saved on your account and follows you to every device, unless this device keeps its own.")
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .navigationTitle("Theme")
  }

  /// The workspaces the person can color: those on the rail first.
  private var colorTargets: [WorkspaceOrg] {
    let pins = model.preferences?.pinned ?? []
    let orgs = model.workspace?.orgs ?? []
    return pins.compactMap { id in orgs.first { $0.id == id } } + orgs.filter { !pins.contains($0.id) }.prefix(8)
  }
}

/// One theme in the picker: a small preview of its rail, surface and accent, light and dark.
private struct ThemeTile: View {
  let name: AppThemeName
  let selected: Bool
  let action: () -> Void

  private var label: String {
    switch name {
    case .highContrast: "High contrast"
    default: name.rawValue.capitalized
    }
  }

  var body: some View {
    let spec = AglynThemes.spec(name.rawValue)
    Button(action: action) {
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 0) {
          preview(spec.light)
          preview(spec.dark)
        }
        .frame(height: 54)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(selected ? AglynColor.tint : AglynColor.divider, lineWidth: selected ? 2 : 1))
        Text(label).font(AglynFont.subheadline)
      }
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(selected ? .isSelected : [])
    .accessibilityIdentifier("theme-\(name.rawValue)")
  }

  private func preview(_ surfaces: AglynSurfaces) -> some View {
    HStack(spacing: 0) {
      surfaces.rail.frame(width: 12)
      ZStack(alignment: .bottomLeading) {
        surfaces.canvas
        RoundedRectangle(cornerRadius: 3).fill(surfaces.surface).padding(6)
        Circle().fill(Color(aglynHex: spec.accent) ?? .clear).frame(width: 8, height: 8).padding(9)
      }
    }
  }

  private var spec: AglynThemeSpec { AglynThemes.spec(name.rawValue) }
}

/// The alternate app icons this build ships (the logo kit's art), on iPhone and iPad.
struct AppIconPicker: View {
  let selection: String
  let pick: (String) -> Void

  /// The icons the bundle declares: the primary, then each alternate under `CFBundleAlternateIcons`.
  private var icons: [(id: String, label: String)] {
    #if os(iOS)
      let alternates =
        ((Bundle.main.object(forInfoDictionaryKey: "CFBundleIcons") as? [String: Any])?["CFBundleAlternateIcons"]
        as? [String: Any])?.keys.sorted() ?? []
      return [("aglyn", "Aglyn")] + alternates.map { ($0, $0.replacingOccurrences(of: "AppIcon-", with: "")) }
    #else
      return []
    #endif
  }

  var body: some View {
    if icons.count > 1 {
      Picker("App icon", selection: Binding(get: { selection }, set: { id in apply(id) })) {
        ForEach(icons, id: \.id) { icon in Text(icon.label).tag(icon.id) }
      }
      .accessibilityIdentifier("theme-app-icon")
    }
  }

  private func apply(_ id: String) {
    pick(id)
    #if os(iOS)
      UIApplication.shared.setAlternateIconName(id == "aglyn" ? nil : id)
    #endif
  }
}

/// Draws everything under it in the theme in force: the account's, or this device's own, with a white-label
/// workspace's brand as the accent while you are in it.
struct AppThemeModifier: ViewModifier {
  @Environment(AppModel.self) private var model
  let nonce: Int

  func body(content: Content) -> some View {
    let prefs = ThemeApplier.effective(model, deviceOverride: DeviceTheme.override())
    let key = ThemeApplier.apply(prefs, model: model)
    content
      .id("\(key)|\(nonce)")
      .tint(AglynColor.tint)
      .preferredColorScheme(ThemeApplier.scheme(prefs))
  }
}

extension View {
  /// The app's theme, on a shell's root.
  func aglynAppTheme(nonce: Int = 0) -> some View { modifier(AppThemeModifier(nonce: nonce)) }
}
