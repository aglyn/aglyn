// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// A screen's actions besides its one primary action (Calm rule 1), for its `aglynScreenToolbar`: one "More" menu in
/// the screen's head on the Mac and iPad, their own navigation-bar buttons on a phone, as they always were there.
public struct AglynSecondaryActions<Content: View>: View {
  @Environment(\.aglynWideChrome) private var wide
  let content: Content

  public init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  public var body: some View {
    if wide {
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
  public func aglynEditorActions(
    id: String, save title: String, enabled: Bool = true, primary: Bool = true, cancel: (() -> Void)? = nil,
    action: @escaping @MainActor () -> Void
  ) -> some View {
    modifier(AglynEditorActionsModifier(id: id, title: title, enabled: enabled, primary: primary, cancel: cancel, save: action))
  }
}

private struct AglynEditorActionsModifier: ViewModifier {
  @Environment(\.aglynWideChrome) private var wide
  let id: String
  let title: String
  let enabled: Bool
  let primary: Bool
  let cancel: (() -> Void)?
  let save: @MainActor () -> Void

  func body(content: Content) -> some View {
    if wide {
      content.preference(key: AglynScreenChromeKey.self, value: chrome)
    } else {
      content.toolbar {
        if let cancel {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { cancel() } }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(title) { save() }
            .disabled(!enabled)
            .accessibilityIdentifier(id)
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
    id: String, _ title: String, systemImage: String, enabled: Bool = true, action: @escaping @MainActor () -> Void
  ) -> some View {
    modifier(
      AglynWidePrimaryActionModifier(
        action: AglynPrimaryAction(id: id, title: title, systemImage: systemImage, enabled: enabled, run: action)))
  }
}

private struct AglynWidePrimaryActionModifier: ViewModifier {
  @Environment(\.aglynWideChrome) private var wide
  let action: AglynPrimaryAction

  func body(content: Content) -> some View {
    if wide {
      content.preference(key: AglynScreenChromeKey.self, value: AglynScreenChrome(primary: action))
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
  let action: AglynPrimaryAction?

  func body(content: Content) -> some View {
    if wide {
      content.preference(key: AglynScreenChromeKey.self, value: AglynScreenChrome(primary: action))
    } else {
      content.toolbar {
        if let action {
          ToolbarItem(placement: .primaryAction) {
            Button { action.run() } label: { Label(action.title, systemImage: action.systemImage) }
              .disabled(!action.enabled)
              .accessibilityIdentifier(action.id)
          }
        }
      }
    }
  }
}
