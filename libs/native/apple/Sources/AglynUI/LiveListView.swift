// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// A live list's four states in one view: skeleton rows while it loads, why
/// it failed (with Try again), an empty state, or its rows with Show more
/// while the reader says more are there. The Kotlin kit's `LiveListPane`.
public struct AglynLiveList<Row: Identifiable, RowView: View>: View {
  let rows: [Row]
  let ready: Bool
  let failure: String?
  let hasMore: Bool
  let failedTitle: String
  let emptyTitle: String
  let emptyMessage: String?
  let systemImage: String
  let onMore: () -> Void
  let onRetry: () -> Void
  let row: (Row) -> RowView

  public init(
    rows: [Row], ready: Bool, failure: String?, hasMore: Bool,
    failedTitle: String = "Could not load this list", emptyTitle: String, emptyMessage: String? = nil, systemImage: String,
    onMore: @escaping () -> Void, onRetry: @escaping () -> Void, @ViewBuilder row: @escaping (Row) -> RowView
  ) {
    self.rows = rows
    self.ready = ready
    self.failure = failure
    self.hasMore = hasMore
    self.failedTitle = failedTitle
    self.emptyTitle = emptyTitle
    self.emptyMessage = emptyMessage
    self.systemImage = systemImage
    self.onMore = onMore
    self.onRetry = onRetry
    self.row = row
  }

  public var body: some View {
    if !ready {
      List { SkeletonRows(count: 6) }.aglynListBackground()
    } else if let failure {
      AglynEmptyState(failedTitle, systemImage: "exclamationmark.triangle", message: failure) {
        Button("Try again", action: onRetry)
      }
    } else if rows.isEmpty {
      AglynEmptyState(emptyTitle, systemImage: systemImage, message: emptyMessage)
    } else {
      List {
        ForEach(rows) { item in row(item).aglynListRow() }
        if hasMore {
          Button("Show more", action: onMore).frame(maxWidth: .infinity)
        }
      }
      .refreshable { onRetry() }
      .aglynListBackground()
    }
  }
}

/// The console's section rail as a row of chips: one per section, the picked one filled.
public struct AglynSectionBar<Section: Hashable & Identifiable>: View {
  let sections: [Section]
  @Binding var selection: Section
  let label: (Section) -> String
  let systemImage: (Section) -> String

  public init(
    _ sections: [Section], selection: Binding<Section>, label: @escaping (Section) -> String,
    systemImage: @escaping (Section) -> String
  ) {
    self.sections = sections
    self._selection = selection
    self.label = label
    self.systemImage = systemImage
  }

  public var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: AglynSpace.one) {
        ForEach(sections) { item in
          AglynChoiceChip(label(item), systemImage: systemImage(item), selected: selection == item) { selection = item }
        }
      }
      .padding(.horizontal, AglynSpace.two)
      .padding(.vertical, AglynSpace.one)
    }
    .accessibilityIdentifier("section-bar")
  }
}
