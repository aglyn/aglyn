// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
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
    for action in model.registry.quickActions(for: .aglyn) {
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
    WideLayoutReader { wide in
      if wide { sidebarLayout } else { tabLayout }
    }
    .sheet(isPresented: $navigation.showSwitcher) {
      SwitcherView().environment(model)
    }
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

  private var sidebarLayout: some View {
    NavigationSplitView(columnVisibility: $columns) {
      List(selection: Binding<ShellSection?>(get: { navigation.section }, set: { if let s = $0 { navigation.section = s } })) {
        Section {
          Label("Home", systemImage: "house").tag(ShellSection.home)
          Label("Notifications", systemImage: "bell").tag(ShellSection.notifications)
        }
        if !screens.isEmpty {
          Section(model.workspace?.site?.name ?? "Site") {
            ForEach(screens) { item in
              Label(item.title, systemImage: item.icon).tag(ShellSection.plugin(item.screen))
            }
          }
        }
        #if os(iOS)
          Section {
            Label("Settings", systemImage: "gearshape").tag(ShellSection.settings)
          }
        #endif
      }
      .navigationTitle(model.brandName)
      #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
      #endif
      .safeAreaInset(edge: .top) {
        AglynArtwork.logo.resizable().scaledToFit().frame(height: 28)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 20).padding(.vertical, 12)
          .accessibilityLabel(model.brandName)
          .accessibilityAddTraits(.isHeader)
      }
      #if os(macOS)
        .navigationSplitViewColumnWidth(min: 200, ideal: 230)
      #endif
      .safeAreaInset(edge: .bottom) { ScopeFooter() }
    } detail: {
      stack(navigation.section)
        .id(navigation.section)
    }
    .navigationSplitViewStyle(.balanced)
  }
}

/// The picked workspace and site at the foot of the sidebar; opens the switcher.
struct ScopeFooter: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation

  var body: some View {
    Button {
      navigation.showSwitcher = true
    } label: {
      HStack(spacing: 10) {
        Image(systemName: "building.2").foregroundStyle(AglynColor.tint).accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 1) {
          Text(model.workspace?.org?.name ?? "No workspace").font(AglynFont.strongSubheadline).lineLimit(1)
          Text(model.workspace?.site?.name ?? "Pick a site").font(AglynFont.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        Spacer(minLength: 0)
        Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(.secondary)
      }
      .padding(12)
      .background(AglynColor.paper, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
      .padding(10)
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Switch workspace or site")
    .accessibilityIdentifier("sidebar-switcher")
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
      if !screens.isEmpty {
        Section(model.workspace?.site?.name ?? "Site") {
          ForEach(screens) { item in
            Button {
              navigation.push(.screen(item.screen, [:]))
            } label: {
              AglynRow(item.title, systemImage: item.icon) {
                Image(systemName: "chevron.forward").font(.caption).foregroundStyle(.tertiary)
              }
            }
            .buttonStyle(.plain)
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
        .buttonStyle(.plain)
        Button {
          navigation.push(.settings)
        } label: {
          AglynRow("Settings", systemImage: "gearshape")
        }
        .buttonStyle(.plain)
      }
    }
    .aglynListBackground()
    .navigationTitle("More")
  }
}
