// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// Where a link from outside the app (another app, a browser, Mail) opens on the Mac (AGL-4059): as a new tab of the
/// window in front, the way the console's link opens a new browser tab, never as a window of its own.
///
/// The system hands a clicked console link to the app as a universal link (a browsing-web user activity), and SwiftUI
/// opens a new window for an activity no open window claims. That window then knows nothing of the link, so it showed
/// the home of the site the app was already on. The window a link reaches is only the messenger: the link goes to the
/// window the person was using, and a window made just to carry it closes.
public enum ExternalLinks {
  /// How long after a window opens a link that reaches it counts as the reason it opened.
  public static let freshWindow: TimeInterval = 3

  /// A window that can take a link: its identity and when it opened.
  public struct Window: Equatable, Sendable {
    public var id: Int
    public var opened: Date

    public init(id: Int, opened: Date) {
      self.id = id
      self.opened = opened
    }
  }

  /// Where the link opens.
  public enum Choice: Equatable, Sendable {
    /// A new tab of this window, brought to the front; `closing` is the window made only to carry the link.
    case newTab(window: Int, closing: Int?)
    /// No window holds the shell yet (the link launched the app, or nobody is signed in): it waits for the first one.
    case waitForWindow
  }

  /// Chooses the window for a link that reached `receiver` at `now`. `windows` are the app's windows that hold the
  /// shell, front to back. A receiver opened within `freshWindow` of the link, while an older window is open, was made
  /// for the link: the older window in front takes it, and the receiver closes. Otherwise the window in front does.
  public static func choose(windows: [Window], receiver: Window?, now: Date) -> Choice {
    let receiverIsMessenger = receiver.map { now.timeIntervalSince($0.opened) < freshWindow } ?? false
    if receiverIsMessenger, let receiver,
      let older = windows.first(where: { $0.id != receiver.id && $0.opened < receiver.opened })
    {
      return .newTab(window: older.id, closing: receiver.id)
    }
    guard let front = windows.first else { return .waitForWindow }
    return .newTab(window: front.id, closing: nil)
  }

  /// Drops the second delivery of one click: the system can hand the same link over as a URL and as a user activity,
  /// and every window that hears it reports it.
  public struct Repeats: Sendable {
    public static let window: TimeInterval = 2
    private var last: (link: String, at: Date)?

    public init() {}

    /// Whether `link` at `now` is new; records it when it is.
    public mutating func isNew(_ link: String, at now: Date) -> Bool {
      if let last, last.link == link, now.timeIntervalSince(last.at) < Self.window { return false }
      last = (link, now)
      return true
    }
  }
}
