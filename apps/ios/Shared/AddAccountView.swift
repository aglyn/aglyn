// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// Add account (Zach 2026-10-18, Phase 1; Figma Menus 2:4 "Add account", Mac 67:632, iPhone 69:860): the app's own
/// sign-in screens, signing in to another account beside the one in use. The person stays signed in to every account
/// and switches from their photo; the new account keeps its own sign-in, workspaces, pins and push.
struct AddAccountView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var startedSlot: String?

  var body: some View {
    NavigationStack {
      // The sign-in screens draw their own card, heading and scrolling (AuthCard measures the space it is given, so it
      // must not sit inside another ScrollView, where it is offered no height and draws nothing). The add-account words
      // replace the sign-in heading and line.
      SignedOutView(
        signInTitle: "Add an account",
        signInSubtitle:
          "Sign in to another \(model.brandName) account. You stay signed in to \(model.auth?.user?.email ?? "this account"), and can switch from your photo at any time."
      )
      .background(AglynColor.page)
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.accessibilityIdentifier("add-account-cancel")
        }
      }
    }
    .aglynSheetMinimumSize(width: 520, height: 680)
    .onAppear {
      startedSlot = model.auth?.activeSlot
      model.authFlow.reset()
      model.auth?.addingAccount = true
    }
    .onDisappear {
      model.auth?.addingAccount = false
      model.authFlow.reset()
    }
    // The new account signed in and is now the one in use.
    .onChange(of: model.auth?.activeSlot) { _, slot in
      if slot != startedSlot { dismiss() }
    }
  }
}
