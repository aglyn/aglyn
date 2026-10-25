// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// The one look every sidebar, list and table row takes when it is selected,
/// hovered or pressed (docs: design-2026-10-16 competitive analysis, spec 2).
///
/// A selected row is a soft brand-tinted rounded fill, inset from the column
/// edge, with its text left in the normal text color (never reversed to white),
/// so contrast holds in light and dark. When the window is not key the fill
/// turns neutral, the way AppKit's unemphasized selection does. Hover and
/// press are faint neutral fills; keyboard focus keeps the system ring.
public enum AglynRowState: Sendable {
  case idle, hovered, pressed, selected, selectedInactive

  /// The fill this state draws behind the row.
  public var fill: Color {
    switch self {
    case .idle: .clear
    case .hovered: AglynColor.hoverFill
    case .pressed: AglynColor.pressedFill
    case .selected: AglynColor.selectedFill
    case .selectedInactive: AglynColor.selectedFillInactive
    }
  }

  public static func of(selected: Bool, windowActive: Bool, pressed: Bool, hovered: Bool) -> AglynRowState {
    if selected { return windowActive ? .selected : .selectedInactive }
    if pressed { return .pressed }
    if hovered { return .hovered }
    return .idle
  }
}

extension AglynColor {
  /// A selected row while its window is key: the brand blue, soft.
  public static let selectedFill = adaptive(
    light: AglynTokens.light.primary.main.opacity(0.14), dark: AglynTokens.dark.primary.main.opacity(0.26))
  /// A selected row while its window is not key: neutral, like AppKit's unemphasized selection.
  public static let selectedFillInactive = adaptive(
    light: AglynTokens.light.text.primary.opacity(0.08), dark: AglynTokens.dark.text.primary.opacity(0.13))
  /// A row under the pointer.
  public static let hoverFill = adaptive(
    light: AglynTokens.light.text.primary.opacity(0.045), dark: AglynTokens.dark.text.primary.opacity(0.07))
  /// A row being pressed.
  public static let pressedFill = adaptive(
    light: AglynTokens.light.text.primary.opacity(0.09), dark: AglynTokens.dark.text.primary.opacity(0.13))
}

extension AglynRadius {
  /// A list or sidebar row's highlight: the Mac's sidebar rounding, a touch rounder on touch screens.
  public static var row: CGFloat {
    #if os(macOS)
      6
    #else
      10
    #endif
  }
}

/// Whether the window this view sits in is the key window (always on iPhone and iPad).
struct WindowActiveReader<Content: View>: View {
  #if os(macOS)
    @Environment(\.controlActiveState) private var activeState
  #endif
  let content: (Bool) -> Content

  var body: some View {
    #if os(macOS)
      content(activeState != .inactive)
    #else
      content(true)
    #endif
  }
}

/// The rounded fill behind a row in a given state.
public struct AglynRowHighlight: View {
  let selected: Bool
  let hovered: Bool
  let pressed: Bool
  /// A full-width content row's fill: square, edge to edge.
  let square: Bool

  public init(selected: Bool, hovered: Bool = false, pressed: Bool = false, square: Bool = false) {
    self.selected = selected
    self.hovered = hovered
    self.pressed = pressed
    self.square = square
  }

  public var body: some View {
    WindowActiveReader { active in
      RoundedRectangle(cornerRadius: square ? 0 : AglynRadius.row, style: .continuous)
        .fill(AglynRowState.of(selected: selected, windowActive: active, pressed: pressed, hovered: hovered).fill)
    }
    .animation(.easeOut(duration: 0.12), value: selected)
    .animation(.easeOut(duration: 0.08), value: hovered)
  }
}

/// How tall a selectable row is at least, and how much air sits around its content.
public enum AglynRowDensity: Sendable {
  /// A sidebar row: one line, the Mac's medium sidebar height, a touch target on iPad.
  case sidebar
  /// A content list row: title and subtitle.
  case list

  var minHeight: CGFloat {
    // Compact density (Theming) takes four points off a row, never below the Mac's own 24-point row.
    let compact: CGFloat = AglynThemeRuntime.shared.isCompact ? 4 : 0
    #if os(macOS)
      return (self == .sidebar ? 28 : 36) - compact
    #else
      return 44 - (self == .sidebar ? compact : 0)
    #endif
  }

  var vertical: CGFloat {
    let compact: CGFloat = AglynThemeRuntime.shared.isCompact ? 2 : 0
    #if os(macOS)
      return (self == .sidebar ? 4 : 6) - compact
    #else
      return (self == .sidebar ? 6 : 8) - compact
    #endif
  }

  var horizontal: CGFloat {
    #if os(macOS)
      self == .sidebar ? 8 : 10
    #else
      12
    #endif
  }

  /// The row's insets in its list. A sidebar row keeps its gap between the highlight and the column's edge; a content
  /// list row's content sits on the column's content edges (`AglynContentInsets`), its highlight reaching `horizontal`
  /// past them.
  var insets: EdgeInsets {
    if self == .list { return AglynContentInsets.listRow(padding: horizontal, vertical: 1) }
    #if os(macOS)
      return EdgeInsets(top: 1, leading: 8, bottom: 1, trailing: 8)
    #else
      return EdgeInsets(top: 1, leading: 10, bottom: 1, trailing: 10)
    #endif
  }
}

/// A row as a button that draws the shared selected, hover and pressed states.
public struct AglynSelectableRowStyle: ButtonStyle {
  let selected: Bool
  let density: AglynRowDensity

  public init(selected: Bool, density: AglynRowDensity = .list) {
    self.selected = selected
    self.density = density
  }

  public func makeBody(configuration: Configuration) -> some View {
    RowBody(configuration: configuration, selected: selected, density: density)
  }

  struct RowBody: View {
    @Environment(\.aglynWideChrome) private var wide
    let configuration: Configuration
    let selected: Bool
    let density: AglynRowDensity
    @State private var hovered = false

    var body: some View {
      // A content list's row on the Mac and iPad is a full-width row (Figma List/Site row: no inset
      // pills): its fill runs the list's width, square, and its content sits on E. A sidebar row keeps its pill.
      let flush = wide && density == .list
      configuration.label
        .environment(\.aglynRowPadding, density.vertical)
        .environment(\.aglynRowSelected, selected)
        .fontWeight(selected && density == .sidebar ? .semibold : nil)
        .padding(.leading, flush ? AglynContentInsets.horizontal - AglynContentInsets.listBuiltIn.leading : density.horizontal)
        .padding(.trailing, flush ? AglynContentInsets.horizontal - AglynContentInsets.listBuiltIn.trailing : density.horizontal)
        .padding(.vertical, density.vertical)
        .frame(maxWidth: .infinity, minHeight: density.minHeight, alignment: .leading)
        .background(AglynRowHighlight(selected: selected, hovered: hovered, pressed: configuration.isPressed, square: flush))
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
        .modifier(AglynLinkPointer(enabled: true))
    }
  }
}

/// A selectable row's insets in its list: none at the sides for a content list on the Mac and iPad (the row draws E
/// itself and its fill runs the width), else the density's.
struct AglynSelectableRowInsets: ViewModifier {
  @Environment(\.aglynWideChrome) private var wide
  let density: AglynRowDensity

  func body(content: Content) -> some View {
    if wide && density == .list {
      content.listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
    } else {
      content.listRowInsets(density.insets)
    }
  }
}

/// A list row that is a button (it opens a screen or picks a value) and selects nothing: a faint rounded fill under
/// the pointer and a firmer one while pressed, the same fills a selectable row uses, so every row answers a touch or
/// a click the same way. The label keeps its own colors (never the accent tint or a dimmed label), and the whole row,
/// not only its words, is the target.
public struct AglynRowButtonStyle: ButtonStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    RowBody(configuration: configuration)
  }

  /// How far the fill reaches past the label into the row's own padding.
  static var bleed: EdgeInsets {
    #if os(macOS)
      EdgeInsets(top: -3, leading: -6, bottom: -3, trailing: -6)
    #else
      EdgeInsets(top: -6, leading: -10, bottom: -6, trailing: -10)
    #endif
  }

  struct RowBody: View {
    let configuration: Configuration
    @Environment(\.isEnabled) private var enabled
    /// In a plain form's row the fill runs the row edge to edge (`AglynGroupedForm`); elsewhere it is a rounded fill
    /// just past the label.
    @Environment(\.aglynRowBleed) private var rowBleed
    @State private var hovered = false

    var body: some View {
      let fill = AglynRowState.of(
        selected: false, windowActive: true, pressed: enabled && configuration.isPressed, hovered: enabled && hovered
      ).fill
      configuration.label
        .contentShape(Rectangle())
        .background {
          if let rowBleed {
            Rectangle().fill(fill).padding(rowBleed)
          } else {
            RoundedRectangle(cornerRadius: AglynRadius.row, style: .continuous)
              .fill(fill)
              .padding(AglynRowButtonStyle.bleed)
          }
        }
        .onHover { hovered = $0 }
        .modifier(AglynLinkPointer(enabled: enabled))
        .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
        .animation(.easeOut(duration: 0.08), value: hovered)
    }
  }
}

/// A row that does one thing (Open the lead in the CRM, Add to a marketing list, Add join collection): its words in the
/// accent text color (the error color when destructive), a › when it opens another screen, the row's hover and the
/// pointing hand; never a bordered pill or a tinted wash. In a plain form its hover runs the row's
/// whole width.
public struct AglynActionRow: View {
  let title: String
  let systemImage: String?
  let opens: Bool
  let destructive: Bool
  let action: () -> Void

  public init(
    _ title: String, systemImage: String? = nil, opens: Bool = false, destructive: Bool = false,
    action: @escaping () -> Void
  ) {
    self.title = title
    self.systemImage = systemImage
    self.opens = opens
    self.destructive = destructive
    self.action = action
  }

  public var body: some View {
    Button(action: action) {
      HStack(spacing: AglynSpace.one) {
        if let systemImage { Image(systemName: systemImage).frame(width: 20) }
        Text(title)
        Spacer(minLength: AglynSpace.one)
        if opens {
          Image(systemName: "chevron.forward").font(.caption.weight(.semibold)).foregroundStyle(AglynColor.textTertiary)
            .accessibilityHidden(true)
        }
      }
      .foregroundStyle(destructive ? AglynColor.error : AglynColor.tint)
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(Rectangle())
    }
    .buttonStyle(.aglynRow)
  }
}

/// A row that opens something shows the pointing hand on the Mac, as a link does ("it's not obvious
/// this is clickable").
struct AglynLinkPointer: ViewModifier {
  let enabled: Bool

  func body(content: Content) -> some View {
    #if os(macOS)
      if enabled, #available(macOS 15, *) {
        content.pointerStyle(.link)
      } else {
        content
      }
    #else
      content
    #endif
  }
}

extension ButtonStyle where Self == AglynRowButtonStyle {
  /// A list row that is a button: `AglynRowButtonStyle`.
  public static var aglynRow: AglynRowButtonStyle { AglynRowButtonStyle() }
}

extension View {
  /// This view as one selectable row of a `List`: tapping it selects `id`, and
  /// it draws the shared selected, hover and pressed states (never the
  /// platform's solid accent bar). Pair the list with `aglynSelectionKeys`.
  public func aglynSelectableRow<ID: Hashable>(
    _ id: ID, selection: Binding<ID?>, density: AglynRowDensity = .list
  ) -> some View {
    aglynSelectableRow(selected: selection.wrappedValue == id, density: density) { selection.wrappedValue = id }
  }

  /// A selectable row whose selection the caller keeps (a sidebar section, a route).
  public func aglynSelectableRow(
    selected: Bool, density: AglynRowDensity = .list, action: @escaping () -> Void
  ) -> some View {
    Button(action: action) { self }
      .buttonStyle(AglynSelectableRowStyle(selected: selected, density: density))
      .modifier(AglynSelectableRowInsets(density: density))
      .listRowBackground(Color.clear)
      .listRowSeparator(.hidden)
      .accessibilityAddTraits(selected ? [.isSelected] : [])
  }

  /// Up and down arrows move a list's selection through `ids` (a hardware
  /// keyboard on iPad, the Mac), as a system selection list does.
  public func aglynSelectionKeys<ID: Hashable>(_ ids: [ID], selection: Binding<ID?>) -> some View {
    focusable()
      .focusEffectDisabled()
      .onKeyPress(keys: [.upArrow, .downArrow]) { press in
        guard let next = AglynSelectionKeys.step(ids, from: selection.wrappedValue, down: press.key == .downArrow)
        else { return .ignored }
        selection.wrappedValue = next
        return .handled
      }
  }
}

public enum AglynSelectionKeys {
  /// The id an arrow key moves to: the next or previous one, the first when nothing is picked, nil at an end.
  public static func step<ID: Hashable>(_ ids: [ID], from current: ID?, down: Bool) -> ID? {
    guard !ids.isEmpty else { return nil }
    guard let current, let index = ids.firstIndex(of: current) else { return down ? ids.first : ids.last }
    let next = down ? index + 1 : index - 1
    return ids.indices.contains(next) ? ids[next] : nil
  }
}

extension View {
  /// A list whose rows are `aglynSelectableRow`s, in a wide window's list
  /// column: plain rows on the paper surface, no separators, the highlight
  /// inset from the edges.
  public func aglynSelectableListStyle() -> some View {
    listStyle(.plain)
      .scrollContentBackground(.hidden)
      .background(AglynColor.paper)
      .environment(\.defaultMinListRowHeight, 1)
  }
}

private struct AglynRowPaddingKey: EnvironmentKey {
  static let defaultValue: CGFloat = 0
}

private struct AglynRowSelectedKey: EnvironmentKey {
  static let defaultValue = false
}

extension EnvironmentValues {
  /// The vertical padding the row a view sits in already gives it (a selectable row's), so a row drawn to a measured
  /// height (`AglynRecordRow`) keeps that height inside it.
  public var aglynRowPadding: CGFloat {
    get { self[AglynRowPaddingKey.self] }
    set { self[AglynRowPaddingKey.self] = newValue }
  }

  /// Whether the row a view sits in is selected: a tile or a status chip on the selection's wash takes the paper with
  /// a ring, so it stands off the wash (Figma List/Order row Selected 11:343, AGL-3990).
  public var aglynRowSelected: Bool {
    get { self[AglynRowSelectedKey.self] }
    set { self[AglynRowSelectedKey.self] = newValue }
  }
}
