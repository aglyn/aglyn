// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

extension View {
  /// The question an action asks before it runs ("Turn Forms off for this site?"), with its buttons.
  ///
  /// `centered` (the iPad's wide chrome): a centered alert, as the console's dialog and Android's are. A
  /// `confirmationDialog` there is a popover whose source is the view it is attached to, here the whole screen, and the
  /// iPad showed nothing at all: Site settings › Plugins' switches asked nothing and saved nothing (AGL-4221). A phone
  /// keeps its action sheet from the bottom, and the Mac its sheet. `message`, when set, is the body under the question
  /// (what else a plugin takes with it when it goes off, as the console's dialog lists it).
  func actionConfirmation<Actions: View>(
    _ title: String, message: String? = nil, isPresented: Binding<Bool>, centered: Bool,
    @ViewBuilder actions: @escaping () -> Actions
  ) -> some View {
    modifier(ActionConfirmation(title: title, message: message, isPresented: isPresented, centered: centered, actions: actions))
  }
}

private struct ActionConfirmation<Actions: View>: ViewModifier {
  let title: String
  let message: String?
  @Binding var isPresented: Bool
  let centered: Bool
  let actions: () -> Actions

  func body(content: Content) -> some View {
    #if os(iOS)
      if centered {
        content.alert(title, isPresented: $isPresented, actions: actions, message: messageText)
      } else {
        content.confirmationDialog(
          title, isPresented: $isPresented, titleVisibility: .visible, actions: actions, message: messageText)
      }
    #else
      content.confirmationDialog(
        title, isPresented: $isPresented, titleVisibility: .visible, actions: actions, message: messageText)
    #endif
  }

  @ViewBuilder private func messageText() -> some View {
    if let message { Text(message) }
  }
}
