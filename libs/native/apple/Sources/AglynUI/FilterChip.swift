// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// A filter that is on, as a chip under a list's toolbar (Figma Chip/Filter, AGL-3966): its words ("Status: Unfulfilled")
/// on the accent's soft fill, and an × that turns it off. Lists show these only once a filter is on (Calm rule 3).
public struct AglynFilterChip: View {
  let label: String
  let remove: () -> Void

  public init(_ label: String, remove: @escaping () -> Void) {
    self.label = label
    self.remove = remove
  }

  public var body: some View {
    Button(action: remove) {
      HStack(spacing: 6) {
        Text(label)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(AglynColor.textPrimary)
          .lineLimit(1)
        Image(systemName: "xmark")
          .font(.system(size: 9, weight: .bold))
          .foregroundStyle(AglynColor.secondaryText)
          .frame(width: 12, height: 12)
      }
      .padding(.leading, 10)
      .padding(.trailing, 8)
      .frame(height: 24)
      .background(Capsule().fill(AglynColor.accentSoft))
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Remove filter \(label)")
  }
}
