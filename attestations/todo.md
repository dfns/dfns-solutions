# Attestations

## Context

Static data accuracy, validity and sourcing is critical in traditional finance.
With more and more assets going on-chain, there is a need to attest and verify statements.
We are going to demonstrate how to use attestation in DFNS to prove that a given bond issued as a smart contract has an ISIN that maps one-to-one to the bond on-chain address.

## Logic

- In our case, a third-party will attest that a given bond address has an ISIN and has been issued by a given legal entity identified by its LEI
- The schema is therefore straightforward: address, ISIN, LEI
- The third-party will attest the proof that can be checked via smart contract, API or online.
- We will use DFNS's capability to sign attestation
- We will use EAS (https://attest.org/)

