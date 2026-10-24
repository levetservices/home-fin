import HomeFinKit
import SwiftUI

/// First sign-in on this device: which Home Fin server? (The address people use in the browser.)
struct ServerView: View {
    @Environment(AppModel.self) private var model
    @State private var address = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        AuthScaffold(back: { withAnimation(Theme.spring) { model.phase = .welcome } }) {
            VStack(alignment: .leading, spacing: 18) {
                Text("Enter your server address")
                    .font(.system(size: 28, weight: .bold))
                ErrorNote(message: error)
                FieldBox {
                    TextField("", text: $address, prompt: Text("e.g. tv.example.com").foregroundStyle(Theme.secondary))
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        #endif
                        .focused($focused)
                        .onSubmit(connect)
                }
                Button(action: connect) {
                    if busy { ProgressView().tint(.white) } else { Text("Continue") }
                }
                .buttonStyle(BrandButtonStyle())
                .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                HelpDisclosure(lines: [
                    "It's the address you open Home Fin with in a browser, like tv.example.com or 192.168.1.20:8096.",
                    "At home, the local address works. Away from home you need the one your server's owner shared."
                ])
            }
        }
        .onAppear { focused = true }
    }

    private func connect() {
        busy = true
        withAnimation { error = nil }
        Task {
            do {
                try await model.connect(to: address)
            } catch {
                withAnimation { self.error = "Couldn't reach a Home Fin server there. Check the address and your connection." }
            }
            busy = false
        }
    }
}

/// Netflix's sign-in frame: a dark red glow at the top, a glass back button and the wordmark.
struct AuthScaffold<Content: View>: View {
    var back: (() -> Void)?
    @ViewBuilder var content: Content

    var body: some View {
        ZStack(alignment: .topLeading) {
            RadialGradient(colors: [Color(hex: "#4a1418"), Color(hex: "#1a0709"), .black], center: .top, startRadius: 0, endRadius: 700)
                .ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 14) {
                        if let back {
                            GlassCircleButton(systemImage: "chevron.left", size: 44, label: "Back", action: back)
                        }
                        Wordmark(size: 30)
                        Spacer()
                    }
                    .padding(.bottom, 48)
                    content
                        .frame(maxWidth: 460, alignment: .leading)
                }
                .frame(maxWidth: 460)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 22)
                .padding(.top, 12)
                .padding(.bottom, 40)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
        }
        .foregroundStyle(.white)
    }
}

/// "Get help ⌄": a few lines of help that fold out.
struct HelpDisclosure: View {
    var lines: [String]
    var actions: [(title: String, action: () -> Void)] = []
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(Theme.spring) { open.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Text("Get help")
                    Image(systemName: "chevron.down")
                        .font(.system(size: 14, weight: .semibold))
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                .font(.system(size: 17))
            }
            .buttonStyle(.plain)
            if open {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(lines, id: \.self) { Text($0) }
                    ForEach(actions.indices, id: \.self) { index in
                        Button(actions[index].title, action: actions[index].action)
                            .buttonStyle(.plain)
                            .underline()
                            .foregroundStyle(.white)
                    }
                }
                .font(.system(size: 15))
                .foregroundStyle(Theme.secondary)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .padding(.top, 28)
    }
}
