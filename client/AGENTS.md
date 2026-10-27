# SEO Spy — Frontend Development Instructions

## 1. Scope

You are working on the **frontend of SEO Spy**.

Primary frontend stack:

- React
- TypeScript
- Vite
- Tailwind CSS
- React Router
- Lucide React

Backend stack, for integration awareness only:

- Node.js
- Express
- TypeScript

Unless explicitly instructed otherwise, work only inside the frontend/client application.

Do not modify backend files, infrastructure, deployment configuration, databases, WordPress integrations, Meta APIs, or authentication code outside the frontend scope.

---

# 2. Product

**SEO Spy** is an AI-powered website and social-media business audit application being built for the Meta Global AI Developer Hackathon.

The product analyzes:

- business websites
- SEO
- technical issues
- content
- business information
- authorized social-media business accounts
- cross-channel consistency

The primary real-world demonstration business is:

**Guzman Tax Accounting**

Website:

`guzmantaxaccounting.com`

Primary social platform for MVP:

**Facebook Business Page**

The frontend must not hard-code the application exclusively to Guzman Tax Accounting.

Guzman Tax Accounting may be used as mock/demo data.

---

# 3. Frontend Responsibility

The frontend is responsible for presenting:

- business information
- website connection status
- social-media connection status
- audit progress
- website findings
- social findings
- scores
- recommendations
- evidence
- severity
- approval controls
- verification results
- loading states
- errors
- empty states

The frontend should make complex SEO and AI information understandable to a small-business owner.

Avoid overly technical language in the user-facing interface.

---

# 4. Primary Navigation

The MVP navigation should include:

- Overview
- Website
- Social Media
- Analysis
- Recommendations
- Settings

Do not add unnecessary sections unless requested.

---

# 5. Overview Page

The Overview should eventually display:

### Business

- business name
- website
- overall audit status

### Connections

- Website
- Facebook Business Page

Example states:

- Connected
- Not connected
- Needs attention
- Scanning
- Error

### Scores

Future scores include:

- Website SEO Score
- Social Presence Score
- Business Consistency Score

During frontend development, these may use mock values.

The final score calculation will come from application-defined backend rules.

Do not create arbitrary scoring logic in the frontend.

### Findings

Display:

- severity
- finding title
- source
- short explanation
- status

Example severities:

- Critical
- Medium
- Low
- Passed / Verified

### Primary CTA

The main investigation action should be visually clear.

Example:

`Run Investigation`

---

# 6. Website Page

The Website page should eventually show findings related to:

- title tags
- meta descriptions
- headings
- image alt text
- internal links
- canonical tags
- robots.txt
- sitemap
- structured data
- accessibility-related SEO signals
- performance
- content issues

During initial development, use mock data only.

Do not build the actual website crawler in the frontend.

Website crawling belongs to the Node.js / Express backend.

---

# 7. Social Media Page

The initial social-media platform is:

**Facebook Business Page**

The frontend should support:

- disconnected state
- Connect Facebook CTA
- connected state
- business/Page identity
- available audit information
- social findings
- cross-channel inconsistencies

Do not implement Facebook OAuth directly in frontend code unless explicitly instructed.

The backend will control OAuth and token exchange.

The frontend should call backend routes.

Never request or store a user's Facebook password.

---

# 8. Analysis Page

The Analysis page should visually communicate the AI investigation process.

Possible stages:

1. Collecting website evidence
2. Collecting authorized social evidence
3. Evaluating technical findings
4. Checking cross-channel consistency
5. AI analysis
6. Prioritizing recommendations
7. Verification

The interface should make it obvious that SEO Spy is performing a structured investigation rather than simply generating chatbot text.

---

# 9. Recommendations Page

Recommendations should include:

- title
- severity
- source
- evidence
- explanation
- recommended change
- expected purpose
- current status

Possible statuses:

- Needs review
- Approved
- Rejected
- Applying
- Applied
- Verifying
- Verified
- Failed

For recommendations capable of changing external systems, provide:

`Approve`

`Edit`

`Reject`

The frontend must never automatically trigger external write actions without explicit user approval.

---

# 10. Verification UI

Verification is a core product feature.

After an approved fix, the UI should support a before/after state.

Example:

Before:

`Missing alt text`

After:

`Alt text detected`

Status:

`Verified`

Prefer clear evidence over generic success messages.

---

# 11. Frontend Development Strategy

Codex is the primary coding agent for the frontend.

Codex may generate the majority of:

- components
- pages
- layouts
- TypeScript
- Tailwind styles
- routing
- mock data
- hooks
- frontend services
- tests
- accessibility improvements
- refactors
- debugging fixes

The human developer reviews and tests the result.

Do not assume that application code must be manually written.

---

# 12. Meta Credit Strategy

Do not use Meta/Muse API calls during normal frontend development.

The frontend must initially work using:

- mock business data
- mock findings
- mock recommendations
- mock connection states
- mock analysis progress

Meta credits are being preserved for later:

- AI integration testing
- prompt refinement
- proof-of-concept testing
- real business analysis
- final testing
- demo

Frontend development should therefore work without live Meta services.

---

# 13. Mock Data

Keep mock/demo data separate from UI components.

Preferred structure:

```text
src/
  data/
    mockBusiness.ts
    mockFindings.ts
    mockRecommendations.ts
```

Do not embed large mock objects directly inside page components.

Mock data should be shaped similarly to the future backend API response.

This will make replacing mock data with real API calls easier later.

---

# 14. Recommended Frontend Structure

Prefer:

```text
client/
  src/
    components/
      layout/
      dashboard/
      findings/
      recommendations/
      common/

    pages/
      Overview/
      Website/
      SocialMedia/
      Analysis/
      Recommendations/
      Settings/

    data/

    hooks/

    services/

    types/

    utils/

    App.tsx
    main.tsx
```

Do not create excessive abstraction.

Keep the architecture understandable for a small hackathon team.

---

# 15. Backend Boundary

The frontend communicates with a future:

**Node.js + Express + TypeScript backend**

The frontend should eventually call endpoints such as:

```text
/api/business
/api/audit
/api/findings
/api/recommendations
/api/connections/facebook
/api/actions
/api/verification
```

These are conceptual examples.

Do not create backend endpoints from frontend tasks unless explicitly requested.

Use a frontend service layer instead of scattering `fetch()` calls throughout components.

Preferred concept:

```text
src/services/api.ts
```

Pages should not know implementation details of backend authentication or AI providers.

---

# 16. Secrets

Never put secrets in frontend code.

Never create:

```text
VITE_MODEL_API_KEY
VITE_META_APP_SECRET
VITE_WORDPRESS_PASSWORD
VITE_BASETEN_API_KEY
```

Private keys belong on the Node.js/Express backend only.

Frontend environment variables must contain only values that are safe to expose publicly.

---

# 17. AI Boundary

The React frontend does not directly call Muse or other private AI APIs.

Correct architecture:

```text
React frontend
      ↓
Node.js / Express API
      ↓
Meta Model API
```

Not:

```text
React frontend
      ↓
Meta Model API
```

The frontend displays structured AI results returned by the backend.

---

# 18. Design Direction

SEO Spy should look like a professional SaaS dashboard.

Design characteristics:

- clean
- modern
- spacious
- high trust
- simple
- business-oriented
- restrained use of color
- strong hierarchy
- easy scanning

Primary visual direction:

- white/light surfaces
- dark readable typography
- restrained blue accents
- subtle borders
- subtle shadows
- clean cards
- clear status indicators

Avoid:

- excessive gradients
- excessive glassmorphism
- distracting animation
- giant decorative elements
- clutter
- low-contrast gray text
- overly futuristic visuals that hurt usability

SEO Spy should feel like a serious business intelligence product.

---

# 19. Responsive Design

Desktop is the primary hackathon demo experience.

However, components must remain usable on:

- desktop
- tablet
- mobile

Sidebar/navigation may collapse on smaller screens.

Do not create desktop layouts that completely break on mobile.

---

# 20. Accessibility

Use semantic HTML.

All interactive controls must:

- be keyboard accessible
- have visible focus states
- use understandable labels
- maintain adequate contrast

Do not rely only on color to communicate severity.

For example:

Do not show only a red dot.

Show:

`Critical`

plus an appropriate visual treatment.

---

# 21. Component Rules

Create reusable components when patterns repeat.

Likely components include:

```text
AppShell
Sidebar
Header
ScoreCard
ConnectionCard
FindingCard
RecommendationCard
StatusBadge
SeverityBadge
EmptyState
LoadingState
ErrorState
ProgressIndicator
```

Do not create one giant dashboard component.

Do not split trivial elements into unnecessary components.

---

# 22. TypeScript

Avoid unnecessary `any`.

Define shared types for:

- Business
- Connection
- Audit
- Finding
- Recommendation
- Verification
- Score
- Severity
- AnalysisStatus

Prefer explicit and reusable types.

---

# 23. State Management

Do not introduce a large state-management library unless the application actually needs one.

Start with:

- React state
- context where appropriate
- route-level data
- small custom hooks

Add more complex state management only if justified.

---

# 24. Error Handling

Do not assume API calls always succeed.

The UI should eventually support:

- loading
- success
- empty
- partial success
- authorization required
- API error
- retry

Failures should be understandable to the business owner.

Avoid exposing raw backend stack traces or technical errors.

---

# 25. API Integration

When replacing mock data with real backend data:

Do not redesign components unnecessarily.

The goal is:

```text
mock object
     ↓
replace with API response
     ↓
same UI
```

Normalize backend responses in the service/data layer when needed.

---

# 26. Git Safety

Before major work, inspect:

```bash
git status
```

After changes, inspect:

```bash
git diff
git status
```

Do not automatically:

- commit
- push
- reset
- clean
- stash
- rebase
- force push
- delete branches

unless explicitly authorized.

Never modify unrelated backend work belonging to another team member.

---

# 27. Codex Task Workflow

For meaningful frontend tasks:

### 1. Inspect

Read existing files before editing.

### 2. Plan

Provide a short implementation plan.

### 3. Implement

Make scoped changes.

### 4. Verify

Run available:

- TypeScript checks
- lint
- tests
- build

### 5. Review

Inspect changes for:

- responsive issues
- accessibility
- TypeScript errors
- unintended files
- secret exposure

### 6. Report

Clearly state:

- files changed
- functionality added
- commands/tests run
- results
- remaining limitations

Never claim something passed if it was not actually run.

---

# 28. Do Not Do These Without Approval

Do not:

- modify server/backend code
- configure Meta Model API
- spend Meta API credits
- configure Baseten
- connect real Facebook credentials
- modify the production WordPress site
- deploy
- commit
- push
- change Git history
- add major dependencies
- replace the chosen frontend stack

without explicit instruction.

---

# 29. Current Frontend Priority

Current work order:

```text
1. Scaffold React + TypeScript + Vite frontend

2. Establish design system and application shell

3. Build sidebar/navigation

4. Build Overview dashboard

5. Add mock Guzman Tax Accounting data

6. Build Website audit UI

7. Build Social Media UI

8. Build Analysis experience

9. Build Recommendations / approval UI

10. Add responsive behavior and accessibility

11. Add frontend tests

12. Integrate Node.js / Express backend later
```

Do not skip ahead to Meta AI integration during this phase.

---

# 30. Definition of Done

A frontend task is complete when:

- requested UI exists
- TypeScript compiles
- build succeeds
- relevant tests pass
- desktop layout works
- basic responsive behavior works
- interactive controls are accessible
- mock data is separate from components
- no secrets exist in frontend code
- no unrelated backend files were modified
- limitations are clearly reported

---

# 31. Product Principle

SEO Spy is not a generic chatbot.

The interface should communicate:

```text
Evidence
→ Analysis
→ Recommendation
→ Approval
→ Action
→ Verification
```

Every major design decision should reinforce that workflow.
