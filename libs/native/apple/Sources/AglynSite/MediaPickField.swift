// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// A picture or film chosen from the media library, the way the console's
/// fields do: a preview, Choose from media (this site's files and the
/// workspace's), and Remove. A stored reference is not shown as text; nobody
/// edits one by hand. `onLink` adds "Use a link instead" for a file hosted
/// elsewhere (the console keeps that beside the picker for entry covers).
public struct MediaPickField: View {
  let context: NativePluginContext
  let label: String
  let value: String
  let kind: String
  let enabled: Bool
  let workspaceOnly: Bool
  let supporting: String?
  let onPick: (ChosenMedia) -> Void
  let onClear: () -> Void
  let onLink: ((String) -> Void)?
  @State private var choosing = false
  @State private var linkOpen: Bool

  /// `workspaceOnly` offers the workspace's library alone, whichever site is picked (a workspace's own logo or favicon).
  public init(
    context: NativePluginContext, label: String, value: String, kind: String = "image", enabled: Bool = true,
    workspaceOnly: Bool = false, supporting: String? = nil, onPick: @escaping (ChosenMedia) -> Void,
    onClear: @escaping () -> Void, onLink: ((String) -> Void)? = nil
  ) {
    self.context = context
    self.label = label
    self.value = value
    self.kind = kind
    self.enabled = enabled
    self.workspaceOnly = workspaceOnly
    self.supporting = supporting
    self.onPick = onPick
    self.onClear = onClear
    self.onLink = onLink
    _linkOpen = State(initialValue: value.hasPrefix("https://"))
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      Text(label).font(AglynFont.caption).foregroundStyle(.secondary)
      HStack(spacing: AglynSpace.two) {
        preview
          .frame(width: 96, height: 72)
          .clipShape(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
          .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          Button(value.isEmpty ? "Choose from media" : "Replace from media") { choosing = true }
            .buttonStyle(.aglynSecondary)
            .disabled(!enabled)
            .accessibilityIdentifier("media-pick-choose")
          if !value.isEmpty {
            Button("Remove", role: .destructive) {
              onClear()
              linkOpen = false
            }
            .buttonStyle(.borderless)
            .disabled(!enabled)
            .accessibilityIdentifier("media-pick-remove")
          }
        }
      }
      if let supporting { Text(supporting).font(AglynFont.caption).foregroundStyle(.secondary) }
      if let onLink {
        if linkOpen {
          // A picked file is a reference, not a link: the box stays empty for it rather than showing a value nobody edits by hand.
          TextField(
            "Link (https://)",
            text: Binding(
              get: { value.hasPrefix("https://") || value.isEmpty ? value : "" },
              set: { onLink($0.trimmingCharacters(in: .whitespaces)) })
          )
          .autocorrectionDisabled()
          .disabled(!enabled)
          #if os(iOS)
            .textInputAutocapitalization(.never)
            .keyboardType(.URL)
          #endif
          Text("A \(kind == "video" ? "video" : "picture") hosted on another website, starting with https://")
            .font(AglynFont.caption).foregroundStyle(.secondary)
        } else {
          Button("Use a link instead") { linkOpen = true }
            .buttonStyle(.borderless).font(AglynFont.caption)
            .disabled(!enabled)
        }
      }
    }
    .sheet(isPresented: $choosing) {
      MediaChooserSheet(context: context, kind: kind, workspaceOnly: workspaceOnly) { chosen in
        linkOpen = false
        onPick(chosen)
      }
    }
  }

  @ViewBuilder
  private var preview: some View {
    if kind == "video" {
      VStack(spacing: AglynSpace.half) {
        Image(systemName: "film")
        Text(value.isEmpty ? "No video" : parseMediaRef(value) != nil ? "From your media" : "Linked video")
          .font(AglynFont.caption)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color.secondary.opacity(0.12))
    } else {
      AglynRemoteImage(mediaPreviewURL(value, origin: context.api.origin, hostID: context.hostID), systemImage: "photo")
    }
  }
}

/// A picture field that stores the pick's reference as its value.
public struct MediaImageField: View {
  let context: NativePluginContext
  let label: String
  @Binding var value: String
  let enabled: Bool
  let supporting: String?

  public init(
    context: NativePluginContext, label: String, value: Binding<String>, enabled: Bool = true, supporting: String? = nil
  ) {
    self.context = context
    self.label = label
    _value = value
    self.enabled = enabled
    self.supporting = supporting
  }

  public var body: some View {
    MediaPickField(
      context: context, label: label, value: value, enabled: enabled, supporting: supporting,
      onPick: { value = $0.reference }, onClear: { value = "" })
  }
}
