// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import AglynUI
import SwiftUI

/// A plugin screen the shell lists as its own section: each plugin tab,
/// then each quick action that opens a screen.
struct SidebarScreen: Identifiable, Hashable {
  let id: String
  let title: String
  let icon: String
  let screen: String
  let requiresSite: Bool

  @MainActor
  static func all(_ model: AppModel) -> [SidebarScreen] {
    var seen = Set<String>()
    var items: [SidebarScreen] = []
    for tab in model.registry.tabs(for: .aglyn) where seen.insert(tab.screen).inserted {
      items.append(
        SidebarScreen(
          id: tab.id, title: tab.title, icon: tab.icon, screen: tab.screen,
          requiresSite: model.registry.screen(tab.screen)?.requiresSite ?? false))
    }
    // A quick action that carries params (New product, Ship orders) is an action, not a place: the sidebar
    // opens a screen with none, so such an action stays on Home.
    for action in model.registry.quickActions(for: .aglyn) where action.params.isEmpty {
      let screen = action.screen
      guard seen.insert(screen).inserted else { continue }
      items.append(
        SidebarScreen(
          id: action.id, title: action.title, icon: action.icon, screen: screen, requiresSite: action.requiresSite))
    }
    return items
  }
}

/// The signed-in "Aglyn" shell: a tab bar on iPhone, a sidebar on iPad and Mac.
struct MainShell: View {
  @Environment(AppModel.self) private var model
  @Bindable var navigation: ShellNavigation
  @State private var columns: NavigationSplitViewVisibility = .all

  var body: some View {
    // The sidebar or the tab bar is the window's own choice, by its width class alone.
    WideLayoutReader(minimumWidth: nil) { wide in
      if wide { sidebarLayout } else { tabLayout }
    }
    .sheet(isPresented: $navigation.showSwitcher) {
      SwitcherView().environment(model)
    }
    .environment(\.aglynScreenSession, model.screenSession)
    .onAppear { DebugLaunch.route(navigation) }
  }

  private var screens: [SidebarScreen] { SidebarScreen.all(model) }

  @ViewBuilder
  private func root(_ section: ShellSection) -> some View {
    switch section {
    case .home: HomeView()
    case .notifications: NotificationsView()
    case .settings: SettingsView()
    case .more: MoreView()
    case .analytics: AnalyticsView()
    case .plugin(let screen): PluginScreenView(screenID: screen)
    }
  }

  private func stack(_ section: ShellSection) -> some View {
    NavigationStack(path: navigation.path(section)) {
      root(section)
        .navigationDestination(for: Route.self) { RouteView(route: $0) }
    }
  }

  // MARK: iPhone

  /// The plugin tabs that get a tab of their own on iPhone. A tab bar holds
  /// five items before iOS folds the rest into its own "More" list, so Home,
  /// Notifications and the app's More take three and the plugins share the
  /// other two; every other plugin screen, and Settings, sits in More.
  static let phonePluginTabLimit = 2

  @MainActor
  static func phonePluginTabs(_ model: AppModel) -> [NativeTab] {
    Array(model.registry.tabs(for: .aglyn).prefix(phonePluginTabLimit))
  }

  private var tabLayout: some View {
    TabView(selection: $navigation.section) {
      stack(.home)
        .tabItem { Label("Home", systemImage: "house") }
        .tag(ShellSection.home)
      ForEach(Self.phonePluginTabs(model)) { tab in
        stack(.plugin(tab.screen))
          .tabItem { Label(tab.title, systemImage: tab.icon) }
          .tag(ShellSection.plugin(tab.screen))
      }
      stack(.notifications)
        .tabItem { Label("Notifications", systemImage: "bell") }
        .tag(ShellSection.notifications)
      stack(.more)
        .tabItem { Label("More", systemImage: "ellipsis.circle") }
        .tag(ShellSection.more)
    }
    .onChange(of: navigation.section, initial: true) { _, section in
      // Settings, or a plugin tab past the limit, has no tab here: open it in More.
      switch section {
      case .settings:
        navigation.section = .more
        navigation.push(.settings)
      case .plugin(let screen) where !Self.phonePluginTabs(model).contains(where: { $0.screen == screen }):
        navigation.section = .more
        navigation.push(.screen(screen, [:]))
      default: break
      }
    }
  }

  // MARK: iPad and Mac

  /// Every sidebar section in order, for the arrow keys.
  private var sidebarOrder: [ShellSection] {
    var order: [ShellSection] = [.home, .notifications]
    if model.workspace?.site != nil { order.append(.analytics) }
    order += screens.map { .plugin($0.screen) }
    order += CoreGroupList.groups(model).flatMap { $0.screens.map { ShellSection.plugin($0.id) } }
    #if os(iOS)
      order.append(.settings)
    #endif
    return order
  }

  private var sidebarSelection: Binding<ShellSection?> {
    Binding(get: { navigation.section }, set: { if let s = $0 { navigation.section = s } })
  }

  private func sidebarRow(_ title: String, systemImage: String, _ section: ShellSection, id: String? = nil) -> some View {
    Label {
      Text(title).font(AglynFont.body).lineLimit(1)
    } icon: {
      Image(systemName: systemImage).foregroundStyle(AglynColor.tint)
    }
    .aglynSelectableRow(section, selection: sidebarSelection, density: .sidebar)
    .accessibilityIdentifier(id ?? "sidebar-\(section.id)")
  }

  private var sidebarLayout: some View {
    NavigationSplitView(columnVisibility: $columns) {
      // The lockup is pinned at the top in a bar of its own and the list starts below it, so no row ever scrolls
      // under it; the switcher's footer bar does the same at the foot.
      VStack(spacing: 0) {
        SidebarBrandHeader(name: model.brandName)
        sidebarList
      }
      #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
      #endif
      #if os(macOS)
        .navigationSplitViewColumnWidth(min: 210, ideal: 240)
      #endif
    } detail: {
      stack(navigation.section)
        .id(navigation.section)
    }
    .navigationSplitViewStyle(.balanced)
  }

  private var sidebarList: some View {
    List {
      Section {
        sidebarRow("Home", systemImage: "house", .home)
        sidebarRow("Notifications", systemImage: "bell", .notifications)
      }
      if model.workspace?.site != nil || !screens.isEmpty {
        Section(model.workspace?.site?.name ?? "Site") {
          if model.workspace?.site != nil {
            sidebarRow("Analytics", systemImage: "chart.bar.xaxis", .analytics)
          }
          ForEach(screens) { item in
            sidebarRow(item.title, systemImage: item.icon, .plugin(item.screen))
          }
        }
      }
      // The console's own areas (core screens, libs/native/screens), by group.
      ForEach(CoreGroupList.groups(model), id: \.id) { group in
        Section(group.heading) {
          ForEach(group.screens) { screen in
            sidebarRow(screen.label, systemImage: screen.icon, .plugin(screen.id), id: "sidebar-\(screen.id)")
          }
        }
      }
      #if os(iOS)
        Section {
          sidebarRow("Settings", systemImage: "gearshape", .settings)
        }
      #endif
    }
    .listStyle(.sidebar)
    .aglynSelectionKeys(sidebarOrder, selection: sidebarSelection)
    .navigationTitle(model.brandName)
    // The switcher sits in a footer bar of its own; the list insets above it, so it never covers a row.
    .safeAreaInset(edge: .bottom, spacing: 0) { ScopeFooter() }
  }
}

/// The brand lockup pinned at the head of the sidebar, in a bar of its own: the
/// logo kit's art (dark appearance included), never re-typed, with the mark's
/// height of clear space on every side.
struct SidebarBrandHeader: View {
  let name: String
  #if os(macOS)
    private let height: CGFloat = 20
  #else
    private let height: CGFloat = 24
  #endif

  var body: some View {
    VStack(spacing: 0) {
      AglynArtwork.logo.resizable().scaledToFit().frame(height: height)
        .padding(.vertical, height)
        .padding(.horizontal, height)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel(name)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("sidebar-brand")
      Divider()
    }
    .background(.bar)
  }
}

/// The picked workspace and site at the foot of the sidebar, in a footer bar
/// of its own; opens the switcher.
struct ScopeFooter: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation

  var body: some View {
    VStack(spacing: 0) {
      Divider()
      Button {
        navigation.showSwitcher = true
      } label: {
        HStack(spacing: 10) {
          IconBadge(
            "building.2", tone: .info, size: 28,
            imageURL: model.mediaURL(model.workspace?.orgLogo?.light, hostID: nil),
            darkImageURL: model.mediaURL(model.workspace?.orgLogo?.dark, hostID: nil))
          VStack(alignment: .leading, spacing: 1) {
            Text(model.workspace?.org?.name ?? "No workspace").font(AglynFont.strongSubheadline).lineLimit(1)
            Text(model.workspace?.site?.name ?? "Pick a site").font(AglynFont.caption).foregroundStyle(.secondary).lineLimit(1)
          }
          Spacer(minLength: 0)
          Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(.secondary)
        }
      }
      .buttonStyle(AglynSelectableRowStyle(selected: false, density: .list))
      .padding(.horizontal, 8)
      .padding(.vertical, 8)
      .help("Switch workspace or site")
      .accessibilityLabel("Switch workspace or site")
      .accessibilityIdentifier("sidebar-switcher")
    }
    .background(.bar)
  }
}

/// Every area the app has a screen for that the tab bar has no room for,
/// on iPhone: the plugins' site screens, then the app's own.
struct MoreView: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation

  var body: some View {
    let tabs = Set(MainShell.phonePluginTabs(model).map(\.screen))
    let screens = SidebarScreen.all(model).filter { !tabs.contains($0.screen) }
    List {
      if model.workspace?.site != nil || !screens.isEmpty {
        Section(model.workspace?.site?.name ?? "Site") {
          if model.workspace?.site != nil {
            Button {
              navigation.push(.analytics)
            } label: {
              AglynRow("Analytics", systemImage: "chart.bar.xaxis") {
                Image(systemName: "chevron.forward").font(.caption).foregroundStyle(.tertiary)
              }
            }
            .buttonStyle(.aglynRow)
            .accessibilityIdentifier("more-analytics")
          }
          ForEach(screens) { item in
            Button {
              navigation.push(.screen(item.screen, [:]))
            } label: {
              AglynRow(item.title, systemImage: item.icon) {
                Image(systemName: "chevron.forward").font(.caption).foregroundStyle(.tertiary)
              }
            }
            .buttonStyle(.aglynRow)
            .accessibilityIdentifier("more-\(item.id)")
          }
        }
      }
      Section {
        Button {
          navigation.select(.notifications)
        } label: {
          AglynRow("Notifications", systemImage: "bell")
        }
        .buttonStyle(.aglynRow)
        Button {
          navigation.push(.settings)
        } label: {
          AglynRow("Settings", systemImage: "gearshape")
        }
        .buttonStyle(.aglynRow)
      }
    }
    .aglynListBackground()
    .navigationTitle("More")
  }
}

