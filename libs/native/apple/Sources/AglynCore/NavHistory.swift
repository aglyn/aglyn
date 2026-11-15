// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

/// Where a window has been, for the title bar's Back and Forward (Mac and iPad): each place opened, in order.
///
/// A place is the screen on show, with every level pushed over its area: an order opened over Orders (a Starred or
/// Recent order, a link to it, its row) is a place of its own, so Back from it returns to Orders, as a browser's Back
/// returns to the page before (the Mac drive of 2026-11-14 found Back skipped Orders).
///
/// A place is everything Back has to put back, not only the screen: the shell keeps the sidebar's mode (the everyday
/// list, Site settings, Workspace settings) and its scope (the whole workspace, or which site) in it, so going Back out
/// of a settings mode or another scope returns to the list and scope that place was opened in, not the screen alone
/// over the list in use now.
public struct NavHistory<Place: Equatable>: Equatable {
  /// The places, oldest first.
  public private(set) var places: [Place]
  /// The place on screen.
  public private(set) var index: Int
  /// How many places are kept; the oldest go first.
  public let limit: Int

  public init(_ start: Place, limit: Int = 50) {
    places = [start]
    index = 0
    self.limit = max(1, limit)
  }

  public var current: Place { places[index] }
  public var canGoBack: Bool { index > 0 }
  public var canGoForward: Bool { index < places.count - 1 }

  /// Notes a place opened: going somewhere new drops what was ahead; the place on screen again is not a new one.
  public mutating func record(_ place: Place) {
    guard places[index] != place else { return }
    places = Array(places.prefix(index + 1)) + [place]
    if places.count > limit { places.removeFirst(places.count - limit) }
    index = places.count - 1
  }

  /// Notes the place on screen changed from inside itself (a screen pushed over it, or one closed): closing back to the
  /// place just before this one is going Back to it, so what is ahead stays for Forward, as a stack's own back control
  /// does; anything else is a new place, as each page opened is in a browser's history.
  public mutating func show(_ place: Place) {
    guard places[index] != place else { return }
    if index > 0, places[index - 1] == place {
      index -= 1
      return
    }
    record(place)
  }

  /// Puts what is now known about the place on screen in its stead, without making it a new place: the site a scope
  /// switch picks is read after the screen it opens was recorded.
  public mutating func replaceCurrent(_ place: Place) {
    places[index] = place
  }

  /// The place before this one, now on screen; nil when there is none.
  public mutating func back() -> Place? {
    guard canGoBack else { return nil }
    index -= 1
    return places[index]
  }

  /// The place after this one, now on screen; nil when there is none.
  public mutating func forward() -> Place? {
    guard canGoForward else { return nil }
    index += 1
    return places[index]
  }
}
