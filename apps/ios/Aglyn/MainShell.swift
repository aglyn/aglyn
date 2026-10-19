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
  @State private var columns: NavigationSplitViewVisibility = .all
  @State private var unreadFeed = NotificationFeed()
  @State private var askedKeepPins = false
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
  #else
    private let compact = false
  #endif

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
    Group {
      if compact { PhoneShell(navigation: navigation) } else { sidebarLayout }
    }
    .sheet(item: $navigation.picker) { picker in
      ScopePickerSheet(start: picker, twoStep: compact).environment(model).environment(navigation)
    }
    .sheet(item: $navigation.pinFull) { PinnedFullSheet(pending: $0).environment(model) }
    .sheet(item: $navigation.colorFor) { WorkspaceColorSheet(target: $0).environment(model) }
    .sheet(isPresented: $navigation.showAddAccount) { AddAccountView().environment(model) }
    .sheet(isPresented: $navigation.showAccount) { AccountSheet().environment(model).environment(navigation) }
    .sheet(isPresented: keepPinsShown) { KeepPinsSheet().environment(model) }
    .environment(\.aglynScreenSession, model.screenSession)
    .preferredColorScheme(model.preferences?.appTheme.appearance.colorScheme)
    .onAppear { DebugLaunch.route(navigation) }
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
    .onChange(of: navigation.section) { _, section in recordRecent(section) }
    // Another account in use, or a support session: nothing open belonged to it.
    .onChange(of: model.auth?.user?.uid) {
      navigation.paths = [:]
      navigation.mode = .main
      navigation.section = .home
    }
    .task(id: "\(model.auth?.user?.uid ?? ""):\(model.refreshToken)") {
      unreadFeed.start(
        reader: model.reader, uid: model.auth?.user?.uid, count: 100, filter: NotificationFilter(status: .new))
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

  // MARK: iPad and Mac

  private var sidebarLayout: some View {
    NavigationSplitView(columnVisibility: $columns) {
      HStack(spacing: 0) {
        WorkspaceRail(unread: unreadByOrg)
        Divider()
        ShellSidebar()
          .background(workspaceTint)
      }
      #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
      #endif
      #if os(macOS)
        .navigationSplitViewColumnWidth(min: 300, ideal: WorkspaceRail.width + 252, max: 380)
      #else
        .navigationSplitViewColumnWidth(WorkspaceRail.width + 260)
      #endif
    } detail: {
      ShellStack(navigation: navigation, section: navigation.section)
        .id(navigation.section)
        .toolbar { TitleBarItems(unread: unreadFeed.rows?.filter { !$0.read }.count ?? 0) }
    }
    .navigationSplitViewStyle(.balanced)
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
  let screen: String
  let params: NativeParams

  /// The areas whose screens draw their own section chips.
  private static let selfSectioned: Set<String> = ["crm", "emails", "marketing", "marketplace"]

  var body: some View {
    let row = ShellScope(model: model, navigation: navigation).row(for: ShellSection.opening(screen, params))
    let sections = (row?.sections ?? []).filter { model.registry.screen($0.screen) != nil }
    PluginScreenView(screenID: screen, params: params)
      .safeAreaInset(edge: .top, spacing: 0) {
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
            .padding(.horizontal, AglynSpace.two)
            .padding(.vertical, AglynSpace.one)
          }
          .background(.bar)
          .accessibilityIdentifier("area-sections-\(row.id)")
        }
      }
      .toolbar {
        if let actions = row?.actions, !actions.isEmpty {
          ToolbarItemGroup(placement: .primaryAction) {
            ForEach(actions.filter { model.registry.screen($0.screen) != nil }, id: \.id) { action in
              Button(action.label, systemImage: action.icon.apple) {
                navigation.push(.screen(action.screen, action.params ?? [:]))
              }
              .accessibilityIdentifier("area-action-\(action.id)")
            }
          }
        }
      }
  }
}

/// The title bar's own items on the Mac and iPad: the bell (the account menu lives at the foot of the rail).
struct TitleBarItems: ToolbarContent {
  @Environment(ShellNavigation.self) private var navigation
  let unread: Int

  var body: some ToolbarContent {
    ToolbarItem(placement: .primaryAction) {
      Button {
        navigation.select(.notifications)
      } label: {
        Label(unread > 0 ? "Notifications, \(unread) unread" : "Notifications", systemImage: unread > 0 ? "bell.badge" : "bell")
      }
      .help("Notifications")
      .accessibilityIdentifier("titlebar-bell")
    }
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
    if let inbox = tab("inbox") { out.append(inbox) }
    out.append((.more, "Menu", "line.3.horizontal"))
    return out
  }

  var body: some View {
    let tabs = tabs
    TabView(selection: $navigation.section) {
      ForEach(tabs, id: \.section) { tab in
        ShellStack(navigation: navigation, section: tab.section)
          .tabItem { Label(tab.title, systemImage: tab.icon) }
          .tag(tab.section)
      }
    }
    .onChange(of: navigation.section, initial: true) { _, section in
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
            navigation.push(.notifications)
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

/// Create new's items (Phase 2 fills them from the console's create actions for the scope).
struct CreateNewItems: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation

  var body: some View {
    Button("Site", systemImage: "globe") {
      navigation.enterWorkspace()
      navigation.select(.plugin("site.sites"))
    }
  }
}
