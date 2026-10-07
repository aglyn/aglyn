// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Observation
import SwiftUI

public struct RegistryError: Error, LocalizedError, Equatable {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}

/// Every contribution the loaded plugins registered. The shell reads only
/// this, so it never names a plugin.
///
/// A registration is refused when its id is taken, so two plugins can never
/// silently shadow each other's screen.
@MainActor
@Observable
public final class NativePluginRegistry {
  public private(set) var screens: [String: NativeScreen] = [:]
  public private(set) var tabList: [String: NativeTab] = [:]
  public private(set) var widgetList: [String: NativeWidget] = [:]
  public private(set) var quickActionList: [String: NativeQuickAction] = [:]
  public private(set) var deepLinkList: [String: NativeDeepLink] = [:]

  public init() {}

  private func taken(_ kind: NativeContributionKind, _ id: String) -> Bool {
    switch kind {
    case .screens: screens[id] != nil
    case .tabs: tabList[id] != nil
    case .widgets: widgetList[id] != nil
    case .quickActions: quickActionList[id] != nil
    case .deepLinks: deepLinkList[id] != nil
    }
  }

  func checkFree(_ kind: NativeContributionKind, _ id: String) throws {
    if taken(kind, id) { throw RegistryError("native \(kind.rawValue) \"\(id)\" is already registered") }
  }

  func add(_ screen: NativeScreen) throws {
    try checkFree(.screens, screen.id)
    screens[screen.id] = screen
  }

  func add(_ tab: NativeTab) throws {
    try checkFree(.tabs, tab.id)
    tabList[tab.id] = tab
  }

  func add(_ widget: NativeWidget) throws {
    try checkFree(.widgets, widget.id)
    widgetList[widget.id] = widget
  }

  func add(_ action: NativeQuickAction) throws {
    if (action.screen == nil) == (action.besignerPath == nil) {
      throw RegistryError("quick action \"\(action.id)\" opens a screen or a Besigner page — exactly one")
    }
    if let path = action.besignerPath, !DeepLinks.isBesignerPath(path) {
      throw RegistryError("quick action \"\(action.id)\" path \"\(path)\" is not a Besigner page")
    }
    try checkFree(.quickActions, action.id)
    quickActionList[action.id] = action
  }

  func add(_ link: NativeDeepLink) throws {
    if !link.path.hasPrefix("/") {
      throw RegistryError("deep link \"\(link.id)\" path \"\(link.path)\" is a console path and starts with /")
    }
    try checkFree(.deepLinks, link.id)
    deepLinkList[link.id] = link
  }

  public func screen(_ id: String) -> NativeScreen? { screens[id] }

  private static func byOrder<T>(_ order: KeyPath<T, Int>, _ id: KeyPath<T, String>) -> (T, T) -> Bool {
    { a, b in a[keyPath: order] != b[keyPath: order] ? a[keyPath: order] < b[keyPath: order] : a[keyPath: id] < b[keyPath: id] }
  }

  public func tabs(for app: AglynAppKind) -> [NativeTab] {
    tabList.values.filter { $0.apps.contains(app) }.sorted(by: Self.byOrder(\.order, \.id))
  }

  public func widgets(for app: AglynAppKind) -> [NativeWidget] {
    widgetList.values.filter { $0.apps.contains(app) }.sorted(by: Self.byOrder(\.order, \.id))
  }

  public func quickActions(for app: AglynAppKind) -> [NativeQuickAction] {
    quickActionList.values.filter { $0.apps.contains(app) }.sorted(by: Self.byOrder(\.order, \.id))
  }

  public func screens(for app: AglynAppKind, placement: POSPlacement? = nil) -> [NativeScreen] {
    screens.values
      .filter { $0.apps.contains(app) && (placement == nil || $0.placement == placement) }
      .sorted { $0.id < $1.id }
  }

  public var deepLinks: [NativeDeepLink] { deepLinkList.values.sorted { $0.id < $1.id } }

  /// Where a console link goes in this app.
  public func resolve(_ link: String) -> LinkTarget? {
    DeepLinks.resolve(link, routes: deepLinks)
  }

  /// Ids one plugin registered, by kind: what the loader compares to its declaration.
  public func registered(by pluginID: String) -> [NativeContributionKind: [String]] {
    [
      .screens: screens.values.filter { $0.pluginID == pluginID }.map(\.id).sorted(),
      .tabs: tabList.values.filter { $0.pluginID == pluginID }.map(\.id).sorted(),
      .widgets: widgetList.values.filter { $0.pluginID == pluginID }.map(\.id).sorted(),
      .quickActions: quickActionList.values.filter { $0.pluginID == pluginID }.map(\.id).sorted(),
      .deepLinks: deepLinkList.values.filter { $0.pluginID == pluginID }.map(\.id).sorted(),
    ]
  }

  /// Drops everything one plugin registered, so a plugin that failed halfway
  /// leaves no tab or widget behind that cannot work.
  public func unregister(_ pluginID: String) {
    screens = screens.filter { $0.value.pluginID != pluginID }
    tabList = tabList.filter { $0.value.pluginID != pluginID }
    widgetList = widgetList.filter { $0.value.pluginID != pluginID }
    quickActionList = quickActionList.filter { $0.value.pluginID != pluginID }
    deepLinkList = deepLinkList.filter { $0.value.pluginID != pluginID }
  }
}

/// What a plugin's registrar function is handed: it registers that plugin's
/// contributions, and only the ones its `plugins.config.json` declaration
/// names. Ids are `<pluginId>.<name>`. A refused registration is recorded
/// (the first one fails the plugin's load) instead of thrown, so a
/// registrar reads as a plain list of calls.
@MainActor
public final class NativePluginRegistrar {
  public let pluginID: String
  private let declared: NativeContributionDeclaration
  private let registry: NativePluginRegistry
  public private(set) var errors: [String] = []

  public init(pluginID: String, declared: NativeContributionDeclaration, registry: NativePluginRegistry) {
    self.pluginID = pluginID
    self.declared = declared
    self.registry = registry
  }

  private func admit(_ kind: NativeContributionKind, _ id: String, _ add: () throws -> Void) {
    guard id.hasPrefix("\(pluginID).") && id.count > pluginID.count + 1 else {
      errors.append(
        "plugin \"\(pluginID)\" registered \(kind.rawValue) \"\(id)\" — a plugin registers only its own ids, \"\(pluginID).<name>\"")
      return
    }
    guard declared.ids(kind).contains(id) else {
      errors.append(
        "plugin \"\(pluginID)\" registered \(kind.rawValue) \"\(id)\", which its \"mobile.contributes.\(kind.rawValue)\" in plugins.config.json does not declare")
      return
    }
    do { try add() } catch { errors.append((error as? RegistryError)?.message ?? "\(error)") }
  }

  public func screen<V: View>(
    _ id: String, title: String, requiresSite: Bool = false, apps: Set<AglynAppKind> = [.aglyn],
    icon: String? = nil, placement: POSPlacement? = nil,
    @ViewBuilder _ content: @escaping @MainActor (NativePluginContext, NativeParams) -> V
  ) {
    admit(.screens, id) {
      try registry.add(
        NativeScreen(
          pluginID: pluginID, id: id, title: title, requiresSite: requiresSite, apps: apps, icon: icon,
          placement: placement, make: { AnyView(content($0, $1)) }))
    }
  }

  public func tab(
    _ id: String, title: String, icon: String, screen: String, order: Int,
    apps: Set<AglynAppKind> = [.aglyn]
  ) {
    admit(.tabs, id) {
      try registry.add(
        NativeTab(pluginID: pluginID, id: id, title: title, icon: icon, screen: screen, order: order, apps: apps))
    }
  }

  public func widget<V: View>(
    _ id: String, title: String, icon: String? = nil, order: Int, size: WidgetSize = .full,
    requiresSite: Bool = false, apps: Set<AglynAppKind> = [.aglyn],
    @ViewBuilder _ content: @escaping @MainActor (NativePluginContext) -> V
  ) {
    admit(.widgets, id) {
      try registry.add(
        NativeWidget(
          pluginID: pluginID, id: id, title: title, icon: icon, order: order, size: size,
          requiresSite: requiresSite, apps: apps, make: { AnyView(content($0)) }))
    }
  }

  public func quickAction(
    _ id: String, title: String, icon: String, order: Int, screen: String? = nil,
    params: NativeParams = [:], besignerPath: String? = nil, requiresSite: Bool = false,
    apps: Set<AglynAppKind> = [.aglyn]
  ) {
    admit(.quickActions, id) {
      try registry.add(
        NativeQuickAction(
          pluginID: pluginID, id: id, title: title, icon: icon, order: order, requiresSite: requiresSite,
          screen: screen, params: params, besignerPath: besignerPath, apps: apps))
    }
  }

  public func deepLink(_ id: String, path: String, screen: String) {
    admit(.deepLinks, id) {
      try registry.add(NativeDeepLink(pluginID: pluginID, id: id, path: path, screen: screen))
    }
  }
}

public struct NativePluginLoadFailure: Equatable, Sendable {
  public let pluginID: String
  public let error: String
}

public struct NativePluginLoadResult: Equatable, Sendable {
  public let loaded: [String]
  public let failed: [NativePluginLoadFailure]
}

/// Loads the plugins the generated native manifest names.
///
/// A plugin whose registrar is refused, or that declares an id it never
/// registers, is reported and unregistered whole; the others still load,
/// because one broken plugin must not leave someone without the app. The
/// order is the manifest's, so a duplicate-id refusal points at the same
/// plugin every launch.
@MainActor
public enum NativePluginLoader {
  public static func load(_ entries: [NativePluginManifestEntry], into registry: NativePluginRegistry)
    -> NativePluginLoadResult
  {
    var loaded: [String] = []
    var failed: [NativePluginLoadFailure] = []
    for entry in entries {
      let registrar = NativePluginRegistrar(pluginID: entry.id, declared: entry.contributes, registry: registry)
      entry.register(registrar)
      var error = registrar.errors.first
      if error == nil {
        let registered = registry.registered(by: entry.id)
        let gaps = NativeContributionKind.allCases.flatMap { kind in
          entry.contributes.ids(kind).filter { !(registered[kind] ?? []).contains($0) }
            .map { "\(kind.rawValue) \"\($0)\"" }
        }
        if !gaps.isEmpty { error = "declares but never registers \(gaps.joined(separator: ", "))" }
      }
      if let error {
        registry.unregister(entry.id)
        failed.append(NativePluginLoadFailure(pluginID: entry.id, error: error))
      } else {
        loaded.append(entry.id)
      }
    }
    return NativePluginLoadResult(loaded: loaded, failed: failed)
  }
}
