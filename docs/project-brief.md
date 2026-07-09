# Project Brief

## Repository

enxpower/docs-energize-v2

## Purpose

This repository publishes the public EnergizeOS engineering documents index for specifications, control narratives, developer manuals, and technical briefs.

## Public / Private Status

The repository is public and appears public-facing. The root `CNAME` points to `docs.energizeos.com`.

## Current Known Structure

- `README.md` — minimal repository title only.
- `index.html` — static site entry point for the EnergizeOS engineering document index.
- `CNAME` — custom domain configuration for `docs.energizeos.com`.
- `vi/assets/favicon.svg` — favicon referenced by `index.html`.
- `vi/assets/og-1200x630.png` — social preview image referenced by `index.html`.

## Deployment / Runtime

Likely GitHub Pages static hosting because the repository has a root `CNAME`. No deployment workflow was found at `.github/workflows/deploy.yml` during inspection. GitHub Pages settings should be verified before changing deployment behavior.

## Related Brand / Domain

- EnergizeOS
- Energize Solutions Inc.
- `docs.energizeos.com`
- `energizeos.com` is linked from the navigation.

## Important Constraints

- Keep the site static unless a runtime or build system is explicitly approved.
- Preserve `docs.energizeos.com` routing unless a domain change is explicitly approved.
- Preserve EnergizeOS light, bright, industrial, serious, and premium visual tone.
- Keep responsive layout and horizontal-scroll prevention intact.
- Keep public HTML metadata relevant and complete.
- Do not expose credentials, internal project data, or private implementation logic.

## What Future AI Agents Must Understand

- This is a public documentation website, not an internal scratchpad.
- Public pages must be polished enough for customers, partners, utilities, EPCs, and technical reviewers.
- `index.html` already contains title, description, Open Graph metadata, favicon, and preview image references.
- The README is currently too minimal and should be improved in a separate scoped task if approved.
- Do not add a framework, build step, dependency, or package file without explicit approval.
- Any route, CNAME, metadata, or VI change can affect the public brand surface.
