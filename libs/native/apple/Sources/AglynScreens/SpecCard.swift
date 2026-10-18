// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynUI
import SwiftUI

/// A spec screen's `cardSlot` card: one row, named and pictured as the screen is, that opens it. The screen is opened with the
/// plugin's id as `pluginId`, as a plugin's settings page opens its screens, so a `requires` of `params.pluginId == <plugin>`
/// holds from either door.
struct SpecCard: View {
  let spec: ScreenSpec
  let pluginID: String
  let context: NativePluginContext

  var body: some View {
    Button {
      context.navigate(spec.id, ["pluginId": pluginID])
    } label: {
      AglynRow(spec.label, subtitle: spec.subtitle, systemImage: spec.icon) {
        Image(systemName: "chevron.forward").font(.caption).foregroundStyle(.tertiary)
      }
    }
    .buttonStyle(.aglynRow)
    .accessibilityIdentifier("spec-card-\(spec.id)")
  }
}
