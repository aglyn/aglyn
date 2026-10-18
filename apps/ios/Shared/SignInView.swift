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
      case .singleSignOn: SingleSignOnView()
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
  /// The password door is working (the provider doors share `busy`, which disables every button).
  @State private var submitting = false
  /// The password door's refusal, shown under the password field.
  @State private var error: String?
  /// A provider door's failure, shown above the provider buttons.
  @State private var providerError: String?

  var body: some View {
    @Bindable var flow = model.authFlow
    AuthCard(
      model.app == .pos ? "Sign in to \(model.appName)" : "Sign in",
      subtitle: model.app == .pos ? "Sign in to take payments at your store." : "Use your \(model.brandName) account",
      accessory: {
        AuthLink("Create account", identifier: "sign-in-create-account") { flow.screen = .signUp }
      }
    ) {
      AuthField(
        label: "Email", text: $flow.email, content: .email, placeholder: "you@example.com",
        identifier: "sign-in-email")
      AuthField(
        label: "Password", text: $password, secure: true, content: .password, message: error,
        identifier: "sign-in-password"
      )
      .onSubmit(submit)
      AuthPrimaryButton(title: "Sign in", busy: submitting, enabled: !flow.email.isEmpty, action: submit)
        .accessibilityIdentifier("sign-in-submit")
      if let providerError { AuthMessage(text: providerError) }
      ProviderSignInButtons(mode: .signIn, busy: $busy, error: $providerError)

      Text(
        .init(
          "By continuing, you agree to \(model.brandName)’s [Terms of Service](\(legalOrigin)/legal/terms) and [Privacy Policy](\(legalOrigin)/legal/privacy)."
        )
      )
      .font(AglynAuthFont.caption)
      .foregroundStyle(AglynAuthTokens.Colors.textSecondary.color)
      .tint(AglynAuthTokens.Colors.textPrimary.color)
      .fixedSize(horizontal: false, vertical: true)

      if !model.deviceScreens.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          Text("Not a register?").font(AglynAuthFont.headline)
          Text("Set this device up as a screen for your customers. A code from a register pairs it.")
            .font(AglynAuthFont.body).foregroundStyle(AglynAuthTokens.Colors.textSecondary.color)
            .fixedSize(horizontal: false, vertical: true)
          HStack(spacing: 8) {
            ForEach(model.deviceScreens) { screen in
              Button { model.setDeviceMode(screen.id) } label: { AglynButtonLabel(screen.title) }
                .buttonStyle(AglynButtonStyle(.secondary, size: .medium, fullWidth: false))
                .accessibilityIdentifier("device-mode-\(screen.id)")
            }
          }
        }
        .padding(.top, 4)
      }
    } footer: {
      AuthFooterLine(lead: "Having trouble logging in?", link: "Account recovery", identifier: "sign-in-account-recovery") {
        flow.screen = .accountRecovery
      }
    }
    .sensoryFeedback(.error, trigger: error)
  }

  private var legalOrigin: String { model.config?.legalOrigin ?? AglynConfig.defaultLegalOrigin }

  private func submit() {
    let email = model.authFlow.email
    guard !email.isEmpty, let auth = model.auth, !busy else { return }
    busy = true
    submitting = true
    error = nil
    providerError = nil
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
      submitting = false
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

/// Workspace single sign-on (`/sso`): the work email first, then the organization's own sign-in page through the console
/// and the one-time hand-off back to the app. A domain the console knows says so before the person continues.
struct SingleSignOnView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.webAuthenticationSession) private var webAuthentication
  @State private var busy = false
  @State private var tried = false
  @State private var error: String?
  /// The typed address's domain, once the console has said it signs in with single sign-on.
  @State private var recognized: String?

  var body: some View {
    @Bindable var flow = model.authFlow
    AuthCard(
      "Single sign-on",
      subtitle: "Enter your work email and we’ll take you to your organization’s sign-in"
    ) {
      AuthField(
        label: "Work email", text: $flow.email, content: .email, placeholder: "you@company.com",
        message: tried ? SignUpRules.email(flow.email) ?? error : error, identifier: "sso-email"
      )
      .onSubmit(submit)
      if let recognized {
        AglynAuthNotice(
          "\(recognized) signs in with single sign-on. You’ll continue at your organization’s sign-in page.",
          systemImage: "key", tone: .info
        )
        .accessibilityIdentifier("sso-routing")
      }
      Button(action: submit) { AglynButtonLabel("Continue with SSO", busy: busy) }
        .buttonStyle(AglynButtonStyle(.primary))
        .disabled(busy)
        .keyboardShortcut(.defaultAction)
        .accessibilityIdentifier("sso-submit")
    } footer: {
      Button { flow.reset() } label: { Label("Back to sign in", systemImage: "arrow.left") }
        .buttonStyle(AglynAuthLinkStyle())
        .accessibilityIdentifier("sso-back")
    }
    .task(id: flow.email) {
      recognized = nil
      let email = flow.email.trimmingCharacters(in: .whitespaces)
      guard SignUpRules.email(email) == nil else { return }
      try? await Task.sleep(for: .milliseconds(400))
      guard !Task.isCancelled, await model.signUpService?.usesSingleSignOn(email) == true else { return }
      recognized = email.split(separator: "@").last.map(String.init)
    }
  }

  private func submit() {
    tried = true
    let email = model.authFlow.email.trimmingCharacters(in: .whitespaces)
    guard SignUpRules.email(email) == nil, !busy else { return }
    busy = true
    error = nil
    Task {
      do {
        try await model.signInThroughConsole(start: .singleSignOn, loginHint: email) { [webAuthentication] url, scheme in
          try await webAuthentication.authenticate(using: url, callbackURLScheme: scheme, preferredBrowserSession: .shared)
        }
      } catch {
        if !isCanceledSignIn(error) {
          self.error = (error as? ConsoleAPIError)?.message ?? signInErrorMessage(error)
        }
      }
      busy = false
    }
  }
}
