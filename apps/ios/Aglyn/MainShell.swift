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
      ShellChrome(strip: strip).environment(current)
      ShellFrame(navigation: current, compact: false) { WideShell(navigation: current) }
        .id(ObjectIdentifier(current))
        .environment(current)
        .focusedSceneValue(\.shellNavigation, current)
    }
    .focusedSceneValue(\.shellTabs, strip)
    #if os(macOS)
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
  @Bindable var strip: TabStrip
  @State private var unreadFeed = NotificationFeed()

  #if os(macOS)
    static let tabRow: CGFloat = 34
    static let toolRow: CGFloat = 44
  #else
    static let tabRow: CGFloat = 40
    static let toolRow: CGFloat = 48
  #endif

  var body: some View {
    @Bindable var navigation = navigation
    let unread = unreadFeed.rows?.filter { !$0.read }.count ?? 0
    VStack(spacing: 0) {
      // The tab strip: the window's buttons, the tabs (each as wide as its title, to a cap), "+".
      HStack(spacing: 4) {
        Color.clear.frame(width: AglynShellMetrics.trafficLights, height: 1)
        ForEach(Array(strip.tabs.enumerated()), id: \.offset) { index, tab in
          ChromeTab(
            title: index == 0 ? "Home" : tabTitle(tab, model: model), systemImage: index == 0 ? "house" : "square.on.square",
            selected: index == strip.selected, closable: index > 0
          ) {
            strip.select(index, model: model)
          } close: {
            strip.close(index, model: model, closedTabs: model.closedTabs)
          }
          .accessibilityIdentifier("tab-\(index)")
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
          TitleBarButton("Back", systemImage: "chevron.left", identifier: "titlebar-back") { navigation.goBack() }
            .disabled(!navigation.canGoBack)
          TitleBarButton("Forward", systemImage: "chevron.right", identifier: "titlebar-forward") { navigation.goForward() }
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
        TitleBarSearchField { navigation.showOneBox = true }
      }
      .padding(.horizontal, 12)
      .frame(height: Self.toolRow)
      .overlay(alignment: .bottom) { Rectangle().fill(AglynColor.divider).frame(height: 1) }
    }
    .background(AglynColor.titlebar)
    .modifier(WindowDragArea())
    .task(id: "\(model.auth?.user?.uid ?? ""):\(model.refreshToken)") {
      unreadFeed.start(
        reader: model.reader, uid: model.auth?.user?.uid, count: 100, filter: NotificationFilter(status: .new))
    }
  }
}

/// One tab in the strip: as wide as its title up to a cap, the title cut with an ellipsis past it.
struct ChromeTab: View {
  let title: String
  let systemImage: String
  let selected: Bool
  let closable: Bool
  let select: () -> Void
  let close: () -> Void
  @State private var hovered = false

  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: systemImage).font(.system(size: AglynShellMetrics.rowText - 2))
        .foregroundStyle(selected ? AglynColor.accentIcon : AglynColor.secondaryText)
      Text(title).font(.system(size: AglynShellMetrics.rowText - 1, weight: selected ? .semibold : .regular))
        .foregroundStyle(selected ? AglynColor.textPrimary : AglynColor.secondaryText)
        .lineLimit(1).truncationMode(.tail)
      if closable {
        Button(action: close) {
          Image(systemName: "xmark").font(.system(size: 9, weight: .semibold)).foregroundStyle(AglynColor.textTertiary)
        }
        .buttonStyle(.plain)
        .opacity(selected || hovered ? 1 : 0)
        .accessibilityLabel("Close tab")
      }
    }
    .padding(.horizontal, 10)
    .frame(height: AglynShellMetrics.barButton)
    .frame(maxWidth: 200, alignment: .leading)
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
      .sheet(isPresented: $navigation.showOneBox) { OneBoxView().environment(model).environment(navigation) }
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
      .onChange(of: navigation.section) { _, section in
        navigation.record(section)
        recordRecent(section)
      }
      // Another account in use, or a support session: nothing open belonged to it.
      .onChange(of: model.auth?.user?.uid) {
        navigation.paths = [:]
        navigation.mode = .main
        navigation.section = .home
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
    let title = [navigation.section == .home ? "Home" : row?.label, scope.site?.name ?? scope.org?.name]
      .compactMap { $0 }.joined(separator: " · ")
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
    .environment(\.aglynSlotParams, ["route": route, "title": title])
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
        .navigationDestination(for: Route.self) { RouteView(route: $0) }
    }
    // A detail a screen opens goes on this stack's path, so a later push (a page in the browser) never drops it.
    .environment(\.aglynPush, AglynPushAction { [weak navigation] view in navigation?.push(.view(view)) })
  }
}

/// A section's first screen.
struct ShellRoot: View {
  let section: ShellSection

  var body: some View {
    switch section {
    case .home: HomeView()
    case .notifications: NotificationsView()
    case .settings: SettingsView()
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

  /// The areas whose screens draw their own section chips.
  private static let selfSectioned: Set<String> = ["crm", "emails", "marketing", "marketplace"]

  var body: some View {
    let row = ShellScope(model: model, navigation: navigation).row(for: ShellSection.opening(screen, params))
    let sections = (row?.sections ?? []).filter { model.registry.screen($0.screen) != nil }
    let actions = (row?.actions ?? []).filter { model.registry.screen($0.screen) != nil }
    PluginScreenView(screenID: screen, params: params)
      .safeAreaInset(edge: .top, spacing: 0) {
        VStack(alignment: .leading, spacing: 0) {
          if wide, let row {
            // The area's head in its content (Figma Mac Sites 13:3): breadcrumbs, the title with its star, and the one
            // filled primary button.
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
                    navigation.select(target)
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
      .overlayPreferenceValue(AglynScreenChromeKey.self, alignment: .top) { chrome in
        if wide, let row {
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
        if !wide, let row, let item = model.itemRef(for: row, navigation: navigation) {
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
        if !wide, !actions.isEmpty {
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
          AglynPrimaryHeaderButton(primary.title, systemImage: primary.systemImage) { primary.run() }
            .disabled(!primary.enabled)
            .opacity(primary.enabled ? 1 : 0.5)
            .accessibilityIdentifier(primary.id)
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

/// The title bar's own items on the Mac and iPad (Figma Mac/Titlebar): Back, Forward and the recent places, the
/// "Search or jump to ⌘K" field that opens the one box, and the bell with its popover. The account menu lives at the
/// foot of the rail.
struct TitleBarItems: ToolbarContent {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let unread: Int

  var body: some ToolbarContent {
    @Bindable var navigation = navigation
    ToolbarItemGroup(placement: .navigation) {
      // Shows or hides the workspace rail (the sidebar's own hide is in the View menu, ⌥⌘S).
      TitleBarButton(
        navigation.railHidden ? "Show workspace switcher" : "Hide workspace switcher", systemImage: "sidebar.left",
        identifier: "titlebar-rail"
      ) {
        withAnimation(.easeOut(duration: 0.2)) { navigation.railHidden.toggle() }
      }
      .keyboardShortcut("s", modifiers: [.control, .command])
      TitleBarButton("Back", systemImage: "chevron.left", identifier: "titlebar-back") { navigation.goBack() }
        .disabled(!navigation.canGoBack)
      TitleBarButton("Forward", systemImage: "chevron.right", identifier: "titlebar-forward") { navigation.goForward() }
        .disabled(!navigation.canGoForward)
      RecentPlacesMenu()
    }
    .aglynPlainToolbarBackground()
    // The one search, centered in the title bar.
    ToolbarItem(placement: .principal) {
      TitleBarSearchField { navigation.showOneBox = true }
    }
    .aglynPlainToolbarBackground()
    // The right side, in Figma's order: the bell, Help, the AI panel.
    ToolbarItemGroup(placement: .primaryAction) {
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
    .aglynPlainToolbarBackground()
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

/// "Search or jump to ⌘K" in the title bar (Figma Titlebar/Search field): a recessed field that opens the one box.
struct TitleBarSearchField: View {
  let action: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "magnifyingglass").font(.system(size: AglynShellMetrics.rowText - 1))
        .foregroundStyle(AglynColor.textTertiary)
      Text("Search or jump to").font(.system(size: AglynShellMetrics.rowText)).foregroundStyle(AglynColor.textTertiary)
      Spacer(minLength: 8)
      Text("⌘K").font(.system(size: AglynShellMetrics.rowText - 2, weight: .medium)).foregroundStyle(AglynColor.secondaryText)
        .padding(.horizontal, 5).padding(.vertical, 1)
        .background(RoundedRectangle(cornerRadius: 4, style: .continuous).fill(AglynColor.paper))
        .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(AglynColor.divider))
    }
    .padding(.horizontal, 10)
    // Centered on the window, 240 to 480 points wide (Figma Mac/Titlebar 12:910).
    .frame(minWidth: 240, maxWidth: 480)
    .frame(height: AglynShellMetrics.barButton)
    .background(RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous).fill(AglynColor.sunken))
    .overlay(
      RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous).strokeBorder(AglynColor.divider))
    .contentShape(Rectangle())
    .onTapGesture(perform: action)
    .help("Search or jump to (⌘K)")
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Search or jump to")
    .accessibilityAddTraits(.isButton)
    .accessibilityAction { action() }
    .accessibilityIdentifier("titlebar-search")
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

  var body: some View {
    let tabs = tabs
    TabView(selection: $navigation.section) {
      ForEach(tabs, id: \.section) { tab in
        Group {
          if tab.section == PhoneShell.createTab { Color.clear } else { ShellStack(navigation: navigation, section: tab.section) }
        }
          .tabItem { Label(tab.title, systemImage: tab.icon) }
          .tag(tab.section)
      }
    }
    .sheet(isPresented: $navigation.showNotifications) {
      NotificationsPopover().environment(model).environment(navigation)
    }
    .sheet(isPresented: $navigation.showCreate) { CreateNewSheet().environment(model).environment(navigation) }
    .sheet(isPresented: $navigation.showAssist) {
      NavigationStack {
        AssistSlot()
          .navigationTitle("\(model.brandName) AI")
          #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
          #endif
          .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { navigation.showAssist = false } } }
      }
      .environment(model).environment(navigation)
      .presentationDetents([.large])
    }
    .onChange(of: navigation.section, initial: true) { previous, section in
      // The centre tab is Create new: it opens the sheet and stays on the tab you were on.
      if section == PhoneShell.createTab {
        navigation.section = previous == PhoneShell.createTab ? .home : previous
        navigation.showCreate = true
        return
      }
      // A section with no tab of its own opens in Menu.
      guard !tabs.contains(where: { $0.section == section }) else { return }
      navigation.section = .more
      switch section {
      case .settings: navigation.push(.settings)
      case .notifications: navigation.push(.notifications)
      case .analytics: navigation.push(.analytics)
      case .plugin(let screen): navigation.push(.screen(screen, [:]))
      case .place(let screen, let params): navigation.push(.screen(screen, params))
      default: break
      }
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
        ToolbarItemGroup(placement: .topBarTrailing) {
          Button {
            navigation.showOneBox = true
          } label: {
            Label("Search or jump to", systemImage: "magnifyingglass")
          }
          .accessibilityIdentifier("topbar-search")
          Button {
            navigation.showNotifications = true
          } label: {
            Label("Notifications", systemImage: "bell")
          }
          .accessibilityIdentifier("topbar-bell")
          Button {
            navigation.showAccount = true
          } label: {
            AglynAccountAvatar(initials: AccountIdentity(model: model).initials, size: 28)
          }
          .accessibilityLabel("Your account")
          .accessibilityIdentifier("topbar-account")
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
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(Capsule().fill(AglynColor.paper))
      .overlay(Capsule().strokeBorder(AglynColor.divider))
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
        // Your AI and help sit in Menu on a phone, never floating over content.
        HStack(spacing: AglynSpace.one) {
          if AssistSlot.available(model) {
            Button {
              navigation.showAssist = true
            } label: {
              Label("\(model.brandName) AI", systemImage: "sparkles").frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("menu-ai")
          }
          Menu {
            HelpMenuItems()
          } label: {
            Label("Help and docs", systemImage: "questionmark.circle").frame(maxWidth: .infinity)
          }
          .accessibilityIdentifier("menu-help")
        }
        .buttonStyle(.bordered)
        .padding(.horizontal, AglynSpace.two)
        .padding(.top, AglynSpace.one)
      }
      if navigation.mode != .main || scope.site != nil {
        ScopeHeader(scope: scope)
      }
      SidebarList(scope: scope, push: true)
    }
    .background(AglynColor.page)
    .navigationTitle(scope.modeTitle ?? "Menu")
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
