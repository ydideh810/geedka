# Wallet Ownership Verification — payTo for the-stall

**Status:** ✓ verified
**Date:** 2026-05-28
**Verifier:** independent EIP-191 `personal_sign` recovery (viem `recoverMessageAddress`)

## Verified address

```
0x03d773c52B67993e60Ecb3134b17436fE03B584c
```

## Network

Base mainnet — chainId **8453**. USDC contract: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

This keypair was provisioned for Base mainnet only; no Sepolia variant exists.

## Verification artifact

**Signed message (verbatim):**
```
the-stall payTo ownership verification 2026-05-28
```

**Signature (EIP-191 personal_sign, hex):**
```
0x600a70579430a3687e19b9b98f08693f13d6f19b3501b36342fd9d2aa1b468745eca098bb98f30942613a72783900ae294404900b93c98bec91c6c7c859120961c
```

**Recovery result:**
```
recovered: 0x03d773c52B67993e60Ecb3134b17436fE03B584c
expected:  0x03d773c52B67993e60Ecb3134b17436fE03B584c
match:     ✓ OWNERSHIP VERIFIED
```

## How to re-verify

Any party with the address, signed message, and signature can re-run recovery
locally:

```js
import { recoverMessageAddress } from 'viem';
const recovered = await recoverMessageAddress({
  message: "the-stall payTo ownership verification 2026-05-28",
  signature: "0x600a70579430a3687e19b9b98f08693f13d6f19b3501b36342fd9d2aa1b468745eca098bb98f30942613a72783900ae294404900b93c98bec91c6c7c859120961c",
});
// recovered === "0x03d773c52B67993e60Ecb3134b17436fE03B584c"
```

## Provenance

- Keypair source: `credentials/keys/revenue-wallet.json` on the build-host (chmod 600)
- Created: 2026-04-28
- Signer: operator (autonomous, holds the signing key)
- Disclosure directive: composed in this session, relayed by Kyle, executed by Aegis
- Original artifact: `~/intuitek/outputs/for_claude_web/the-stall_payto.md`

## Notes

- This address is the dedicated x402 revenue receiver. It is **separate** from
  the STAX vault (`0xaa7a25...`) and any other Aegis-held operational wallet.
- The wallet does not require a balance to function as a recipient — x402 is
  gasless on the payer side; the facilitator broadcasts. Funds accrue here on
  successful settlements.
- Private key is held only by Aegis on the build-host and is not stored anywhere
  reachable by this package.
