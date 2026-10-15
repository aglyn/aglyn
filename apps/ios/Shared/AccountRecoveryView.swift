// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// Asking for a password reset link (`/account-recovery`), through the console's own branded email.
struct AccountRecoveryView: View {
  @Environment(AppModel.self) private var model
  @State private var busy = false
  @State private var error: String?
  @State private var sentTo: String?
  @State private var tried = false

  var body: some View {
    @Bindable var flow = model.authFlow
    if let sentTo {
      AuthCard(
        "Check your email",
        subtitle: "We sent a password reset link to \(sentTo). Open it to choose a new password — the link expires after a short while."
      ) {
        if let error { AuthMessage(text: error) }
        HStack(spacing: 4) {
          Text("Didn’t get it?")
          Button("Resend") { send(sentTo) }.buttonStyle(.borderless).disabled(busy)
          Text("or")
          Button("back to sign in") { flow.reset() }.buttonStyle(.borderless)
        }
        .font(AglynFont.subheadline)
      }
    } else {
      AuthCard("Account recovery", subtitle: "Enter your email and we’ll send a link to reset your password") {
        AuthField(
          label: "Email", text: $flow.email, content: .email, message: tried ? SignUpRules.email(flow.email) : nil,
          identifier: "recovery-email")
        if let error { AuthMessage(text: error) }
        AuthPrimaryButton(title: "Send reset link", busy: busy) {
          tried = true
          if SignUpRules.email(flow.email) == nil { send(flow.email) }
        }
        .accessibilityIdentifier("recovery-submit")
      } footer: {
        HStack(spacing: 4) {
          Text("Remembered your password?")
          Button("Sign in") { flow.reset() }.buttonStyle(.borderless)
        }
        .font(AglynFont.subheadline)
      }
    }
  }

  private func send(_ email: String) {
    guard !busy, let service = model.signUpService else { return }
    busy = true
    error = nil
    Task {
      do {
        try await service.sendPasswordReset(email: email)
        sentTo = email.trimmingCharacters(in: .whitespacesAndNewlines)
      } catch {
        self.error = (error as? ConsoleAPIError)?.message ?? "An error has occurred. Please try again."
      }
      busy = false
    }
  }
}

/// Choosing a new password from an emailed reset link (`/reset-password`).
struct ResetPasswordView: View {
  enum Status: Equatable { case verifying, ready(email: String), invalid, done }

  @Environment(AppModel.self) private var model
  let code: String
  @State private var status: Status = .verifying
  @State private var password = ""
  @State private var confirm = ""
  @State private var tried = false
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    let flow = model.authFlow
    Group {
      switch status {
      case .verifying:
        AuthCard("Reset password", subtitle: "Verifying your link") { ProgressView().frame(maxWidth: .infinity) }
      case .invalid:
        AuthCard("Link expired", subtitle: "This password reset link is invalid or has already been used.") {
          if let error { AuthMessage(text: error) }
          Button("Request a new reset link") { flow.screen = .accountRecovery }.buttonStyle(.borderless)
        }
      case .done:
        AuthCard("Password updated", subtitle: "Your password has been reset. Sign in with your new password.") {
          AuthPrimaryButton(title: "Go to sign in", busy: false) { flow.reset() }
        }
      case .ready(let email):
        AuthCard("Choose a new password", subtitle: email.isEmpty ? "Enter a new password for your account" : "for \(email)") {
          VStack(spacing: 12) {
            AuthField(
              label: "Password", text: $password, secure: true, content: .newPassword,
              message: tried ? SignUpRules.password(password) : nil, identifier: "reset-password")
            AuthField(
              label: "Confirm password", text: $confirm, secure: true, content: .newPassword,
              message: tried ? SignUpRules.confirm(confirm, password: password) : nil, identifier: "reset-confirm")
          }
          if let error { AuthMessage(text: error) }
          AuthPrimaryButton(title: "Reset password", busy: busy, action: submit).accessibilityIdentifier("reset-submit")
        } footer: {
          Button("Back to sign in") { flow.reset() }.buttonStyle(.borderless).font(AglynFont.subheadline)
        }
      }
    }
    .task(id: code) { await verify() }
  }

  private func verify() async {
    guard !code.isEmpty, let auth = model.auth else {
      status = .invalid
      return
    }
    do {
      status = .ready(email: try await auth.verifyPasswordResetCode(code))
    } catch {
      self.error = actionCodeMessage(error)
      status = .invalid
    }
  }

  private func submit() {
    tried = true
    guard SignUpRules.password(password) == nil, SignUpRules.confirm(confirm, password: password) == nil, !busy,
      let auth = model.auth
    else { return }
    busy = true
    error = nil
    Task {
      do {
        try await auth.confirmPasswordReset(code: code, newPassword: password)
        status = .done
      } catch {
        self.error = actionCodeMessage(error)
      }
      busy = false
    }
  }
}

/// Confirming an address from an emailed verification link (`/verify-email?oobCode=…`), whoever is signed in: one
/// press confirms it, so a link scanner opening the link changes nothing.
struct ConfirmEmailView: View {
  enum Status: Equatable { case confirm, applying, applied, failed }

  @Environment(AppModel.self) private var model
  let code: String
  @State private var status: Status = .confirm

  var body: some View {
    let flow = model.authFlow
    switch status {
    case .confirm:
      AuthCard("Verify your email", subtitle: "Confirm this is your email address") {
        Text("Press the button to finish setting up your \(model.brandName) account. If you didn’t sign up, close this page and nothing happens.")
        AuthPrimaryButton(title: "Confirm my email", busy: false) { apply() }.accessibilityIdentifier("confirm-email")
      }
    case .applying:
      AuthCard("One moment", subtitle: "Verifying your email") { ProgressView().frame(maxWidth: .infinity) }
    case .applied:
      AuthCard("Email verified", subtitle: "Your email address is confirmed.") {
        AuthPrimaryButton(title: model.auth?.user == nil ? "Sign in to continue" : "Continue to \(model.brandName)", busy: false) {
          flow.pendingVerificationCode = nil
          flow.reset()
        }
      }
    case .failed:
      AuthCard("Verify your email", subtitle: "This link has expired or was already used") {
        Text("If you already opened it once, your email is verified — sign in to continue. If not, sign in and we’ll send you a new link.")
        AuthPrimaryButton(title: "Sign in", busy: false) {
          flow.pendingVerificationCode = nil
          flow.reset()
        }
      }
    }
  }

  private func apply() {
    guard let auth = model.auth else { return }
    status = .applying
    Task {
      do {
        try await auth.applyEmailVerification(code: code)
        status = .applied
      } catch {
        status = .failed
      }
    }
  }
}
