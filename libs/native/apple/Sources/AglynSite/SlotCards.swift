// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import Observation
import SwiftUI

/// What other plugins put in one of a setup page's zones (`hostBusinessProfile`, `hostSeo`, `hostSettings`), in order: the
/// native twin of the console's `PluginZoneSection`. The page never names the plugins that contribute.
struct SlotCards: View {
  let context: NativePluginContext
  let slot: String

  var body: some View {
    ForEach(context.slotWidgets(slot), id: \.id) { widget in
      widget.make(context).accessibilityIdentifier("zone-widget-\(widget.id)")
    }
  }
}

/// Values a plugin's widget proposed for a form (the SEO form's `proposeDraft`), staged as unsaved edits: a proposal lands in
/// the form's fields beside what was typed, the same key twice applies once, and the form's Save is the write.
@MainActor
@Observable
final class FormDraft {
  private(set) var values: [String: String] = [:]
  /// Bumps whenever a proposal lands, so a form re-reads `values`.
  private(set) var version = 0
  @ObservationIgnored private var applied = Set<String>()

  func propose(_ proposed: [String: String], key: String) {
    guard applied.insert(key).inserted else { return }
    values.merge(proposed) { _, new in new }
    version += 1
  }
}
