// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// The verification step a signed-in account with an unconfirmed address meets before anything else (`/verify-email`):
/// the link is sent once on arrival, the account is re-read every few seconds and whenever the app comes back to the
/// front, and "I’ve verified" checks at once. A verification link opened in the app confirms it here too.
struct VerifyEmailView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.scenePhase) private var scenePhase
  @State private var sent = false
  @State private var sending = false
  @State private var error: String?
  @State private var applying = false

  /// How often the account is re-read (`POLL_MS`).
  private static let pollSeconds: UInt64 = 4

  var body: some View {
    let email = model.auth?.user?.email
    AuthCard(
      "Verify your email",
      subtitle: "We sent a verification link to \(email ?? "your email address"). Open it to activate your account — this page updates on its own once you do."
    ) {
      VStack(spacing: 12) {
        AuthPrimaryButton(title: "I’ve verified — continue", busy: applying) { Task { await check() } }
          .accessibilityIdentifier("verify-continue")
        HStack(spacing: 4) {
          if sent { Text("Didn’t get it?") }
          Button("Resend verification email") { Task { await send(automatic: false) } }
            .buttonStyle(.borderless)
            .disabled(sending)
            .accessibilityIdentifier("verify-resend")
        }
        .font(AglynFont.subheadline)
        if let error { AuthMessage(text: error) }
      }
    } footer: {
      HStack(spacing: 4) {
        Text("Wrong account?")
        Button("Sign out") { Task { await model.signOut() } }.buttonStyle(.borderless)
      }
      .font(AglynFont.subheadline)
    }
    .task {
      if let code = model.authFlow.pendingVerificationCode {
        await apply(code)
      } else {
        await send(automatic: true)
      }
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: Self.pollSeconds * 1_000_000_000)
        await check()
      }
    }
    .onChange(of: scenePhase) { if scenePhase == .active { Task { await check() } } }
    .onChange(of: model.authFlow.pendingVerificationCode) {
      if let code = model.authFlow.pendingVerificationCode { Task { await apply(code) } }
    }
  }

  private func send(automatic: Bool) async {
    guard !sending, let service = model.signUpService else { return }
    sending = true
    error = nil
    switch await service.sendVerification(automatic: automatic) {
    case .sent: sent = true
    case .alreadyVerified: await check()
    case .failed(let message): error = message
    }
    sending = false
  }

  /// Re-reads the account; a confirmed address lets the app continue on its own.
  private func check() async {
    await model.auth?.reload()
  }

  private func apply(_ code: String) async {
    guard let auth = model.auth else { return }
    applying = true
    model.authFlow.pendingVerificationCode = nil
    if case .confirmEmail = model.authFlow.screen { model.authFlow.screen = .signIn }
    do {
      try await auth.applyEmailVerification(code: code)
    } catch {
      self.error = "That verification link has expired or was already used. Send yourself a new one below."
    }
    applying = false
  }
}
