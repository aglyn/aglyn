// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// One column of a board: its key, heading, a figure under it (a total), and its cards.
public struct BoardColumn<Item: Identifiable>: Identifiable {
  public let id: String
  public let title: String
  public let caption: String?
  public let items: [Item]

  public init(id: String, title: String, caption: String? = nil, items: [Item]) {
    self.id = id
    self.title = title
    self.caption = caption
    self.items = items
  }
}

/// A board of columns side by side that scrolls sideways (a pipeline's
/// stages); each column scrolls its own cards. The Kotlin kit's `Board`.
public struct AglynBoard<Item: Identifiable, Card: View>: View {
  @Environment(\.dynamicTypeSize) private var typeSize
  let columns: [BoardColumn<Item>]
  let emptyColumn: String
  let card: (BoardColumn<Item>, Item) -> Card

  public init(
    columns: [BoardColumn<Item>], emptyColumn: String = "Nothing here",
    @ViewBuilder card: @escaping (BoardColumn<Item>, Item) -> Card
  ) {
    self.columns = columns
    self.emptyColumn = emptyColumn
    self.card = card
  }

  private var columnWidth: CGFloat { typeSize.isAccessibilitySize ? 380 : 290 }

  public var body: some View {
    ScrollView(.horizontal) {
      HStack(alignment: .top, spacing: AglynSpace.two) {
        ForEach(columns) { column in
          VStack(alignment: .leading, spacing: AglynSpace.one) {
            HStack {
              Text(column.title).font(AglynFont.headline).lineLimit(1)
                .accessibilityAddTraits(.isHeader)
              Spacer()
              StatusChip("\(column.items.count)")
            }
            if let caption = column.caption {
              Text(caption).font(AglynFont.caption).foregroundStyle(.secondary)
            }
            ScrollView(.vertical) {
              LazyVStack(spacing: AglynSpace.one) {
                if column.items.isEmpty {
                  Text(emptyColumn).font(AglynFont.caption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, AglynSpace.one)
                }
                ForEach(column.items) { item in card(column, item) }
              }
            }
          }
          .padding(AglynSpace.two)
          .frame(width: columnWidth, alignment: .top)
          .frame(maxHeight: .infinity, alignment: .top)
          .background(AglynColor.paper, in: RoundedRectangle(cornerRadius: AglynRadius.card, style: .continuous))
          .accessibilityElement(children: .contain)
          .accessibilityLabel("\(column.title), \(column.items.count)")
          .accessibilityIdentifier("board-column-\(column.id)")
        }
      }
      .padding(AglynSpace.two)
    }
    .background(AglynColor.page)
  }
}
