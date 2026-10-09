// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Charts
import SwiftUI

/// One bar: its value, its label on the axis (or empty), and what VoiceOver reads.
public struct AglynBar: Identifiable, Hashable, Sendable {
  public let id: String
  public let value: Double
  public let label: String
  public let spoken: String

  public init(id: String, value: Double, label: String = "", spoken: String) {
    self.id = id
    self.value = value
    self.label = label
    self.spoken = spoken
  }
}

/// A row of bars over time (a day each), in the brand tint, with the last
/// one emphasized when asked. Swift Charts, so it scales, reads each bar to
/// VoiceOver, and follows light and dark. The Kotlin kit's `TrendBars`.
public struct AglynBarChart: View {
  let bars: [AglynBar]
  let highlightLast: Bool
  let height: CGFloat

  public init(_ bars: [AglynBar], highlightLast: Bool = false, height: CGFloat = 140) {
    self.bars = bars
    self.highlightLast = highlightLast
    self.height = height
  }

  public var body: some View {
    Chart(Array(bars.enumerated()), id: \.element.id) { index, bar in
      BarMark(x: .value("Day", bar.id), y: .value("Value", bar.value))
        .foregroundStyle(highlightLast && index == bars.count - 1 ? AglynColor.primary : AglynColor.primary.opacity(bar.value == 0 ? 0.2 : 0.7))
        .cornerRadius(3)
        .accessibilityLabel(bar.spoken)
    }
    .chartXAxis {
      AxisMarks(values: bars.filter { !$0.label.isEmpty }.map(\.id)) { value in
        AxisValueLabel {
          if let id = value.as(String.self) { Text(bars.first { $0.id == id }?.label ?? "") }
        }
      }
    }
    .frame(height: height)
  }
}
