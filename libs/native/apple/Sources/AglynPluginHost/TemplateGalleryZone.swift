// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// How a shelf in the template gallery stands (`ConsoleTemplateGalleryShelfState`): still reading, showing something,
/// or with nothing to show, so the gallery's "nothing matches" line counts it.
public enum TemplateGalleryShelfState: String, Sendable {
  case loading
  case shown
  case empty
}

/// What the template gallery hands the widgets in its `templateGallery` zone (the console's
/// `ConsoleTemplateGalleryZoneProps`, AGL-3080): the site a template installs into, the kind being picked, the search
/// word, and where each answer goes. The gallery never names the plugin that fills it.
public struct TemplateGalleryZone {
  /// The zone's name, the console's.
  public static let slot = "templateGallery"

  public let hostID: String
  /// `page`, `component` or `layout`; a shelf offering one kind draws nothing for the others.
  public let kind: String
  /// The word typed in the gallery's search, `""` for none.
  public let search: String
  /// Closes the gallery once an install has landed in the library, with what to tell the person.
  public let onInstalled: @MainActor (String) -> Void
  /// Says how a shelf stands, keyed by a name the widget keeps.
  public let reportShelf: @MainActor (String, TemplateGalleryShelfState) -> Void

  public init(
    hostID: String, kind: String, search: String, onInstalled: @escaping @MainActor (String) -> Void,
    reportShelf: @escaping @MainActor (String, TemplateGalleryShelfState) -> Void
  ) {
    self.hostID = hostID
    self.kind = kind
    self.search = search
    self.onInstalled = onInstalled
    self.reportShelf = reportShelf
  }
}

extension EnvironmentValues {
  /// The template gallery's zone, while one of its widgets is drawn; nil anywhere else.
  @Entry public var templateGalleryZone: TemplateGalleryZone? = nil
}
