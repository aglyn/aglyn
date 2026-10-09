// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// A small figure for a detail page's numbers row: a label, the figure, a
/// caption (the Kotlin kit's `StatTile`). Lighter than a dashboard
/// `MetricCard`, and not a button.
public struct AglynFigureTile: View {
  let label: String
  let value: String
  let caption: String?

  public init(_ label: String, value: String, caption: String? = nil) {
    self.label = label
    self.value = value
    self.caption = caption
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      Text(label).font(AglynFont.strongSubheadline).foregroundStyle(.secondary).lineLimit(1)
      Text(value).font(AglynFont.title2).monospacedDigit()
      if let caption {
        Text(caption).font(AglynFont.caption).foregroundStyle(.secondary).lineLimit(2)
      }
    }
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .padding(AglynSpace.oneAndHalf)
    .background(AglynColor.page, in: RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
    .accessibilityElement(children: .combine)
  }
}

/// A row of short items that wraps onto the next line when it runs out of
/// width: status chips, a pair of buttons.
public struct AglynWrapRow: Layout {
  let spacing: CGFloat
  let lineSpacing: CGFloat

  public init(spacing: CGFloat = AglynSpace.one, lineSpacing: CGFloat = AglynSpace.one) {
    self.spacing = spacing
    self.lineSpacing = lineSpacing
  }

  private func lines(_ width: CGFloat, _ subviews: Subviews) -> [[(Int, CGSize)]] {
    var lines: [[(Int, CGSize)]] = [[]]
    var x: CGFloat = 0
    for (index, subview) in subviews.enumerated() {
      let size = subview.sizeThatFits(.unspecified)
      if x > 0 && x + size.width > width {
        lines.append([])
        x = 0
      }
      lines[lines.count - 1].append((index, size))
      x += size.width + spacing
    }
    return lines
  }

  public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    let rows = lines(width, subviews)
    // Plain loops: the chained map/reduce form took Xcode 26's type checker
    // past its time limit on GitHub's macOS image (AGL-3709).
    var height: CGFloat = 0
    var used: CGFloat = 0
    for row in rows {
      var rowHeight: CGFloat = 0
      var rowWidth: CGFloat = 0
      for (_, size) in row {
        rowHeight = max(rowHeight, size.height)
        rowWidth += size.width
      }
      if row.count > 1 { rowWidth += spacing * CGFloat(row.count - 1) }
      height += rowHeight
      used = max(used, rowWidth)
    }
    if rows.count > 1 { height += lineSpacing * CGFloat(rows.count - 1) }
    return CGSize(width: proposal.width ?? used, height: height)
  }

  public func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for row in lines(bounds.width, subviews) {
      var x = bounds.minX
      let height = row.map(\.1.height).max() ?? 0
      for (index, size) in row {
        subviews[index].place(
          at: CGPoint(x: x, y: y + (height - size.height) / 2), proposal: ProposedViewSize(size))
        x += size.width + spacing
      }
      y += height + lineSpacing
    }
  }
}
