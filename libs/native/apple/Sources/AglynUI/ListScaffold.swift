// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

// A screen's own chrome in its content on the Mac and iPad (AGL-3945 fidelity pass; Figma Mac Sites 13:3, Orders
// 13:483): the window's title bar holds only the shell's items, and a list's search and Filter sit in the list's own
// toolbar under the screen's title. On a phone the system's search bar stays (Figma Phone 2:7).

private struct AglynWideChromeKey: EnvironmentKey {
  static let defaultValue: Bool = {
    #if os(macOS)
      true
    #else
      false
    #endif
  }()
}

extension EnvironmentValues {
  /// Whether a screen draws its search and actions in its content (the Mac, and iPad's wide shell) rather than in the
  /// navigation bar.
  public var aglynWideChrome: Bool {
    get { self[AglynWideChromeKey.self] }
    set { self[AglynWideChromeKey.self] = newValue }
  }
}

extension View {
  /// A list's search: in the list's own toolbar on the Mac and iPad, the system's search bar on a phone. `onSubmit` runs
  /// when the person presses Return in it.
  public func aglynSearchable(text: Binding<String>, prompt: String, onSubmit: (() -> Void)? = nil) -> some View {
    modifier(AglynSearchableModifier(text: text, prompt: prompt, onSubmit: onSubmit, filter: nil))
  }

  /// A list's search with its one Filter control beside it on the Mac and iPad (Calm rule 3: the filter's chips show
  /// only once a filter is on). On a phone the filter stays where the screen puts it.
  public func aglynSearchable<Filter: View>(
    text: Binding<String>, prompt: String, onSubmit: (() -> Void)? = nil, @ViewBuilder filter: () -> Filter
  ) -> some View {
    modifier(AglynSearchableModifier(text: text, prompt: prompt, onSubmit: onSubmit, filter: AnyView(filter())))
  }
}

private struct AglynSearchableModifier: ViewModifier {
  @Environment(\.aglynWideChrome) private var wide
  @Binding var text: String
  let prompt: String
  let onSubmit: (() -> Void)?
  let filter: AnyView?

  init(text: Binding<String>, prompt: String, onSubmit: (() -> Void)?, filter: AnyView?) {
    _text = text
    self.prompt = prompt
    self.onSubmit = onSubmit
    self.filter = filter
  }

  func body(content: Content) -> some View {
    if wide {
      content.safeAreaInset(edge: .top, spacing: 0) {
        AglynListToolbar(text: $text, prompt: prompt, onSubmit: onSubmit) { filter }
      }
    } else {
      content
        .searchable(text: $text, prompt: prompt)
        .onSubmit(of: .search) { onSubmit?() }
    }
  }
}

/// A list's toolbar (Figma List toolbar): its search field, then its one Filter control.
public struct AglynListToolbar<Filter: View>: View {
  @Binding var text: String
  let prompt: String
  let onSubmit: (() -> Void)?
  let filter: Filter

  public init(text: Binding<String>, prompt: String, onSubmit: (() -> Void)? = nil, @ViewBuilder filter: () -> Filter) {
    _text = text
    self.prompt = prompt
    self.onSubmit = onSubmit
    self.filter = filter()
  }

  public var body: some View {
    HStack(spacing: 8) {
      HStack(spacing: 6) {
        Image(systemName: "magnifyingglass").font(.system(size: AglynShellMetrics.rowText - 1))
          .foregroundStyle(AglynColor.textTertiary)
        TextField(prompt, text: $text)
          .textFieldStyle(.plain)
          .font(.system(size: AglynShellMetrics.rowText))
          .onSubmit { onSubmit?() }
          .accessibilityIdentifier("list-search")
        if !text.isEmpty {
          Button {
            text = ""
            onSubmit?()
          } label: {
            Image(systemName: "xmark.circle.fill").foregroundStyle(AglynColor.textTertiary)
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Clear search")
        }
      }
      .padding(.horizontal, 10)
      .frame(height: AglynShellMetrics.barButton)
      .background(RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous).fill(AglynColor.sunken))
      .overlay(
        RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous).strokeBorder(AglynColor.divider))
      filter
    }
    .padding(.horizontal, AglynContentInsets.horizontal)
    .padding(.bottom, 10)
    .background(AglynColor.paper)
  }
}

/// A Filter control for a list toolbar: one bordered "Filter" menu holding the list's filters; it reads as on (tinted,
/// with the filter's name) once one is picked.
public struct AglynFilterMenu<Content: View>: View {
  let active: String?
  let content: Content

  public init(active: String?, @ViewBuilder content: () -> Content) {
    self.active = active
    self.content = content()
  }

  public var body: some View {
    Menu {
      content
    } label: {
      HStack(spacing: 6) {
        Image(systemName: "line.3.horizontal.decrease").font(.system(size: AglynShellMetrics.rowText - 1))
        Text(active ?? "Filter").font(.system(size: AglynShellMetrics.rowText, weight: .medium)).lineLimit(1)
      }
      .foregroundStyle(active == nil ? AglynColor.textPrimary : AglynColor.tint)
      .padding(.horizontal, 10)
      .frame(height: AglynShellMetrics.barButton)
      .background(
        RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous)
          .fill(active == nil ? AglynColor.paper : AglynColor.accentSoft))
      .overlay(
        RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous)
          .strokeBorder(active == nil ? AglynColor.divider : .clear))
      .contentShape(Rectangle())
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .menuIndicator(.hidden)
    .fixedSize()
    .accessibilityIdentifier("list-filter")
  }
}

/// The content's side margins on the Mac and iPad (Figma: 32 points from the sidebar's edge).
public enum AglynContentInsets {
  public static var horizontal: CGFloat {
    #if os(macOS)
      32
    #else
      24
    #endif
  }
}

/// A screen's head in its content on the Mac and iPad (Figma Mac Sites 13:3): its breadcrumbs, then its title with the
/// star beside it and its one filled primary button on the right.
public struct AglynContentHeader<Crumbs: View, Accessory: View>: View {
  let title: String
  let crumbs: Crumbs
  let accessory: Accessory

  public init(_ title: String, @ViewBuilder crumbs: () -> Crumbs, @ViewBuilder accessory: () -> Accessory) {
    self.title = title
    self.crumbs = crumbs()
    self.accessory = accessory()
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      crumbs
      HStack(alignment: .center, spacing: 10) {
        Text(title)
          .font(.system(size: 22, weight: .semibold))
          .foregroundStyle(AglynColor.textPrimary)
          .lineLimit(1)
          .accessibilityAddTraits(.isHeader)
        accessory
      }
    }
    .padding(.horizontal, AglynContentInsets.horizontal)
    .padding(.top, 20)
    .padding(.bottom, 12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(AglynColor.paper)
  }
}

/// The one filled primary button of a screen's head (Figma Button, Primary, Medium; Compact radius 6 on the Mac).
public struct AglynPrimaryHeaderButton: View {
  let title: String
  let systemImage: String
  let shortcut: KeyboardShortcut?
  let help: String?
  let action: () -> Void

  public init(
    _ title: String, systemImage: String, shortcut: KeyboardShortcut? = nil, help: String? = nil,
    action: @escaping () -> Void
  ) {
    self.title = title
    self.systemImage = systemImage
    self.shortcut = shortcut
    self.help = help
    self.action = action
  }

  public var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        Image(systemName: systemImage).font(.system(size: AglynShellMetrics.rowText, weight: .semibold))
        Text(title).font(.system(size: AglynShellMetrics.rowText + 1, weight: .semibold)).lineLimit(1)
      }
      .foregroundStyle(AglynColor.primaryContrast)
      .padding(.horizontal, 14)
      .frame(height: 36)
      .background(RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous).fill(AglynColor.primary))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .keyboardShortcut(shortcut)
    .help(help ?? title)
  }
}

/// A screen's one primary action (Figma: the filled button at the right of the screen's title row).
public struct AglynPrimaryAction: Equatable {
  public let id: String
  public let title: String
  public let systemImage: String
  public let enabled: Bool
  /// Its keyboard shortcut (⌘N for a New … action), on every device.
  public let shortcut: KeyboardShortcut?
  /// Its tooltip, and why it is disabled when it is.
  public let help: String?
  public let run: @MainActor () -> Void

  public init(
    id: String, title: String, systemImage: String, enabled: Bool = true, shortcut: KeyboardShortcut? = nil,
    help: String? = nil, run: @escaping @MainActor () -> Void
  ) {
    self.id = id
    self.title = title
    self.systemImage = systemImage
    self.enabled = enabled
    self.shortcut = shortcut
    self.help = help
    self.run = run
  }

  public static func == (a: AglynPrimaryAction, b: AglynPrimaryAction) -> Bool {
    a.id == b.id && a.title == b.title && a.enabled == b.enabled
  }
}

/// What a screen puts in its head on the Mac and iPad: its one primary action and its other actions.
public struct AglynScreenChrome {
  public var primary: AglynPrimaryAction?
  public var entries: [AglynScreenToolbarEntry] = []
  /// The screen's own title, for the head of a screen pushed over a list (`aglynScreenTitle`).
  public var title: String?

  /// Adds what an outer modifier publishes to what the screen inside it already did: the screen's own primary action and
  /// title stay first, actions add up. Every chrome modifier merges this way, so stacking them never hides one.
  public mutating func merge(_ outer: AglynScreenChrome) {
    primary = primary ?? outer.primary
    title = title ?? outer.title
    entries.append(contentsOf: outer.entries)
  }
}

public struct AglynScreenChromeKey: PreferenceKey {
  public static let defaultValue = AglynScreenChrome()
  public static func reduce(value: inout AglynScreenChrome, nextValue: () -> AglynScreenChrome) {
    // Siblings: the first one's primary action and title win, every one's actions add up.
    value.merge(nextValue())
  }
}

extension View {
  /// The screen's one primary action: the filled button in its head on the Mac and iPad (the shell draws it there),
  /// the navigation bar's button on a phone.
  public func aglynPrimaryAction(
    id: String, _ title: String, systemImage: String, enabled: Bool = true, shortcut: KeyboardShortcut? = nil,
    help: String? = nil, action: @escaping @MainActor () -> Void
  ) -> some View {
    modifier(
      AglynPrimaryActionModifier(
        action: AglynPrimaryAction(
          id: id, title: title, systemImage: systemImage, enabled: enabled, shortcut: shortcut, help: help, run: action)))
  }
}

private struct AglynPrimaryActionModifier: ViewModifier {
  @Environment(\.aglynWideChrome) private var wide
  let action: AglynPrimaryAction

  func body(content: Content) -> some View {
    if wide {
      content.transformPreference(AglynScreenChromeKey.self) { $0.merge(AglynScreenChrome(primary: action)) }
    } else {
      content.toolbar {
        ToolbarItem(placement: .primaryAction) {
          Button { action.run() } label: { Label(action.title, systemImage: action.systemImage) }
            .disabled(!action.enabled)
            .keyboardShortcut(action.shortcut)
            .help(action.help ?? action.title)
            .accessibilityIdentifier(action.id)
        }
      }
    }
  }
}

extension View {
  /// A content list on the Mac and iPad as Figma draws one (Mac Sites 13:3): rows on the surface, hairlines between
  /// them, 32-point margins; a phone keeps its grouped list.
  public func aglynContentList() -> some View { modifier(AglynContentListModifier()) }
}

private struct AglynContentListModifier: ViewModifier {
  @Environment(\.aglynWideChrome) private var wide

  func body(content: Content) -> some View {
    if wide {
      content
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(AglynColor.paper)
        .environment(\.defaultMinListRowHeight, 48)
        .contentMargins(.horizontal, AglynContentInsets.horizontal - 8, for: .scrollContent)
    } else {
      content.aglynListBackground()
    }
  }
}

/// One group of a screen's own actions for its head (`aglynScreenToolbar`).
public struct AglynScreenToolbarEntry: Identifiable {
  public let id: String
  public let content: AnyView
}

extension View {
  /// A screen's own actions besides its primary one (Select, an export menu): in its head beside the primary button on
  /// the Mac and iPad, never in the window's title bar; in the navigation bar on a phone.
  public func aglynScreenToolbar<Content: View>(id: String, @ViewBuilder content: @escaping () -> Content) -> some View {
    modifier(AglynScreenToolbarModifier(id: id, content: content))
  }
}

private struct AglynScreenToolbarModifier<Items: View>: ViewModifier {
  @Environment(\.aglynWideChrome) private var wide
  let id: String
  let content: () -> Items

  func body(content view: Content) -> some View {
    if wide {
      view.transformPreference(AglynScreenChromeKey.self) {
        $0.merge(AglynScreenChrome(entries: [AglynScreenToolbarEntry(id: id, content: AnyView(content()))]))
      }
    } else {
      view.toolbar { ToolbarItemGroup(placement: .primaryAction) { content() } }
    }
  }
}

/// A screen action's look in its head: a bordered 28-point button (Figma Button, Secondary, Small; Compact radius 6).
public struct AglynHeaderButtonStyle: ButtonStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: AglynShellMetrics.rowText, weight: .medium))
      .foregroundStyle(AglynColor.textPrimary)
      .labelStyle(.titleAndIcon)
      .padding(.horizontal, 10)
      .frame(height: AglynShellMetrics.barButton + 4)
      .background(
        RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous)
          .fill(configuration.isPressed ? AglynColor.hover : AglynColor.paper))
      .overlay(
        RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous).strokeBorder(AglynColor.divider))
  }
}

extension View {
  /// A screen's title in its head on the Mac and iPad when it is pushed over a list (a product, a contact); the
  /// navigation title on a phone. Use beside `.navigationTitle` with the same words.
  public func aglynScreenTitle(_ title: String) -> some View {
    transformPreference(AglynScreenChromeKey.self) { $0.merge(AglynScreenChrome(title: title)) }
  }
}

// How a screen puts its own chrome in its content on the Mac and iPad (the window has no toolbar there):
// - `aglynSearchable(text:prompt:onSubmit:filter:)`: the list's search and its one Filter, in the list's toolbar.
// - `aglynPrimaryAction(id:_:systemImage:enabled:action:)`: the one filled button at the right of the screen's head.
// - `aglynScreenToolbar(id:content:)`: the screen's other actions (Select, a ⋯ menu), beside the primary button.
// - `aglynScreenTitle(_:)`: a pushed screen's title in its head.
// On a phone each falls back to the navigation bar. The shell (AreaView, PushedScreen) draws the head.

/// A record's row in a content list (Figma List/Order row 11:358): its kind's icon on a 32-point tile, the title at 14
/// semibold over the detail at 12, and the trailing figures; 64 points tall on the Mac and iPad. On a phone (Size=Phone)
/// the tile is 36, the title 17 and the detail 13, 68 points tall.
public struct AglynRecordRow<Trailing: View>: View {
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif
  let title: String
  let detail: String?
  let systemImage: String
  let trailing: Trailing

  public init(_ title: String, detail: String?, systemImage: String, @ViewBuilder trailing: () -> Trailing) {
    self.title = title
    self.detail = detail
    self.systemImage = systemImage
    self.trailing = trailing()
  }

  private var phone: Bool {
    #if os(iOS)
      sizeClass == .compact
    #else
      false
    #endif
  }

  public var body: some View {
    HStack(spacing: 12) {
      Image(systemName: systemImage)
        .font(.system(size: phone ? 16 : 14))
        .foregroundStyle(AglynColor.secondaryText)
        .frame(width: phone ? 36 : 32, height: phone ? 36 : 32)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(AglynColor.sunken))
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.system(size: phone ? 17 : 14, weight: .semibold)).foregroundStyle(AglynColor.textPrimary)
          .lineLimit(1)
        if let detail, !detail.isEmpty {
          Text(detail).font(.system(size: phone ? 13 : 12)).foregroundStyle(AglynColor.secondaryText).lineLimit(1)
        }
      }
      Spacer(minLength: 8)
      VStack(alignment: .trailing, spacing: 4) { trailing }
    }
    .padding(.vertical, phone ? 12 : 10)
    .frame(minHeight: phone ? 44 : 44)
    .accessibilityElement(children: .combine)
  }
}

extension AglynRecordRow {
  /// The trailing total in the row's own type (14 semibold; 15 regular on a phone).
  public static func total(_ text: String, phone: Bool) -> some View {
    Text(text).font(.system(size: phone ? 15 : 14, weight: phone ? .regular : .semibold)).monospacedDigit()
      .foregroundStyle(AglynColor.textPrimary)
  }
}
