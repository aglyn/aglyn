// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import Observation
import SwiftUI

#if os(macOS)
  import AppKit
#endif

// Tabs on the Mac and iPad (AGL-3945, Figma Menus 2:4 "Tab overview"): each tab keeps its own workspace, site and
// place. On the Mac a tab is a window in the system's tab group, so tabs split into windows and merge back, and the
// system's tab overview (Show All Tabs) lists them; on iPad, which has no window tabs, the shell draws a tab strip.
// ⌘T opens one, ⌘W closes it, ⌘⇧T opens the last one closed again.

/// What a tab opens on: its workspace and site, its place, and a page for the in-app browser.
struct ShellSeed: Codable, Hashable, Identifiable {
  var id = UUID()
  var orgID: String?
  var hostID: String?
  var inSite = true
  /// The place it opens (a manifest screen and its params); nil for Home.
  var screen: String?
  var params: [String: String] = [:]
  /// A web page the tab opens in the in-app browser (⌘-click on a link).
  var webURL: URL?
  /// The tab's title in a recently-closed list.
  var title: String = "Home"

  var section: ShellSection { screen.map { ShellSection.opening($0, params) } ?? .home }
}

/// The tabs closed in this app's run, newest first, for ⌘⇧T and the Recently Closed list.
@MainActor
@Observable
final class ClosedTabs {
  private(set) var seeds: [ShellSeed] = []

  func closed(_ seed: ShellSeed) {
    seeds.removeAll { $0.id == seed.id }
    seeds.insert(seed, at: 0)
    if seeds.count > 10 { seeds.removeLast(seeds.count - 10) }
  }

  /// The last one closed, taken off the list.
  func reopen() -> ShellSeed? {
    guard !seeds.isEmpty else { return nil }
    return seeds.removeFirst()
  }

  func take(_ seed: ShellSeed) { seeds.removeAll { $0.id == seed.id } }
}

extension ShellNavigation {
  /// This tab as a seed: where it stands and what it shows, for a new tab beside it or the recently closed list.
  @MainActor
  func seed(model: AppModel, title: String? = nil) -> ShellSeed {
    var seed = ShellSeed(
      orgID: pickedOrgID ?? model.workspace?.org?.id, hostID: pickedHostID ?? model.workspace?.site?.id, inSite: inSite)
    switch section {
    case .plugin(let screen): seed.screen = screen
    case .place(let screen, let params):
      seed.screen = screen
      seed.params = params
    case .analytics: seed.screen = "shell.analytics"
    default: break
    }
    seed.title = title ?? ShellScope(model: model, navigation: self).row(for: section)?.label ?? "Home"
    return seed
  }

  /// Opens a seed in this tab: its workspace and site, its place, and its web page.
  @MainActor
  func apply(_ seed: ShellSeed, model: AppModel) {
    pickedOrgID = seed.orgID
    pickedHostID = seed.hostID
    inSite = seed.inSite
    if let orgID = seed.orgID { model.workspace?.open(orgID: orgID, hostID: seed.hostID) }
    select(seed.section)
    if let url = seed.webURL { push(.web(AglynWebPage(url))) }
  }

  /// Notes the workspace and site this tab stands in, so it comes back to them when it is in front again.
  func remember(orgID: String?, hostID: String?) {
    pickedOrgID = orgID
    pickedHostID = hostID
  }
}

/// Tab titles: the place, then the site or workspace ("Bakery — Orders").
@MainActor
func tabTitle(_ navigation: ShellNavigation, model: AppModel) -> String {
  // A tab behind another keeps its own title (the app's workspace is the front tab's).
  if !navigation.front, let title = navigation.frozenTitle { return title }
  let scope = ShellScope(model: model, navigation: navigation)
  let place = navigation.section == .home ? "Home" : scope.row(for: navigation.section)?.label ?? "Home"
  guard let owner = scope.site?.name ?? scope.org?.name else { return place }
  return place == "Home" && navigation.section == .home ? "\(owner) — Home" : "\(owner) — \(place)"
}

#if os(macOS)
  /// The Mac window a view sits in, handed over once it is known.
  struct WindowReader: NSViewRepresentable {
    let found: (NSWindow) -> Void

    func makeNSView(context: Context) -> NSView {
      let view = NSView()
      DispatchQueue.main.async { if let window = view.window { found(window) } }
      return view
    }

    func updateNSView(_ view: NSView, context: Context) {
      DispatchQueue.main.async { if let window = view.window { found(window) } }
    }
  }

  /// Makes the main window a tab of the app's one tab group, keeps its title the tab's, follows it to the front (its
  /// workspace and site become the app's), and files it under Recently Closed when it closes.
  struct MacWindowTab: ViewModifier {
    @Environment(AppModel.self) private var model
    let navigation: ShellNavigation
    let closedTabs: ClosedTabs
    @State private var window: NSWindow?
    @State private var observers: [NSObjectProtocol] = []

    func body(content: Content) -> some View {
      content
        .background(WindowReader { found in attach(found) })
        .onChange(of: tabTitle(navigation, model: model)) { _, title in window?.title = title }
        // While this tab is in front, the workspace and site it stands in are its own.
        .onChange(of: model.workspace?.effective) { _, pick in
          guard window?.isKeyWindow == true, let pick else { return }
          navigation.remember(orgID: pick.orgID, hostID: pick.hostID)
        }
    }

    private func attach(_ found: NSWindow) {
      guard window !== found else { return }
      window = found
      found.tabbingMode = .preferred
      found.tabbingIdentifier = "aglyn-main"
      found.title = tabTitle(navigation, model: model)
      let center = NotificationCenter.default
      observers.forEach(center.removeObserver)
      observers = [
        center.addObserver(forName: NSWindow.didBecomeKeyNotification, object: found, queue: .main) { _ in
          MainActor.assumeIsolated { cameToFront() }
        },
        center.addObserver(forName: NSWindow.willCloseNotification, object: found, queue: .main) { _ in
          MainActor.assumeIsolated { closedTabs.closed(navigation.seed(model: model, title: found.title)) }
        },
      ]
      if navigation.pickedOrgID == nil, let pick = model.workspace?.effective {
        navigation.remember(orgID: pick.orgID, hostID: pick.hostID)
      }
    }

    /// The tab in front reads its own workspace and site.
    private func cameToFront() {
      guard let workspace = model.workspace, let orgID = navigation.pickedOrgID else { return }
      let current = workspace.effective
      if current.orgID != orgID || (navigation.pickedHostID != nil && current.hostID != navigation.pickedHostID) {
        workspace.open(orgID: orgID, hostID: navigation.pickedHostID)
      }
    }
  }
#endif

// MARK: iPad: the tab strip

/// The tabs of one iPad window: each its own navigation, the first (Home) pinned at the start.
@MainActor
@Observable
final class TabStrip {
  private(set) var tabs: [ShellNavigation]
  var selected: Int = 0

  init(first: ShellNavigation) { tabs = [first] }

  var current: ShellNavigation { tabs[min(selected, tabs.count - 1)] }

  func open(_ seed: ShellSeed, model: AppModel) {
    let navigation = ShellNavigation()
    send(current, back: true, model: model)
    tabs.append(navigation)
    selected = tabs.count - 1
    navigation.apply(seed, model: model)
  }

  /// A tab going behind keeps reading its own workspace and site; one coming in front reads the app's again once they
  /// are its own (`settle`).
  private func send(_ tab: ShellNavigation, back: Bool, model: AppModel) {
    if back {
      if tab.front {
        tab.frozenContext = model.liveContext(for: tab)
        tab.frozenTitle = tabTitle(tab, model: model)
      }
      tab.front = false
    } else {
      tab.front = true
      settle(model: model)
    }
  }

  /// Lets the tab in front read the app's workspace and site live once they are the ones it stands in.
  func settle(model: AppModel) {
    let tab = current
    guard tab.front, let frozen = tab.frozenContext else { return }
    let settled = model.workspace?.org?.id == frozen.orgID && model.scopedSite(tab)?.id == frozen.hostID
    // The person went elsewhere in this tab before its own place came back: what they picked is live.
    let effective = model.workspace?.effective
    let movedOn = effective != nil && (effective?.orgID != tab.pickedOrgID || (tab.pickedHostID != nil && effective?.hostID != tab.pickedHostID))
    if settled || movedOn { tab.frozenContext = nil }
  }

  /// Takes a tab out of the strip without filing it as closed (it moves to a window of its own), and returns where it
  /// stood.
  func detach(_ index: Int, model: AppModel) -> ShellSeed? {
    guard index > 0, tabs.indices.contains(index) else { return nil }
    let tab = tabs[index]
    let seed = tab.seed(model: model, title: tabTitle(tab, model: model))
    tabs.remove(at: index)
    selected = min(selected, tabs.count - 1)
    select(selected, model: model)
    return seed
  }

  /// The window went behind another of the app's windows: its tab in front keeps its own place, as a hidden tab does.
  func windowWentBehind(model: AppModel) {
    if current.front, let pick = model.workspace?.effective { current.remember(orgID: pick.orgID, hostID: pick.hostID) }
    send(current, back: true, model: model)
  }

  /// The window came in front: its tab in front reads its own workspace and site again.
  func windowCameToFront(model: AppModel) { select(selected, model: model) }

  /// Closes a tab (never the pinned first one), filing it under Recently Closed.
  func close(_ index: Int, model: AppModel, closedTabs: ClosedTabs) {
    guard index > 0, tabs.indices.contains(index) else { return }
    closedTabs.closed(tabs[index].seed(model: model, title: tabTitle(tabs[index], model: model)))
    tabs.remove(at: index)
    selected = min(selected, tabs.count - 1)
    select(selected, model: model)
  }

  /// Brings a tab to the front: the workspace and site it stands in become the app's.
  func select(_ index: Int, model: AppModel) {
    guard tabs.indices.contains(index) else { return }
    if index != selected, tabs.indices.contains(selected) {
      if current.frozenContext == nil, let pick = model.workspace?.effective {
        current.remember(orgID: pick.orgID, hostID: pick.hostID)
      }
      send(current, back: true, model: model)
    }
    selected = index
    let tab = tabs[index]
    defer { send(tab, back: false, model: model) }
    if let orgID = tab.pickedOrgID, let workspace = model.workspace {
      let now = workspace.effective
      if now.orgID != orgID || (tab.pickedHostID != nil && now.hostID != tab.pickedHostID) {
        workspace.open(orgID: orgID, hostID: tab.pickedHostID)
      }
    }
  }
}

/// The strip across the top of an iPad window: the tabs, ⊕ for a new one, and Recently Closed.
struct TabStripBar: View {
  @Environment(AppModel.self) private var model
  @Bindable var strip: TabStrip
  let closedTabs: ClosedTabs

  var body: some View {
    HStack(spacing: 4) {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 4) {
          ForEach(Array(strip.tabs.enumerated()), id: \.offset) { index, tab in
            HStack(spacing: 6) {
              Image(systemName: index == 0 ? "house" : "square.on.square").font(.caption)
              Text(index == 0 ? "Home" : tabTitle(tab, model: model)).font(AglynFont.subheadline).lineLimit(1)
              if index > 0 {
                Button {
                  strip.close(index, model: model, closedTabs: closedTabs)
                } label: {
                  Image(systemName: "xmark").font(.caption2.weight(.semibold))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close tab")
              }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
              RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous)
                .fill(index == strip.selected ? AglynColor.paper : Color.clear))
            .contentShape(Rectangle())
            .onTapGesture { strip.select(index, model: model) }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(index == strip.selected ? [.isSelected, .isButton] : .isButton)
            .accessibilityIdentifier("tab-\(index)")
          }
        }
      }
      Button {
        strip.open(strip.current.seed(model: model), model: model)
      } label: {
        Label("New tab", systemImage: "plus").labelStyle(.iconOnly)
      }
      .buttonStyle(.borderless)
      .keyboardShortcut("t", modifiers: .command)
      .accessibilityIdentifier("tab-new")
      Menu {
        Section("Recently closed") {
          if closedTabs.seeds.isEmpty { Text("Nothing closed yet") }
          ForEach(closedTabs.seeds) { seed in
            Button(seed.title) {
              closedTabs.take(seed)
              strip.open(seed, model: model)
            }
          }
        }
      } label: {
        Label("Tabs", systemImage: "square.grid.2x2").labelStyle(.iconOnly)
      }
      .accessibilityIdentifier("tab-overview")
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
    .background(AglynColor.rail)
    // ⌘W closes the tab in front, ⌘⇧T opens the last one closed.
    .background {
      Button("") { strip.close(strip.selected, model: model, closedTabs: closedTabs) }
        .keyboardShortcut("w", modifiers: .command)
        .opacity(0)
      Button("") { if let seed = closedTabs.reopen() { strip.open(seed, model: model) } }
        .keyboardShortcut("t", modifiers: [.command, .shift])
        .opacity(0)
    }
  }
}
