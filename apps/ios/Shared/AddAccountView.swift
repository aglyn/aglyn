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
      ScrollView {
        VStack(alignment: .leading, spacing: AglynSpace.two) {
          VStack(alignment: .leading, spacing: AglynSpace.one) {
            Text("Add an account").font(AglynFont.title).accessibilityAddTraits(.isHeader)
            Text(
              "Sign in to another \(model.brandName) account. You stay signed in to \(model.auth?.user?.email ?? "this account"), and can switch from your photo at any time."
            )
            .font(AglynFont.subheadline)
            .foregroundStyle(.secondary)
          }
          .padding(.horizontal, AglynSpace.two)
          .padding(.top, AglynSpace.two)
          SignedOutView()
        }
        .frame(maxWidth: 520)
        .frame(maxWidth: .infinity)
      }
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
