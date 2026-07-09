# CLAUDE.md

## Project

This repository is the public EnergizeOS engineering documents website for specifications, control narratives, developer manuals, and technical briefs.

## Operating Context

This repository belongs to EnergizeOS and Energize Solutions Inc. It is part of the public documentation context for engineering-facing material served from `docs.energizeos.com`.

## Current Purpose

The current practical purpose is to publish a lightweight static documentation index for EnergizeOS engineering documents using EnergizeOS visual identity and public web metadata.

## Architecture

The repository is a static HTML documentation site.

Known structure from inspection:

- `README.md` exists but currently only contains the repository name.
- `index.html` is the static site entry point.
- `CNAME` points the site to `docs.energizeos.com`.
- `vi/assets/favicon.svg` is referenced by `index.html`.
- `vi/assets/og-1200x630.png` is referenced by `index.html` for social preview.
- No root `package.json` was found during inspection.
- No `.github/workflows/deploy.yml` was found during inspection.

Deployment is likely GitHub Pages because the repository contains a root `CNAME`, but Pages settings were not verified.

## Brand / UI Rules

This repository contains public HTML and documentation pages. Apply these rules to every public page change:

- Desktop, tablet, and mobile layouts must be precisely responsive.
- Every release must be checked for responsive layout before publishing.
- Horizontal scrolling must be prevented on all screen sizes.
- Every public HTML page must include proper social preview metadata.
- Every public HTML page must include a strongly relevant title, description, favicon, and preview image.
- PNG preview images are preferred over SVG when social sharing compatibility matters.
- Use the correct company VI based on the brand involved.
- If no company brand applies, use Andy Gong / GONG-VI.
- Do not use dark color schemes unless the repository's VI explicitly requires it.
- Do not expose private source, credentials, or internal logic in public pages.
- All code, comments, filenames, and UI copy must be English.

For EnergizeOS repositories:

- Use EnergizeOS VI.
- The visual tone must be light, bright, industrial, serious, and premium.
- Avoid dark cyberpunk styling.
- Avoid generic SaaS template styling.
- Use disciplined spacing, strong readability, and clean executive presentation.

## Hard Rules

- Do not modify unrelated files.
- Do not add dependencies unless explicitly approved.
- Do not change deployment structure unless explicitly approved.
- Do not change public routes unless explicitly approved.
- Do not commit credentials, tokens, API keys, OAuth secrets, private keys, or environment variable values.
- Do not put secrets in frontend HTML or public JavaScript.
- Keep changes minimal, purposeful, and reversible.
- All generated repository content must be English-only.
- Update docs/todo-next.md at the end of every coding session.

## Session Handoff Rule

Every coding session must end by updating:

- docs/decision-log.md if a decision changed
- docs/change-log.md if files changed
- docs/todo-next.md with exact next steps

If docs/change-log.md does not exist and files were changed, create it.
