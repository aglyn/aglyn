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
      // A long queue scrolls in its own band instead of pushing the product grid off the screen.
      ViewThatFits(in: .vertical) {
        zone(widgets)
        ScrollView { zone(widgets) }
      }
      .frame(maxHeight: 320)
      .accessibilityIdentifier("pos-orders-zone")
    }
  }

  private func zone(_ widgets: [NativeWidget]) -> some View {
    VStack(spacing: 0) {
      ForEach(widgets) { $0.make(context) }
    }
  }
}
