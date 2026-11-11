// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// The in-app Besigner's focus mode on the Mac and iPad (AGL-4056).
///
/// Opening the editor folds the workspace rail and the sidebar away, so the canvas takes the window. The title bar's
/// switcher toggle still works: while the editor is open, the sidebar follows the rail, so the one toggle brings both
/// back (and folds both again). Leaving the editor puts them back exactly as they were before it opened, whatever
/// was toggled meanwhile.
public struct BesignerFocus: Equatable, Sendable {
  /// Which of the two columns are folded away.
  public struct Columns: Equatable, Sendable {
    public var railHidden: Bool
    public var sidebarHidden: Bool

    public init(railHidden: Bool, sidebarHidden: Bool) {
      self.railHidden = railHidden
      self.sidebarHidden = sidebarHidden
    }

    /// Both folded away: the editor's own columns.
    public static let focused = Columns(railHidden: true, sidebarHidden: true)
  }

  /// The columns as they were before the editor opened; nil while it is not open.
  public private(set) var saved: Columns?

  public init() {}

  /// Whether the editor holds the window in focus mode now.
  public var active: Bool { saved != nil }

  /// The editor opens: remembers `now` and answers the columns to show. Opening it again keeps the first memory.
  public mutating func enter(_ now: Columns) -> Columns {
    if saved == nil { saved = now }
    return .focused
  }

  /// The rail toggled while the editor is open: the sidebar follows it. Outside focus mode the columns stay as asked.
  public func toggled(_ now: Columns) -> Columns {
    guard active else { return now }
    return Columns(railHidden: now.railHidden, sidebarHidden: now.railHidden)
  }

  /// The editor closes: the columns as they were before it opened, or nil when it was never in focus mode.
  public mutating func leave() -> Columns? {
    defer { saved = nil }
    return saved
  }
}

/// When an edge swipe means "back" (AGL-4056): as the system's own pop, a swipe past a third of the width, or a flick
/// toward the trailing side.
public enum BackGesture {
  /// Points a second that count as a flick.
  public static let flickSpeed: Double = 500

  /// Whether a swipe that travelled `travel` points at `speed` points a second, over a view `width` wide, goes back.
  public static func completes(travel: Double, speed: Double, width: Double) -> Bool {
    guard travel > 0, speed >= 0 || travel > width / 2 else { return false }
    return travel > width / 3 || speed > flickSpeed
  }
}
