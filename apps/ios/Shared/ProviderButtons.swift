// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynScreens
import AglynUI
import AuthenticationServices
import SwiftUI

/// The doors under a sign-in or sign-up form besides the password, after an "or", in the spec's order (Figma
/// "Button/Provider" 28:764): Sign in with Apple where the build offers it (App Store guideline 4.8 asks for it beside
/// Google), Google where the build has its OAuth clients, and on sign-in a passkey where the build has a relying party
/// and single sign-on. Every one is 48 points tall, rounded 12, 8 apart. On sign-up each is gated on the agreement.
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
  @State private var working: String?

  private var googleOffered: Bool { model.config?.google != nil }
  private var appleOffered: Bool { model.config?.appleSignIn == true }
  private var passkeyOffered: Bool { mode == .signIn && model.config?.passkeyRelyingParty != nil && model.api != nil }
  private var ssoOffered: Bool { mode == .signIn }

  var body: some View {
    if googleOffered || appleOffered || passkeyOffered || ssoOffered {
      VStack(spacing: AglynAuthTokens.Metrics.providerSpacing) {
        AglynOrDivider().padding(.bottom, 4)
        if appleOffered { apple }
        if googleOffered {
          // Google's approved title, unchanged while its sheet opens.
          Button("Continue with Google", action: google)
          .buttonStyle(AglynGoogleButtonStyle())
          .disabled(busy || !enabled)
          .accessibilityIdentifier("sign-in-google")
        }
        if passkeyOffered {
          Button(action: passkey) {
            AglynButtonLabel("Sign in with a passkey", systemImage: "lock", busy: working == "passkey")
          }
          .buttonStyle(AglynButtonStyle(.secondary))
          .disabled(busy || !enabled)
          .accessibilityIdentifier("sign-in-passkey")
        }
        if ssoOffered {
          Button { model.authFlow.screen = .singleSignOn } label: {
            AglynButtonLabel("Continue with SSO", systemImage: "key")
          }
          .buttonStyle(AglynButtonStyle(.secondary))
          .disabled(busy || !enabled)
          .accessibilityIdentifier("sign-in-sso")
        }
      }
    }
  }

  /// Apple's own button (HIG): black on a light ground, white on a dark one, with Apple's approved title. On the Mac the
  /// system button keeps its own short height, so the Mac draws the HIG's custom button (the Apple logo and the system
  /// font, Apple's colors) at the provider height and asks for the credential itself.
  @ViewBuilder
  private var apple: some View {
    #if os(macOS)
      Button(action: appleOnMac) {
        HStack(spacing: 6) {
          Image(systemName: "applelogo").font(.system(size: 17, weight: .semibold))
          Text(mode == .signUp ? "Sign up with Apple" : "Sign in with Apple").font(.system(size: 17, weight: .semibold))
        }
        .foregroundStyle(colorScheme == .dark ? Color.black : Color.white)
        .frame(maxWidth: .infinity, minHeight: AglynAuthTokens.Metrics.buttonHeight)
        .background(
          colorScheme == .dark ? Color.white : Color.black,
          in: RoundedRectangle(cornerRadius: AglynAuthDensity.buttonRadius(AglynAuthTokens.Metrics.buttonRadius), style: .continuous)
        )
        .contentShape(RoundedRectangle(cornerRadius: AglynAuthDensity.buttonRadius(AglynAuthTokens.Metrics.buttonRadius), style: .continuous))
      }
      .buttonStyle(.plain)
      .disabled(busy || !enabled)
      .opacity(busy || !enabled ? AglynAuthTokens.Metrics.disabledOpacity : 1)
      .accessibilityIdentifier("sign-in-apple")
    #else
      SignInWithAppleButton(mode == .signUp ? .signUp : .signIn) { request in
        prepare(request)
      } onCompletion: { result in
        apple(result)
      }
      .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
      .frame(height: AglynAuthTokens.Metrics.buttonHeight)
      .clipShape(RoundedRectangle(cornerRadius: AglynAuthDensity.buttonRadius(AglynAuthTokens.Metrics.buttonRadius), style: .continuous))
      .disabled(busy || !enabled)
      .opacity(busy || !enabled ? AglynAuthTokens.Metrics.disabledOpacity : 1)
      // The agreement is checked before Apple's sheet opens: without it, a tap shows the reminder instead.
      .overlay {
        if mode == .signUp && !consented {
          Color.clear.contentShape(Rectangle()).onTapGesture { _ = gate() }
        }
      }
      .accessibilityIdentifier("sign-in-apple")
    #endif
  }

  private func prepare(_ request: ASAuthorizationAppleIDRequest) {
    let nonce = AppleSignInNonce.make()
    appleNonce = nonce.raw
    request.requestedScopes = [.fullName, .email]
    request.nonce = nonce.hashed
  }

  #if os(macOS)
    private func appleOnMac() {
      guard mode == .signIn || gate() else { return }
      let request = ASAuthorizationAppleIDProvider().createRequest()
      prepare(request)
      Task {
        do {
          let result = try await authorizationController.performRequest(request)
          guard case .appleID(let credential) = result else {
            error = "Sign in with Apple did not finish. Try again."
            return
          }
          finishApple(credential)
        } catch {
          if !isCanceledSignIn(error) { self.error = "Sign in with Apple did not finish. Try again." }
        }
      }
    }
  #endif

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

  private func apple(_ result: Result<ASAuthorization, Error>) {
    switch result {
    case .failure(let failure):
      if !isCanceledSignIn(failure) { error = "Sign in with Apple did not finish. Try again." }
    case .success(let authorization):
      guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
        error = "Sign in with Apple did not finish. Try again."
        return
      }
      finishApple(credential)
    }
  }

  private func finishApple(_ credential: ASAuthorizationAppleIDCredential) {
    guard let data = credential.identityToken, let token = String(data: data, encoding: .utf8), !appleNonce.isEmpty else {
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

  private func passkey() {
    guard let auth = model.auth, let api = model.api, let relyingParty = model.config?.passkeyRelyingParty else { return }
    busy = true
    working = "passkey"
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
      working = nil
    }
  }

  private func providerErrorMessage(_ error: Error) -> String {
    if let google = error as? GoogleLinkError { return google.message }
    if let api = error as? ConsoleAPIError { return api.message }
    return mode == .signUp ? signUpErrorMessage(error) : signInErrorMessage(error)
  }
}
