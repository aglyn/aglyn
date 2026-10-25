// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynScreens
import AglynUI
import SwiftUI

/// The signed-in "Aglyn" shell (AGL-3945, the native navigation redesign): one scope at a time. On the Mac and iPad, the
/// workspace rail, the scope's sidebar from the nav manifest, and the detail; on iPhone, a top bar with the scope chip
/// and a tab bar (Home, the site's busiest area, Inbox, Menu), Menu holding the same grouped list.
struct MainShell: View {
  @Environment(AppModel.self) private var model
  @Bindable var navigation: ShellNavigation
  /// What this window opens on: a tab opened from another (⌘T, a ⌘-clicked link), or a reopened one.
  var seed: ShellSeed? = nil
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif
  @State private var seeded = false

  var body: some View {
    Group {
      #if os(iOS)
        if sizeClass == .compact {
          ShellFrame(navigation: navigation, compact: true) { PhoneShell(navigation: navigation) }
        } else {
          ShellTabs(first: navigation)
        }
      #else
        ShellTabs(first: navigation)
      #endif
    }
    .task(id: "\(model.workspace?.org?.id ?? ""):\(model.auth?.user?.uid ?? ""):\(model.orgAccess.memberRoleID ?? "")") {
      model.orgAccess.follow(
        reader: model.reader, api: model.api, orgID: model.workspace?.org?.id, uid: model.auth?.user?.uid)
    }
    .task(id: model.workspace?.ready == true) {
      guard !seeded, let seed, model.workspace?.ready == true else { return }
      seeded = true
      navigation.apply(seed, model: model)
    }
  }
}

/// The Mac's and iPad's window (Figma Mac/Titlebar 12:910): two rows of chrome drawn here, not by the system: the tab
/// strip (the window's buttons, the tabs, "+") and the toolbar (the rail toggle, history, the search centered on the
/// window, the bell, Help and AI); then the shell of the tab in front.
struct ShellTabs: View {
  @Environment(AppModel.self) private var model
  @State private var strip: TabStrip

  init(first: ShellNavigation) {
    _strip = State(initialValue: TabStrip(first: first))
  }

  var body: some View {
    let current = strip.current
    VStack(spacing: 0) {
      ShellChrome(strip: strip).environment(current).zIndex(1)
      // Every open tab stays alive, only the one in front shown and touchable, so each keeps its own path, selection,
      // scroll and unsaved fields while another is in front.
      ZStack {
        ForEach(strip.tabs, id: \.tabID) { tab in
          let front = tab === current
          ShellFrame(navigation: tab, compact: false) { WideShell(navigation: tab) }
            .environment(tab)
            .opacity(front ? 1 : 0)
            .allowsHitTesting(front)
            .accessibilityHidden(!front)
            .zIndex(front ? 1 : 0)
        }
      }
      .focusedSceneValue(\.shellNavigation, current)
    }
    // The search's dropdown, under the title bar's field and over everything else (P3).
    .modifier(OneBoxOverlay(navigation: current))
    .focusedSceneValue(\.shellTabs, strip)
    // The tab in front keeps the workspace and site it stands in as its own, so the others never follow it.
    .onChange(of: model.workspace?.effective) { _, pick in
      // A tab back in front reads live once its own workspace and site are back; until then it keeps its own.
      if strip.current.frozenContext != nil { strip.settle(model: model) }
      if strip.current.frozenContext == nil, let pick { strip.current.remember(orgID: pick.orgID, hostID: pick.hostID) }
    }
    .onChange(of: model.workspace?.site?.id) { strip.settle(model: model) }
    #if os(macOS)
      .background(
        WindowReader { window in
          MacWindowControls.attach(window)
          MacWindowFocus.attach(window, strip: strip, model: model)
        })
      // The chrome reaches the window's top edge; the window's own buttons sit in the tab strip. The window has no
      // system toolbar: a screen's actions are in its head, so nothing draws over the chrome.
      .ignoresSafeArea(.container, edges: .top)
      .toolbar(.hidden, for: .windowToolbar)
    #endif
    .onAppear {
      for tab in strip.tabs { tab.openTab = { [weak strip, model] seed in strip?.open(seed, model: model) } }
    }
    .onChange(of: strip.tabs.count) {
      for tab in strip.tabs where tab.openTab == nil {
        tab.openTab = { [weak strip, model] seed in strip?.open(seed, model: model) }
      }
    }
  }
}

/// The two rows of window chrome.
struct ShellChrome: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  #if os(macOS)
    @Environment(\.openWindow) private var openWindow
  #endif
  @Bindable var strip: TabStrip
  @State private var unreadFeed = NotificationFeed()
  #if os(macOS)
    /// The window this chrome draws, and whether it is full screen: there its own buttons are gone, and so is the room
    /// the tab row keeps for them (P1).
    @State private var window: NSWindow?
    @State private var fullScreen = false
  #endif

  #if os(macOS)
    static let tabRow: CGFloat = 34
    static let toolRow: CGFloat = 44
  #else
    static let tabRow: CGFloat = 40
    static let toolRow: CGFloat = 48
  #endif

  /// The room at the tab row's leading edge for the window's close, minimize and zoom buttons.
  private var windowButtonsRoom: CGFloat {
    #if os(macOS)
      fullScreen ? 0 : AglynShellMetrics.trafficLights
    #else
      AglynShellMetrics.trafficLights
    #endif
  }

  var body: some View {
    @Bindable var navigation = navigation
    let unread = unreadFeed.rows?.filter { !$0.read }.count ?? 0
    VStack(spacing: 0) {
      // The tab strip: the window's buttons, the tabs (each as wide as its title, to a cap), "+".
      HStack(spacing: 4) {
        Color.clear.frame(width: windowButtonsRoom, height: 1)
        ForEach(Array(strip.tabs.enumerated()), id: \.offset) { index, tab in
          if index == 0 {
            // The pinned Home tab is the brand's mark alone (Figma Titlebar/Home tab 117:16049).
            HomeMarkTab(selected: index == strip.selected) { strip.select(index, model: model) }
              .accessibilityIdentifier("tab-0")
          } else {
          let parts = tabTitleParts(tab, model: model)
          ChromeTab(
            owner: parts.owner, place: parts.place, systemImage: tabIcon(tab, model: model),
            selected: index == strip.selected, closable: index > 0
          ) {
            strip.select(index, model: model)
          } close: {
            strip.close(index, model: model, closedTabs: model.closedTabs)
          }
          .accessibilityIdentifier("tab-\(index)")
          #if os(macOS)
            // Over a tab the window does not move with the pointer, so a drag takes the tab, not the window (the tab
            // row's empty space still moves it).
            .onHover { inside in window?.isMovable = !inside }
            // Dragged down out of the strip, a tab becomes a window of its own.
            .gesture(
              DragGesture(minimumDistance: 12).onEnded { drag in
                guard drag.translation.height > Self.tabRow, let seed = strip.detach(index, model: model) else { return }
                openWindow(id: "main", value: seed)
              })
          #endif
          }
        }
        Button {
          strip.open(strip.current.seed(model: model), model: model)
        } label: {
          AglynBarSymbol(systemImage: "plus")
        }
        .buttonStyle(.plain)
        .help("New tab (⌘T)")
        .accessibilityLabel("New tab")
        .accessibilityIdentifier("tab-new")
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 8)
      .frame(height: Self.tabRow)
      .contentShape(Rectangle())
      #if os(macOS)
        // Double-clicking the tab row zooms the window, as a title bar does.
        .onTapGesture(count: 2) { NSApp.keyWindow?.performZoom(nil) }
        .background(
          WindowReader { found in
            guard window !== found else { return }
            window = found
            fullScreen = found.styleMask.contains(.fullScreen)
          })
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.willEnterFullScreenNotification)) { note in
          if note.object as? NSWindow === window { fullScreen = true }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.willExitFullScreenNotification)) { note in
          if note.object as? NSWindow === window { fullScreen = false }
        }
      #endif
      .overlay(alignment: .bottom) { Rectangle().fill(AglynColor.divider).frame(height: 1) }
      // The toolbar: the rail toggle and history on the left, the bell, Help and AI on the right, and the one search
      // centered on the window.
      ZStack {
        HStack(spacing: 2) {
          TitleBarButton(
            navigation.railHidden ? "Show workspace switcher" : "Hide workspace switcher", systemImage: "sidebar.left",
            identifier: "titlebar-rail"
          ) {
            withAnimation(.easeOut(duration: 0.2)) { navigation.railHidden.toggle() }
          }
          TitleBarButton("Back", systemImage: "arrow.left", identifier: "titlebar-back") { navigation.goBack() }
            .disabled(!navigation.canGoBack)
          TitleBarButton("Forward", systemImage: "arrow.right", identifier: "titlebar-forward") { navigation.goForward() }
            .disabled(!navigation.canGoForward)
          RecentPlacesMenu()
          Spacer(minLength: 0)
          TitleBarButton(
            unread > 0 ? "Notifications, \(unread) unread" : "Notifications", systemImage: unread > 0 ? "bell.badge" : "bell",
            identifier: "titlebar-bell"
          ) { navigation.showNotifications.toggle() }
          .popover(isPresented: $navigation.showNotifications, arrowEdge: .bottom) {
            NotificationsPopover().environment(model).environment(navigation)
          }
          HelpMenuButton()
          if AssistSlot.available(model) {
            TitleBarButton("\(model.brandName) AI", systemImage: "sparkles", identifier: "titlebar-ai") {
              navigation.showAssist.toggle()
            }
            .keyboardShortcut("i", modifiers: [.command, .option])
          }
        }
        TitleBarSearch()
      }
      .padding(.horizontal, 12)
      .frame(height: Self.toolRow)
      // The hairline sits under the toolbar row, not inside it: Figma's Mac/Titlebar 12:910 is 34 + 44 + 1 = 79 points
      // (iPad 40 + 48 + 1), and the content starts under it.
      Rectangle().fill(AglynColor.divider).frame(height: 1)
    }
    .background(AglynColor.titlebar)
    .modifier(WindowDragArea())
    .task(id: "\(model.auth?.user?.uid ?? ""):\(model.refreshToken)") {
      unreadFeed.start(
        reader: model.reader, uid: model.auth?.user?.uid, count: 100, filter: NotificationFilter(status: .new))
    }
  }
}

#if os(macOS)
  /// The window's close, minimize and zoom buttons in the tab row: shown (hiding the system toolbar hides them) and
  /// centered on the row, again whenever the window lays itself out.
  @MainActor
  enum MacWindowControls {
    private static var watched: Set<ObjectIdentifier> = []

    /// The buttons' own changes: SwiftUI hides the title bar's views again when it re-applies the hidden toolbar
    /// (typing in a field did, P1), and the window lays the buttons out again on its own.
    private static var observations: [ObjectIdentifier: [NSKeyValueObservation]] = [:]
    private static var pending: Set<ObjectIdentifier> = []

    static func attach(_ window: NSWindow) {
      place(window)
      guard watched.insert(ObjectIdentifier(window)).inserted else { return }
      var watching: [NSKeyValueObservation] = []
      for kind in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
        var view: NSView? = window.standardWindowButton(kind)
        while let current = view, current !== window.contentView?.superview {
          watching.append(current.observe(\.isHidden, options: [.new]) { [weak window] _, change in
            if change.newValue == true { MainActor.assumeIsolated { soon(window) } }
          })
          watching.append(current.observe(\.alphaValue, options: [.new]) { [weak window] _, change in
            if (change.newValue ?? 1) < 1 { MainActor.assumeIsolated { soon(window) } }
          })
          view = current.superview
        }
        if let button = window.standardWindowButton(kind) {
          watching.append(button.observe(\.frame, options: [.new]) { [weak window] _, _ in
            MainActor.assumeIsolated { soon(window) }
          })
        }
      }
      observations[ObjectIdentifier(window)] = watching
      let center = NotificationCenter.default
      for name in [NSWindow.didResizeNotification, NSWindow.didEndLiveResizeNotification, NSWindow.didExitFullScreenNotification,
        NSWindow.didBecomeKeyNotification]
      {
        center.addObserver(forName: name, object: window, queue: .main) { [weak window] _ in
          MainActor.assumeIsolated { if let window { place(window) } }
        }
      }
    }

    /// Places the buttons again on the next turn of the run loop, once per burst of changes.
    private static func soon(_ window: NSWindow?) {
      guard let window, pending.insert(ObjectIdentifier(window)).inserted else { return }
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          pending.remove(ObjectIdentifier(window))
          place(window)
        }
      }
    }

    static func place(_ window: NSWindow) {
      let kinds: [NSWindow.ButtonType] = [.closeButton, .miniaturizeButton, .zoomButton]
      for (index, kind) in kinds.enumerated() {
        guard let button = window.standardWindowButton(kind) else { continue }
        // Every view between the button and the window's frame view is shown again.
        var view: NSView? = button
        while let current = view, current !== window.contentView?.superview {
          current.isHidden = false
          current.alphaValue = 1
          view = current.superview
        }
        guard let bar = button.superview else { continue }
        // Centred on the tab row, measured from the window's top edge rather than the title bar view's own height,
        // which grows when anything asks the window for a toolbar (P1: the buttons sat 8 points low).
        let rowCentre = bar.convert(NSPoint(x: 0, y: window.frame.height - ShellChrome.tabRow / 2), from: nil)
        let y = (rowCentre.y - button.frame.height / 2).rounded()
        let origin = NSPoint(x: 14 + CGFloat(index) * 20, y: y)
        if button.frame.origin != origin { button.setFrameOrigin(origin) }
      }
    }
  }
#endif

#if os(macOS)
  /// Another of the app's windows in front: this window's tab keeps its own workspace and site while it is behind,
  /// and takes them back when it comes in front (the app keeps one workspace store for every window).
  @MainActor
  enum MacWindowFocus {
    private static var watched: Set<ObjectIdentifier> = []

    static func attach(_ window: NSWindow, strip: TabStrip, model: AppModel) {
      guard watched.insert(ObjectIdentifier(window)).inserted else { return }
      let center = NotificationCenter.default
      center.addObserver(forName: NSWindow.didResignMainNotification, object: window, queue: .main) { [weak strip, weak model] _ in
        MainActor.assumeIsolated { if let strip, let model { strip.windowWentBehind(model: model) } }
      }
      center.addObserver(forName: NSWindow.didBecomeMainNotification, object: window, queue: .main) { [weak strip, weak model] _ in
        MainActor.assumeIsolated { if let strip, let model { strip.windowCameToFront(model: model) } }
      }
    }
  }
#endif

/// The Home tab: the logo kit's mark, 16 points, icon only, never faded.
struct HomeMarkTab: View {
  @Environment(AppModel.self) private var model
  let selected: Bool
  let select: () -> Void
  @State private var hovered = false

  var body: some View {
    mark
      .frame(width: AglynShellMetrics.barButton + 4, height: AglynShellMetrics.barButton)
      .background(
        RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous)
          .fill(selected ? AglynColor.paper : hovered ? AglynColor.hover : .clear))
      .overlay(
        RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous)
          .strokeBorder(selected ? AglynColor.divider : .clear))
      .contentShape(Rectangle())
      .onTapGesture(perform: select)
      .onHover { hovered = $0 }
      .help("Home")
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("\(model.brandName) Home")
      .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
  }

  /// A white-label workspace's own mark when it set one (the console's brand profile), else the logo kit's.
  @ViewBuilder
  private var mark: some View {
    if let custom = model.orgAccess.whiteLabelMark {
      AglynBrandPicture(
        model.mediaURL(custom.light, hostID: nil, width: 64), darkURL: model.mediaURL(custom.dark, hostID: nil, width: 64),
        size: 16, cornerRadius: 3
      ) { AglynArtwork.mark.resizable().scaledToFit().frame(width: 16, height: 16) }
      .accessibilityIdentifier("tab-home-white-label")
    } else {
      AglynArtwork.mark.resizable().scaledToFit().frame(width: 16, height: 16)
    }
  }
}

/// One tab in the strip: as wide as its title up to a cap, the title cut with an ellipsis past it.
struct ChromeTab: View {
  /// The workspace or site the tab stands in; it gives way first when the tab is narrow.
  let owner: String?
  /// The screen in use, always shown whole.
  let place: String
  let systemImage: String
  let selected: Bool
  let closable: Bool
  let select: () -> Void
  let close: () -> Void
  @State private var hovered = false

  /// Figma Titlebar/Tab 8:111: a 14-point icon, 13-point title (semibold in use), × at rest, 10-point padding, 6 between.
  var body: some View {
    let font = Font.system(size: 13, weight: selected ? .semibold : .regular)
    HStack(spacing: 6) {
      Image(systemName: systemImage).font(.system(size: 12))
        .frame(width: 14, height: 14)
        .foregroundStyle(selected ? AglynColor.accentIcon : AglynColor.secondaryText)
      HStack(spacing: 0) {
        if let owner {
          Text("\(owner) — ").lineLimit(1).truncationMode(.tail).layoutPriority(0)
        }
        Text(place).lineLimit(1).fixedSize().layoutPriority(1)
      }
      .font(font)
      .foregroundStyle(selected ? AglynColor.textPrimary : AglynColor.secondaryText)
      if closable {
        Button(action: close) {
          Image(systemName: "xmark").font(.system(size: 9, weight: .semibold)).foregroundStyle(AglynColor.textTertiary)
            .frame(width: 12, height: 12)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Close tab")
      }
    }
    .padding(.horizontal, 10)
    .frame(height: AglynShellMetrics.barButton)
    // As wide as its title, to a cap; past it the owner truncates and the screen stays whole.
    .frame(maxWidth: 260, alignment: .leading)
    .fixedSize(horizontal: true, vertical: false)
    .background(
      RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous)
        .fill(selected ? AglynColor.paper : hovered ? AglynColor.hover : .clear))
    .overlay(
      RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous)
        .strokeBorder(selected ? AglynColor.divider : .clear))
    .contentShape(Rectangle())
    .onTapGesture(perform: select)
    .onHover { hovered = $0 }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
  }
}

/// Dragging the chrome's empty space moves the window, as a title bar does.
struct WindowDragArea: ViewModifier {
  func body(content: Content) -> some View {
    #if os(macOS)
      if #available(macOS 15.0, *) {
        content.gesture(WindowDragGesture())
      } else {
        content
      }
    #else
      content
    #endif
  }
}

/// What every layout of the shell carries: its sheets and popovers, the account's look, and the bookkeeping that
/// follows the person (recent workspaces, recents, history, another account in use).
struct ShellFrame<Content: View>: View {
  @Environment(AppModel.self) private var model
  #if os(macOS)
    @Environment(\.openWindow) private var openWindow
  #endif
  @Bindable var navigation: ShellNavigation
  let compact: Bool
  @ViewBuilder let content: () -> Content
  @State private var askedKeepPins = false
  /// The site this window last showed, so a site that leaves the list (deleted) is told from a switch.
  @State private var shownSite = WorkspaceStore.ShownSiteWatch()

  var body: some View {
    content()
      .sheet(item: $navigation.picker) { picker in
        ScopePickerSheet(start: picker, twoStep: compact).environment(model).environment(navigation)
      }
      .sheet(item: $navigation.pinFull) { PinnedFullSheet(pending: $0).environment(model) }
      .sheet(item: $navigation.colorFor) { WorkspaceColorSheet(target: $0).environment(model) }
      .sheet(isPresented: $navigation.showAddAccount) { AddAccountView().environment(model) }
      .sheet(isPresented: $navigation.showAccount) { AccountSheet().environment(model).environment(navigation) }
      .sheet(isPresented: keepPinsShown) { KeepPinsSheet().environment(model) }
      #if os(iOS)
        // A phone's search is the same box, full screen; a wide window's is the title bar's field and its dropdown.
        .fullScreenCover(isPresented: compact ? $navigation.showOneBox : .constant(false)) {
          PhoneSearchView().environment(model).environment(navigation)
        }
      #endif
      .sheet(isPresented: $navigation.showAddWorkspace) {
        AddWorkspaceSheet { navigation.showAddWorkspace = false }.environment(model)
      }
      .sheet(isPresented: $navigation.showShortcuts) { KeyboardShortcutsSheet() }
      .environment(\.aglynScreenSession, model.screenSession)
      .aglynAppTheme(nonce: navigation.themeNonce)
      .onAppear {
        DebugLaunch.route(navigation)
        #if os(macOS)
          navigation.openTab = { [openWindow] seed in openWindow(id: "main", value: seed) }
        #endif
      }
      // Every screen that offers "Choose a site" asks for the site picker.
      .onChange(of: navigation.showSwitcher) { _, asked in
        guard asked else { return }
        navigation.showSwitcher = false
        navigation.picker = compact ? .workspace : .site
      }
      .onChange(of: model.workspace?.org?.id, initial: true) { _, orgID in
        if let orgID { model.preferences?.opened(orgID: orgID) }
      }
      .onChange(of: model.workspace?.orgs.map(\.id) ?? []) { _, ids in model.auth?.recordWorkspaces(ids) }
      // A site on screen that is deleted (or taken away) leaves for the whole workspace's Sites, as View all sites does,
      // never for the next site with the same screen still open (a deleted site's Danger zone stayed open on another).
      .onChange(of: model.workspace?.sites.map(\.id) ?? []) { leaveARemovedSite() }
      .onChange(of: model.workspace?.effective, initial: true) { leaveARemovedSite() }
      .onChange(of: navigation.section) { _, section in
        navigation.record(section)
        recordRecent(section)
        // At rest only the group holding the place in use is open (Figma 12:703); a group opened by hand stays open
        // until the next place is opened.
        if !compact { navigation.openGroups = navigation.openGroups.filter { $0.hasSuffix(".folded") } }
      }
      // Another account in use, or a support session: nothing open belonged to it.
      .onChange(of: model.auth?.user?.uid) {
        navigation.paths = [:]
        navigation.mode = .main
        navigation.section = .home
      }
  }

  private func leaveARemovedSite() {
    guard let workspace = model.workspace else { return }
    let leave = shownSite.update(
      orgID: workspace.org?.id, pickedHostID: workspace.effective.hostID, sites: workspace.sites, ready: workspace.ready,
      inSite: navigation.inSite)
    if leave, navigation.front {
      navigation.enterWorkspace()
      navigation.select(.plugin("site.sites"))
    }
  }


  /// Asked once of an account with more than five pins (which five to keep).
  private var keepPinsShown: Binding<Bool> {
    Binding(
      get: { !askedKeepPins && model.preferences?.mustPickPins == true },
      set: { if !$0 { askedKeepPins = true } })
  }

  /// Notes the row just opened in the account's recents.
  private func recordRecent(_ section: ShellSection) {
    let scope = ShellScope(model: model, navigation: navigation)
    guard section != .home, let row = scope.row(for: section), let item = model.itemRef(for: row, navigation: navigation)
    else { return }
    model.preferences?.opened(item)
  }
}

/// The Mac and iPad layout: the rail and the scope's sidebar, the detail, the title bar's items, and the AI panel
/// docked on the right.
struct WideShell: View {
  @Environment(AppModel.self) private var model
  @Bindable var navigation: ShellNavigation
  @State private var unreadFeed = NotificationFeed()

  /// Unread notifications, by workspace: the rail's badges.
  private var unreadByOrg: [String: Int] {
    var counts: [String: Int] = [:]
    for row in unreadFeed.rows ?? [] where !row.read {
      let orgID = row.orgID ?? row.hostID.flatMap { id in model.workspace?.sites.first { $0.id == id }?.orgID }
      if let orgID { counts[orgID, default: 0] += 1 }
    }
    return counts
  }

  var body: some View {
    // One flush row of columns under the title bar (Figma Mac 13:483): the rail, the sidebar with a hairline after it,
    // and the place in use. Not a split view: its sidebar floats as an inset card the design does not have.
    HStack(spacing: 0) {
      if !navigation.railHidden {
        WorkspaceRail(unread: unreadByOrg)
          .transition(.move(edge: .leading).combined(with: .opacity))
      }
      if !navigation.sidebarHidden {
        ShellSidebar()
          .background(workspaceTint)
          .frame(width: AglynShellMetrics.sidebarWidth)
          .overlay(alignment: .trailing) { Rectangle().fill(AglynColor.divider).frame(width: 1) }
          .transition(.move(edge: .leading).combined(with: .opacity))
      }
      ShellStack(navigation: navigation, section: navigation.section)
        .id(navigation.section)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AglynColor.paper)
        .inspector(isPresented: $navigation.showAssist) {
          AssistSlot()
            .inspectorColumnWidth(min: 300, ideal: 360, max: 480)
        }
    }
    .environment(\.aglynWideChrome, true)
    .task(id: "\(model.auth?.user?.uid ?? ""):\(model.refreshToken)") {
      unreadFeed.start(
        reader: model.reader, uid: model.auth?.user?.uid, count: 100, filter: NotificationFilter(status: .new))
    }
  }

  /// The light tint a workspace's color lays over the sidebar while you are in it.
  @ViewBuilder
  private var workspaceTint: some View {
    let color = model.workspaceColor(model.workspace?.org?.id)
    if color.tintsApp, let tint = Color(aglynHex: color.color) {
      tint.opacity(0.06)
    }
  }
}

/// The Mac's title bar as Figma draws it: one plain bar in the theme's title-bar color across the window, with a
/// hairline under it and no window title (the tabs and the place say where you are).
struct MacTitleBar: ViewModifier {
  func body(content: Content) -> some View {
    #if os(macOS)
      if #available(macOS 15.0, *) {
        content
          .toolbar(removing: .title)
          .toolbarBackground(AglynColor.titlebar, for: .windowToolbar)
          .toolbarBackgroundVisibility(.visible, for: .windowToolbar)
      } else {
        content.toolbarBackground(AglynColor.titlebar, for: .windowToolbar)
      }
    #else
      content
    #endif
  }
}

/// The AI panel: the widgets a plugin puts in the `assistPanel` slot (the AI plugin's Assist), handed the console path
/// of the screen in use and its title, so the shell never names AI.
struct AssistSlot: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation

  static let slot = "assistPanel"

  static func available(_ model: AppModel) -> Bool { !model.registry.widgets(for: model.app, slot: slot).isEmpty }

  var body: some View {
    let scope = ShellScope(model: model, navigation: navigation)
    let row = scope.row(for: navigation.section)
    let place = navigation.section == .home ? "Home" : row?.label
    let scopeName = scope.site?.name ?? scope.org?.name
    let title = [place, scopeName].compactMap { $0 }.joined(separator: " · ")
    // The context chip wears the place's own icon (Figma AI sheet 21:314, AI panel 18:485).
    let icon = navigation.section == .home ? "house" : (row?.appleIcon ?? "eye")
    let orgSlug = model.workspace?.org?.slug ?? ""
    let site = scope.site
    let route =
      "/\(orgSlug)" + (site.map { "/hosts/\($0.subdomain.isEmpty ? $0.id : $0.subdomain)" } ?? "")
      + (row.map(Self.consolePath) ?? "")
    VStack(spacing: 0) {
      if let context = model.context(for: navigation) {
        ForEach(model.registry.widgets(for: model.app, slot: Self.slot)) { widget in
          widget.make(context).id("\(widget.id):\(context.orgID ?? ""):\(context.hostID ?? "")")
        }
      }
    }
    .environment(
      \.aglynSlotParams,
      ["route": route, "title": title, "icon": icon, "place": place ?? "", "scope": scopeName ?? ""])
  }

  /// A row's console path within its scope, from the manifest's console reference.
  static func consolePath(_ row: NativeNavRow) -> String {
    switch row.console.surface {
    case .hostPluginTab, .orgPluginTab, .hostPluginSection, .orgPluginSection: row.console.id
    case .setupSection: "/setup/\(row.console.id)"
    default: ""
    }
  }
}

/// One section's navigation stack.
struct ShellStack: View {
  @Environment(AppModel.self) private var model
  @Bindable var navigation: ShellNavigation
  let section: ShellSection

  var body: some View {
    NavigationStack(path: navigation.path(section)) {
      ShellRoot(section: section)
        .phoneTopBar()
        .wideBarHidden()
        .navigationDestination(for: Route.self) { route in
          PushedScreen(section: section) {
            if case .area(let screen, let params) = route {
              AreaView(screen: screen, params: params, pushed: true)
            } else {
              RouteView(route: route)
            }
          }
          .phoneAssistOnPushed(route)
          .wideBarHidden()
        }
    }
    // A detail a screen opens goes on this stack's path, so a later push (a page in the browser) never drops it.
    .environment(\.aglynPush, AglynPushAction { [weak navigation] view in navigation?.push(.view(view)) })
  }
}

extension View {
  /// On iPad, as on the Mac, the window's drawn chrome and the screen's head replace the system navigation bar (Figma
  /// iPad frames): a screen's title, way back and actions are in its head.
  func wideBarHidden() -> some View { modifier(WideBarHidden()) }
}

/// No system bar where the shell draws its own chrome: the navigation bar on iPad, and on the Mac the window toolbar a
/// pushed screen would bring back (its back chevron and a screen's own items floated over the tab row).
private struct WideBarHidden: ViewModifier {
  @Environment(\.aglynWideChrome) private var wide

  func body(content: Content) -> some View {
    #if os(iOS)
      content.toolbar(wide ? .hidden : .automatic, for: .navigationBar)
    #else
      content
        .navigationBarBackButtonHidden(wide)
        .toolbar(wide ? .hidden : .automatic, for: .windowToolbar)
    #endif
  }
}

/// A screen pushed over a section's list, with its head on the Mac and iPad (the window has no toolbar there): the way
/// back to the list, its title, and its actions (`aglynScreenTitle`, `aglynPrimaryAction`, `aglynScreenToolbar`).
struct PushedScreen<Content: View>: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @Environment(\.aglynWideChrome) private var wide
  @Environment(\.dismiss) private var dismiss
  let section: ShellSection
  /// Whether the head offers the way back (a pushed screen) or not (a section's own first screen).
  var back = true
  @ViewBuilder let content: () -> Content

  /// The head's height, kept clear above the screen.
  private var headHeight: CGFloat { back ? 92 : 70 }

  var body: some View {
    if wide {
      // The screen fills the area under its head, so the head stays at the top on a screen that draws less than the
      // window (the Besigner's loading state had the head centred around its spinner, AGL-4002).
      content()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .safeAreaInset(edge: .top, spacing: 0) { AglynColor.paper.frame(height: headHeight) }
        .overlayPreferenceValue(AglynScreenChromeKey.self, alignment: .top) { chrome in
          head(chrome)
        }
    } else {
      content()
    }
  }

  private func head(_ chrome: AglynScreenChrome) -> some View {
    let parent = section == .home ? "Home" : ShellScope(model: model, navigation: navigation).row(for: section)?.label ?? "Back"
    return VStack(alignment: .leading, spacing: 10) {
      if back {
      Button {
        dismiss()
      } label: {
        HStack(spacing: 4) {
          Image(systemName: "chevron.left").font(.system(size: 10, weight: .semibold))
          Text(parent).font(.system(size: AglynShellMetrics.rowText - 1))
        }
        .foregroundStyle(AglynColor.secondaryText)
      }
      .buttonStyle(.plain)
      .accessibilityIdentifier("pushed-back")
      }
      HStack(spacing: 8) {
        Text(chrome.title ?? "")
          .font(.system(size: 22, weight: .semibold))
          .foregroundStyle(AglynColor.textPrimary)
          .lineLimit(1)
          .accessibilityAddTraits(.isHeader)
        Spacer(minLength: 8)
        HStack(spacing: 8) { ForEach(chrome.entries) { $0.content } }
          .buttonStyle(AglynHeaderButtonStyle())
          .menuStyle(.button)
          .fixedSize()
        if let primary = chrome.primary {
          AglynPrimaryHeaderButton(
            primary.title, systemImage: primary.systemImage, shortcut: primary.shortcut, help: primary.help
          ) { primary.run() }
            .disabled(!primary.enabled)
            .opacity(primary.enabled ? 1 : 0.5)
            .accessibilityIdentifier(primary.id)
        }
      }
      .frame(height: 36)
    }
    .padding(.horizontal, AglynContentInsets.horizontal)
    .padding(.top, 18)
    .frame(maxWidth: .infinity, alignment: .topLeading)
  }
}

/// A section's first screen.
struct ShellRoot: View {
  let section: ShellSection

  var body: some View {
    switch section {
    case .home: HomeView()
    case .notifications: PushedScreen(section: .home, back: false) { NotificationsView().aglynScreenTitle("Notifications") }
    case .settings: PushedScreen(section: .home, back: false) { SettingsView().aglynScreenTitle("Settings") }
    case .more: MenuScreen()
    case .analytics: AnalyticsView()
    case .plugin(let screen): AreaView(screen: screen, params: [:])
    case .place(let screen, let params): AreaView(screen: screen, params: params)
    }
  }
}

/// An area of the scope (Orders, Products, Pages…): its screen, with its sections as chips across the top when the
/// screen does not draw its own (Orders, Returns, Reservations inside Orders), and its actions (Scan stock, New product)
/// in the title bar.
struct AreaView: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @Environment(\.aglynWideChrome) private var wide
  let screen: String
  let params: NativeParams
  /// Pushed on a phone's stack (a Menu row), rather than a section's own first screen.
  var pushed = false

  /// The areas whose screens draw their own section chips.
  private static let selfSectioned: Set<String> = ["crm", "emails", "marketing", "marketplace"]

  /// A section chip: the sidebar's selection on the Mac and iPad; on a phone the pushed area swaps for the section in
  /// place, so every section stays one tap from its area (AGL-3993).
  private func choose(_ target: ShellSection) {
    if pushed || !wide { navigation.swapArea(target) } else { navigation.select(target) }
  }

  var body: some View {
    let row = ShellScope(model: model, navigation: navigation).row(for: ShellSection.opening(screen, params))
    let sections = (row?.sections ?? []).filter { model.registry.screen($0.screen) != nil }
    let actions = (row?.actions ?? []).filter { model.registry.screen($0.screen) != nil }
    // A screen that heads its own list column (Figma Orders 13:483; on a phone its own title row, 22:499) gets the head's
    // parts instead of the head, the section chips and the phone's star and actions.
    let columnHead = AglynListColumnHead.screens.contains(screen)
    PluginScreenView(screenID: screen, params: params)
      .environment(\.aglynAreaHead, columnHead ? row.map { areaHead($0, sections: sections) } : nil)
      .safeAreaInset(edge: .top, spacing: 0) {
        if !columnHead {
          VStack(alignment: .leading, spacing: 0) {
            if wide, let row {
              // The area's head in its content (Figma Mac Sites 13:3): breadcrumbs, the title with its star, and the
              // one filled primary button.
              AglynContentHeader(row.label) {
                Breadcrumbs(row: row)
              } accessory: {
                starButton(row)
                Spacer(minLength: 8)
                // The screen's own actions and primary button are drawn over this row from its preferences (below).
              }
            }
            if let row, sections.count > 1, !Self.selfSectioned.contains(row.id) {
              ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: AglynSpace.one) {
                  ForEach(sections, id: \.id) { section in
                    let target = ShellSection.opening(section.screen, section.params)
                    AglynChoiceChip(section.label, selected: target == ShellSection.opening(screen, params)) {
                      choose(target)
                    }
                    .accessibilityIdentifier("area-section-\(section.id)")
                  }
                }
                .padding(.horizontal, wide ? AglynContentInsets.horizontal : AglynSpace.two)
                .padding(.vertical, AglynSpace.one)
              }
              .background(wide ? AnyShapeStyle(AglynColor.paper) : AnyShapeStyle(.bar))
              .accessibilityIdentifier("area-sections-\(row.id)")
            }
          }
        }
      }
      .overlayPreferenceValue(AglynScreenChromeKey.self, alignment: .top) { chrome in
        if wide, !columnHead, let row {
          // The area's own create action stands in when the screen names no primary action of its own.
          let fallback = (actions.first(where: { $0.params?["new"] == "1" }) ?? actions.first).map { first in
            AglynPrimaryAction(id: "area-action-\(first.id)", title: first.label, systemImage: first.icon.apple, enabled: true) {
              navigation.push(.screen(first.screen, first.params ?? [:]))
            }
          }
          AreaHeaderActions(row: row, primary: chrome.primary ?? fallback, entries: chrome.entries)
        }
      }
      .toolbar {
        // On a phone the star and the area's actions stay in the navigation bar.
        if !wide, !columnHead, let row, let item = model.itemRef(for: row, navigation: navigation) {
          ToolbarItem(placement: .primaryAction) {
            let starred = model.preferences?.isStarred(item) == true
            Button {
              model.preferences?.toggleStar(item)
            } label: {
              Label(starred ? "Unstar \(row.label)" : "Star \(row.label)", systemImage: starred ? "star.fill" : "star")
            }
            .help(starred ? "Unstar" : "Star")
            .accessibilityIdentifier("titlebar-star")
          }
        }
        if !wide, !columnHead, !actions.isEmpty {
          ToolbarItemGroup(placement: .primaryAction) {
            ForEach(actions, id: \.id) { action in
              Button(action.label, systemImage: action.icon.apple) {
                navigation.push(.screen(action.screen, action.params ?? [:]))
              }
              .accessibilityIdentifier("area-action-\(action.id)")
            }
          }
        }
      }
  }

  /// The head's parts for a screen that draws them in its list column: title, breadcrumbs, star and sections.
  private func areaHead(_ row: NativeNavRow, sections: [NativeNavSection]) -> AglynAreaHead {
    AglynAreaHead(
      title: row.label, crumbs: AnyView(Breadcrumbs(row: row)), star: AnyView(starButton(row)),
      sections: sections.count > 1
        ? sections.map { section in
          let target = ShellSection.opening(section.screen, section.params)
          return AglynAreaSection(
            id: section.id, label: section.label, selected: target == ShellSection.opening(screen, params)
          ) { choose(target) }
        } : [])
  }

  /// The star beside the area's title: the place on the person's Starred list.
  @ViewBuilder
  private func starButton(_ row: NativeNavRow) -> some View {
    if let item = model.itemRef(for: row, navigation: navigation) {
      let starred = model.preferences?.isStarred(item) == true
      Button {
        model.preferences?.toggleStar(item)
      } label: {
        Image(systemName: starred ? "star.fill" : "star")
          .font(.system(size: AglynShellMetrics.rowIcon - 1))
          .foregroundStyle(starred ? AnyShapeStyle(AglynColor.warning) : AnyShapeStyle(AglynColor.textTertiary))
      }
      .buttonStyle(.plain)
      .help(starred ? "Unstar" : "Star")
      .accessibilityLabel(starred ? "Unstar \(row.label)" : "Star \(row.label)")
      .accessibilityIdentifier("titlebar-star")
    }
  }
}

/// The screen's own actions over its head's title row on the Mac and iPad: laid out like the head (an invisible copy of
/// its breadcrumbs keeps the row's height) so they sit exactly on the title row's trailing edge.
struct AreaHeaderActions: View {
  let row: NativeNavRow
  let primary: AglynPrimaryAction?
  let entries: [AglynScreenToolbarEntry]

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Breadcrumbs(row: row).hidden()
      HStack(spacing: 8) {
        Spacer(minLength: 0)
        HStack(spacing: 8) {
          ForEach(entries) { $0.content }
        }
        .buttonStyle(AglynHeaderButtonStyle())
        .menuStyle(.button)
        .fixedSize()
        .frame(height: 36)
        if let primary {
          // Off for a reason, it says why: on hover on the Mac, on a tap on iPad.
          AglynPrimaryHeaderButton.blockable(primary)
        }
      }
    }
    .padding(.horizontal, AglynContentInsets.horizontal)
    .padding(.top, 20)
    .frame(maxWidth: .infinity, alignment: .topLeading)
  }
}

/// Where an area sits: its site or workspace, its group, and itself ("Juniper Street Bakery › Sell › Orders"), on the
/// Mac and iPad, where the title bar shows the area's own name.
struct Breadcrumbs: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif
  let row: NativeNavRow?

  var body: some View {
    #if os(iOS)
      if sizeClass == .regular { crumbs }
    #else
      crumbs
    #endif
  }

  @ViewBuilder
  private var crumbs: some View {
    let scope = ShellScope(model: model, navigation: navigation)
    if let row {
      let group = scope.currentList.groups.first { $0.rows.contains { $0.id == row.id } }?.label
      let owner = navigation.mode == .main ? (scope.site?.name ?? scope.org?.name) : scope.modeTitle
      let parts = [owner, group, row.label].compactMap { $0 }
      HStack(spacing: 6) {
        ForEach(Array(parts.enumerated()), id: \.offset) { index, part in
          if index > 0 {
            Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(AglynColor.textTertiary)
          }
          Text(part).font(.system(size: AglynShellMetrics.rowText - 1, weight: index == parts.count - 1 ? .medium : .regular))
            .foregroundStyle(index == parts.count - 1 ? AglynColor.textPrimary : AglynColor.secondaryText)
            .lineLimit(1)
        }
      }
      .accessibilityElement(children: .combine)
      .accessibilityIdentifier("breadcrumbs")
    }
  }
}

/// A title-bar button (Figma Titlebar/Icon button): a line symbol in the secondary text color on a square that fills
/// faintly under the pointer, with no glass of its own.
struct TitleBarButton: View {
  let title: String
  let systemImage: String
  let identifier: String
  let action: () -> Void

  init(_ title: String, systemImage: String, identifier: String, action: @escaping () -> Void) {
    self.title = title
    self.systemImage = systemImage
    self.identifier = identifier
    self.action = action
  }

  var body: some View {
    Button(action: action) {
      AglynBarSymbol(systemImage: systemImage)
    }
    .buttonStyle(.plain)
    .help(title)
    .accessibilityLabel(title)
    .accessibilityIdentifier(identifier)
  }
}

/// The recent places beside Back and Forward: what the person opened lately, from the account's recents.
struct RecentPlacesMenu: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation

  var body: some View {
    Menu {
      let recents = Array((model.preferences?.recents ?? []).prefix(12))
      if recents.isEmpty { Text("Nothing opened yet") }
      ForEach(recents, id: \.key) { item in
        Button(recentTitle(item)) { open(item) }
      }
    } label: {
      AglynBarSymbol(systemImage: "clock")
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .menuIndicator(.hidden)
    .fixedSize()
    .accessibilityLabel("Recent")
    .help("Recent")
    .accessibilityIdentifier("titlebar-recent")
  }

  private func recentTitle(_ item: RecentItem) -> String {
    let site = item.hostId.flatMap { id in model.workspace?.sites.first { $0.id == id }?.name }
    let org = model.workspace?.orgs.first { $0.id == item.orgId }?.name
    return "\(item.label) — \(site ?? org ?? "")"
  }

  private func open(_ item: RecentItem) {
    if item.orgId != model.workspace?.org?.id { model.workspace?.open(orgID: item.orgId, hostID: item.hostId) }
    if let hostID = item.hostId {
      model.workspace?.selectSite(hostID)
      navigation.inSite = true
    } else {
      navigation.inSite = false
    }
    navigation.mode = .main
    navigation.select(ShellSection.opening(item.screen, item.params))
  }
}

// MARK: iPhone

/// The phone shell: the scope chip, search, the bell and your photo in the top bar of every tab's first screen, and the
/// tab bar (Home, the site's busiest area, Inbox, Menu).
struct PhoneShell: View {
  @Environment(AppModel.self) private var model
  @Bindable var navigation: ShellNavigation
  /// A tab's count from its row's count view (Inbox's unread), worn as the tab's badge (Figma Phone/Tab bar 22:499).
  @State private var counts: [String: Int] = [:]

  /// The tabs for where the person stands: the busiest area is Orders for a store, Pages for a site without one, and
  /// Sites for the whole workspace.
  private var tabs: [(section: ShellSection, title: String, icon: String)] {
    let scope = ShellScope(model: model, navigation: navigation)
    let rows = scope.mainList.groups.flatMap(\.rows)
    func tab(_ id: String) -> (ShellSection, String, String)? {
      rows.first { $0.id == id }.map { (ShellSection.opening($0.screen, $0.params), $0.label, $0.appleIcon) }
    }
    var out: [(ShellSection, String, String)] = [(.home, "Home", "house")]
    if let busiest = scope.inSite ? (tab("orders") ?? tab("pages")) : tab("sites") { out.append(busiest) }
    out.append((PhoneShell.createTab, "Create", "plus.circle.fill"))
    if let inbox = tab("inbox") { out.append(inbox) }
    out.append((.more, "Menu", "line.3.horizontal"))
    return out
  }

  /// The centre tab's tag: never a section of its own.
  static let createTab = ShellSection.plugin("shell.create")

  /// The manifest row a tab opens ("inbox"), for its count; empty for Home, Create and Menu.
  private func tabRowID(_ section: ShellSection) -> String {
    let scope = ShellScope(model: model, navigation: navigation)
    return scope.mainList.groups.flatMap(\.rows).first { ShellSection.opening($0.screen, $0.params) == section }?.id ?? ""
  }

  #if os(iOS)
    /// Figma Phone/Tab item, in the theme in force: the shared `AglynPhoneTabBar` (the bold look's pill and gradient +
    /// on a phone in the Aglyn theme, AGL-3990).
    static func styleTabBar() { AglynPhoneTabBar.style() }

    /// Create new's tile in the tab bar (`AglynPhoneTabBar.createTile`).
    @MainActor static var createTile: UIImage? { AglynPhoneTabBar.createTile }
  #endif

  var body: some View {
    let tabs = tabs
    TabView(selection: $navigation.section) {
      ForEach(tabs, id: \.section) { tab in
        Group {
          if tab.section == PhoneShell.createTab { Color.clear } else { ShellStack(navigation: navigation, section: tab.section) }
        }
          .tabItem {
            #if os(iOS)
              if tab.section == PhoneShell.createTab, let tile = PhoneShell.createTile {
                // The centre tab is the filled accent "+" tile (Figma Phone/Tab bar, Create), drawn as it is.
                Image(uiImage: tile.withRenderingMode(.alwaysOriginal)).renderingMode(.original).accessibilityLabel("Create")
              } else {
                // Line icons, as Figma's tab bar (a tab bar fills its symbols unless told not to); in the bold look the
                // tab in use is its white icon on the #00B0FF pill.
                if navigation.section == tab.section, let pill = AglynPhoneTabBar.activeIcon(tab.icon) {
                  Label { Text(tab.title) } icon: { Image(uiImage: pill).renderingMode(.original) }
                } else {
                  Label(tab.title, systemImage: tab.icon).environment(\.symbolVariants, .none)
                }
              }
            #else
              Label(tab.title, systemImage: tab.icon)
            #endif
          }
          .badge(counts[tabRowID(tab.section)] ?? 0)
          .tag(tab.section)
      }
    }
    // The tabs' rows' count views, unseen, so each tab can wear its count.
    .background {
      if let context = model.context(for: navigation) {
        ForEach(tabs.map { tabRowID($0.section) }.filter { !$0.isEmpty }, id: \.self) { rowID in
          ForEach(model.registry.widgets(for: model.app, slot: "sidebarCount.\(rowID)")) { widget in
            widget.make(context).id("\(widget.id):\(context.orgID ?? ""):\(context.hostID ?? "")")
              .onPreferenceChange(AglynCountKey.self) { count in
                MainActor.assumeIsolated { counts[rowID] = count ?? 0 }
              }
          }
        }
        .hidden()
        .accessibilityHidden(true)
      }
    }
    #if os(iOS)
      .onAppear { PhoneShell.styleTabBar() }
    #endif
    .sheet(isPresented: $navigation.showNotifications) {
      NotificationsPopover().environment(model).environment(navigation)
    }
    .sheet(isPresented: $navigation.showCreate) { CreateNewSheet().environment(model).environment(navigation) }
    .sheet(isPresented: $navigation.showAssist) {
      // Figma iPhone / Sheet / AI 21:314: the grabber, the title centered, Done in the trailing corner, then the panel.
      NavigationStack {
        AssistSlot()
          .navigationTitle("\(model.brandName) AI")
          #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(AglynColor.paper, for: .navigationBar)
          #endif
          .toolbar {
            ToolbarItem(placement: .confirmationAction) {
              Button("Done") { navigation.showAssist = false }
                .fontWeight(.semibold)
                .tint(AglynColor.textPrimary)
                .accessibilityIdentifier("assist-done")
            }
          }
      }
      .environment(model).environment(navigation)
      .presentationDetents([.large])
      .presentationDragIndicator(.visible)
      .presentationBackground(AglynColor.paper)
    }
    .onChange(of: navigation.section, initial: true) { previous, section in
      // The centre tab is Create new: it opens the sheet and stays on the tab you were on.
      if section == PhoneShell.createTab {
        navigation.section = previous == PhoneShell.createTab ? .home : previous
        navigation.showCreate = true
        return
      }
      // A section with no tab of its own opens in Menu, an area with its section chips (AGL-3993).
      guard !tabs.contains(where: { $0.section == section }) else { return }
      navigation.openInMenu(section)
    }
  }
}

/// The phone's top bar: the scope chip on the leading side; the bell and your photo on the trailing side.
struct PhoneTopBar: ViewModifier {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif

  func body(content: Content) -> some View {
    #if os(iOS)
      content.toolbar {
        if sizeClass == .compact {
        ToolbarItem(placement: .topBarLeading) { ScopeChip() }
        // One item, not a group: with search, the bell, AI and your photo as separate items, a phone's bar folds the
        // last of them into a "More" menu, and AI must stay one tap away (Figma Phone/Top bar 273:20194).
        ToolbarItem(placement: .topBarTrailing) {
          HStack(spacing: AglynSpace.one) {
            Button {
              navigation.showOneBox = true
            } label: {
              Label("Search or jump to", systemImage: "magnifyingglass")
            }
            // Grey, as Figma's top bar (22:499); the accent is for the action in use.
            .tint(AglynColor.secondaryText)
            .accessibilityIdentifier("topbar-search")
            Button {
              navigation.showNotifications = true
            } label: {
              Label("Notifications", systemImage: "bell")
            }
            .tint(AglynColor.secondaryText)
            .accessibilityIdentifier("topbar-bell")
            // Your AI, one tap away on every screen, as the Mac's and iPad's title bar has it (Figma Phone/Top bar
            // 273:20194): after the bell, before your photo.
            if AssistSlot.available(model) {
              PhoneAssistButton()
            }
            Button {
              navigation.showAccount = true
            } label: {
              AglynAccountAvatar(initials: AccountIdentity(model: model).initials, size: 28)
            }
            .accessibilityLabel("Your account")
            .accessibilityIdentifier("topbar-account")
          }
          .labelStyle(.iconOnly)
        }
        }
      }
    #else
      content
    #endif
  }
}

extension View {
  /// The phone's top bar, on a tab's first screen.
  func phoneTopBar() -> some View { modifier(PhoneTopBar()) }

  /// Your AI on a phone's pushed screen (Figma Phone/Top bar, Pushed): on the navigation bar's trailing edge, after the
  /// screen's own actions, so it is one tap away wherever you are.
  func phoneAssistOnPushed(_ route: Route) -> some View { modifier(PhoneAssistOnPushed(route: route)) }
}

/// The top bar's AI button: a grey line ✦ like the bell beside it, opening the AI sheet.
struct PhoneAssistButton: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation

  var body: some View {
    Button {
      navigation.showAssist = true
    } label: {
      Label("\(model.brandName) AI", systemImage: "sparkles")
    }
    .tint(AglynColor.secondaryText)
    .accessibilityIdentifier("topbar-ai")
  }
}

private struct PhoneAssistOnPushed: ViewModifier {
  @Environment(AppModel.self) private var model
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif
  let route: Route

  /// The in-app browser keeps its own bar (Figma 22:712): its page is not a screen the AI reads.
  private var shown: Bool {
    if case .web = route { return false }
    return AssistSlot.available(model)
  }

  func body(content: Content) -> some View {
    #if os(iOS)
      content.toolbar {
        if sizeClass == .compact && shown {
          ToolbarItem(placement: .topBarTrailing) { PhoneAssistButton() }
        }
      }
    #else
      content
    #endif
  }
}

/// The scope chip: the site (or the whole workspace) the phone stands in; opens the two-step picker.
struct ScopeChip: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation

  var body: some View {
    let site = model.scopedSite(navigation)
    let name = site?.name ?? model.workspace?.org?.name ?? "Switch"
    Button {
      navigation.picker = .workspace
    } label: {
      HStack(spacing: 6) {
        if let site {
          AglynBrandPicture(model.mediaURL(site.favicon, hostID: site.id), size: 20, cornerRadius: 10) {
            AglynWorkspaceTile(name: site.name, logoURL: nil, colorHex: model.workspaceColor(model.workspace?.org?.id).color, selected: false, size: 20)
          }
        } else if let org = model.workspace?.org {
          PinTile(orgID: org.id, size: 20)
        }
        Text(name).font(AglynFont.strongSubheadline).lineLimit(1)
        Image(systemName: "chevron.down").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
      }
      // Figma Phone/Scope chip 11:313: a filled sunken capsule, no border, 6 points before the picture and 12 after (raised
      // with a hairline in the phone's bold look, AGL-3990).
      .padding(.leading, 6)
      .padding(.trailing, 12)
      .padding(.vertical, 4)
      .aglynPhoneChip()
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Switch, \(name)")
    .accessibilityIdentifier("scope-chip")
  }
}

/// Menu on a phone: the same grouped list as the Mac sidebar, under the scope's header.
struct MenuScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation

  var body: some View {
    let scope = ShellScope(model: model, navigation: navigation)
    VStack(spacing: 0) {
      if navigation.mode == .main {
        // Your AI and help sit in Menu on a phone, never floating over content (Figma 22:176, "Quick").
        HStack(spacing: 10) {
          if AssistSlot.available(model) {
            quick("\(model.brandName) AI", "sparkles", ai: true) { navigation.showAssist = true }
              .accessibilityIdentifier("menu-ai")
          }
          Menu {
            HelpMenuItems()
          } label: {
            quickLabel("Help and docs", "questionmark.circle")
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("menu-help")
        }
        .padding(EdgeInsets(top: 12, leading: 16, bottom: 4, trailing: 16))
        // The workspace and its ▾, the Mac sidebar's own header and menu (WorkspaceMenuItems): Workspace settings,
        // Members, Billing, Upgrade plan. In a site too, so a phone reaches them the one way a Mac does.
        WorkspaceButton()
          .padding(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
      }
      // A settings mode says where it is and leads back; the everyday Menu is under the scope chip.
      if navigation.mode != .main {
        ScopeHeader(scope: scope)
      }
      SidebarList(scope: scope, push: true)
    }
    // The list sits on the paper surface under the title, which stays on the page ground (Figma 22:176); in the bold
    // look the panel's top corners round and the ground carries the brand's glow (AGL-3990).
    .aglynPhonePanel()
    .aglynPhoneGround()
    .navigationTitle(scope.modeTitle ?? "Menu")
  }

  private func quick(_ title: String, _ icon: String, ai: Bool = false, action: @escaping () -> Void) -> some View {
    Button(action: action) { quickLabel(title, icon, ai: ai) }.buttonStyle(.plain)
  }

  /// One of Menu's two quick buttons: an icon and a label on a 44-point card.
  /// In the phone's bold look (AGL-3990) the AI card wears the brand's wash and its sparkle the gradient, and help's
  /// icon is the quiet secondary shade.
  private func quickLabel(_ title: String, _ icon: String, ai: Bool = false) -> some View {
    let bold = AglynThemeRuntime.shared.phoneBold
    let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
    return HStack(spacing: 10) {
      if ai {
        AglynAIGlyph(size: 17)
      } else {
        Image(systemName: icon).font(.system(size: 17)).foregroundStyle(bold ? AglynColor.secondaryText : AglynColor.accentIcon)
      }
      Text(title).font(.system(size: 15, weight: bold ? .semibold : .medium)).foregroundStyle(AglynColor.textPrimary).lineLimit(1)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 14)
    .frame(maxWidth: .infinity, minHeight: 44)
    .background {
      if ai && bold { shape.fill(AglynBrandGradient.wash) } else { shape.fill(AglynColor.sunken) }
    }
    .contentShape(Rectangle())
  }
}

/// Your account on a phone: a sheet with the account menu's places (Figma Phone 2:7, "Account sheet").
struct AccountSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @Environment(\.dismiss) private var dismiss
  @State private var confirmSignOut = false

  var body: some View {
    let identity = AccountIdentity(model: model)
    NavigationStack {
      List {
        Section {
          VStack(spacing: 6) {
            AglynAccountAvatar(initials: identity.initials, size: 64)
            Text(identity.name).font(AglynFont.headline)
            if let email = identity.email, email != identity.name {
              Text(email).font(AglynFont.subheadline).foregroundStyle(.secondary)
            }
          }
          .frame(maxWidth: .infinity)
          .listRowBackground(Color.clear)
        }
        Section {
          ThemeRow()
          row("Theme settings", "paintpalette") { navigation.push(.themeSettings) }
          row("Settings", "gearshape") { navigation.push(.settings) }
          if model.registry.screen(AccountPlaces.marketplaceScreen) != nil {
            row("Marketplace", "storefront") { navigation.push(.screen(AccountPlaces.marketplaceScreen, [:])) }
          }
          if let docs = AccountPlaces.documentation(model) { row("Documentation", "book") { navigation.openWeb(docs) } }
          if model.registry.screen(AccountPlaces.reportScreen) != nil {
            row("Report an issue", "flag") { navigation.push(.screen(AccountPlaces.reportScreen, [:])) }
          }
        }
        if let auth = model.auth {
          Section("Accounts") {
            ForEach(auth.accounts) { account in
              Button {
                Task { await auth.switchAccount(to: account.slot) }
                dismiss()
              } label: {
                HStack(spacing: 10) {
                  AglynAccountAvatar(initials: account.initials, size: 28)
                  VStack(alignment: .leading, spacing: 1) {
                    Text(account.displayName ?? account.email ?? "Account").font(AglynFont.body)
                    if let email = account.email, account.displayName != nil {
                      Text(email).font(AglynFont.caption).foregroundStyle(.secondary)
                    }
                  }
                  Spacer()
                  if account.slot == auth.activeSlot && auth.impersonation == nil {
                    Image(systemName: "checkmark").foregroundStyle(AglynColor.tint)
                  }
                }
              }
              .buttonStyle(.aglynRow)
              .accessibilityIdentifier("account-\(account.email ?? account.slot)")
            }
            if auth.canAddAccounts {
              row("Add account", "person.badge.plus") {
                // The sheets take turns: this one closes, then Add account opens.
                Task { @MainActor in
                  try? await Task.sleep(nanoseconds: 350_000_000)
                  navigation.showAddAccount = true
                }
              }
              .accessibilityIdentifier("account-add")
            }
          }
        }
        Section {
          Button("Sign out", role: .destructive) { confirmSignOut = true }
            .accessibilityIdentifier("settings-sign-out")
        }
      }
      .navigationTitle("Account")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
      .signOutConfirmation(isPresented: $confirmSignOut)
    }
  }

  private func row(_ title: String, _ icon: String, action: @escaping () -> Void) -> some View {
    Button {
      dismiss()
      action()
    } label: {
      AglynRow(title, systemImage: icon) {
        Image(systemName: "chevron.forward").font(.caption).foregroundStyle(.tertiary)
      }
    }
    .buttonStyle(.aglynRow)
  }
}

/// Theme on the phone's account sheet: light, dark or the system's.
private struct ThemeRow: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    if let preferences = model.preferences {
      Picker(
        selection: Binding(
          get: { preferences.appTheme.appearance },
          set: { value in
            var theme = preferences.appTheme
            theme.appearance = value
            preferences.setAppTheme(theme)
          })
      ) {
        Text("Light").tag(AppAppearance.light)
        Text("Dark").tag(AppAppearance.dark)
        Text("Match system").tag(AppAppearance.system)
      } label: {
        Label("Theme", systemImage: "circle.lefthalf.filled")
      }
      .accessibilityIdentifier("account-theme")
    }
  }
}

/// One thing Create new can make where the window stands.
struct CreateAction: Identifiable {
  let id: String
  let label: String
  let icon: String
  let screen: String
  let params: [String: String]
  /// Why it cannot be made here, shown on the disabled item; nil when it can.
  let blocked: String?
}

extension ShellScope {
  /// What Create new lists for this scope, from the manifest's menu (`resolveCreateList`): an item of a plugin that is
  /// off is not offered; one the person's role, site role or plan stands in front of is listed disabled with why. An
  /// item whose screen this build lacks is left out.
  var createActions: [CreateAction] {
    let scope: NativeNavCreateScope = inSite ? .site : .workspace
    let items = NativeNav.manifest.create?.first(where: { $0.scope == scope })?.items ?? []
    let access = model.orgAccess
    let resolved = resolveCreateList(
      scope, enabledPluginIds: inSite ? sitePlugins : workspacePlugins,
      permissions: access.permissions(items.compactMap(\.permission)),
      features: access.features(items.compactMap(\.planFeature)), hostRole: inSite ? (hostAdmin ? "admin" : site?.role) : nil)
    return resolved.filter { model.registry.screen($0.screen) != nil }.map { item in
      CreateAction(
        id: item.id, label: item.label, icon: item.icon.apple, screen: item.screen, params: item.params ?? [:],
        blocked: item.blocked ? item.reason : nil)
    }
  }
}

/// Create new on a phone: the same items as a sheet.
struct CreateNewSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    let scope = ShellScope(model: model, navigation: navigation)
    NavigationStack {
      List {
        Section(scope.site.map { "In \($0.name)" } ?? scope.org.map { "In \($0.name)" } ?? "") {
          ForEach(scope.createActions) { action in
            Button {
              dismiss()
              navigation.mode = .main
              navigation.push(.screen(action.screen, action.params))
            } label: {
              AglynRow(action.label, subtitle: action.blocked, systemImage: action.icon)
            }
            .buttonStyle(.aglynRow)
            .disabled(action.blocked != nil)
            .accessibilityIdentifier("create-\(action.id)")
          }
        }
        Section {
          Button {
            dismiss()
            navigation.showAddWorkspace = true
          } label: {
            AglynRow("Workspace", systemImage: "building.2")
          }
          .buttonStyle(.aglynRow)
        }
      }
      .navigationTitle("Create new")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
    }
    .presentationDetents([.medium])
  }
}

/// Create new's items: the scope's makes, a blocked one disabled with its reason; then Add workspace.
struct CreateNewItems: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation

  var body: some View {
    let scope = ShellScope(model: model, navigation: navigation)
    Section(scope.site.map { "In \($0.name)" } ?? scope.org.map { "In \($0.name)" } ?? "") {
      ForEach(scope.createActions) { action in
        Button {
          navigation.mode = .main
          navigation.push(.screen(action.screen, action.params))
        } label: {
          if let blocked = action.blocked {
            Label("\(action.label) — \(blocked)", systemImage: action.icon)
          } else {
            Label(action.label, systemImage: action.icon)
          }
        }
        .disabled(action.blocked != nil)
        .accessibilityIdentifier("create-\(action.id)")
      }
    }
    Section {
      Button("Workspace", systemImage: "building.2") { navigation.showAddWorkspace = true }
        .accessibilityIdentifier("create-workspace")
    }
  }
}
