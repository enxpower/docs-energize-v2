# Decision Log

## Active Decisions

- Decision: Initial Project Context Pack added.
  Reason: Future AI coding sessions need a reliable project baseline instead of relying on chat history.
  Impact: Future sessions should read `CLAUDE.md` and docs files before making changes.

- Decision: This repository remains a static public documentation site.
  Reason: Inspection found `index.html` and `CNAME`, with no root `package.json` or verified deployment workflow.
  Impact: Future work must not introduce a build system, framework, dependency, or runtime unless explicitly approved.

- Decision: The canonical public documentation domain is `docs.energizeos.com`.
  Reason: The root `CNAME` file contains `docs.energizeos.com`.
  Impact: Do not change domain routing, canonical URLs, or public routes without explicit approval.

- Decision: EnergizeOS VI is the required visual identity.
  Reason: `index.html` uses EnergizeOS branding, color variables, favicon, and social preview metadata.
  Impact: Future UI work must preserve the light, bright, industrial, serious, and premium EnergizeOS tone.
