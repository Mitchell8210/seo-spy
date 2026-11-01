# SEO Spy project instructions

These instructions apply throughout this repository. Also read `client/AGENTS.md` for frontend work and `server/AGENTS.md` for backend work. The frontend preservation rule below applies to every task that affects the frontend, including cross-stack integration work.

## Strict frontend preservation rule

Unless the user explicitly directs or approves a specific presentation change, preserve the existing frontend exactly. This is a strict scope boundary intended to prevent development churn, not a general design preference.

- Never change component labels, titles, headings, static copy, icons, colors, typography, spacing, borders, sizing, layouts, responsive behavior, component ordering, or navigation without explicit permission.
- Never add, remove, replace, or reorganize visible sections, components, cards, controls, charts, supporting rows, or displayed data fields without explicit permission. Availability of additional backend data is not permission to display it.
- For data integration, focus only on connecting available real data to the correct existing fields and making the existing application controls functional. Reuse existing components and presentation; adapt API responses in services, hooks, and data mapping rather than redesigning the UI.
- Updating values, business identities, findings, recommendations, and statuses in their existing data slots is permitted within the requested integration. This does not authorize renaming the surrounding labels, substituting a different kind of metric, adding new fields, or inventing data. For example, media views must not populate a people-reached field.
- If data is missing or incompatible, preserve the existing field and use an existing truthful unavailable/loading/error treatment where one exists. Do not hide the field, rename it to fit a different metric, or create new presentation or wording without permission. If no existing treatment can represent the result accurately, explain the mismatch and ask before changing the presentation.
- Suggestions are welcome. Explain the proposed improvement, its benefit, and the exact presentation changes, then obtain clear approval before implementing any part of it. Continue independent work within the approved scope while waiting.
- A request to integrate real data, fix functionality, review a page, or improve reliability does not imply approval for presentation changes. Silence, elapsed time, a recommendation, or approval of a different change is not permission. Apply approvals only to the specific changes authorized.
- Do not make incidental visual, copy, accessibility-presentation, or component-structure improvements during integration. If a fix requires changing the protected presentation, discuss it first.

Before editing, inspect the existing UI and identify the exact data slots and behavior involved. Before handing off, review the diff for changes to protected presentation and remove any unapproved changes. Run relevant checks and report any remaining data limitations without expanding the UI.

This rule governs how to interpret any broader design, component, accessibility, roadmap, or implementation guidance elsewhere in the repository. Those guidelines do not grant permission to change the frontend. Only explicit user direction or approval authorizes an exception, limited to its stated scope.
