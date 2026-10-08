// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import SwiftUI

/// Which app a contribution shows in.
public enum AglynAppKind: String, Sendable, CaseIterable {
  case aglyn
  case pos
}

/// Where a POS contribution sits in the register.
public enum POSPlacement: String, Sendable {
  case register, tender, peripheral, menu
}

public enum WidgetSize: String, Sendable {
  /// Pairs two widgets on a row in a wide window; narrow windows stack everything.
  case half
  case full
}

/// How a console path is scoped when a plugin names it: under the picked
/// site, under the workspace, or whole (the Kotlin kit's `ConsoleScope`).
public enum ConsoleScope: Sendable {
  /// Prefixed with the picked site: `/{org}/hosts/{site}{path}`.
  case site
  /// Prefixed with the picked workspace: `/{org}{path}`.
  case org
  /// Opened as given.
  case absolute
}

/// What a plugin's screen, widget or action is given: the picked workspace
/// and site, the Firestore reader under the console's own rules, the console
/// API client, navigation, and the Besigner (the only web content the apps
/// show; every other console area is a native screen). `hostID` is nil until a site is picked; a
/// contribution that needs one says `requiresSite`.
public struct NativePluginContext {
  public let uid: String
  public let orgID: String?
  public let hostID: String?
  /// The console's URL slugs for the same pick (`/{orgSlug}/hosts/{hostSlug}`).
  public let orgSlug: String?
  public let hostSlug: String?
  public let firestore: FirestoreReader
  public let api: ConsoleAPIClient
  /// Writes the console makes straight to Firestore (no route), made the
  /// same way under the same security rules, as the signed-in person.
  public let writer: FirestoreWriter
  private let navigateAction: @MainActor (String, NativeParams) -> Void
  private let openBesignerAction: @MainActor (String) -> Void

  public init(
    uid: String, orgID: String?, hostID: String?, orgSlug: String?, hostSlug: String?,
    firestore: FirestoreReader, api: ConsoleAPIClient, writer: FirestoreWriter = NoFirestoreWrites(),
    navigate: @escaping @MainActor (String, NativeParams) -> Void,
    openBesigner: @escaping @MainActor (String) -> Void
  ) {
    self.uid = uid
    self.orgID = orgID
    self.hostID = hostID
    self.orgSlug = orgSlug
    self.hostSlug = hostSlug
    self.firestore = firestore
    self.api = api
    self.writer = writer
    self.navigateAction = navigate
    self.openBesignerAction = openBesigner
  }

  /// Opens a registered screen by id.
  @MainActor public func navigate(_ screenID: String, _ params: NativeParams = [:]) {
    navigateAction(screenID, params)
  }

  /// Opens a Besigner page in the app's authenticated web view. Only a
  /// Besigner path opens (`DeepLinks.isBesignerPath`); anything else is
  /// refused, because console areas are native screens. Returns whether it opened.
  @MainActor @discardableResult
  public func openBesigner(_ path: String, scope: ConsoleScope = .site) -> Bool {
    let scoped = besignerPath(path, scope: scope)
    guard DeepLinks.isBesignerPath(scoped) else { return false }
    openBesignerAction(scoped)
    return true
  }

  /// A Besigner path under the picked scope.
  public func besignerPath(_ path: String, scope: ConsoleScope) -> String {
    let rest = path.hasPrefix("/") ? path : "/\(path)"
    switch scope {
    case .absolute: return rest
    case .org: return orgSlug.map { "/\($0)\(rest)" } ?? rest
    case .site:
      guard let orgSlug, let hostSlug else { return rest }
      return "/\(orgSlug)/hosts/\(hostSlug)\(rest)"
    }
  }
}

public typealias ScreenBuilder = @MainActor (NativePluginContext, NativeParams) -> AnyView
public typealias WidgetBuilder = @MainActor (NativePluginContext) -> AnyView

public struct NativeScreen: Identifiable {
  public let pluginID: String
  public let id: String
  public let title: String
  public let requiresSite: Bool
  public let apps: Set<AglynAppKind>
  public let icon: String?
  public let placement: POSPlacement?
  public let make: ScreenBuilder
}

public struct NativeTab: Identifiable {
  public let pluginID: String
  public let id: String
  public let title: String
  /// An SF Symbol name.
  public let icon: String
  /// The screen the tab opens at its root.
  public let screen: String
  /// Lower first. The shell's own Home is 0 and More is 1000.
  public let order: Int
  public let apps: Set<AglynAppKind>
}

public struct NativeWidget: Identifiable {
  public let pluginID: String
  public let id: String
  public let title: String
  public let icon: String?
  public let order: Int
  public let size: WidgetSize
  public let requiresSite: Bool
  public let apps: Set<AglynAppKind>
  /// A core page's slot it renders in instead of Home, the native twin of
  /// the console's `PluginWidgetSlot` (`hostAnalytics` is the Analytics page's).
  public var slot: String? = nil
  public let make: WidgetBuilder
}

public struct NativeQuickAction: Identifiable {
  public let pluginID: String
  public let id: String
  public let title: String
  public let icon: String
  public let order: Int
  public let requiresSite: Bool
  /// The native screen it opens.
  public let screen: String
  public let params: NativeParams
  public let apps: Set<AglynAppKind>
}

public struct NativeDeepLink: Identifiable, DeepLinkRoute {
  public let pluginID: String
  public let id: String
  /// A console path pattern, e.g. `/redirects/:redirectId`; the org/site prefix is stripped before matching.
  public let path: String
  public let screen: String
}

public enum NativeContributionKind: String, CaseIterable, Sendable {
  case screens, tabs, widgets, quickActions, deepLinks
}

/// A plugin's declared contributions, as `plugins.config.json` states them
/// under `mobile.contributes`: the ids it registers, by kind.
public struct NativeContributionDeclaration: Sendable, Equatable {
  public var screens: [String]
  public var tabs: [String]
  public var widgets: [String]
  public var quickActions: [String]
  public var deepLinks: [String]

  public init(
    screens: [String] = [], tabs: [String] = [], widgets: [String] = [],
    quickActions: [String] = [], deepLinks: [String] = []
  ) {
    self.screens = screens
    self.tabs = tabs
    self.widgets = widgets
    self.quickActions = quickActions
    self.deepLinks = deepLinks
  }

  public func ids(_ kind: NativeContributionKind) -> [String] {
    switch kind {
    case .screens: screens
    case .tabs: tabs
    case .widgets: widgets
    case .quickActions: quickActions
    case .deepLinks: deepLinks
    }
  }
}

/// One plugin as the generated native manifest names it.
public struct NativePluginManifestEntry {
  public let id: String
  public let contributes: NativeContributionDeclaration
  public let register: @MainActor (NativePluginRegistrar) -> Void

  public init(
    id: String, contributes: NativeContributionDeclaration,
    register: @escaping @MainActor (NativePluginRegistrar) -> Void
  ) {
    self.id = id
    self.contributes = contributes
    self.register = register
  }

  /// The generated manifest's shape: declared ids keyed by kind (`"screens"`, `"widgets"`, …).
  public init(
    id: String, contributes: [String: [String]],
    register: @escaping @MainActor (NativePluginRegistrar) -> Void
  ) {
    self.init(
      id: id,
      contributes: NativeContributionDeclaration(
        screens: contributes["screens"] ?? [], tabs: contributes["tabs"] ?? [],
        widgets: contributes["widgets"] ?? [], quickActions: contributes["quickActions"] ?? [],
        deepLinks: contributes["deepLinks"] ?? []),
      register: register)
  }
}
