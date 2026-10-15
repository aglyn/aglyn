// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynScreens
import AglynUI
import AuthenticationServices
import SwiftUI

/// The doors under a sign-in or sign-up form besides the password: a passkey on sign-in where the build has a relying
/// party (the console's sign-in page offers one too).
struct ProviderSignInButtons: View {
  enum Mode { case signIn, signUp }

  @Environment(AppModel.self) private var model
  @Environment(\.authorizationController) private var authorizationController
  let mode: Mode
  var enabled = true
  /// The sign-up's consent check, run before a provider sheet opens.
  var gate: () -> Bool = { true }
  @Binding var busy: Bool
  @Binding var error: String?
  var marketing = false

  private var passkeyOffered: Bool { mode == .signIn && model.config?.passkeyRelyingParty != nil && model.api != nil }

  var body: some View {
    if passkeyOffered {
      VStack(spacing: 8) {
        HStack {
          VStack { Divider() }
          Text(mode == .signUp ? "Or sign up with" : "Or sign in with").font(AglynFont.caption).foregroundStyle(.secondary)
            .fixedSize()
          VStack { Divider() }
        }
        if passkeyOffered {
          Button(action: passkey) {
            Label("Passkey", systemImage: "person.badge.key").frame(maxWidth: .infinity)
          }
          .buttonStyle(.bordered)
          .controlSize(.large)
          .disabled(busy || !enabled)
          .accessibilityIdentifier("sign-in-passkey")
        }
      }
    }
  }

  private func passkey() {
    guard let auth = model.auth, let api = model.api, let relyingParty = model.config?.passkeyRelyingParty else { return }
    busy = true
    error = nil
    Task {
      do {
        let token = try await PasskeySignIn.token(api: api, relyingParty: relyingParty, controller: authorizationController)
        try await auth.signIn(customToken: token)
      } catch {
        // The ceremony's and the routes' failures have the console's words; the Firebase sign-in after them has its own.
        self.error = PasskeySignIn.failed(error) ? PasskeySignIn.message(for: error) : signInErrorMessage(error)
      }
      busy = false
    }
  }
}
