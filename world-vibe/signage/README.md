# World Vibe physical signage

This directory documents the reproducible candidate signage pack for the World Vibe web-to-app handoff. Generated files stay under `.artifacts/` and must not be distributed until the physical-device gate passes.

## Generate and verify

From the repository root:

```sh
node scripts/generate-world-vibe-signage.mjs
node --test tests/world-vibe-signage.test.mjs
```

The generator reads `world-vibe/topics.json` as the only topic inventory, embeds the existing QR asset for each topic, and verifies both the source QR and the rendered poster against the exact stable URL. It writes a SHA-256 manifest alongside nine PNGs:

- A4 at 300 DPI with a three-inch QR for tabletop/counter use.
- 11×17 inches at 300 DPI with a six-inch QR for booths and storefronts.
- 4K landscape for a large display; the physical display size and viewing distance still require venue-specific validation.

The automated test also requires every rendered poster to decode after a 25% downscale with mild blur and after a 25% downscale with an eight-degree rotation. These are image-level robustness checks, not substitutes for real-world camera testing.

## Design basis

The pack uses a utility-first handoff composition rather than a campaign/manifesto layout: exact statement, explicit Camera instruction, explicit tap/check-in instruction, QR target, stable URL, then the privacy contract. It inherits SomaCheck's Hanken Grotesk typography and cream/ink/emerald palette. The discarded generic A4 approach made the QR and action too secondary and could not represent booth or large-display viewing distances.

## Release gate

Only topics present in `world-vibe/topics.json` may ship. Each statement and stable URL must match the source exactly. Before distribution, test every format that will be used with Mike's iPhone 12 mini:

1. Scan from the expected minimum, typical, and maximum viewing distances under bright, dim, and glare-prone lighting.
2. Confirm the camera presents the correct link and one tap opens the exact statement handoff.
3. Test with SomaCheck installed, force-quit, signed out, calibration incomplete, and not installed.
4. Complete one check-in and confirm the exact external statement appears once in Journey.
5. Confirm the source event receives only the permitted aggregate contribution, never the person's Journey entry or identity.
6. Reopen the original link without completing another check-in and confirm that opening alone creates neither a Journey entry nor a public contribution. A second intentionally completed check-in may create a second private Journey entry, while the event must still count that account as one public participant.

The privacy line on the candidate artwork is a behavioral contract: `Your check-in stays in your SomaCheck account. This event sees only aggregate results.` Do not release the artwork unless the app and backend evidence prove that contract.
