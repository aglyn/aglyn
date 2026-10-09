// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// Email and password sign-in against Firebase Auth, the console's own accounts.
struct SignInView: View {
  @Environment(AppModel.self) private var model
  @State private var email = ""
  @State private var password = ""
  @State private var busy = false
  @State private var error: String?
  @State private var notice: String?
  @FocusState private var focus: Field?

  private enum Field { case email, password }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        VStack(alignment: .leading, spacing: 8) {
          AglynArtwork.logo
            .resizable()
            .scaledToFit()
            .frame(height: 44)
            .accessibilityLabel(model.appName)
          if model.app == .pos {
            Text("POS").font(AglynFont.title).foregroundStyle(AglynColor.tint)
          }
          Text(
            model.app == .pos
              ? "Sign in to take payments at your store."
              : "Sign in to manage your sites, orders and customers."
          )
          .foregroundStyle(.secondary)
        }

        VStack(spacing: 12) {
          TextField("Email", text: $email)
            .textContentType(.username)
            .autocorrectionDisabled()
            #if os(iOS)
              .keyboardType(.emailAddress)
              .textInputAutocapitalization(.never)
            #endif
            .focused($focus, equals: .email)
            .submitLabel(.next)
            .onSubmit { focus = .password }
            .accessibilityIdentifier("sign-in-email")
          SecureField("Password", text: $password)
            .textContentType(.password)
            .focused($focus, equals: .password)
            .submitLabel(.go)
            .onSubmit(submit)
            .accessibilityIdentifier("sign-in-password")
        }
        .textFieldStyle(.roundedBorder)
        .controlSize(.large)

        if let error {
          Label(error, systemImage: "exclamationmark.circle")
            .foregroundStyle(AglynColor.error)
            .font(AglynFont.subheadline)
        }
        if let notice {
          Text(notice).font(AglynFont.subheadline).foregroundStyle(.secondary)
        }

        VStack(spacing: 8) {
          Button(action: submit) {
            Group {
              if busy { ProgressView() } else { Text("Sign in") }
            }
            .frame(maxWidth: .infinity)
          }
          .buttonStyle(.borderedProminent)
          .controlSize(.large)
          .disabled(email.isEmpty || password.isEmpty || busy)
          .keyboardShortcut(.defaultAction)
          .accessibilityIdentifier("sign-in-submit")

          Button("Forgot password", action: forgot)
            .buttonStyle(.borderless)
            .disabled(busy)
        }
      }
      .padding(24)
      .frame(maxWidth: 440)
      .frame(maxWidth: .infinity)
    }
    .scrollBounceBehavior(.basedOnSize)
    .sensoryFeedback(.error, trigger: error)
  }

  private func submit() {
    guard !email.isEmpty, !password.isEmpty, let auth = model.auth else { return }
    busy = true
    error = nil
    notice = nil
    Task {
      do {
        try await auth.signIn(email: email, password: password)
      } catch {
        self.error = signInErrorMessage(error)
      }
      busy = false
    }
  }

  private func forgot() {
    guard let auth = model.auth else { return }
    guard !email.isEmpty else {
      error = "Enter your email, then choose Forgot password."
      return
    }
    Task {
      try? await auth.resetPassword(email: email)
      error = nil
      notice = "If that email has an account, a reset link is on its way."
    }
  }
}
