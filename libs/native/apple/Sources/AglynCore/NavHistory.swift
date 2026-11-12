// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

/// Where a window has been, for the title bar's Back and Forward (Mac and iPad): each place opened, in order.
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
