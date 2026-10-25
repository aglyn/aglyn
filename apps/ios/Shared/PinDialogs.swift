// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

// The small choices pins and colors ask for (AGL-3945, Figma Menus 2:4): "Pinned is full. Replace one?", the one-time
// "Keep which 5 pins?", and a workspace's color. Nothing is ever dropped quietly.

/// A sixth pin: which of the five it replaces.
struct PinnedFullSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let pending: PendingPin
  @State private var replacing: String?

  var body: some View {
    let pins = model.preferences?.pinned ?? []
    NavigationStack {
      Form {
        Section {
          Text("You can pin five workspaces. Pick one to make room for \(pending.name).")
            .foregroundStyle(.secondary)
        }
        Section {
          ForEach(Array(pins.enumerated()), id: \.element) { index, orgID in
            Button {
              replacing = orgID
            } label: {
              HStack(spacing: 10) {
                Image(systemName: replacing == orgID ? "largecircle.fill.circle" : "circle")
                  .foregroundStyle(replacing == orgID ? AglynColor.tint : AglynColor.secondaryText)
                PinTile(orgID: orgID, size: 24)
                Text(name(orgID)).frame(maxWidth: .infinity, alignment: .leading)
                Text("⌘\(index + 1)").font(AglynFont.caption).foregroundStyle(.secondary)
              }
              .contentShape(Rectangle())
            }
            .buttonStyle(.aglynRow)
            .accessibilityAddTraits(replacing == orgID ? .isSelected : [])
            .accessibilityIdentifier("replace-pin-\(orgID)")
          }
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Pinned is full. Replace one?")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button(replacing.map { "Replace \(name($0))" } ?? "Replace") {
            if let replacing { model.preferences?.replacePin(replacing, with: pending.orgID) }
            dismiss()
          }
          .disabled(replacing == nil)
          .accessibilityIdentifier("replace-pin-confirm")
        }
      }
    }
    .aglynSheetMinimumSize(width: 440, height: 420)
    .task { model.workspace?.loadOrgs(pins) }
  }

  private func name(_ orgID: String) -> String { model.workspace?.orgs.first { $0.id == orgID }?.name ?? "A workspace" }
}

/// Asked once of an account that pinned more than five before the cap: which five stay pinned. Until it answers, the
/// first five are the pins.
struct KeepPinsSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var keep: [String] = []

  var body: some View {
    let stored = model.preferences?.storedPins ?? []
    let cap = ContractValues.shared.pinnedOrgsMax
    NavigationStack {
      Form {
        Section {
          Text(
            "Pins are now limited to five, here and in the console. You have \(stored.count) pinned workspaces. The ones you leave out stay in All workspaces."
          )
          .foregroundStyle(.secondary)
        }
        Section {
          ForEach(stored, id: \.self) { orgID in
            let on = keep.contains(orgID)
            Toggle(isOn: Binding(get: { on }, set: { toggle(orgID, $0) })) {
              HStack(spacing: 10) {
                PinTile(orgID: orgID, size: 24)
                Text(model.workspace?.orgs.first { $0.id == orgID }?.name ?? "A workspace")
              }
            }
            .toggleStyle(.aglynCheckbox)
            .disabled(!on && keep.count >= cap)
            .accessibilityIdentifier("keep-pin-\(orgID)")
          }
        } footer: {
          Text("\(keep.count) of \(cap) chosen")
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Keep which 5 pins?")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Keep these \(keep.count)") {
            model.preferences?.keepPins(keep)
            dismiss()
          }
          .disabled(keep.isEmpty)
          .accessibilityIdentifier("keep-pins-confirm")
        }
      }
    }
    .interactiveDismissDisabled()
    .aglynSheetMinimumSize(width: 440, height: 520)
    .onAppear {
      keep = Array(stored.prefix(cap))
      model.workspace?.loadOrgs(stored)
    }
  }

  private func toggle(_ orgID: String, _ on: Bool) {
    if on { if !keep.contains(orgID) && keep.count < ContractValues.shared.pinnedOrgsMax { keep.append(orgID) } }
    else { keep.removeAll { $0 == orgID } }
  }
}

/// A workspace's tile at a small size, for the pin lists.
struct PinTile: View {
  @Environment(AppModel.self) private var model
  let orgID: String
  var size: CGFloat = 24

  var body: some View {
    let logo = model.workspace?.orgLogos[orgID]
    let name = model.workspace?.orgs.first { $0.id == orgID }?.name ?? "?"
    AglynWorkspaceTile(
      name: name, logoURL: model.mediaURL(logo?.light, hostID: nil),
      darkLogoURL: model.mediaURL(logo?.dark, hostID: nil), colorHex: model.workspaceColor(orgID).color, selected: false,
      size: size, initials: workspaceInitial(name))
  }
}

/// A workspace's color: Automatic (its brand color, else one from its logo), a swatch, or any color. Synced on the
/// account; only the person sees their pick.
struct WorkspaceColorSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let target: ColorPickTarget
  @State private var custom = Color.clear

  var body: some View {
    let picked = model.preferences?.workspaceColors[target.orgID]
    let automatic = resolveWorkspaceColor(
      picked: nil, brandColor: model.workspace?.orgLogos[target.orgID]?.brandColor, logoColor: nil, useWorkspaceBrand: true)
    NavigationStack {
      Form {
        Section {
          HStack(spacing: 8) {
            Button { set(nil) } label: { AglynColorSwatch(hex: nil, selected: picked == nil) }
              .buttonStyle(.plain)
              .accessibilityLabel("Automatic")
              .accessibilityIdentifier("workspace-color-automatic")
            ForEach(AglynWorkspaceSwatches.all, id: \.id) { swatch in
              Button { set(swatch.hex) } label: {
                AglynColorSwatch(hex: swatch.hex, selected: picked?.uppercased() == swatch.hex)
              }
              .buttonStyle(.plain)
              .accessibilityLabel(swatch.label)
              .accessibilityIdentifier("workspace-color-\(swatch.id)")
            }
          }
          ColorPicker("Custom…", selection: $custom, supportsOpacity: false)
            .onChange(of: custom) { _, color in if let hex = color.aglynHexString { set(hex) } }
        } header: {
          Text("Your color for \(target.name)")
        } footer: {
          Text(
            automatic.source == .brand
              ? "Automatic uses the workspace's brand color. Only you see your pick."
              : "Automatic: the brand color, else a color from the logo. Only you see your pick.")
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Workspace color")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
    .aglynSheetMinimumSize(width: 420, height: 300)
    .presentationDetents([.medium])
  }

  private func set(_ hex: String?) { model.preferences?.setWorkspaceColor(hex, for: target.orgID) }
}

extension Color {
  /// `#RRGGBB` for a picked color, in sRGB.
  var aglynHexString: String? {
    #if os(iOS)
      var (r, g, b, a): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
      guard UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a), a > 0 else { return nil }
    #else
      guard let rgb = NSColor(self).usingColorSpace(.sRGB), rgb.alphaComponent > 0 else { return nil }
      let (r, g, b) = (rgb.redComponent, rgb.greenComponent, rgb.blueComponent)
    #endif
    func byte(_ value: CGFloat) -> Int { Int((min(max(value, 0), 1) * 255).rounded()) }
    return String(format: "#%02X%02X%02X", byte(r), byte(g), byte(b))
  }
}
