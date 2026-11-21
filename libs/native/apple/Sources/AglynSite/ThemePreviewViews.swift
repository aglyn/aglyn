// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// A theme the picker previews before it is used: its kind and id as the theme route names them, and its name.
struct ThemePreviewTarget: Identifiable, Equatable {
  let kind: String
  let themeID: String?
  let name: String
  var id: String { "\(kind):\(themeID ?? "")" }
}

/// The picker's two steps, as the console's: a theme is previewed here, light or dark, and applied only on "Use this
/// theme", because a theme repaints the live site the moment it is used.
struct ThemePreviewSheet: View {
  let target: ThemePreviewTarget
  let api: HostSettingsAPI
  /// The theme in use, named as the list names it, and whether edits are waiting on it.
  let currentName: String?
  let currentEdited: Bool
  let canManage: Bool
  let runner: ActionRunner
  let close: () -> Void
  @State private var answer: ThemePreviewAnswer?
  @State private var failed: String?
  @State private var dark = false

  var body: some View {
    NavigationStack {
      List {
        if let failed {
          Section { AglynNotice(failed, tone: .error) }
        } else if let answer {
          Section {
            Text(themePreviewLead(name: target.name, edited: answer.edited)).font(AglynFont.subheadline).foregroundStyle(.secondary)
            Picker("Scheme", selection: $dark) {
              Text("Light").tag(false)
              Text("Dark").tag(true)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("theme-preview-scheme")
          }
          Section {
            ThemePreviewKitView(kit: answer.kit(dark: dark))
              .listRowInsets(EdgeInsets())
          }
          Section {
            AglynNotice(themePreviewNotice(candidate: target.name, current: currentName, currentEdited: currentEdited), tone: .info)
            if let error = runner.error { AglynNotice(error, tone: .error) }
          }
        } else {
          Section { SkeletonRows(count: 6) }
        }
      }
      .aglynListBackground()
      .navigationTitle(target.name)
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { close() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Use this theme") {
            runner.run("This site now uses \(target.name).", onDone: close) {
              try await api.selectTheme(kind: target.kind, id: target.themeID)
            }
          }
          .disabled(!canManage || runner.busy || answer == nil)
          .accessibilityIdentifier("theme-preview-use")
        }
      }
      .task(id: target.id) {
        do {
          answer = try await api.previewTheme(kind: target.kind, id: target.themeID)
        } catch {
          failed = (error as? ConsoleAPIError)?.message ?? "The preview could not be loaded. Try again."
        }
      }
    }
    .accessibilityIdentifier("theme-preview")
  }
}

/// The console's `ThemePreview` sample kit, drawn in the theme's own colours, corner radius and type ramp: an app bar,
/// the ramp, buttons and chips in each accent, the status colours, a card, the surface and the tints, a field, alerts and
/// a selected row. The site's fonts are not loaded in the app; sizes and weights are the theme's.
struct ThemePreviewKitView: View {
  let kit: ThemePreviewKit

  private func color(_ css: String, _ fallback: Color = .clear) -> Color { css.isEmpty ? fallback : Color(aglynCSS: css) }
  private var ink: Color { color(kit.text.primary, .primary) }
  private var muted: Color { color(kit.text.secondary, .secondary) }
  private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: kit.radius, style: .continuous) }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text("Site preview").font(.system(size: rung("h6")?.sizePx ?? 20, weight: weight(rung("h6"))))
        Spacer()
        Text("Action").font(AglynFont.subheadline.weight(.semibold))
      }
      .foregroundStyle(color(kit.primary.contrastText, .white))
      .padding(AglynSpace.two)
      .background(color(kit.primary.main, .accentColor))
      VStack(alignment: .leading, spacing: AglynSpace.two) {
        ramp
        HStack(spacing: AglynSpace.one) {
          filled("Primary", kit.primary)
          filled("Secondary", kit.secondary)
          filled("Tertiary", kit.tertiary)
        }
        HStack(spacing: AglynSpace.one) {
          Text("Outlined").padding(.horizontal, AglynSpace.oneAndHalf).padding(.vertical, AglynSpace.one)
            .foregroundStyle(color(kit.primary.main)).overlay(shape.strokeBorder(color(kit.primary.main)))
          Text("Text").padding(.horizontal, AglynSpace.one).foregroundStyle(color(kit.primary.main))
        }
        .font(AglynFont.subheadline.weight(.semibold))
        chips([("Error", kit.error), ("Warning", kit.warning), ("Info", kit.info), ("Success", kit.success)])
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          Text("Card title").font(.system(size: rung("h6")?.sizePx ?? 20, weight: weight(rung("h6")))).foregroundStyle(ink)
          Text("Cards pick up the paper background and border radius.").font(AglynFont.subheadline).foregroundStyle(muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(AglynSpace.two)
        .background(color(kit.background.paper), in: shape)
        .overlay(shape.strokeBorder(color(kit.divider)))
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          Text("Surface").font(AglynFont.subheadline.weight(.semibold))
          Text("Raised panels and toolbars sit on the surface color.").font(AglynFont.subheadline)
        }
        .foregroundStyle(color(kit.surface.contrastText, ink))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(AglynSpace.oneAndHalf)
        .background(color(kit.surface.main), in: shape)
        .overlay(shape.strokeBorder(color(kit.divider)))
        HStack(spacing: AglynSpace.one) {
          tile("Primary", kit.tint.primary, kit.primary.dark)
          tile("Secondary", kit.tint.secondary, kit.secondary.main)
          tile("Tertiary", kit.tint.tertiary, kit.tertiary.main)
        }
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          Text("Error").font(AglynFont.caption).foregroundStyle(color(kit.error.main))
          Text("Invalid").foregroundStyle(ink).frame(maxWidth: .infinity, alignment: .leading)
            .padding(AglynSpace.one).overlay(shape.strokeBorder(color(kit.error.main)))
          Text("Field errors use the error color.").font(AglynFont.caption).foregroundStyle(color(kit.error.main))
        }
        alert("Success alert uses the palette.", kit.success)
        alert("Info alert uses the palette.", kit.info)
        alert("Warning alert uses the palette.", kit.warning)
        alert("Error alert uses the palette.", kit.error)
        VStack(alignment: .leading, spacing: 0) {
          VStack(alignment: .leading, spacing: 2) {
            Text("Selected list row").foregroundStyle(ink)
            Text("Selection uses the palette's action colors.").font(AglynFont.caption).foregroundStyle(muted)
          }
          .frame(maxWidth: .infinity, alignment: .leading).padding(AglynSpace.one).background(color(kit.selected))
          Text("Unselected list row").foregroundStyle(ink).padding(AglynSpace.one)
        }
      }
      .padding(AglynSpace.two)
    }
    .background(color(kit.background.default))
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("theme-preview-kit")
  }

  private func rung(_ key: String) -> ThemePreviewTypeRung? { kit.typography.first { $0.key == key } }

  private func weight(_ rung: ThemePreviewTypeRung?) -> Font.Weight {
    switch rung?.weight ?? 400 {
    case ..<350: .light
    case ..<450: .regular
    case ..<550: .medium
    case ..<650: .semibold
    case ..<750: .bold
    default: .heavy
    }
  }

  /// Every variant the theme defines, largest first, each named and with what it resolves to.
  private var ramp: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      ForEach(kit.typography) { rung in
        HStack(alignment: .firstTextBaseline) {
          Text(rung.key).font(.system(size: rung.sizePx, weight: weight(rung))).foregroundStyle(ink).lineLimit(1)
          Spacer(minLength: AglynSpace.one)
          Text("\(rung.raw) · \(rung.weight.map(String.init) ?? "")").font(AglynFont.caption).foregroundStyle(color(kit.text.disabled))
        }
      }
      (Text("Body copy shows the font family, size, and text colors. ") + Text("A link").foregroundColor(color(kit.primary.main))
        + Text(" sits inline with the text."))
        .foregroundStyle(ink)
    }
  }

  private func filled(_ label: String, _ accent: ThemePreviewAccent) -> some View {
    Text(label).font(AglynFont.subheadline.weight(.semibold)).padding(.horizontal, AglynSpace.oneAndHalf).padding(.vertical, AglynSpace.one)
      .foregroundStyle(color(accent.contrastText)).background(color(accent.main), in: shape)
  }

  private func chips(_ entries: [(String, ThemePreviewAccent)]) -> some View {
    HStack(spacing: AglynSpace.half) {
      ForEach(entries, id: \.0) { label, accent in
        Text(label).font(AglynFont.caption).padding(.horizontal, AglynSpace.one).padding(.vertical, AglynSpace.half)
          .foregroundStyle(color(accent.contrastText)).background(color(accent.main), in: Capsule())
      }
    }
  }

  private func tile(_ label: String, _ fill: String, _ inkCSS: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label).font(AglynFont.subheadline.weight(.semibold))
      Text("tint.\(label.lowercased())").font(AglynFont.caption)
    }
    .foregroundStyle(color(inkCSS))
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(AglynSpace.oneAndHalf)
    .background(color(fill), in: shape)
  }

  private func alert(_ text: String, _ accent: ThemePreviewAccent) -> some View {
    Text(text).font(AglynFont.subheadline).foregroundStyle(color(accent.dark))
      .frame(maxWidth: .infinity, alignment: .leading).padding(AglynSpace.oneAndHalf)
      .overlay(shape.strokeBorder(color(accent.main)))
  }
}
