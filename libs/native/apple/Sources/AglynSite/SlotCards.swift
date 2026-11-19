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

  /// Hands over, once, the proposed values a form owns: they leave the draft, so a form opened later never stages them
  /// again over what was saved.
  func take(_ paths: [String]) -> [String: String] {
    var taken: [String: String] = [:]
    for path in paths { if let value = values.removeValue(forKey: path) { taken[path] = value } }
    return taken
  }

  /// The site's one draft (AGL-4136). The SEO zone proposes into it, and a value for a field another section's card owns
  /// (the name, email and phone on Setup → Business profile's Business details) waits here until that card takes it, as the
  /// console stages a proposal in the draft of the card that owns its field.
  static func forSite(_ hostID: String) -> FormDraft {
    if let draft = sites[hostID] { return draft }
    let draft = FormDraft()
    sites[hostID] = draft
    return draft
  }

  private static var sites: [String: FormDraft] = [:]
}
