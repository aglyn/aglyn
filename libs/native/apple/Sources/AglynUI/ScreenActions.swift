// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// What sits beside a list's create action (its create zone: Create with AI). Beside New in the head on the Mac and iPad.
/// On a phone it goes in a "⋯": the phone's top bar, and a pushed screen's navigation bar, already hold the AI panel's ✦,
/// so a list's own Create with AI never draws a second ✦ beside it (one ✦ per phone screen; Figma iPhone / Site / Pages
/// 283:23456). A list that already folds actions into its title row's "⋯" puts it there instead (`phoneTitleRow`).
///
/// `reportsDrawn`: the content is other plugins' widgets, which may draw nothing (Create with AI where the plan has no
/// AI). A menu's items are only built when it opens, so a copy of the content is kept out of sight to load them, and the
/// "⋯" shows once one says it draws something (`aglynDrawsBesideCreate`), never as an empty menu.
public struct AglynBesideCreate<Content: View>: View {
  @Environment(\.aglynWideChrome) private var wide
  @State private var drawn = false
  let reportsDrawn: Bool
  let content: Content

  public init(reportsDrawn: Bool = false, @ViewBuilder content: () -> Content) {
    self.reportsDrawn = reportsDrawn
    self.content = content()
  }

  public var body: some View {
    if wide {
      content
    } else if reportsDrawn {
      ZStack {
        content.hidden().frame(width: 0, height: 0).clipped().allowsHitTesting(false).accessibilityHidden(true)
        if drawn { AglynMoreMenu { content } }
      }
      .onPreferenceChange(AglynDrawsBesideCreateKey.self) { drawn = $0 }
    } else {
      AglynMoreMenu { content }
    }
  }
}

/// Whether a widget beside a list's create action draws something (`AglynBesideCreate(reportsDrawn:)`).
public struct AglynDrawsBesideCreateKey: PreferenceKey {
  public static let defaultValue = false
  public static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}

extension View {
  /// Says this widget draws something beside a list's create action, so a phone's "⋯" for it shows.
  public func aglynDrawsBesideCreate(_ drawn: Bool) -> some View {
    preference(key: AglynDrawsBesideCreateKey.self, value: drawn)
  }
}

/// Whether a list draws in a phone's title row (Figma iPhone / Site / Pages 283:23456): the row holds the ⋯ and the
/// filled "+", and the top bar above it already holds the AI panel's ✦, so a list's Create with AI goes in that ⋯ rather
/// than drawing a second ✦ beside it. The Mac and iPad keep it beside New in the head.
public func phoneTitleRow(head: AglynAreaHead?, wide: Bool) -> Bool { head != nil && !wide }

/// A screen's actions besides its one primary action (Calm rule 1), for its `aglynScreenToolbar`: one "More" menu in
/// the screen's head on the Mac and iPad, their own navigation-bar buttons on a phone, as they always were there.
public struct AglynSecondaryActions<Content: View>: View {
  @Environment(\.aglynWideChrome) private var wide
  @Environment(\.aglynPhoneAreaHead) private var phoneHead
  let content: Content

  public init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  public var body: some View {
    // A phone area's title row folds them into its "⋯" too (Figma 283:23456), beside the filled "+".
    if wide || phoneHead != nil {
      AglynMoreMenu { content }
    } else {
      content
    }
  }
}

extension View {
  /// An editor's Cancel and Save. On a phone they stay in the navigation bar (Cancel leading, Save trailing). On the
  /// Mac and iPad they sit in the screen's head: Save as its one filled button with Cancel beside it, or, for an editor
  /// shown beside its list (`primary: false`), Save as a bordered button so the list keeps the head's one primary action.
  /// `busy` (a save in flight) shows a spinner in place of Save on a phone and "Saving…" in the head.
  public func aglynEditorActions(
    id: String, save title: String, enabled: Bool = true, busy: Bool = false, primary: Bool = true,
    cancel: (() -> Void)? = nil, action: @escaping @MainActor () -> Void
  ) -> some View {
    modifier(
      AglynEditorActionsModifier(
        id: id, title: busy ? "Saving…" : title, enabled: enabled && !busy, busy: busy, primary: primary, cancel: cancel,
        save: action))
  }
}

private struct AglynEditorActionsModifier: ViewModifier {
  @Environment(\.aglynWideChrome) private var wide
  let id: String
  let title: String
  let enabled: Bool
  let busy: Bool
  let primary: Bool
  let cancel: (() -> Void)?
  let save: @MainActor () -> Void

  func body(content: Content) -> some View {
    if wide {
      content.transformPreference(AglynScreenChromeKey.self) { $0.merge(chrome) }
    } else {
      content.toolbar {
        if let cancel {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { cancel() } }
        }
        ToolbarItem(placement: .confirmationAction) {
          if busy {
            ProgressView().accessibilityLabel(title).accessibilityIdentifier("\(id)-busy")
          } else {
            Button(title) { save() }
              .disabled(!enabled)
              .accessibilityIdentifier(id)
          }
        }
      }
    }
  }

  private var chrome: AglynScreenChrome {
    var entries: [AglynScreenToolbarEntry] = []
    if let cancel {
      entries.append(AglynScreenToolbarEntry(id: "\(id)-cancel", content: AnyView(Button("Cancel") { cancel() })))
    }
    if primary {
      return AglynScreenChrome(
        primary: AglynPrimaryAction(id: id, title: title, systemImage: "checkmark", enabled: enabled, run: save), entries: entries)
    }
    entries.append(
      AglynScreenToolbarEntry(
        id: id,
        content: AnyView(Button(title) { save() }.disabled(!enabled).accessibilityIdentifier(id))))
    return AglynScreenChrome(entries: entries)
  }
}

extension View {
  /// A primary action for the screen's head on the Mac and iPad only, for a screen whose phone layout keeps the action
  /// where it always was (inside its navigation-bar menu).
  public func aglynWidePrimaryAction(
    id: String, _ title: String, systemImage: String, enabled: Bool = true, shortcut: KeyboardShortcut? = nil,
    help: String? = nil, action: @escaping @MainActor () -> Void
  ) -> some View {
    modifier(
      AglynWidePrimaryActionModifier(
        action: AglynPrimaryAction(
          id: id, title: title, systemImage: systemImage, enabled: enabled, shortcut: shortcut, help: help, run: action)))
  }
}

private struct AglynWidePrimaryActionModifier: ViewModifier {
  @Environment(\.aglynWideChrome) private var wide
  let action: AglynPrimaryAction

  func body(content: Content) -> some View {
    if wide {
      content.transformPreference(AglynScreenChromeKey.self) { $0.merge(AglynScreenChrome(primary: action)) }
    } else {
      content
    }
  }
}

extension View {
  /// A primary action the screen has only some of the time (a tab without one, a whole-workspace view): `nil` leaves the
  /// head and the navigation bar without one, and the screen keeps its identity as it comes and goes.
  public func aglynPrimaryAction(_ action: AglynPrimaryAction?) -> some View {
    modifier(AglynOptionalPrimaryActionModifier(action: action))
  }
}

private struct AglynOptionalPrimaryActionModifier: ViewModifier {
  @Environment(\.aglynWideChrome) private var wide
  @Environment(\.aglynPhoneAreaHead) private var phoneHead
  let action: AglynPrimaryAction?

  func body(content: Content) -> some View {
    // A phone area's title row draws it too (`aglynPhoneAreaHead`), as the head does on the Mac and iPad.
    if wide || phoneHead != nil {
      content.transformPreference(AglynScreenChromeKey.self) { $0.merge(AglynScreenChrome(primary: action)) }
    } else {
      content.toolbar {
        if let action {
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
}
