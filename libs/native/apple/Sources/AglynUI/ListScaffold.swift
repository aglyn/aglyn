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

/// A list's toolbar (Figma List toolbar): its search field, then its one Filter control. On a phone (a screen that heads
/// its own list there, Figma 22:499's Toolbar) the field and the Filter are 40 points tall on the page.
public struct AglynListToolbar<Filter: View>: View {
  @Environment(\.aglynWideChrome) private var wide
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
    let touch = !wide
    HStack(spacing: 8) {
      HStack(spacing: 8) {
        Image(systemName: "magnifyingglass").font(.system(size: touch ? 17 : AglynShellMetrics.rowText - 1))
          .foregroundStyle(AglynColor.textTertiary)
        TextField(prompt, text: $text)
          .textFieldStyle(.plain)
          .font(.system(size: touch ? 17 : AglynShellMetrics.rowText))
          .submitLabel(.search)
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
      .padding(.horizontal, touch ? 12 : 10)
      .frame(height: touch ? 40 : AglynShellMetrics.barButton)
      .background(
        RoundedRectangle(cornerRadius: touch ? 12 : AglynShellMetrics.controlRadius, style: .continuous).fill(AglynColor.sunken)
      )
      .overlay {
        if !touch {
          RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous).strokeBorder(AglynColor.divider)
        }
      }
      filter.environment(\.aglynTouchToolbar, touch)
    }
    .padding(.horizontal, touch ? AglynContentInsets.phone : (inset ?? AglynContentInsets.horizontal))
    .padding(.bottom, touch ? 12 : 10)
    // On touch the row sits on the page ground; in the phone's bold look it lets the ground (and its glow) through.
    .background(touch ? (AglynThemeRuntime.shared.phoneBold ? Color.clear : AglynColor.page) : AglynColor.paper)
  }
}

extension EnvironmentValues {
  /// A Filter control in a phone's list toolbar: drawn at the toolbar's 40 points.
  @Entry var aglynTouchToolbar: Bool = false
}

/// A Filter control for a list toolbar: one bordered "Filter" menu holding the list's filters; it reads as on (tinted,
/// with the filter's name) once one is picked.
public struct AglynFilterMenu<Content: View>: View {
  @Environment(\.aglynTouchToolbar) private var touch
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
      // Figma Button, Secondary: Small (28, radius 6) in a Mac or iPad list toolbar; Medium Touch (40, radius 8, 14
      // semibold) in a phone's (22:499).
      let radius = touch ? 8 : AglynShellMetrics.controlRadius
      HStack(spacing: touch ? 8 : 6) {
        Image(systemName: "line.3.horizontal.decrease").font(.system(size: touch ? 15 : AglynShellMetrics.rowText - 1))
        Text(active ?? "Filter").font(.system(size: touch ? 14 : AglynShellMetrics.rowText, weight: touch ? .semibold : .medium))
          .lineLimit(1)
      }
      .foregroundStyle(active == nil ? AglynColor.textPrimary : AglynColor.tint)
      .padding(.horizontal, touch ? 14 : 10)
      .frame(height: touch ? 40 : AglynShellMetrics.barButton)
      .background(
        RoundedRectangle(cornerRadius: radius, style: .continuous)
          .fill(active == nil ? AglynColor.paper : AglynColor.accentSoft))
      .overlay(
        RoundedRectangle(cornerRadius: radius, style: .continuous)
          .strokeBorder(active == nil ? AglynColor.borderStrong : .clear))
      .contentShape(Rectangle())
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .menuIndicator(.hidden)
    .fixedSize()
    .accessibilityIdentifier("list-filter")
  }
}

/// The one content edge, E, of every column on the Mac and iPad: its crumbs, title, search and Filter, each row's
/// leading icon and trailing chevron, its section heads and cards sit on E and on width − E, and its hairlines run
/// exactly from one to the other (Zach, 2026-10-19: one inset system; Figma has no token for it, so this is the rule
/// Figma's frames follow). 32 on the Mac (Compact), 24 on iPad (Touch); a phone's lists keep their 16.
public enum AglynContentInsets {
  public static var horizontal: CGFloat {
    #if os(macOS)
      32
    #else
      24
    #endif
  }

  /// A phone's side margin.
  public static let phone: CGFloat = 16

  /// What a plain `List` adds outside a row's own insets: 8 before and 9 after it on the Mac (measured by laying a
  /// list out off screen; it also ignores `contentMargins`), nothing on iPad.
  public static var listBuiltIn: (leading: CGFloat, trailing: CGFloat) {
    #if os(macOS)
      (8, 9)
    #else
      (0, 0)
    #endif
  }

  /// A plain list row's insets that put its content on E and width − E, less `padding` the row draws itself.
  public static func listRow(padding: CGFloat = 0, vertical: CGFloat = 0) -> EdgeInsets {
    EdgeInsets(
      top: vertical, leading: horizontal - listBuiltIn.leading - padding,
      bottom: vertical, trailing: horizontal - listBuiltIn.trailing - padding)
  }
}

extension View {
  /// A screen-level row (a notice, a chip row, a scope bar, a search field) on its column's content edges: E on the
  /// Mac and iPad, the phone's 16 on a phone.
  public func aglynContentEdges() -> some View { modifier(AglynContentEdgesModifier()) }
}

private struct AglynContentEdgesModifier: ViewModifier {
  @Environment(\.aglynWideChrome) private var wide

  func body(content: Content) -> some View {
    content.padding(.horizontal, wide ? AglynContentInsets.horizontal : AglynContentInsets.phone)
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
  /// them, every row on the content edges (`aglynContentRow`); a phone keeps its grouped list.
  public func aglynContentList() -> some View { modifier(AglynContentListModifier()) }

  /// One row of an `aglynContentList` on the Mac and iPad: its content on E and width − E, and the hairline under it
  /// running exactly between them (none under the last row). A phone keeps its grouped row.
  public func aglynContentRow(separator: Bool = true) -> some View { modifier(AglynContentRowModifier(separator: separator)) }
}

private struct AglynContentRowModifier: ViewModifier {
  @Environment(\.aglynWideChrome) private var wide
  let separator: Bool

  func body(content: Content) -> some View {
    if wide {
      content
        .listRowInsets(AglynContentInsets.listRow())
        .listRowSeparator(.hidden)
        .listRowBackground(AglynColor.paper)
        .overlay(alignment: .bottom) {
          if separator { AglynHairline() }
        }
    } else {
      content
        .listRowInsets(EdgeInsets(top: 0, leading: AglynContentInsets.phone, bottom: 0, trailing: AglynContentInsets.phone))
        .listRowBackground(AglynColor.paper)
    }
  }
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
        // The rows put themselves on the edges (`aglynContentRow`); a margin here would move them off E on iPad, and
        // the Mac's list ignores it.
        .contentMargins(.horizontal, 0, for: .scrollContent)
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
      // Figma Button Secondary's outline, border/strong (never the platform's bright rim in dark).
      .overlay(
        RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous).strokeBorder(AglynColor.borderStrong))
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
/// actions as bordered buttons (the detail beside it holds the filled one). On a phone it is the screen's own title row
/// (Figma iPhone / Site / Orders 22:499): the large title with its star, the other actions as 40-point bordered icons,
/// and the create action as the filled 40-point "+" at the trailing edge.
public struct AglynListColumnHeader<Actions: View>: View {
  @Environment(\.aglynWideChrome) private var wide
  let head: AglynAreaHead
  let primary: AglynPrimaryAction?
  let actions: Actions

  public init(_ head: AglynAreaHead, primary: AglynPrimaryAction? = nil, @ViewBuilder actions: () -> Actions) {
    self.head = head
    self.primary = primary
    self.actions = actions()
  }

  public var body: some View {
    if wide { column } else { phone }
  }

  private var column: some View {
    HStack(alignment: .center, spacing: 10) {
      Text(head.title)
        .font(.system(size: 22, weight: .semibold))
        .foregroundStyle(AglynColor.textPrimary)
        .lineLimit(1)
        .accessibilityAddTraits(.isHeader)
      head.star
      Spacer(minLength: 8)
      HStack(spacing: 8) {
        if let primary {
          AglynBlockableButton(primary) { Label(primary.title, systemImage: primary.systemImage).labelStyle(.titleAndIcon) }
        }
        actions
      }
      .buttonStyle(AglynHeaderButtonStyle())
      .menuStyle(.button)
      .fixedSize()
    }
    // Figma's title row is the height of its small buttons (28), 20 below the column's top and 12 above the search.
    .frame(height: 28)
    .padding(.horizontal, AglynListColumnHeader<EmptyView>.inset)
    .padding(.top, 20)
    .padding(.bottom, 12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(AglynColor.paper)
  }

  private var phone: some View {
    HStack(alignment: .center, spacing: 8) {
      Text(head.title)
        .font(.system(size: 34, weight: .bold))
        .foregroundStyle(AglynColor.textPrimary)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .accessibilityAddTraits(.isHeader)
      head.star
      Spacer(minLength: 8)
      HStack(spacing: 8) {
        actions
          .buttonStyle(AglynTouchIconButtonStyle(filled: false))
          .menuStyle(.button)
        if let primary {
          AglynBlockableButton(primary) { Label(primary.title, systemImage: primary.systemImage).labelStyle(.iconOnly) }
            .buttonStyle(AglynTouchIconButtonStyle(filled: true))
        }
      }
      .fixedSize()
    }
    // Figma 22:499's Title row: 16 at the sides, 4 above and 8 below a 41-point line (the 34-point title; the
    // 40-point buttons).
    .frame(minHeight: 41)
    .padding(.horizontal, 16)
    .padding(.top, 4)
    .padding(.bottom, 8)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  /// The list column's side margins: the content edge, as every column's (`AglynContentInsets`).
  public static var inset: CGFloat { AglynContentInsets.horizontal }
}

/// A phone title row's 40-point button (Figma 22:499): the create action filled with the accent, any other action
/// bordered on the surface; an icon alone keeps it square, a word (Done) widens it.
public struct AglynTouchIconButtonStyle: ButtonStyle {
  let filled: Bool

  public init(filled: Bool) { self.filled = filled }

  public func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: filled ? 20 : 17, weight: .semibold))
      .foregroundStyle(filled ? AglynColor.primaryContrast : AglynColor.textPrimary)
      .padding(.horizontal, 10)
      .frame(minWidth: 40, minHeight: 40)
      .background(
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .fill(filled ? AglynColor.primary : AglynColor.paper))
      .overlay {
        if !filled { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(AglynColor.borderStrong) }
      }
      .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
      .opacity(configuration.isPressed ? 0.8 : 1)
  }
}

extension View {
  /// A screen that draws its own title row on a phone (`AglynListColumnHeader`): the navigation bar keeps the scope
  /// chip and the shell's buttons and draws no second title. The title stays the screen's name for the back button.
  /// Nothing changes on the Mac and iPad, or without a head.
  @ViewBuilder
  public func aglynListColumnHead(_ head: AglynAreaHead?) -> some View {
    #if os(iOS)
      modifier(AglynListColumnHeadModifier(head: head))
    #else
      self
    #endif
  }

  /// A record row in a phone's flush list (Figma List/Order row, Size=Phone): edge to edge on the surface, 16 at the
  /// sides, the row's own height, a hairline under it across the whole width.
  public func aglynFlushRow() -> some View {
    listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
      .listRowBackground(AglynColor.paper)
      .listRowSeparatorTint(AglynColor.divider)
      .alignmentGuide(.listRowSeparatorLeading) { _ in -16 }
  }

  /// A phone's flush list of record rows (Figma 22:499's Order rows): no inset card, rows on the surface.
  public func aglynFlushList() -> some View {
    listStyle(.plain)
      .scrollContentBackground(.hidden)
      .background(AglynColor.page)
      .environment(\.defaultMinListRowHeight, 1)
  }
}

#if os(iOS)
  private struct AglynListColumnHeadModifier: ViewModifier {
    @Environment(\.aglynWideChrome) private var wide
    let head: AglynAreaHead?

    func body(content: Content) -> some View {
      if head != nil, !wide {
        content
          .navigationBarTitleDisplayMode(.inline)
          .toolbar {
            ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1).accessibilityHidden(true) }
          }
      } else {
        content
      }
    }
  }
#endif

/// The breadcrumbs over the detail column of a screen that heads its own list column (Figma Orders 13:483).
public struct AglynDetailCrumbs: View {
  let head: AglynAreaHead

  public init(_ head: AglynAreaHead) { self.head = head }

  public var body: some View {
    // Figma 13:483: the crumbs 24 from the column's top and 40 from its edge, where the record's head lines up.
    head.crumbs
      .padding(.horizontal, AglynContentInsets.horizontal)
      .padding(.top, 24)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(AglynColor.paper)
  }
}

/// A record's row in a content list (Figma List/Order row 11:358): its kind's icon on a 32-point tile, the title at 14
/// semibold over the detail at 12, and the trailing figures; 64 points tall on the Mac and iPad. On a phone (Size=Phone)
/// the tile is 36, the title 17 and the detail 13, 68 points tall.
public struct AglynRecordRow<Trailing: View>: View {
  @Environment(\.aglynRowPadding) private var rowPadding
  @Environment(\.aglynRowSelected) private var rowSelected
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
      // Selected: the paper with a 1-point ring in the accent's text shade, so the tile stands off the selection's wash
      // (Figma List/Order row Selected 11:343, AGL-3990).
      Image(systemName: systemImage)
        .font(.system(size: phone ? 16 : 14))
        .foregroundStyle(rowSelected ? AglynColor.tint : AglynColor.secondaryText)
        .frame(width: phone ? 36 : 32, height: phone ? 36 : 32)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(rowSelected ? AglynColor.paper : AglynColor.sunken))
        .overlay {
          if rowSelected { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(AglynColor.tint, lineWidth: 1) }
        }
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
    // 64 points (68 on a phone) in all, whatever the row around it already pads.
    .padding(.vertical, max(0, (phone ? 12 : 10) - rowPadding))
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
