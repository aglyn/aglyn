// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import AuthenticationServices
import SwiftUI

/// Creating an account, as the console's `/signup` does: name, workspace name, email and password; the Terms of
/// Service and Privacy Policy agreed to; the optional product-updates opt-in; and the provider doors below, which the
/// same agreement gates.
struct SignUpView: View {
  @Environment(AppModel.self) private var model
  @State private var firstName = ""
  @State private var lastName = ""
  @State private var organization = ""
  @State private var email = ""
  @State private var password = ""
  @State private var confirm = ""
  @State private var consented = false
  @State private var consentError = false
  @State private var marketing = false
  @State private var tried = false
  @State private var busy = false
  @State private var error: String?
  @State private var paused: String?

  private var flow: AuthFlow { model.authFlow }

  private var problems: [String?] {
    [
      SignUpRules.firstName(firstName), SignUpRules.lastName(lastName), SignUpRules.organization(organization),
      SignUpRules.email(email), SignUpRules.password(password), SignUpRules.confirm(confirm, password: password),
    ]
  }

  var body: some View {
    AuthCard(
      "Sign up",
      subtitle: flow.plan?.signUpHeadline ?? "Create a new \(model.brandName) Account"
    ) {
      VStack(alignment: .leading, spacing: 12) {
        HStack(alignment: .top, spacing: 12) {
          AuthField(
            label: "First name", text: $firstName, content: .name, message: tried ? problems[0] : nil,
            identifier: "sign-up-first-name")
          AuthField(
            label: "Last name", text: $lastName, content: .familyName, message: tried ? problems[1] : nil,
            identifier: "sign-up-last-name")
        }
        AuthField(
          label: "Organization name", text: $organization, content: .organization, message: tried ? problems[2] : nil,
          supporting: WorkspaceName.helper(workspaceDomain: model.config?.workspaceDomain ?? "aglyn.com"),
          identifier: "sign-up-organization")
        AuthField(
          label: "Email", text: $email, content: .email, message: tried ? problems[3] : nil, identifier: "sign-up-email")
        AuthField(
          label: "Password", text: $password, secure: true, content: .newPassword, message: tried ? problems[4] : nil,
          identifier: "sign-up-password")
        AuthField(
          label: "Confirm password", text: $confirm, secure: true, content: .newPassword,
          message: tried ? problems[5] : nil, identifier: "sign-up-confirm")
      }

      VStack(alignment: .leading, spacing: 12) {
        if flow.consentBounceUID != nil {
          AglynNotice(
            "Looks like you’re new here — please accept the Terms of Service and Privacy Policy to finish setting up your account.",
            tone: .info)
        }
        AuthCheckRow(
          isOn: $consented, accessibilityLabel: "Agree to the Terms of Service and Privacy Policy",
          identifier: "sign-up-consent"
        ) {
          LegalLinks(lead: "I agree to \(model.brandName)’s")
        }
        .onChange(of: consented) { if consented { consentError = false } }
        if consentError {
          Text("Please accept the Terms of Service and Privacy Policy to continue.")
            .font(AglynFont.caption).foregroundStyle(AglynColor.error)
        }
        // Below the required acceptance and never part of it: the terms gate the sign-up, this gates nothing.
        AuthCheckRow(isOn: $marketing, accessibilityLabel: "Send me product updates", identifier: "sign-up-marketing") {
          Text(MarketingConsent.text(brand: model.brandName))
        }
      }

      VStack(alignment: .leading, spacing: 12) {
        AuthPrimaryButton(title: "Next", busy: busy, enabled: paused == nil, action: submit)
          .accessibilityIdentifier("sign-up-submit")
        if let paused {
          AglynNotice("New signups are temporarily paused — \(paused)", tone: .warning)
        }
        if let error { AuthMessage(text: error) }
        ProviderSignInButtons(mode: .signUp, enabled: paused == nil, gate: gate, busy: $busy, error: $error, marketing: marketing)
      }
    } footer: {
      HStack(spacing: 4) {
        Text("Already have an account?")
        Button("Sign in") { flow.reset() }.buttonStyle(.borderless).accessibilityIdentifier("sign-up-to-sign-in")
      }
      .font(AglynFont.subheadline)
    }
    .task { paused = await model.signUpService?.signupsPaused() }
  }

  /// The agreement every door checks first; false (and said) without it.
  private func gate() -> Bool {
    guard paused == nil else { return false }
    guard consented else {
      consentError = true
      return false
    }
    return true
  }

  private func submit() {
    tried = true
    guard gate(), problems.allSatisfy({ $0 == nil }), !busy else { return }
    busy = true
    error = nil
    Task {
      do {
        try await model.signUpWithPassword(
          firstName: firstName, lastName: lastName, organization: organization, email: email, password: password,
          marketing: marketing)
      } catch {
        self.error = error.localizedDescription
      }
      busy = false
    }
  }
}
