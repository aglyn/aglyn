// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynScreens
import AglynUI
import AuthenticationServices
import SwiftUI

/// The doors under a sign-in or sign-up form besides the password: Google where the build has its OAuth clients, Sign in
/// with Apple where the build offers it (App Store guideline 4.8 asks for it beside Google), and on sign-in single
/// sign-on through the console and a passkey where the build has a relying party (the console's sign-in page offers
/// both). On sign-up each is gated on the agreement first.
struct ProviderSignInButtons: View {
  enum Mode { case signIn, signUp }

  @Environment(AppModel.self) private var model
  @Environment(\.authorizationController) private var authorizationController
  @Environment(\.webAuthenticationSession) private var webAuthentication
  @Environment(\.colorScheme) private var colorScheme
  let mode: Mode
  var enabled = true
  /// The sign-up's consent check, run before a provider sheet opens.
  var gate: () -> Bool = { true }
  @Binding var busy: Bool
  @Binding var error: String?
  var marketing = false
  /// Whether the sign-up's agreement is ticked (and signups are open), so Apple's sheet may open.
  var consented = true
  @State private var appleNonce = ""

  private var googleOffered: Bool { model.config?.google != nil }
  private var appleOffered: Bool { model.config?.appleSignIn == true }
  private var passkeyOffered: Bool { mode == .signIn && model.config?.passkeyRelyingParty != nil && model.api != nil }

  var body: some View {
    if googleOffered || appleOffered || passkeyOffered || mode == .signIn {
      VStack(spacing: 8) {
        HStack {
          VStack { Divider() }
          Text(mode == .signUp ? "Or sign up with" : "Or sign in with").font(AglynFont.caption).foregroundStyle(.secondary)
            .fixedSize()
          VStack { Divider() }
        }
        if googleOffered {
          Button(action: google) {
            Label("Google", systemImage: "g.circle").frame(maxWidth: .infinity, minHeight: AglynFieldStyle.height)
          }
          .buttonStyle(.bordered)
          .buttonBorderShape(.roundedRectangle(radius: AglynRadius.tile))
          .disabled(busy || !enabled)
          .accessibilityIdentifier("sign-in-google")
        }
        if appleOffered {
          SignInWithAppleButton(mode == .signUp ? .signUp : .signIn) { request in
            let nonce = AppleSignInNonce.make()
            appleNonce = nonce.raw
            request.requestedScopes = [.fullName, .email]
            request.nonce = nonce.hashed
          } onCompletion: { result in
            apple(result)
          }
          .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
          .frame(height: AglynFieldStyle.height)
          .clipShape(RoundedRectangle(cornerRadius: AglynRadius.tile, style: .continuous))
          .disabled(busy || !enabled)
          // The agreement is checked before Apple's sheet opens: without it, a tap shows the reminder instead.
          .overlay {
            if mode == .signUp && !consented {
              Color.clear.contentShape(Rectangle()).onTapGesture { _ = gate() }
            }
          }
          .accessibilityIdentifier("sign-in-apple")
        }
        if mode == .signIn {
          Button(action: singleSignOn) {
            Label("Single sign-on (SSO)", systemImage: "key.viewfinder").frame(maxWidth: .infinity, minHeight: AglynFieldStyle.height)
          }
          .buttonStyle(.bordered)
          .buttonBorderShape(.roundedRectangle(radius: AglynRadius.tile))
          .disabled(busy || !enabled)
          .accessibilityIdentifier("sign-in-sso")
        }
        if passkeyOffered {
          Button(action: passkey) {
            Label("Passkey", systemImage: "person.badge.key").frame(maxWidth: .infinity, minHeight: AglynFieldStyle.height)
          }
          .buttonStyle(.bordered)
          .buttonBorderShape(.roundedRectangle(radius: AglynRadius.tile))
          .disabled(busy || !enabled)
          .accessibilityIdentifier("sign-in-passkey")
        }
      }
    }
  }

  private func google() {
    guard mode == .signIn || gate() else { return }
    busy = true
    error = nil
    Task {
      do {
        try await model.continueWithGoogle(signingUp: mode == .signUp, marketing: marketing) { [webAuthentication] url, scheme in
          try await webAuthentication.authenticate(using: url, callbackURLScheme: scheme, preferredBrowserSession: .shared)
        }
      } catch {
        if !isCanceledSignIn(error) { self.error = providerErrorMessage(error) }
      }
      busy = false
    }
  }

  /// Workspace single sign-on, through the console's `/sso` page and the one-time hand-off back to the app.
  private func singleSignOn() {
    busy = true
    error = nil
    Task {
      do {
        try await model.signInThroughConsole(start: .singleSignOn) { [webAuthentication] url, scheme in
          try await webAuthentication.authenticate(using: url, callbackURLScheme: scheme, preferredBrowserSession: .shared)
        }
      } catch {
        if !isCanceledSignIn(error) { self.error = providerErrorMessage(error) }
      }
      busy = false
    }
  }

  private func apple(_ result: Result<ASAuthorization, Error>) {
    switch result {
    case .failure(let failure):
      if !isCanceledSignIn(failure) { error = "Sign in with Apple did not finish. Try again." }
    case .success(let authorization):
      guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
        let data = credential.identityToken, let token = String(data: data, encoding: .utf8), !appleNonce.isEmpty
      else {
        error = "Sign in with Apple did not finish. Try again."
        return
      }
      busy = true
      error = nil
      let nonce = appleNonce
      Task {
        do {
          try await model.continueWithApple(
            identityToken: token, rawNonce: nonce, fullName: credential.fullName, signingUp: mode == .signUp,
            marketing: marketing)
        } catch {
          self.error = providerErrorMessage(error)
        }
        busy = false
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

  private func providerErrorMessage(_ error: Error) -> String {
    if let google = error as? GoogleLinkError { return google.message }
    if let api = error as? ConsoleAPIError { return api.message }
    return mode == .signUp ? signUpErrorMessage(error) : signInErrorMessage(error)
  }
}
