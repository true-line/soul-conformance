import CryptoKit
import Foundation

// The fixture supplies an ephemeral software key. Parsing and the exact bytes
// covered by the signature come from the unbundled owner CLI.
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
        let request = OwnerRequest.firstHQ(try FirstHQChallenge.parse(input.challenge, now: input.now))
        let key = try P256.Signing.PrivateKey(rawRepresentation: input.key)
        let proof = Proof(public_key: key.publicKey.x963Representation,
                          signature: try key.signature(for: request.signedBytes).derRepresentation)
        FileHandle.standardOutput.write(try JSONEncoder().encode(proof))
    }
}
