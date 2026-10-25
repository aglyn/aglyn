// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

// The figures of a stats card (Figma "Homestats components (AGL-4011)": Stat/Tile, Top list/Row): the console's traffic
// card's `StatTile` and `TopList`, shared by Home, Analytics and a page's detail on every Apple screen size. The Kotlin
// kit's `Stats.kt` draws the same parts.

/// How a delta beside a figure reads: up is good, down is bad, flat is neither (the console's `+12% vs prior`).
public enum AglynDeltaTone: Sendable {
  case up, down, flat
}

/// One measurement: the figure, a delta on its baseline when there is one, and the label that says what was measured.
/// A note under the label says how it was counted (`today or overdue`).
public struct AglynStatTile: View {
  let value: String?
  let label: String
  let delta: String?
  let deltaTone: AglynDeltaTone
  let note: String?
  let help: String?
  let valueColor: Color?

  /// `value` nil draws the loading placeholder. `valueColor` tints the figure alone (an overdue count in the error color).
  public init(
    _ value: String?, label: String, delta: String? = nil, deltaTone: AglynDeltaTone = .flat, note: String? = nil,
    help: String? = nil, valueColor: Color? = nil
  ) {
    self.valueColor = valueColor
    self.value = value
    self.label = label
    self.delta = delta
    self.deltaTone = deltaTone
    self.note = note
    self.help = help
  }

  private var deltaColor: Color {
    switch deltaTone {
    case .up: AglynColor.success
    case .down: AglynColor.error
    case .flat: AglynColor.secondary
    }
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.of(0.25)) {
      Text(value ?? "000").font(AglynFont.title2.weight(.semibold)).monospacedDigit().lineLimit(1).truncationMode(.middle)
        .foregroundStyle(valueColor ?? AglynColor.textPrimary)
        .redacted(reason: value == nil ? .placeholder : [])
      Text(label).font(AglynFont.caption).foregroundStyle(.secondary).lineLimit(1)
      if let delta {
        Text(delta).font(AglynFont.caption.weight(.semibold)).foregroundStyle(deltaColor).lineLimit(1)
      }
      if let note {
        Text(note).font(AglynFont.caption).foregroundStyle(.secondary).lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .help(help ?? "")
    .accessibilityElement(children: .combine)
  }
}

/// A ranked breakdown: a title and its rows, each a label and its count. Draws nothing without rows, as the console's
/// `TopList` does (an empty "Top campaigns" reads as a list that failed to load).
public struct AglynTopList: View {
  let title: String
  let rows: [(label: String, count: String)]

  public init(_ title: String, rows: [(label: String, count: String)]) {
    self.title = title
    self.rows = rows
  }

  public var body: some View {
    if !rows.isEmpty {
      VStack(alignment: .leading, spacing: AglynSpace.half) {
        Text(title).font(AglynFont.strongSubheadline)
        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
          HStack(spacing: AglynSpace.one) {
            Text(row.label).lineLimit(1).truncationMode(.middle)
            Spacer(minLength: AglynSpace.one)
            Text(row.count).foregroundStyle(.secondary).monospacedDigit()
          }
          .font(AglynFont.subheadline)
          .accessibilityElement(children: .combine)
        }
      }
      .frame(maxWidth: .infinity, alignment: .topLeading)
    }
  }
}

/// The range a stats card reads, as the console's selector words it: `7 days` … `90 days`, one segmented control.
public struct AglynRangePicker: View {
  @Binding var days: Int
  let choices: [Int]

  public init(days: Binding<Int>, choices: [Int]) {
    _days = days
    self.choices = choices
  }

  public var body: some View {
    Picker("Range", selection: $days) {
      ForEach(choices, id: \.self) { Text("\($0) days").tag($0) }
    }
    .pickerStyle(.segmented)
    .labelsHidden()
    .fixedSize()
    .accessibilityLabel("Range")
  }
}

/// A stats section on a dashboard: its title, the controls on the right (a range, View details), then its card.
public struct AglynStatsSection<Accessory: View, Content: View>: View {
  let title: String
  let accessory: Accessory
  let content: Content

  public init(_ title: String, @ViewBuilder accessory: () -> Accessory, @ViewBuilder content: () -> Content) {
    self.title = title
    self.accessory = accessory()
    self.content = content()
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.oneAndHalf) {
      ViewThatFits(in: .horizontal) {
        HStack(alignment: .center, spacing: AglynSpace.two) {
          Text(title).font(AglynFont.headline).accessibilityAddTraits(.isHeader)
          Spacer(minLength: AglynSpace.one)
          accessory
        }
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          Text(title).font(AglynFont.headline).accessibilityAddTraits(.isHeader)
          accessory
        }
      }
      VStack(alignment: .leading, spacing: AglynSpace.two) { content }
        .padding(AglynSpace.two)
        .frame(maxWidth: .infinity, alignment: .leading)
        .aglynCardSurface()
    }
  }
}

extension View {
  /// A card standing in a form as its own block: no row background, inset or separator of the form's own, so the card
  /// draws its surface once (Home's and Analytics' cards inside a page's detail form).
  public func aglynBareFormRow() -> some View {
    listRowBackground(Color.clear)
      .listRowInsets(EdgeInsets())
      .listRowSeparator(.hidden)
  }
}
