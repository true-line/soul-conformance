import CryptoKit
import Foundation

// The fixture supplies an ephemeral software key. Parsing and the exact bytes
// covered by the signature come from the same source as the owner app.
@main
struct FixtureOwner {
    struct Input: Decodable {
        let challenge: Data
        let key: Data
        let now: Int64
    }
    struct Proof: Encodable {
        let public_key: Data
        let signature: Data
    }

    static func main() throws {
        let input = try JSONDecoder().decode(Input.self, from: FileHandle.standardInput.readDataToEndOfFile())
        let challenge = try FirstHQChallenge.parse(input.challenge, now: input.now)
        let key = try P256.Signing.PrivateKey(rawRepresentation: input.key)
        let proof = Proof(public_key: key.publicKey.x963Representation,
                          signature: try key.signature(for: challenge.signedBytes).derRepresentation)
        FileHandle.standardOutput.write(try JSONEncoder().encode(proof))
    }
}
