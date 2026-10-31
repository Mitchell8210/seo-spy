# WordPress access verification: Guzman Tax Accounting

Checked October 30, 2026 UTC using `scripts/verify-wordpress.mjs` and credentials loaded from ignored `server/.env`. This is a read-only diagnostic and a handoff for a future WordPress integration, not an implemented write module.

## Confirmed results

- REST origin tested: `https://guzmantaxaccounting.com`.
- Authenticated `GET /wp-json/wp/v2/users/me?context=edit`: HTTP 200, user ID 12, role `administrator`.
- `GET /wp-json/wp/v2/users/me/application-passwords/introspect`: HTTP 200. The supplied application password was recognized.
- All 19 diagnostic requests returned HTTP 200. Only GET and OPTIONS were sent. Redirects were not followed; credentials were restricted to the selected HTTPS origin.
- Edit-context reads succeeded for pages, posts, media, content types, taxonomies, settings, plugins and themes.
- Collection totals at verification: 41 pages, 17 posts and 243 media records. Only three items from each content collection were sampled; this was not a full content export.
- Core Page/Post schemas expose title, content, excerpt, slug, publishing status, featured media and registered meta. Media exposes `alt_text`, caption and description.
- Sample content exposes Elementor meta fields, including `_elementor_data` and `_elementor_page_settings`.
- REST discovery advertises Rank Math and Elementor namespaces. Rank Math routes include `updateMeta`, `updateSchemas`, `updateSettings` and `updateRedirection`. Discovery is not proof that these routes accept application-password writes.
- Sample core Page/Post `meta` did not expose Rank Math SEO title/description keys. Core excerpts must not be treated as SEO meta descriptions.

The sanitized machine-readable snapshot is saved under ignored `reports/wordpress/access-verification.json`. It contains capabilities and API schema information, not the password or Authorization header.

## Action capability assessment

| Action | Read-only evidence | Conclusion for a future module |
| --- | --- | --- |
| Read current content and collect before-values | Edit-context Page/Post reads returned 200 | Verified access |
| Update Page/Post titles, body content, excerpts and slugs | `edit_pages`, `edit_posts`, `edit_others_*`, `edit_published_*` capabilities; core schemas expose these fields | Supported in principle; actual mutation deliberately not tested |
| Create, publish, unpublish or delete Pages/Posts | Publishing/deletion/edit capabilities reported; core collection schemas advertise creation | Capability-supported; implement exact action types and validate before any write |
| Update media alt text, captions and descriptions | Media edit-context read 200; media schema exposes those fields; edit capabilities present | Strong candidate for a narrow adapter, with rendered-output verification |
| Upload media | `upload_files` capability; media collection advertises POST | Capability-supported; no upload attempted |
| Manage categories/tags | `manage_categories` capability and taxonomy discovery | Supported in principle; individual term actions not exercised |
| Update site title/tagline, timezone or homepage selection | Settings read 200; `manage_options` true; settings schema advertises these fields and POST/PUT/PATCH | Capability-supported; unrelated settings should remain outside an SEO fix allowlist |
| Update SEO titles/descriptions, canonical/social metadata or structured data | Rank Math namespaces/routes and `rank_math_*` capabilities present | Requires a dedicated Rank Math compatibility investigation; plugin nonce/auth requirements and field mapping not verified |
| Edit Elementor-built page content | Elementor meta and endpoints present | Requires a dedicated structured-content adapter; a generic content update may not modify the actual rendered builder content |
| Manage plugins, themes or users | Broad administrator capabilities; plugin/theme listing reads 200 | Account has broad privileges, but individual write endpoints were not tested. Exclude these operations from the initial module |
| Change business hours/phone, image text or internal links | Content access is available | Need exact resource/field mapping; no universal WordPress business-hours/phone field was established |

An application password authenticates as its associated user; it is not itself a per-action approval mechanism. The reported administrator role is much broader than the initial SEO Spy integration needs. The future module must enforce its own narrow action allowlist and user approval, and should use a dedicated restricted service account when its required capabilities are established.

## Limits and future implementation requirements

1. No POST, PUT, PATCH or DELETE request was sent, so successful writing has not been proven. OPTIONS schemas advertise API shapes; they do not guarantee that every permission callback, security plugin or hosting restriction will allow a write.
2. No content, settings, plugin configuration, user account or application password was changed by the diagnostic. WordPress may maintain its normal authentication usage/access metadata for authenticated reads.
3. Start the future module with read/dry-run support and one explicitly approved reversible action. Capture before-values, bind approval to an exact patch/target and check for conflicting edits before execution.
4. Verify the public rendered result separately. A WordPress Page title may differ from a Rank Math SEO title; changing attachment alt text may not change alt text already stored in an Elementor widget or existing markup.
5. Test Rank Math/Elementor authentication and schema compatibility without issuing mutation requests first. Never use a plugin GET endpoint merely because it is called GET: some plugin routes may perform actions. This diagnostic called only core read endpoints and REST discovery.
6. Keep credentials server-side, disallow credential forwarding across redirects, bind requests to registered installations and enforce request limits. Never expose WordPress credentials to the browser or AI model.
7. Maintain distinct proposal, approval, execution and verification records as described in [the AI integration plan](AI_AGENT_INTEGRATION_PLAN.md).

## Re-running this diagnostic

From `server/`: `node scripts/verify-wordpress.mjs`. It reads the existing `.env`, performs only the fixed GET/OPTIONS checks, and replaces the local ignored diagnostic snapshot. `--config-only` displays configuration key names/presence, never credential values. It currently targets only the two approved Guzman HTTPS hostnames; it is not a generic WordPress connector.

Official API context: [WordPress application passwords](https://developer.wordpress.org/advanced-administration/security/application-passwords/), [Pages REST API](https://developer.wordpress.org/rest-api/reference/pages/), [Media REST API](https://developer.wordpress.org/rest-api/reference/media/). The site-specific findings above come from the dated live diagnostic, not an assumption based on those documents.
