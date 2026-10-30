# Website priority policy: website-priority-v1

The backend derives priorities and recommended next steps from saved Lighthouse measurements and findings. This is SEO Spy's review policy, not a Google severity rating or a new scoring formula. Category scores, raw observations and collection dates remain unchanged. It evaluates homepage lab measurements, not site-wide coverage or field performance.

## Measurement rules

Values at or below the good boundary stay Low. Values above good and at or below poor become Medium. Values strictly above poor become Critical for LCP, TBT and CLS, and Medium for FCP and Speed Index. Critical maps to the existing frontend Urgent column.

| Metric | Unit | Mobile good / poor boundary | Desktop good / poor boundary | Priority above poor |
| --- | --- | --- | --- | --- |
| Largest Contentful Paint | ms | 2500 / 4000 | 1200 / 2400 | Critical |
| Total Blocking Time | ms | 200 / 600 | 150 / 350 | Critical |
| Cumulative Layout Shift | unitless | 0.1 / 0.25 | 0.1 / 0.25 | Critical |
| First Contentful Paint | ms | 1800 / 3000 | 900 / 1600 | Medium |
| Speed Index | ms | 3400 / 5800 | 1300 / 2300 | Medium |

The ranges follow Google's documentation: [LCP](https://developer.chrome.com/docs/lighthouse/performance/lighthouse-largest-contentful-paint), [TBT](https://developer.chrome.com/docs/lighthouse/performance/lighthouse-total-blocking-time), [CLS](https://web.dev/articles/cls), [FCP](https://developer.chrome.com/docs/lighthouse/performance/first-contentful-paint), and [Speed Index](https://developer.chrome.com/docs/lighthouse/performance/speed-index). Lab desktop thresholds differ from mobile; these rules do not claim a field Core Web Vitals assessment. The priority mapping itself is an application decision, with LCP/TBT/CLS prioritized for main-content visibility, responsiveness and visual stability. FCP and Speed Index support that investigation without multiplying Urgent findings for overlapping loading symptoms.

Each evaluated finding must belong to this audit, have directly linked check evidence, be referenced by the performance category, and have a binary/numeric check outcome with a finite score below 1. Metrics require a finite nonnegative numeric value and the correct unit. Missing values, wrong units, unreferenced checks, and manual/skipped/error/informative outcomes do not trigger escalation. Zero is valid. The category score alone never sets severity.

## Supporting diagnostic rules

A failed known diagnostic becomes Medium when a related metric is measured above its poor boundary in the same report. Otherwise it stays Low. A diagnostic is an investigation lead, not proof of the cause, and does not become Critical by itself.

| Diagnostic | Related metric |
| --- | --- |
| Forced reflow, unused JavaScript, main-thread work breakdown | TBT |
| Network dependency tree, LCP breakdown, LCP discovery, image delivery | LCP |
| Render-blocking insight | LCP or FCP |

Unknown checks, unrelated accessibility/SEO findings, and retired TTI/Max Potential FID checks retain their existing priority. We do not infer savings, blame a plugin, or promise score increases from the limited normalized evidence. Recommendations identify the relevant investigation, conditional changes, and a same-device retest rather than a generic instruction to review Lighthouse.

## Generation and archive reads

New Lighthouse investigations apply this policy before publishing results. New Website archives also persist `results.websiteAnalysis` with the version, audit ID, findings, recommendations and priority decisions (`findingId`, rule ID, reason, severity, evidence references). Analysis is deterministic and does not mutate its input. Re-running it does not create new finding/recommendation IDs.

`GET /api/audits/:auditId/website-analysis` derives current analysis from a saved live homepage/Lighthouse report. Older archives are not rewritten; downloading the original archive retains its original classifications. The Website hook loads the analysis alongside the original report and evidence summaries, validates ownership/references, and overlays the returned findings and recommendations atomically. It contains no browser-side priority rules. Unavailable analysis is a read error; prior usable results remain visible.

HTML-only results retain their existing findings. Lighthouse partial results can be analyzed using whichever individual checks and measurements are actually available. A missing category score is not silently treated as zero. No website changes, provider calls, AI interpretation or new SEO Spy combined score are introduced by this policy. Future policy/AI revisions should carry a new analysis version and retain the source report and scoring provenance.
