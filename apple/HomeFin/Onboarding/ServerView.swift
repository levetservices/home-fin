import HomeFinKit
import SwiftUI

/// First launch: which Home Fin server? (The address people use in the browser.)
struct ServerView: View {
    @Environment(AppModel.self) private var model
    @State private var address = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        AuthScaffold {
            VStack(alignment: .leading, spacing: 18) {
                Text("Connect to Home Fin")
                    .font(.system(size: 30, weight: .bold))
                Text("Enter the address you use for Home Fin in a browser.")
                    .foregroundStyle(Theme.secondary)
                ErrorNote(message: error)
                FieldBox(label: "Server address") {
                    TextField("tv.example.com", text: $address)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        #endif
                        .onSubmit(connect)
                }
                Button(action: connect) {
                    if busy { ProgressView().tint(.white) } else { Text("Continue") }
                }
                .buttonStyle(BrandButtonStyle())
                .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty || busy)
            }
        }
    }

    private func connect() {
        busy = true
        withAnimation { error = nil }
        Task {
            do {
                try await model.connect(to: address)
            } catch {
                withAnimation { self.error = error.localizedDescription }
            }
            busy = false
        }
    }
}

/// The sign-in pages' frame: wordmark top-left, a centred column on a dark red-tinted backdrop.
struct AuthScaffold<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ZStack(alignment: .topLeading) {
            LinearGradient(colors: [Color(hex: "#3a0d10"), Theme.background, .black], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            ScrollView {
                VStack(spacing: 0) {
                    HStack {
                        Wordmark(size: 30)
                        Spacer()
                    }
                    .padding(.bottom, 40)
                    content
                        .frame(maxWidth: 440)
                        .frame(maxWidth: .infinity)
                }
                .padding(.horizontal, 24)
                .padding(.top, 20)
                .padding(.bottom, 40)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .foregroundStyle(.white)
    }
}
