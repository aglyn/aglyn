// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynScreens
import AglynUI
import SwiftUI

/// The signed-out app: whichever of the console's `(auth)` screens the flow is on.
struct SignedOutView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    Group {
      switch model.authFlow.screen {
      case .signIn: SignInView()
      case .signUp: SignUpView()
      case .accountRecovery: AccountRecoveryView()
      case .resetPassword(let code): ResetPasswordView(code: code)
      case .confirmEmail(let code): ConfirmEmailView(code: code)
      }
    }
    .animation(.default, value: model.authFlow.screen)
  }
}

/// Email and password sign-in against Firebase Auth, the console's own accounts (`/signin`).
struct SignInView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.webAuthenticationSession) private var webAuthentication
  @State private var password = ""
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    @Bindable var flow = model.authFlow
    AuthCard(
      model.app == .pos ? "Sign in to \(model.appName)" : "Sign in",
      subtitle: model.app == .pos ? "Sign in to take payments at your store." : "Use your \(model.brandName) account"
    ) {
      VStack(spacing: 12) {
        AuthField(label: "Email", text: $flow.email, content: .email, identifier: "sign-in-email")
        AuthField(label: "Password", text: $password, secure: true, content: .password, identifier: "sign-in-password")
          .onSubmit(submit)
      }

      if let error { AuthMessage(text: error) }

      VStack(spacing: 8) {
        AuthPrimaryButton(title: "Sign in", busy: busy, enabled: !flow.email.isEmpty, action: submit)
          .accessibilityIdentifier("sign-in-submit")
        ProviderSignInButtons(mode: .signIn, busy: $busy, error: $error)
      }

      Text(
        .init(
          "By continuing, you agree to \(model.brandName)’s [Terms of Service](\(legalOrigin)/legal/terms) and [Privacy Policy](\(legalOrigin)/legal/privacy)."
        )
      )
      .font(AglynFont.caption)
      .foregroundStyle(.secondary)

      if !model.deviceScreens.isEmpty {
        Divider()
        VStack(alignment: .leading, spacing: 8) {
          Text("Not a register?").font(AglynFont.headline)
          Text("Set this device up as a screen for your customers. A code from a register pairs it.")
            .font(AglynFont.subheadline).foregroundStyle(.secondary)
          ForEach(model.deviceScreens) { screen in
            Button(screen.title) { model.setDeviceMode(screen.id) }
              .buttonStyle(.bordered)
              .controlSize(.large)
              .accessibilityIdentifier("device-mode-\(screen.id)")
          }
        }
      }
    } footer: {
      VStack(alignment: .leading, spacing: 8) {
        HStack(spacing: 4) {
          Text("Having trouble logging in?")
          Button("Account recovery") { flow.screen = .accountRecovery }
            .buttonStyle(.borderless).accessibilityIdentifier("sign-in-account-recovery")
        }
        HStack(spacing: 4) {
          Text("New to \(model.brandName)?")
          Button("Create account") { flow.screen = .signUp }
            .buttonStyle(.borderless).accessibilityIdentifier("sign-in-create-account")
        }
      }
      .font(AglynFont.subheadline)
    }
    .sensoryFeedback(.error, trigger: error)
  }

  private var legalOrigin: String { model.config?.legalOrigin ?? AglynConfig.defaultLegalOrigin }

  private func submit() {
    let email = model.authFlow.email
    guard !email.isEmpty, let auth = model.auth, !busy else { return }
    busy = true
    error = nil
    Task {
      do {
        // Email first, as the console's `/sso` discovers it: an address on a workspace's single sign-on domain lives in
        // that workspace's identity pool, so it signs in through its identity provider, never with a project-pool password.
        if await model.signUpService?.usesSingleSignOn(email) == true {
          try await model.signInThroughConsole(start: .singleSignOn, loginHint: email) { [webAuthentication] url, scheme in
            try await webAuthentication.authenticate(using: url, callbackURLScheme: scheme, preferredBrowserSession: .shared)
          }
        } else if password.isEmpty {
          self.error = "Enter your password."
        } else {
          try await signInWithAnyConfirmedAddress(auth, email: email)
        }
      } catch {
        if !isCanceledSignIn(error) {
          self.error = (error as? ConsoleAPIError)?.message ?? signInErrorMessage(error)
        }
      }
      busy = false
    }
  }

  /// The typed address first; on a credential refusal alone, once more with the account's primary address when the
  /// typed one is a confirmed secondary (`/api/auth/resolve-identifier`, AGL-2486).
  private func signInWithAnyConfirmedAddress(_ auth: AuthSession, email: String) async throws {
    do {
      try await auth.signIn(email: email, password: password)
    } catch {
      guard isCredentialRefusal(error), let resolved = await model.signUpService?.resolveIdentifier(email) else { throw error }
      try await auth.signIn(email: resolved, password: password)
    }
  }
}
