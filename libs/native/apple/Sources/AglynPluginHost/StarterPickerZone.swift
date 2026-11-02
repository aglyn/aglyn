// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import SwiftUI

/// What Create site hands the widgets in its `hostStarterPicker` zone (the console's `ConsoleHostStarterPickerZoneProps`):
/// what to list, what the person picked, and where each answer goes. Create site never names the plugin that fills it.
public struct StarterPickerZone {
  /// The zone's name, the console's.
  public static let slot = "hostStarterPicker"

  public let orgID: String
  public let mode: SiteStarterMode
  public let search: String
  /// The listing shown chosen, and what Create site knows about owning it.
  public let selected: SiteStarterSummary?
  public let onPick: @MainActor (SiteStarterSummary) -> Void
  /// Whether a picker is on screen. The first answer decides, and `false` hands Create site back to its own choice.
  public let ready: @MainActor (Bool) -> Void

  public init(
    orgID: String, mode: SiteStarterMode, search: String, selected: SiteStarterSummary?,
    onPick: @escaping @MainActor (SiteStarterSummary) -> Void, ready: @escaping @MainActor (Bool) -> Void
  ) {
    self.orgID = orgID
    self.mode = mode
    self.search = search
    self.selected = selected
    self.onPick = onPick
    self.ready = ready
  }
}

extension EnvironmentValues {
  /// Create site's starter zone, while one of its widgets is drawn; nil anywhere else.
  @Entry public var starterPickerZone: StarterPickerZone? = nil
}
