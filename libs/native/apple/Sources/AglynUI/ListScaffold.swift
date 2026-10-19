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
  let inset: CGFloat?
  let filter: Filter

  /// `inset` is the side margin when the toolbar heads a list column rather than the whole content.
  public init(
    text: Binding<String>, prompt: String, onSubmit: (() -> Void)? = nil, inset: CGFloat? = nil,
    @ViewBuilder filter: () -> Filter
  ) {
    _text = text
    self.prompt = prompt
    self.onSubmit = onSubmit
    self.inset = inset
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
    .padding(.horizontal, inset ?? AglynContentInsets.horizontal)
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

extension AglynPrimaryHeaderButton {
  /// A screen's primary action as its head's filled button; off for a reason, it says why (`AglynBlockableButton`).
  public static func blockable(_ action: AglynPrimaryAction) -> some View {
    AglynBlockableButton(action) {
      AglynPrimaryHeaderButton.face(action.title, systemImage: action.systemImage)
    }
    .buttonStyle(.plain)
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
    Button(action: action) { Self.face(title, systemImage: systemImage) }
      .buttonStyle(.plain)
      .keyboardShortcut(shortcut)
      .help(help ?? title)
  }

  /// The button's face: icon and title on the primary fill.
  static func face(_ title: String, systemImage: String) -> some View {
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
        ToolbarItem(placement: .primaryAction) { AglynBlockableButton(action) { Label(action.title, systemImage: action.systemImage) } }
      }
    }
  }
}

/// A screen's primary action as a button: when it is off for a reason the person can act on (its `help`), it stays
/// on screen dimmed and says why, never silently dead (the console's BlockedControl). The Mac says it on hover, as
/// the console's tooltip does; a touch screen has no hover, so a tap shows the reason beside the button.
public struct AglynBlockableButton<Label: View>: View {
  let action: AglynPrimaryAction
  let label: Label
  @State private var explaining = false

  public init(_ action: AglynPrimaryAction, @ViewBuilder label: () -> Label) {
    self.action = action
    self.label = label()
  }

  private var reason: String? { action.enabled ? nil : action.help }

  public var body: some View {
    #if os(iOS)
      if let reason {
        Button { explaining = true } label: { label }
          .opacity(0.5)
          .accessibilityHint(reason)
          .accessibilityIdentifier(action.id)
          .popover(isPresented: $explaining) {
            Text(reason)
              .font(AglynFont.body)
              .fixedSize(horizontal: false, vertical: true)
              .frame(idealWidth: 280)
              .padding(AglynSpace.two)
              .presentationCompactAdaptation(.popover)
              .accessibilityIdentifier("\(action.id)-reason")
          }
      } else {
        plain
      }
    #else
      plain
    #endif
  }

  private var plain: some View {
    Button { action.run() } label: { label }
      .disabled(!action.enabled)
      .opacity(action.enabled ? 1 : 0.5)
      .keyboardShortcut(action.shortcut)
      .help(action.help ?? action.title)
      .accessibilityIdentifier(action.id)
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
  /// `phone` is where a phone's navigation bar puts them: a More menu that was secondary there stays secondary.
  public func aglynScreenToolbar<Content: View>(
    id: String, phone: ToolbarItemPlacement = .primaryAction, @ViewBuilder content: @escaping () -> Content
  ) -> some View {
    modifier(AglynScreenToolbarModifier(id: id, phone: phone, content: content))
  }
}

private struct AglynScreenToolbarModifier<Items: View>: ViewModifier {
  @Environment(\.aglynWideChrome) private var wide
  let id: String
  let phone: ToolbarItemPlacement
  let content: () -> Items

  func body(content view: Content) -> some View {
    if wide {
      view.transformPreference(AglynScreenChromeKey.self) {
        $0.merge(AglynScreenChrome(entries: [AglynScreenToolbarEntry(id: id, content: AnyView(content()))]))
      }
    } else {
      view.toolbar { ToolbarItemGroup(placement: phone) { content() } }
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

// MARK: A head in the list column (Figma Orders 13:483)

/// One of an area's sections (Orders, Returns, Reservations), for a screen that offers them itself.
public struct AglynAreaSection: Identifiable {
  public let id: String
  public let label: String
  public let selected: Bool
  public let open: @MainActor () -> Void

  public init(id: String, label: String, selected: Bool, open: @escaping @MainActor () -> Void) {
    self.id = id
    self.label = label
    self.selected = selected
    self.open = open
  }
}

/// What the shell would draw across an area's content, handed to a screen that draws its head in its list column
/// instead (Figma Orders 13:483: the title and create action head the list, the breadcrumbs head the detail).
public struct AglynAreaHead {
  public let title: String
  public let crumbs: AnyView
  public let star: AnyView
  public let sections: [AglynAreaSection]

  public init(title: String, crumbs: AnyView, star: AnyView, sections: [AglynAreaSection]) {
    self.title = title
    self.crumbs = crumbs
    self.star = star
    self.sections = sections
  }
}

extension EnvironmentValues {
  /// The area's head on the Mac and iPad when its screen draws the head in its own list column; nil otherwise.
  @Entry public var aglynAreaHead: AglynAreaHead? = nil
}

/// The screens that head their own list column on the Mac and iPad. A plugin names its screen when it registers it, so
/// the shell knows before the first frame and never draws, then removes, a head of its own.
@MainActor
public enum AglynListColumnHead {
  public private(set) static var screens: Set<String> = []

  public static func register(_ screen: String) { screens.insert(screen) }
}

/// A list column's head (Figma Orders 13:483): the area's title with its star, then its create action and its other
/// actions as bordered buttons (the detail beside it holds the filled one).
public struct AglynListColumnHeader<Actions: View>: View {
  let head: AglynAreaHead
  let actions: Actions

  public init(_ head: AglynAreaHead, @ViewBuilder actions: () -> Actions) {
    self.head = head
    self.actions = actions()
  }

  public var body: some View {
    HStack(alignment: .center, spacing: 10) {
      Text(head.title)
        .font(.system(size: 22, weight: .semibold))
        .foregroundStyle(AglynColor.textPrimary)
        .lineLimit(1)
        .accessibilityAddTraits(.isHeader)
      head.star
      Spacer(minLength: 8)
      HStack(spacing: 8) { actions }
        .buttonStyle(AglynHeaderButtonStyle())
        .menuStyle(.button)
        .fixedSize()
    }
    .frame(height: 36)
    .padding(.horizontal, AglynListColumnHeader<EmptyView>.inset)
    .padding(.top, 20)
    .padding(.bottom, 12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(AglynColor.paper)
  }

  /// The list column's side margins (Figma: 20 from the column's edges).
  public static var inset: CGFloat { 20 }
}

/// The breadcrumbs over the detail column of a screen that heads its own list column (Figma Orders 13:483).
public struct AglynDetailCrumbs: View {
  let head: AglynAreaHead

  public init(_ head: AglynAreaHead) { self.head = head }

  public var body: some View {
    head.crumbs
      .padding(.horizontal, AglynContentInsets.horizontal)
      .padding(.top, 20)
      .padding(.bottom, 4)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(AglynColor.paper)
  }
}
