// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

#if os(macOS)
  import AglynCore
  import AppKit

  /// The Mac's windows that hold the shell, and where a link from outside the app opens (AGL-4059, `ExternalLinks`): a
  /// new tab of the window in front, brought forward, on the workspace and site the link names. A window the system made
  /// only to carry the link closes.
  @MainActor
  final class MacLinkWindows {
    static let shared = MacLinkWindows()

    private struct Entry {
      weak var window: NSWindow?
      weak var strip: TabStrip?
      let opened: Date
    }

    private var entries: [Entry] = []
    private var repeats = ExternalLinks.Repeats()
    /// Links that arrived before any window held the shell (the link launched the app, or nobody was signed in yet).
    private var waiting: [String] = []

    /// A window's tab strip, once the window holds the shell; a link waiting for one opens in it.
    func register(_ window: NSWindow, strip: TabStrip, model: AppModel) {
      entries.removeAll { $0.window == nil || $0.strip == nil || ($0.window === window && $0.strip !== strip) }
      // The window reports itself on every redraw; it opened the first time.
      if !entries.contains(where: { $0.window === window }) {
        entries.append(Entry(window: window, strip: strip, opened: Date()))
      }
      guard !waiting.isEmpty else { return }
      let links = waiting
      waiting = []
      for link in links { open(link, in: strip, window: window, model: model) }
    }

    /// Opens a link that reached the window `receiver` (nil while the window is not known yet), opened at `opened`.
    /// Returns whether that window was made only to carry the link and should close.
    @discardableResult
    func open(_ link: String, receivedBy receiver: NSWindow?, opened: Date, model: AppModel) -> Bool {
      let now = Date()
      guard repeats.isNew(link, at: now) else { return false }
      let live = liveEntries()
      let windows = live.compactMap { entry in entry.window.map { ExternalLinks.Window(id: $0.windowNumber, opened: entry.opened) } }
      let messenger = ExternalLinks.Window(id: receiver?.windowNumber ?? -1, opened: opened)
      switch ExternalLinks.choose(windows: windows, receiver: messenger, now: now) {
      case .waitForWindow:
        waiting.append(link)
        return false
      case .newTab(let id, let closing):
        guard let entry = live.first(where: { $0.window?.windowNumber == id }), let window = entry.window,
          let strip = entry.strip
        else {
          waiting.append(link)
          return false
        }
        open(link, in: strip, window: window, model: model)
        guard closing != nil, receiver !== window else { return false }
        // Only a window that is still as it opened: never one the person has started using.
        let receiverStrip = receiver.flatMap { found in entries.first { $0.window === found }?.strip }
        return receiverStrip?.untouched ?? true
      }
    }

    private func open(_ link: String, in strip: TabStrip, window: NSWindow, model: AppModel) {
      strip.openLink(link, model: model)
      if window.isMiniaturized { window.deminiaturize(nil) }
      window.makeKeyAndOrderFront(nil)
      NSApp.activate()
    }

    /// The registered windows still open, front to back.
    private func liveEntries() -> [Entry] {
      entries.removeAll { $0.window == nil || $0.strip == nil }
      let order = NSApp.orderedWindows
      return entries
        .filter { entry in entry.window.map { $0.isVisible || $0.isMiniaturized } ?? false }
        .sorted { a, b in
          let ia = a.window.flatMap { order.firstIndex(of: $0) } ?? Int.max
          let ib = b.window.flatMap { order.firstIndex(of: $0) } ?? Int.max
          return ia < ib
        }
    }
  }
#endif
