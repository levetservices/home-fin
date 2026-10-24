import HomeFinKit
import SwiftUI

/// Netflix's sign-in: email first, then the password. Servers without the accounts service, and
/// people still on a Jellyfin login, use a username instead.
struct SignInView: View {
    @Environment(AppModel.self) private var model
    @State private var useJellyfin = false
    @State private var step = Step.email
    @State private var email = ""
    @State private var username = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?

    enum Step { case email, password }
    enum Field { case email, username, password }

    private var jellyfinOnly: Bool { !model.accountsEnabled || useJellyfin }

    var body: some View {
        AuthScaffold {
            VStack(alignment: .leading, spacing: 18) {
                if jellyfinOnly {
                    jellyfinForm
                } else if step == .email {
                    emailStep
                } else {
                    passwordStep
                }
                footer
            }
            .animation(Theme.spring, value: step)
            .animation(Theme.spring, value: useJellyfin)
        }
        .onAppear { focus = jellyfinOnly ? .username : .email }
    }

    private var emailStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Enter your info to sign in").font(.system(size: 30, weight: .bold))
            Text("Signing in to \(model.serverName).").foregroundStyle(Theme.secondary)
            ErrorNote(message: error)
            FieldBox(label: "Email address") {
                TextField("", text: $email)
                    .textContentType(.username)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    #endif
                    .focused($focus, equals: .email)
                    .onSubmit(nextFromEmail)
            }
            Button("Continue", action: nextFromEmail)
                .buttonStyle(BrandButtonStyle())
                .disabled(!email.contains("@"))
        }
        .transition(.asymmetric(insertion: .move(edge: .leading).combined(with: .opacity), removal: .opacity))
    }

    private var passwordStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Enter your password").font(.system(size: 30, weight: .bold))
            HStack(spacing: 6) {
                Text("Signing in as").foregroundStyle(Theme.secondary)
                Text(email).bold()
                Button("Change") {
                    password = ""
                    error = nil
                    step = .email
                    focus = .email
                }
                .buttonStyle(.plain)
                .underline()
            }
            .font(.callout)
            ErrorNote(message: error)
            FieldBox(label: "Password") {
                SecureField("", text: $password)
                    .textContentType(.password)
                    .focused($focus, equals: .password)
                    .onSubmit(signInWithEmail)
            }
            Button(action: signInWithEmail) {
                if busy { ProgressView().tint(.white) } else { Text("Sign In") }
            }
            .buttonStyle(BrandButtonStyle())
            .disabled(password.isEmpty || busy)
        }
        .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
    }

    private var jellyfinForm: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Sign in").font(.system(size: 30, weight: .bold))
            Text(model.accountsEnabled ? "With the username you use for Jellyfin." : "Signing in to \(model.serverName).")
                .foregroundStyle(Theme.secondary)
            ErrorNote(message: error)
            FieldBox(label: "Username") {
                TextField("", text: $username)
                    .textContentType(.username)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .focused($focus, equals: .username)
                    .onSubmit { focus = .password }
            }
            FieldBox(label: "Password") {
                SecureField("", text: $password)
                    .textContentType(.password)
                    .focused($focus, equals: .password)
                    .onSubmit(signInWithJellyfin)
            }
            Button(action: signInWithJellyfin) {
                if busy { ProgressView().tint(.white) } else { Text("Sign In") }
            }
            .buttonStyle(BrandButtonStyle())
            .disabled(username.isEmpty || busy)
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 12) {
            if model.accountsEnabled {
                Button(useJellyfin ? "Sign in with your email instead" : "Use a Jellyfin username instead") {
                    error = nil
                    password = ""
                    useJellyfin.toggle()
                    focus = useJellyfin ? .username : .email
                }
            }
            Button("Change server (\(model.server?.host() ?? ""))") { model.changeServer() }
        }
        .buttonStyle(.plain)
        .font(.callout)
        .foregroundStyle(Theme.secondary)
        .padding(.top, 20)
    }

    private func nextFromEmail() {
        guard email.contains("@") else { return }
        error = nil
        step = .password
        focus = .password
    }

    private func signInWithEmail() {
        run { try await model.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password) }
    }

    private func signInWithJellyfin() {
        run { try await model.signIn(username: username.trimmingCharacters(in: .whitespaces), password: password) }
    }

    private func run(_ action: @escaping () async throws -> Void) {
        busy = true
        withAnimation { error = nil }
        Task {
            do {
                try await action()
            } catch let failure as HomeFinError where failure.status == 401 {
                withAnimation { error = jellyfinOnly ? "Incorrect username or password." : "Incorrect password for this email." }
            } catch {
                withAnimation { self.error = error.localizedDescription }
            }
            busy = false
        }
    }
}
