// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynUI
import SwiftUI

/// The Redirects card on the dashboard: how many rules the site serves, how
/// many are off, and the first one the serve path checks.
struct RedirectsSummaryWidget: View {
  let context: NativePluginContext
  @State private var model = HostRedirectsModel()

  var body: some View {
    let off = model.rows.filter { !$0.isOn }.count
    let on = model.rows.count - off
    MetricCard(
      "Redirects", systemImage: RedirectsSymbols.rule,
      value: model.ready ? "\(on)" : nil,
      caption: (on == 1 ? "redirect is on" : "redirects are on") + (off > 0 ? " · \(off) off" : ""),
      actionLabel: "Opens Redirects",
      failed: model.failed ? "Could not load redirects." : nil
    ) {
      context.navigate(redirectsListScreen)
    }
    .accessibilityIdentifier("redirects-summary")
    .task(id: context.hostID) { model.start(context.firestore, hostID: context.hostID) }
    .onDisappear { model.stop() }
  }
}
