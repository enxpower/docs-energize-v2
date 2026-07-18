// ── ARCBOS Sidecar PDF Publisher ─────────────────────────────────────────────
// Visual language from styles/screen.css + print.css

// ── Page layout ───────────────────────────────────────────────────────────────
#set page(
  paper: "us-letter",
  margin: (left: 0.8in, right: 0.8in, top: 0.8in, bottom: 0.8in),
  header: context {
    if counter(page).get().first() > 1 {
      block(
        width: 100%,
        stroke: (bottom: 0.5pt + rgb("e1e4e9")),
        inset: (bottom: 5pt),
      )[
        #set text(font: ("Arial", "Noto Sans CJK SC"), size: 7.5pt)
        #grid(
          columns: (1fr, auto),
          align: (left + bottom, right + bottom),
          [#text(weight: "bold", fill: rgb("1a1c20"))[ENERGIZE]],
          [#text(fill: rgb("9aa1aa"))[ENERGIZE-MEM-2607-0003]],
        )
      ]
    }
  },
  footer: context [
    #block(
      width: 100%,
      stroke: (top: 0.5pt + rgb("e1e4e9")),
      inset: (top: 5pt),
    )[
      #set text(font: ("Arial", "Noto Sans CJK SC"), size: 7pt, fill: rgb("9aa1aa"))
      #grid(
        columns: (1fr, auto),
        align: (left + top, right + top),
        [ENERGIZE-MEM-2607-0003 · v2.0],
        [Page #counter(page).display() of #counter(page).final().first()],
      )
    ]
  ],
)

// ── Base typography ───────────────────────────────────────────────────────────
// lang: "zh" enables CJK line-break:strict — no mid-word breaks in Chinese.
#set text(font: ("Times New Roman", "Noto Serif CJK SC"), size: 11pt, fill: rgb("1a1c20"), lang: "zh")
#set par(leading: 0.85em, spacing: 14pt, justify: true, first-line-indent: 0pt)

// ── List settings ─────────────────────────────────────────────────────────────
#set list(indent: 0.8em, body-indent: 0.5em)
#set enum(indent: 0.8em, body-indent: 0.5em)

// ── Link show rule ────────────────────────────────────────────────────────────
#show link: it => text(fill: rgb("1d3f5f"))[#underline(
  stroke: 0.5pt + rgb("1d3f5f"),
  offset: 2pt,
  it
)]

// ── Heading show rules ────────────────────────────────────────────────────────
// bookmarked: true adds PDF navigation bookmarks for each heading.
#set heading(bookmarked: true)
#show heading.where(level: 1): it => {
  v(26pt, weak: true)
  block(
    width: 100%,
    stroke: (top: 0.5pt + rgb("e1e4e9")),
    inset: (top: 10pt, bottom: 0pt),
  )[
    #set text(font: ("Arial", "Noto Sans CJK SC"), size: 15pt, weight: "semibold", fill: rgb("1a1c20"))
    #it.body
  ]
  v(16pt, weak: true)
}
#show heading.where(level: 2): it => {
  v(20pt, weak: true)
  text(font: ("Arial", "Noto Sans CJK SC"), size: 13pt, weight: "semibold", fill: rgb("1a1c20"))[#it.body]
  v(12pt, weak: true)
}
#show heading.where(level: 3): it => {
  v(16pt, weak: true)
  text(font: ("Arial", "Noto Sans CJK SC"), size: 11pt, weight: "semibold", fill: rgb("1a1c20"))[#it.body]
  v(9pt, weak: true)
}
#show heading.where(level: 4): it => {
  v(12pt, weak: true)
  text(font: ("Arial", "Noto Sans CJK SC"), size: 10pt, weight: "semibold", fill: rgb("1a1c20"))[#it.body]
  v(7pt, weak: true)
}

// ── Code show rules ───────────────────────────────────────────────────────────
// Inline and block code: uniform border, light neutral bg, NO left bar.
#show raw.where(block: false): it => box(
  fill: rgb("f6f7f8"),
  stroke: 0.5pt + rgb("e1e4e9"),
  inset: (x: 3pt, y: 1.5pt),
  radius: 3pt,
)[#text(font: ("Courier New", "Noto Sans Mono CJK SC"), size: 9.5pt, fill: rgb("1d232b"))[#it]]

#show raw.where(block: true): it => block(
  width: 100%,
  fill: rgb("f6f7f8"),
  stroke: 0.5pt + rgb("e1e4e9"),
  radius: 3pt,
  inset: (left: 14pt, top: 11pt, bottom: 11pt, right: 12pt),
)[#set text(lang: "en")
#text(font: ("Courier New", "Noto Sans Mono CJK SC"), size: 9pt, fill: rgb("1d232b"))[#it]]

#text(font: ("Arial", "Noto Sans CJK SC"), size: 9pt, weight: "bold", fill: rgb("1a1c20"), tracking: 0.08em)[ENERGIZE]
#v(8pt)
#line(length: 100%, stroke: 1pt + rgb("1a1c20"))
#v(8pt)
#text(font: ("Arial", "Noto Sans CJK SC"), size: 7pt, weight: "bold", fill: rgb("6a717b"), tracking: 0.08em)[MEMO]
#v(6pt)
#text(font: ("Arial", "Noto Sans CJK SC"), size: 22pt, weight: "semibold", fill: rgb("1a1c20"), hyphenate: false, lang: "zh")[CA-PEP01 Scope & Commercial Position Record — July 20 Discussion Prep]
#v(10pt)
#line(length: 100%, stroke: 0.5pt + rgb("e1e4e9"))
#v(7pt)
#text(font: ("Arial", "Noto Sans CJK SC"), size: 8pt, fill: rgb("6a717b"))[#text(weight: "bold")[ENERGIZE-MEM-2607-0003] #text(fill: rgb("9aa1aa"))[ · ]MEMO #text(fill: rgb("9aa1aa"))[ · ]v2.0]
#v(10pt)
#grid(
  columns: (1.3in, 1fr),
  row-gutter: 6pt,
  [#text(font: ("Arial", "Noto Sans CJK SC"), size: 6.8pt, weight: "bold", fill: rgb("9aa1aa"), tracking: 0.08em)[CLIENT]],  [#text(font: ("Arial", "Noto Sans CJK SC"), size: 9pt, fill: rgb("1a1c20"))[Internal]],
  [#text(font: ("Arial", "Noto Sans CJK SC"), size: 6.8pt, weight: "bold", fill: rgb("9aa1aa"), tracking: 0.08em)[PROJECT]], [#text(font: ("Arial", "Noto Sans CJK SC"), size: 9pt, fill: rgb("1a1c20"))[Battery Integration]],
  [#text(font: ("Arial", "Noto Sans CJK SC"), size: 6.8pt, weight: "bold", fill: rgb("9aa1aa"), tracking: 0.08em)[STATUS]],  [#text(font: ("Arial", "Noto Sans CJK SC"), size: 9pt, fill: rgb("1a1c20"))[Final]],
)
#v(12pt)
#line(length: 100%, stroke: 0.5pt + rgb("e1e4e9"))
#v(18pt)

#text(weight: "bold")[CA-PEP01 · PepsiCo/SDG&E Interconnection Support · Prepared for July 20 Commercial Discussion]

Prepared by: Energize Solutions Inc. · Date: July 17, 2026 · Project ID: PJ25060008

#v(10pt, weak: true)
#line(length: 100%, stroke: 0.3pt + rgb("e1e4e9"))
#v(10pt, weak: true)

== COMMON GROUND

- The project timeline has extended significantly beyond original expectations.
- The original Phase 1/2/3 proposals remain the governing reference for scope and pricing.
- Energize is not seeking to re-bill for deliverables already completed and paid under Phase 1/2/3.
- The technical architecture for SWBD\#1 is now substantially converged between Energize and B&V.
- RDB configuration, FAT, SAT, and commissioning remain ahead and both sides want them completed efficiently.

#v(10pt, weak: true)
#line(length: 100%, stroke: 0.3pt + rgb("e1e4e9"))
#v(10pt, weak: true)

== SECTION 1 — WHAT THE ORIGINAL PROPOSALS ACTUALLY SAY

#text(style: "italic")[The table below is sourced directly from Energize's original Phase 1, 2, and 3 proposals (Project ID PJ25060008). This is the scope baseline both parties agreed to reference.]

#table(
  columns: (25fr, 15fr, 35fr, 25fr),
  inset: (x: 8pt, y: 5.5pt),
  align: top + left,
  stroke: none,
  table.hline(stroke: 0.8pt + rgb("1a1c20")),
  table.header(
    [#text(font: ("Arial", "Noto Sans CJK SC"), size: 7.5pt, weight: "bold", fill: rgb("6a717b"), tracking: 0.06em)[#upper[Activity]]],
    [#text(font: ("Arial", "Noto Sans CJK SC"), size: 7.5pt, weight: "bold", fill: rgb("6a717b"), tracking: 0.06em)[#upper[Source (Proposal Ref.)]]],
    [#text(font: ("Arial", "Noto Sans CJK SC"), size: 7.5pt, weight: "bold", fill: rgb("6a717b"), tracking: 0.06em)[#upper[What the Original Document Actually Says]]],
    [#text(font: ("Arial", "Noto Sans CJK SC"), size: 7.5pt, weight: "bold", fill: rgb("6a717b"), tracking: 0.06em)[#upper[Responsibility]]],
    table.hline(stroke: 0.7pt + rgb("c2c7ce")),
  ),
  [SEL-700G relay procurement, installation & commissioning],
  [Phase 1 App. H / Phase 2 App. I],
  [NOT Energize scope — explicitly excluded ("Not supplied, configured, or commissioned")],
  [Client / EPC / OEM responsibility],
  table.hline(stroke: 0.5pt + rgb("e1e4e9")),
  [52a/52b auxiliary contact signal wiring],
  [Phase 1 App. H],
  [NOT Energize scope — explicitly excluded ("Not responsible for signal wiring")],
  [Client / EPC / OEM responsibility],
  table.hline(stroke: 0.5pt + rgb("e1e4e9")),
  [Main breaker model, control terminals, auxiliary contacts],
  [Phase 1 App. H],
  [NOT Energize scope — explicitly excluded],
  [Client / EPC / OEM responsibility],
  table.hline(stroke: 0.5pt + rgb("e1e4e9")),
  [Control logic design, C1–C7 interlock criteria, DO/DI wiring diagrams],
  [Phase 1 App. H / T01–T08],
  [Energize scope — included and delivered],
  [Energize (complete)],
  table.hline(stroke: 0.5pt + rgb("e1e4e9")),
  [Phase 3 on-site/remote commissioning support],
  [Phase 3 §X.3],
  [5 business days (blended remote + local), \$7,500],
  [Energize — base scope, time-boxed],
  table.hline(stroke: 0.5pt + rgb("e1e4e9")),
  [SEL/SEL-735 .RDB configuration file preparation],
  [Phase 3 P3.2],
  [\$3,000 — assumes device installed, wired, and reachable per Phase 2 design],
  [Energize — base scope, conditional on site readiness],
  table.hline(stroke: 0.5pt + rgb("e1e4e9")),
  [Final Acceptance Test (FAT) & punch list resolution],
  [Phase 3 P3.4],
  [\$1,200 — single FAT cycle assumed],
  [Energize — base scope, single cycle only],
  table.hline(stroke: 0.5pt + rgb("e1e4e9")),
)

#v(10pt, weak: true)
#line(length: 100%, stroke: 0.3pt + rgb("e1e4e9"))
#v(10pt, weak: true)

== SECTION 2 — THREE-BUCKET COMMERCIAL MODEL

#text(style: "italic")[This structure separates what is already included, what has already happened outside scope, and what remains an open commercial question for the future — so each can be resolved on its own terms.]

=== BUCKET 1 — Remaining Base-Scope Work (No Additional Charge)

- One (1) Final Acceptance Test cycle, per Phase 3 P3.4, once design is frozen and site is ready.
- One (1) round of on-site/remote commissioning support, up to 5 business days, per Phase 3 P3.1.
- SEL-700G/SEL-735 .RDB configuration file preparation, per Phase 3 P3.2 — conditional on devices being installed, wired, and reachable, as stated in the original proposal.

#text(style: "italic")[Energize will not re-bill for these once the above conditions are met. Repeated cycles, remobilization, or validation of a re-opened design are treated under Bucket 3, not this bucket.]

=== BUCKET 2 — Work Already Performed Outside Original Scope (One-Time Reconciliation)

- SEL-700G protection logic review and re-review across four cycles (May 4 – Jul 7), covering work explicitly excluded from Energize scope per Phase 1 Appendix H ("SEL700G Relay Procurement & Commissioning — Not supplied, configured, or commissioned by Energize").
- 52a/52b signal path architecture analysis and re-analysis — explicitly excluded from Energize scope per the same appendix ("Not responsible for signal wiring").
- Repeated rescheduling and standby time for technical review calls (May 11–14, 2026) that did not proceed as planned.
- Development and issuance of supplementary technical memoranda (PUB-2605-0038-MEM, PUB-2607-0001-MEM, PUB-2607-0002-MEM) required specifically because B&V's own approved design (Feb 3, 2026) was reopened and revised (May 29 – Jul 7, 2026).
- Multi-party coordination and status-chasing across B&V, Ravenvolt, EVESCO, and GrayBirch beyond the single-point-of-contact model assumed in the original proposals.

#text(style: "italic")[These are one-time items tied to the May–July 2026 ECO cycle, representing approximately 7.5 engineering-days of review, analysis, and documentation beyond original scope.] #text(weight: "bold")[Recommended resolution: a single reconciliation payment of USD 15,000 (comparable to the full Phase 3 commissioning value of USD 16,500), via a one-time change order — not a recurring fee.]

=== BUCKET 3 — Future Uncertainty: Continued Availability & Additional Cycles

- Energize's original proposals assumed continuous execution: Phase 2 estimated 20 business days; Phase 3 estimated a single 5-day commissioning window ending T0+20 days. Neither assumed indefinite pauses, repeated design reopening, or extended standby.
- If EVESCO/B&V require Energize to remain available on short notice through an undefined FAT/SAT timeline, a resource-availability arrangement is appropriate — this is what the June 10 proposal (\$7,500/mo or \$13,000/mo) was intended to cover.
- Alternatively, Energize can operate on a pause/remobilize basis: no standing fee, but response time is not guaranteed and remobilization is scheduled per then-available engineering capacity.
- Any additional FAT cycles, repeated validation due to design changes after this memorandum, or new protection/architecture questions are billed under this bucket, not treated as included base scope.

#text(style: "italic")[This bucket is independent of Bucket 2. Resolving Bucket 2 does not itself resolve how Energize is compensated for continued availability going forward — that requires a separate decision between a retainer, milestone billing, or pause/remobilize.]

#v(10pt, weak: true)
#line(length: 100%, stroke: 0.3pt + rgb("e1e4e9"))
#v(10pt, weak: true)

== SECTION 3 — RESPONSE TO EVESCO'S POSITION

=== ON "DURATION ALONE DOES NOT CONSTITUTE SCOPE CHANGE"

Energize agrees with this principle. The claim in Bucket 2 is not that the project took longer, but that specific activities performed — SEL-700G logic review, 52a/52b architecture analysis — fall outside the scope boundary set out in Phase 1 Appendix H and Phase 2 Appendix I of Energize's own original proposals. These documents state plainly that SEL-700G configuration and 52a/52b wiring are client/EPC/OEM responsibilities, not Energize deliverables. The basis for the Bucket 2 request is the content of the work, not its duration.