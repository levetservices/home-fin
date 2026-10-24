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
    @State private var showPassword = false
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?

    enum Step { case email, password }
    enum Field { case email, username, password }

    private var jellyfinOnly: Bool { !model.accountsEnabled || useJellyfin }

    var body: some View {
        AuthScaffold(back: goBack) {
            VStack(alignment: .leading, spacing: 18) {
                if jellyfinOnly {
                    jellyfinForm
                } else if step == .email {
                    emailStep
                } else {
                    passwordStep
                }
                HelpDisclosure(lines: help, actions: helpActions)
            }
            .animation(Theme.spring, value: step)
            .animation(Theme.spring, value: useJellyfin)
        }
        .onAppear { focus = jellyfinOnly ? .username : .email }
    }

    private func goBack() {
        if step == .password && !jellyfinOnly {
            password = ""
            error = nil
            step = .email
            focus = .email
        } else {
            withAnimation(Theme.spring) { model.phase = .welcome }
        }
    }

    private var emailStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Enter your info to sign in").font(.system(size: 28, weight: .bold))
            ErrorNote(message: error)
            FieldBox {
                TextField("", text: $email, prompt: Text("Email address").foregroundStyle(Theme.secondary))
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
            Text("Enter your password").font(.system(size: 28, weight: .bold))
            Text(email).font(.system(size: 17)).foregroundStyle(Theme.secondary)
            ErrorNote(message: error)
            FieldBox {
                HStack {
                    Group {
                        if showPassword {
                            TextField("", text: $password, prompt: Text("Password").foregroundStyle(Theme.secondary))
                        } else {
                            SecureField("", text: $password, prompt: Text("Password").foregroundStyle(Theme.secondary))
                        }
                    }
                    .textContentType(.password)
                    .focused($focus, equals: .password)
                    .onSubmit(signInWithEmail)
                    Button(showPassword ? "Hide" : "Show") { showPassword.toggle() }
                        .buttonStyle(.plain)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.secondary)
                }
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
            Text("Enter your info to sign in").font(.system(size: 28, weight: .bold))
            ErrorNote(message: error)
            FieldBox {
                TextField("", text: $username, prompt: Text("Username").foregroundStyle(Theme.secondary))
                    .textContentType(.username)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .focused($focus, equals: .username)
                    .onSubmit { focus = .password }
            }
            FieldBox {
                SecureField("", text: $password, prompt: Text("Password").foregroundStyle(Theme.secondary))
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

    private var help: [String] {
        var lines = ["Signing in to \(model.serverName) (\(model.server?.host() ?? ""))."]
        if model.accountsEnabled && !jellyfinOnly {
            lines.append("Forgot your password? Ask whoever runs this server to send you a reset link.")
        }
        return lines
    }

    private var helpActions: [(title: String, action: () -> Void)] {
        var actions: [(title: String, action: () -> Void)] = []
        if model.accountsEnabled {
            actions.append((useJellyfin ? "Sign in with your email instead" : "Use a Jellyfin username instead", {
                error = nil
                password = ""
                useJellyfin.toggle()
                focus = useJellyfin ? .username : .email
            }))
        }
        actions.append(("Use a different server", { model.changeServer() }))
        return actions
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
