// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import SwiftUI

/// The register's zone for what other channels send to the counter (AGL-3644): a delivery app's orders, say, waiting to
/// be accepted, made and handed over. The console register hosts the same `posOrders` zone above its product grid.
/// The plugins that put a widget here are never named; the zone draws whatever the POS app's registry holds for it,
/// above the till, and nothing when no plugin contributes (or a contribution draws nothing).
let commercePosOrdersSlot = "posOrders"

struct PosOrdersZone: View {
  let context: NativePluginContext

  var body: some View {
    let widgets = context.slotWidgets(commercePosOrdersSlot)
    if !widgets.isEmpty {
      // A long queue scrolls in its own band instead of pushing the product grid off the screen. The band is as tall
      // as what the widgets draw, so a widget that draws nothing (no delivery service connected) leaves no gap.
      HeightCap(320) {
        ViewThatFits(in: .vertical) {
          zone(widgets)
          ScrollView { zone(widgets) }
        }
      }
      .accessibilityIdentifier("pos-orders-zone")
    }
  }

  private func zone(_ widgets: [NativeWidget]) -> some View {
    VStack(spacing: 0) {
      ForEach(widgets) { $0.make(context) }
    }
  }
}

/// Proposes at most `limit` points of height and takes the height its content chooses. `.frame(maxHeight:)` would
/// instead grow to the limit whenever the parent offers more, even around content that draws nothing.
private struct HeightCap: Layout {
  let limit: CGFloat

  init(_ limit: CGFloat) { self.limit = limit }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard let content = subviews.first else { return .zero }
    return content.sizeThatFits(ProposedViewSize(width: proposal.width, height: min(proposal.height ?? limit, limit)))
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size))
  }
}
