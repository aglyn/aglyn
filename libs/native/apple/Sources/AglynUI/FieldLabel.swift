// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// A text field's name, kept in sight. An iOS grouped form draws a `TextField` with no label of its own: its name is
/// only its prompt, which goes the moment the field holds a value, so a filled form (an edited rental, a walk-in, the
/// workspace profile's contact lines) read as a column of bare values. The console's MUI fields float their label above
/// a filled value, and Figma's form fields (Business profile 365:11713, `Field/Text` 28:791) carry it above in
/// caption type, secondary text, 4 pt over the value.
public enum AglynFieldLabel {
  /// Whether a field shows its name above it: once it holds a value, or when its prompt is words of its own (a
  /// placeholder such as "Mobile dog grooming…"). An empty field whose prompt is its name says it once, inside it, as
  /// MUI's resting label does.
  public static func showsAbove(value: String, prompt: String?, label: String) -> Bool {
    guard !label.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
    if !value.isEmpty { return true }
    guard let prompt, !prompt.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
    return prompt != label
  }
}

extension View {
  /// The field's `label` above it while `AglynFieldLabel.showsAbove` says so, on iOS. A plain form (`aglynPlainForm`)
  /// already labels its rows on the leading edge, and the Mac's form labels its fields itself, so neither adds one.
  public func aglynFieldLabel(_ label: String, value: String, prompt: String? = nil) -> some View {
    modifier(AglynFieldLabelModifier(label: label, value: value, prompt: prompt))
  }
}

private struct AglynFieldLabelModifier: ViewModifier {
  @Environment(\.aglynPlainForm) private var plain
  let label: String
  let value: String
  let prompt: String?

  private var shows: Bool {
    #if os(iOS)
      !plain && AglynFieldLabel.showsAbove(value: value, prompt: prompt, label: label)
    #else
      false
    #endif
  }

  func body(content: Content) -> some View {
    // The field keeps its place whether or not the label is drawn, so typing the first character never moves focus.
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      if shows {
        Text(label).font(AglynFont.caption).foregroundStyle(.secondary).accessibilityHidden(true)
      }
      content
    }
  }
}
