# Acceptance Checklist

## General

- Project context files exist.
- Scope is clear.
- Repository purpose is documented.
- No unrelated files were changed.
- No secrets are committed.
- Documentation is concise and actionable.
- All generated repository content is English-only.

## For Public HTML / Website Repositories

- Mobile layout has no horizontal scroll.
- Desktop, tablet, and mobile layouts are checked.
- Page title and description are relevant.
- Social preview metadata exists.
- Favicon exists.
- Preview image exists or is explicitly listed as missing.
- Correct VI is applied.
- No dark scheme is used unless approved.
- No external tracking is added unless approved.
- Public pages do not expose internal credentials or private logic.

## Repository-Specific Checks

- `CNAME` still points to `docs.energizeos.com` unless a domain change is explicitly approved.
- `index.html` keeps relevant EnergizeOS title, description, favicon, and social preview metadata.
- The site remains static unless a build system is explicitly approved.
- No `package.json` or dependency file is added without approval.
- EnergizeOS VI remains light, bright, industrial, serious, and premium.
- Public document links are checked before release.
- Preview image and favicon paths are checked before release.
