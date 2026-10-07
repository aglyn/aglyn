// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynUI
import SwiftUI

/// The Redirects card on the dashboard: how many rules the site serves, and how many are off.
struct RedirectsSummaryWidget: View {
  let context: NativePluginContext
  @State private var model = HostRedirectsModel()

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      if !model.ready {
        Text("00").font(AglynFont.figure).redacted(reason: .placeholder)
        Text("redirects are on").foregroundStyle(.secondary).redacted(reason: .placeholder)
      } else if model.failed {
        Text("Could not load redirects.").foregroundStyle(.secondary)
      } else {
        let off = model.rows.filter { !$0.isOn }.count
        let on = model.rows.count - off
        Text("\(on)")
          .font(AglynFont.figure)
          .accessibilityIdentifier("redirects-summary-count")
        Text((on == 1 ? "redirect is on" : "redirects are on") + (off > 0 ? " · \(off) off" : ""))
          .foregroundStyle(.secondary)
      }
      Button("View") { context.navigate(redirectsListScreen) }
        .buttonStyle(.borderless)
        .padding(.top, 4)
    }
    .task(id: context.hostID) { model.start(context.firestore, hostID: context.hostID) }
    .onDisappear { model.stop() }
  }
}
