import Foundation
#if canImport(Security)
import Security
#endif

/// Who is signed in on this device, kept between launches.
public struct SavedSession: Codable, Equatable, Sendable {
    public var server: URL
    public var userId: String
    public var token: String
    public var userName: String
    public var isAdministrator: Bool
    /// The Home Fin profile being watched as, when signed in through the accounts service.
    public var profile: HomeFinProfile?

    public init(server: URL, userId: String, token: String, userName: String, isAdministrator: Bool, profile: HomeFinProfile? = nil) {
        self.server = server
        self.userId = userId
        self.token = token
        self.userName = userName
        self.isAdministrator = isAdministrator
        self.profile = profile
    }

    /// The name rows are personalised with ("Continue Watching for …").
    public var viewerName: String { profile?.name ?? userName }
}

/// Where the session's secret lives: the Keychain on Apple platforms, memory in tests.
public protocol SecretStore: Sendable {
    func load() -> Data?
    func save(_ data: Data)
    func clear()
}

public final class MemorySecretStore: SecretStore, @unchecked Sendable {
    private var data: Data?
    private let lock = NSLock()

    public init() {}
    public func load() -> Data? { lock.withLock { data } }
    public func save(_ data: Data) { lock.withLock { self.data = data } }
    public func clear() { lock.withLock { data = nil } }
}

#if canImport(Security)
/// One generic-password item holding the session (token included), this device only.
public struct KeychainSecretStore: SecretStore {
    let service: String
    let account: String

    public init(service: String = "app.homefin.session", account: String = "default") {
        self.service = service
        self.account = account
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    public func load() -> Data? {
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(lookup as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }

    public func save(_ data: Data) {
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    public func clear() {
        SecItemDelete(query as CFDictionary)
    }
}
#endif

public struct SessionStore: Sendable {
    let secrets: SecretStore

    public init(secrets: SecretStore) {
        self.secrets = secrets
    }

    public func load() -> SavedSession? {
        guard let data = secrets.load() else { return nil }
        return try? JSONDecoder().decode(SavedSession.self, from: data)
    }

    public func save(_ session: SavedSession) {
        if let data = try? JSONEncoder().encode(session) { secrets.save(data) }
    }

    public func clear() {
        secrets.clear()
    }
}

/// Turns what someone types ("tv.example.com", "192.168.1.5:8096/") into a server URL.
public func normaliseServerAddress(_ text: String) -> URL? {
    var value = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return nil }
    if !value.lowercased().hasPrefix("http://") && !value.lowercased().hasPrefix("https://") {
        // Bare IPs and :port addresses are usually on the home network (http); names get https.
        let looksLocal = value.first?.isNumber == true || value.contains(":") || value.hasSuffix(".local")
        value = (looksLocal ? "http://" : "https://") + value
    }
    while value.hasSuffix("/") { value.removeLast() }
    // The web client lives at /web; the API is at the root.
    if value.lowercased().hasSuffix("/web") { value.removeLast(4) }
    guard let url = URL(string: value), url.host != nil else { return nil }
    return url
}
