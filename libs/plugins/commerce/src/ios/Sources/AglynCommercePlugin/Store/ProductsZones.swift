// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynUI
import SwiftUI

/// The Products page's zones, the console's `productsCreate` (another way to start a product, beside Add product)
/// and `productsHub` (above the catalog: proposals the hub writes). The plugins that put a widget here are never
/// named; each zone draws whatever the registry holds for it, and nothing when no plugin contributes.
let commerceProductsCreateSlot = "productsCreate"
let commerceProductsHubSlot = "productsHub"

struct ProductsZone: View {
  let context: NativePluginContext
  let slot: String

  var body: some View {
    let widgets = context.slotWidgets(slot)
    if !widgets.isEmpty {
      VStack(spacing: AglynSpace.one) {
        ForEach(widgets) { $0.make(context) }
      }
      .aglynContentEdges()
      .accessibilityIdentifier("products-zone-\(slot)")
    }
  }
}
