import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Something went wrong talking to Jellyfin or the accounts service, with a message fit to show.
public struct HomeFinError: LocalizedError, Equatable, Sendable {
    public var status: Int?
    public var message: String
    public var code: String?

    public init(status: Int? = nil, message: String, code: String? = nil) {
        self.status = status
        self.message = message
        self.code = code
    }

    public var errorDescription: String? { message }

    public var isUnauthorized: Bool { status == 401 }
}

/// This app as Jellyfin sees it: shows up under Dashboard → Devices.
public struct DeviceIdentity: Sendable, Equatable {
    public var id: String
    public var name: String
    public var client: String
    public var version: String

    public init(id: String, name: String, client: String = "Home Fin", version: String = "1.0.0") {
        self.id = id
        self.name = name
        self.client = client
        self.version = version
    }

    /// A stable id for this install, kept in UserDefaults.
    public static func persistentID(defaults: UserDefaults = .standard) -> String {
        let key = "homefin.deviceId"
        if let existing = defaults.string(forKey: key) { return existing }
        let fresh = UUID().uuidString
        defaults.set(fresh, forKey: key)
        return fresh
    }

    /// The `MediaBrowser …` Authorization header Jellyfin expects, with the token once signed in.
    public func authorization(token: String?) -> String {
        func clean(_ value: String) -> String { value.replacingOccurrences(of: "\"", with: "") }
        var header = "MediaBrowser Client=\"\(clean(client))\", Device=\"\(clean(name))\", DeviceId=\"\(clean(id))\", Version=\"\(clean(version))\""
        if let token { header += ", Token=\"\(clean(token))\"" }
        return header
    }

    /// The `device` body the accounts service wants when signing a profile in.
    var jsonBody: [String: String] { ["id": id, "name": name, "client": client, "version": version] }
}

/// Shared request plumbing: build URLs, send, turn error bodies into readable messages.
struct HTTP: Sendable {
    let session: URLSession

    static let jsonDecoder = JSONDecoder()
    static let jsonEncoder = JSONEncoder()

    static func url(_ base: URL, _ path: String, _ query: [String: String?] = [:]) -> URL {
        let trimmed = base.absoluteString.hasSuffix("/") ? String(base.absoluteString.dropLast()) : base.absoluteString
        var components = URLComponents(string: trimmed + path)!
        let items = query.compactMap { key, value in value.map { URLQueryItem(name: key, value: $0) } }
            .sorted { $0.name < $1.name }
        if !items.isEmpty { components.queryItems = (components.queryItems ?? []) + items }
        return components.url!
    }

    func data(_ request: URLRequest) async throws -> (Data, Int) {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw HomeFinError(message: "Can't reach the server. Check your connection and the server address.", code: "offline")
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw Self.error(status: status, data: data) }
        return (data, status)
    }

    func decode<T: Decodable>(_ type: T.Type, _ request: URLRequest) async throws -> T {
        let (data, _) = try await data(request)
        do {
            return try Self.jsonDecoder.decode(T.self, from: data)
        } catch {
            throw HomeFinError(message: "The server sent something unexpected (\(T.self)).", code: "decode")
        }
    }

    /// `{ "error": "…", "code": "…" }` from the accounts service, Jellyfin's plain-text errors otherwise.
    static func error(status: Int, data: Data) -> HomeFinError {
        struct Body: Decodable {
            var error: String?
            var code: String?
        }
        if let body = try? jsonDecoder.decode(Body.self, from: data), let message = body.error {
            return HomeFinError(status: status, message: message, code: body.code)
        }
        switch status {
        case 401: return HomeFinError(status: status, message: "Your sign-in has expired. Sign in again.", code: "signed_out")
        case 403: return HomeFinError(status: status, message: "You don't have access to that.", code: "forbidden")
        case 404: return HomeFinError(status: status, message: "That couldn't be found on the server.", code: "not_found")
        default: return HomeFinError(status: status, message: "The server had a problem (\(status)).", code: "server")
        }
    }
}
