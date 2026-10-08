// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// One choice in an `AglynChipRow`.
public struct AglynChipOption: Identifiable, Hashable, Sendable {
  public let id: String
  public let label: String
  public let systemImage: String?

  public init(_ id: String, _ label: String, systemImage: String? = nil) {
    self.id = id
    self.label = label
    self.systemImage = systemImage
  }
}

/// A row of single-choice filter chips above a list, scrolling sideways
/// when it outgrows the width ("All", "Custom domain", a file type).
public struct AglynChipRow: View {
  let options: [AglynChipOption]
  let selected: String
  let onSelect: (String) -> Void

  public init(_ options: [AglynChipOption], selected: String, onSelect: @escaping (String) -> Void) {
    self.options = options
    self.selected = selected
    self.onSelect = onSelect
  }

  public var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: AglynSpace.one) {
        ForEach(options) { option in
          AglynChoiceChip(option.label, systemImage: option.systemImage, selected: option.id == selected) {
            onSelect(option.id)
          }
          .accessibilityIdentifier("chip-\(option.id)")
        }
      }
      .padding(.horizontal, AglynSpace.two)
      .padding(.vertical, AglynSpace.one)
    }
    .sensoryFeedback(.selection, trigger: selected)
  }
}

/// A label and a value on one line in a form or detail card; a missing value
/// reads as `placeholder`, muted.
public struct AglynDetailRow: View {
  let title: String
  let value: String?
  let placeholder: String

  public init(_ title: String, value: String?, placeholder: String = "—") {
    self.title = title
    self.value = value
    self.placeholder = placeholder
  }

  public var body: some View {
    LabeledContent(title) {
      Text(value ?? placeholder)
        .foregroundStyle(value == nil ? .secondary : .primary)
        .multilineTextAlignment(.trailing)
        .textSelection(.enabled)
    }
  }
}

/// A list's "more below" footer: loads the next page when it scrolls into
/// view, and is a button for VoiceOver and keyboards.
public struct AglynLoadMoreRow: View {
  let title: String
  let action: () -> Void

  public init(_ title: String = "Show more", action: @escaping () -> Void) {
    self.title = title
    self.action = action
  }

  public var body: some View {
    Button(action: action) {
      HStack(spacing: AglynSpace.one) {
        ProgressView().controlSize(.small)
        Text(title)
      }
      .frame(maxWidth: .infinity)
    }
    .buttonStyle(.borderless)
    .onAppear(perform: action)
  }
}

/// An indented row in a tree list (a page inside a group): `depth` steps in.
public struct AglynTreeIndent<Content: View>: View {
  let depth: Int
  let content: Content

  public init(depth: Int, @ViewBuilder content: () -> Content) {
    self.depth = depth
    self.content = content()
  }

  public var body: some View {
    HStack(spacing: 0) {
      if depth > 0 {
        Color.clear.frame(width: CGFloat(min(depth, 6)) * AglynSpace.two).accessibilityHidden(true)
      }
      content
    }
  }
}
