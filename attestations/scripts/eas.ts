// Ethereum Attestation Service (https://attest.org) -- Sepolia deployment.
// Addresses and ABI fragments below are taken verbatim from
// @ethereum-attestation-service/eas-contracts (deployments/sepolia/{EAS,SchemaRegistry}.json).

export const EAS_ADDRESS = '0xC2679fBD37d54388Ce493F1DB75320D236e1815e' as const
export const SCHEMA_REGISTRY_ADDRESS = '0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0' as const

// Bond attestation schema: on-chain address <-> ISIN <-> LEI mapping.
export const BOND_SCHEMA = 'address contractAddress,string isin,string lei' as const

export const schemaRegistryAbi = [
    {
        inputs: [
            { internalType: 'string', name: 'schema', type: 'string' },
            { internalType: 'contract ISchemaResolver', name: 'resolver', type: 'address' },
            { internalType: 'bool', name: 'revocable', type: 'bool' },
        ],
        name: 'register',
        outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [{ internalType: 'bytes32', name: 'uid', type: 'bytes32' }],
        name: 'getSchema',
        outputs: [
            {
                components: [
                    { internalType: 'bytes32', name: 'uid', type: 'bytes32' },
                    { internalType: 'contract ISchemaResolver', name: 'resolver', type: 'address' },
                    { internalType: 'bool', name: 'revocable', type: 'bool' },
                    { internalType: 'string', name: 'schema', type: 'string' },
                ],
                internalType: 'struct SchemaRecord',
                name: '',
                type: 'tuple',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        anonymous: false,
        inputs: [
            { indexed: true, internalType: 'bytes32', name: 'uid', type: 'bytes32' },
            { indexed: false, internalType: 'address', name: 'registerer', type: 'address' },
        ],
        name: 'Registered',
        type: 'event',
    },
] as const

export const easAbi = [
    {
        inputs: [
            {
                components: [
                    { internalType: 'bytes32', name: 'schema', type: 'bytes32' },
                    {
                        components: [
                            { internalType: 'address', name: 'recipient', type: 'address' },
                            { internalType: 'uint64', name: 'expirationTime', type: 'uint64' },
                            { internalType: 'bool', name: 'revocable', type: 'bool' },
                            { internalType: 'bytes32', name: 'refUID', type: 'bytes32' },
                            { internalType: 'bytes', name: 'data', type: 'bytes' },
                            { internalType: 'uint256', name: 'value', type: 'uint256' },
                        ],
                        internalType: 'struct AttestationRequestData',
                        name: 'data',
                        type: 'tuple',
                    },
                ],
                internalType: 'struct AttestationRequest',
                name: 'request',
                type: 'tuple',
            },
        ],
        name: 'attest',
        outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
        stateMutability: 'payable',
        type: 'function',
    },
    {
        inputs: [{ internalType: 'bytes32', name: 'uid', type: 'bytes32' }],
        name: 'getAttestation',
        outputs: [
            {
                components: [
                    { internalType: 'bytes32', name: 'uid', type: 'bytes32' },
                    { internalType: 'bytes32', name: 'schema', type: 'bytes32' },
                    { internalType: 'uint64', name: 'time', type: 'uint64' },
                    { internalType: 'uint64', name: 'expirationTime', type: 'uint64' },
                    { internalType: 'uint64', name: 'revocationTime', type: 'uint64' },
                    { internalType: 'bytes32', name: 'refUID', type: 'bytes32' },
                    { internalType: 'address', name: 'recipient', type: 'address' },
                    { internalType: 'address', name: 'attester', type: 'address' },
                    { internalType: 'bool', name: 'revocable', type: 'bool' },
                    { internalType: 'bytes', name: 'data', type: 'bytes' },
                ],
                internalType: 'struct Attestation',
                name: '',
                type: 'tuple',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [{ internalType: 'bytes32', name: 'uid', type: 'bytes32' }],
        name: 'isAttestationValid',
        outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        anonymous: false,
        inputs: [
            { indexed: true, internalType: 'address', name: 'recipient', type: 'address' },
            { indexed: true, internalType: 'address', name: 'attester', type: 'address' },
            { indexed: false, internalType: 'bytes32', name: 'uid', type: 'bytes32' },
            { indexed: true, internalType: 'bytes32', name: 'schema', type: 'bytes32' },
        ],
        name: 'Attested',
        type: 'event',
    },
] as const
