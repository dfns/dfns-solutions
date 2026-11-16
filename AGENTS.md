# DFNS Solutions

Rules for AI agents and people adding a solution demo to this repository. This repository is **public**: everything committed here can be read by anyone.

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md`.

## Scope

These rules apply to **new** solution demos. Existing demos keep their current look. Do not restyle them unless their owner asks.

## Web UI: follow the DFNS design system

When a new demo has a web UI, build it with the DFNS design system (repo `dfns/dfns-design-system`, DFNS staff only):

- **Colors, spacing, radii, shadows and type sizes:** take them from the design system's `tokens/` folder (entry: `tokens/index.css`). Copy the token CSS into the demo and use the variables. Never hardcode a value that exists as a token, and prefer semantic tokens such as `--base-primary` over base scales.
- **Logos:** use the SVGs from `assets/logos/`. Do not redraw or recolor them.
- **Icons:** Heroicons v2, solid style only.
- **Components:** if the design system has a component (Button, Badge, CTA, Input), match it instead of designing a new one.
- **Light and dark:** support both, using the token values for each mode.
- If two sources disagree on a value, the design-system `tokens/` folder wins.

## Fonts are licensed: never commit them

Suisse Intl and PP Neue Montreal are licensed fonts and must not be committed to this repository or bundled in a demo. In the font stack, put the brand font first and a free fallback after it, for example:

```css
font-family: "Suisse Intl", Inter, system-ui, sans-serif;
```

Staff who have the font installed see the brand font, and everyone else gets the fallback.

## Public repository

- Never name a client in code, comments, sample data, screenshots or commit messages. Use "a client" or a made-up company name.
- Use testnets and placeholder values only. Never commit API keys, private keys, tokens, org IDs from a real customer, or `.env` files. Commit a `.env.example` with variable names and empty values.
- Do not copy internal-only files from the design system (for example confidential specs or anything outside `tokens/`, `assets/logos/` and `assets/icons/`) into this repository.
