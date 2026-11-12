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
  let identifier: String

  public init(
    _ sections: [Section], selection: Binding<Section>, label: @escaping (Section) -> String,
    systemImage: @escaping (Section) -> String, identifier: String = "section-bar"
  ) {
    self.sections = sections
    self._selection = selection
    self.label = label
    self.systemImage = systemImage
    self.identifier = identifier
  }

  public var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: AglynSpace.one) {
        ForEach(sections) { item in
          AglynChoiceChip(label(item), systemImage: systemImage(item), selected: selection == item) { selection = item }
        }
      }
      .aglynContentEdges()
      .padding(.vertical, AglynSpace.one)
    }
    .accessibilityIdentifier(identifier)
  }
}

/// A hub with the console's sections (CRM, Emails, Marketing, Sequences): its section bar across the top, then the picked
/// section. When the picked section is a list beside its detail that took the area's head into its list column on the
/// Mac and iPad (`aglynColumnHeadOffer`, Figma 13:483), the sections go there too, under the area's title like every
/// other area's (`AglynAreaSectionChips`), and the bar across the top steps aside: never chips over the title.
public struct AglynSectionHub<Section: Hashable & Identifiable, Content: View>: View {
  @Environment(\.aglynColumnHeadOffer) private var offer
  /// The picked section's list column drew the head (and so these sections).
  @State private var sectionsInColumn = false
  let sections: [Section]
  @Binding var selection: Section
  let label: (Section) -> String
  let systemImage: (Section) -> String
  let identifier: String
  let content: Content

  public init(
    _ sections: [Section], selection: Binding<Section>, label: @escaping (Section) -> String,
    systemImage: @escaping (Section) -> String, identifier: String = "section-bar", @ViewBuilder content: () -> Content
  ) {
    self.sections = sections
    self._selection = selection
    self.label = label
    self.systemImage = systemImage
    self.identifier = identifier
    self.content = content()
  }

  public var body: some View {
    VStack(spacing: 0) {
      if offer == nil || !sectionsInColumn {
        AglynSectionBar(sections, selection: $selection, label: label, systemImage: systemImage, identifier: identifier)
      }
      content
        .environment(\.aglynColumnHeadOffer, offer?.withSections(areaSections))
        .onPreferenceChange(AglynListColumnHeadPlacedKey.self) { sectionsInColumn = $0 }
    }
  }

  private var areaSections: [AglynAreaSection] {
    let binding = $selection
    return sections.map { item in
      AglynAreaSection(id: "\(item.id)", label: label(item), selected: item == selection) { binding.wrappedValue = item }
    }
  }
}
