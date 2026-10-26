// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// A Material Design icon as a component stores it (`ReusableComponentIcon`): its id, and the SVG path it is drawn from.
public struct ComponentIcon: Equatable, Hashable, Identifiable, Sendable {
  public let id: String
  public let path: String
  public let name: String

  public init(id: String, path: String, name: String? = nil) {
    self.id = id
    self.path = path
    self.name = name ?? id
  }

  /// The `icon` field a save writes.
  public var stored: [String: Any] { ["iconId": id, "iconPath": path] }
}

/// The icon a component document carries, or nil when it has none (a cleared icon is an empty map).
func componentIcon(of doc: FirestoreDocument) -> ComponentIcon? {
  guard let raw = doc.data["icon"] as? [String: Any], let id = nonBlankText(raw["iconId"] as? String) else { return nil }
  return ComponentIcon(id: id, path: raw["iconPath"] as? String ?? "")
}

/// `GET /api/hosts/icons?search=`: the icons a picker lists for what was typed, at most sixty.
public func searchComponentIcons(_ api: ConsoleAPIClient, search: String) async throws -> [ComponentIcon] {
  let answer = try await api.request("/api/hosts/icons", query: [("search", search.trimmingCharacters(in: .whitespacesAndNewlines))])
  return (answer?["icons"]?.arrayValue ?? []).compactMap { entry in
    guard let id = entry["id"]?.stringValue else { return nil }
    return ComponentIcon(id: id, path: entry["path"]?.stringValue ?? "", name: entry["name"]?.stringValue)
  }
}

/// The icon a person picks for a component, in the details sheet: the glyph, its id and the actions to change or remove it.
struct ComponentIconField: View {
  let icon: ComponentIcon?
  let onChoose: () -> Void
  let onClear: () -> Void

  var body: some View {
    HStack {
      ZStack {
        if let icon { SvgPathIcon(icon.path, size: 28, label: icon.name) }
      }
      .frame(width: 40, height: 40)
      VStack(alignment: .leading, spacing: 2) {
        Text("Icon").font(AglynFont.caption).foregroundStyle(.secondary)
        Text(icon?.id ?? "None chosen")
      }
      Spacer()
      Button(icon == nil ? "Choose" : "Change", action: onChoose).buttonStyle(.aglynSecondary).accessibilityIdentifier("component-icon-choose")
      if icon != nil {
        Button("Remove", action: onClear).buttonStyle(.borderless).accessibilityIdentifier("component-icon-clear")
      }
    }
  }
}

/// Searches the icon set and hands back the one a person taps, as the console's picker does with Choose.
struct ComponentIconPicker: View {
  let api: ConsoleAPIClient
  let current: ComponentIcon?
  let onPick: (ComponentIcon) -> Void
  let close: () -> Void
  @State private var search = ""
  @State private var picked: ComponentIcon?
  @State private var found: [ComponentIcon]?
  @State private var failed = false

  var body: some View {
    AglynActionSheet(
      "Choose an icon", confirmLabel: "Choose", confirmEnabled: picked != nil && picked?.id != current?.id, busy: false, error: nil,
      onCancel: close,
      onConfirm: { if let picked { onPick(picked) } }
    ) {
      TextField("Search icons, such as cart or phone", text: $search)
        .autocorrectionDisabled()
        .accessibilityIdentifier("icon-search")
      if failed {
        AglynNotice("The icons could not be loaded. Check the connection and try again.", tone: .error)
      } else if let found {
        if found.isEmpty {
          Text("No icon matches that. Try another word.").foregroundStyle(.secondary)
        } else {
          ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 52), spacing: 6)], spacing: 6) {
              ForEach(found) { icon in
                Button {
                  picked = icon
                } label: {
                  SvgPathIcon(icon.path, size: 28)
                    .frame(width: 52, height: 52)
                    .background(picked?.id == icon.id ? AglynColor.primary.opacity(0.18) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(icon.name + (picked?.id == icon.id ? ", selected" : ""))
                .accessibilityIdentifier("icon-\(icon.id)")
              }
            }
          }
          .frame(maxHeight: 320)
        }
      } else {
        Text("Searching…").foregroundStyle(.secondary)
      }
      if let picked { Text("\(picked.name) (\(picked.id))").font(AglynFont.caption).foregroundStyle(.secondary) }
    }
    .onAppear { picked = current }
    // A pause after the last key, so the route is asked once per word rather than once per letter.
    .task(id: search) {
      found = nil
      failed = false
      if !search.isEmpty { try? await Task.sleep(nanoseconds: 300_000_000) }
      guard !Task.isCancelled else { return }
      do { found = try await searchComponentIcons(api, search: search) } catch is CancellationError {} catch {
        Telemetry.record(error, "site.component_icons")
        failed = true
      }
    }
  }
}
