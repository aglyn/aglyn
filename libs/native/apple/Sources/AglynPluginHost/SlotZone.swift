// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// Where a zone draws its widgets on a list: in the list's header beside its own create action, or in the list's body
/// (its empty state). A widget reads it to size itself: an icon-sized action in a crowded header, a full button in a body.
public enum SlotPlacement: Sendable, Equatable {
  case header, body
}

private struct SlotPlacementKey: EnvironmentKey {
  static let defaultValue = SlotPlacement.body
}

extension EnvironmentValues {
  /// The placement of the zone a widget is drawn in; `.body` outside one.
  public var slotPlacement: SlotPlacement {
    get { self[SlotPlacementKey.self] }
    set { self[SlotPlacementKey.self] = newValue }
  }
}

/// The zones a site's lists host beside their create action, under the console's names: the native twins of the
/// `hostScreens`, `hostTemplates`, `hostLayouts`, `hostComponents` and `hostForms` zones. A list draws its zone and never
/// names the plugins that fill it (the AI plugin's Create with AI is one).
public enum ListCreateZone {
  public static let pages = "hostScreens"
  public static let templates = "hostTemplates"
  public static let layouts = "hostLayouts"
  public static let components = "hostComponents"
  public static let forms = "hostForms"
}

/// What other plugins put in one of a page's zones, in order, each told where it is drawn: the native twin of the
/// console's `PluginWidgetSlot`. Inside a `ToolbarItemGroup` each widget is one toolbar item.
public struct SlotWidgets: View {
  let context: NativePluginContext
  let slot: String
  let placement: SlotPlacement

  public init(context: NativePluginContext, slot: String, placement: SlotPlacement = .body) {
    self.context = context
    self.slot = slot
    self.placement = placement
  }

  public var body: some View {
    ForEach(context.slotWidgets(slot), id: \.id) { widget in
      widget.make(context)
        .environment(\.slotPlacement, placement)
        .accessibilityIdentifier("zone-widget-\(widget.id)")
    }
  }
}
