import { verifyImageAlt, type ImageAltVerificationTarget } from "../src/integrations/wordpress/verify-image-alt.js";

const target: ImageAltVerificationTarget = { mediaId: 7, sourceUrl: "https://example.com/wp-content/uploads/team.jpg", expectedAlt: "Tax accounting team", pageUrl: "https://example.com/services/" };

describe("pure public image alternative verification", () => {
  it("matches only the exact attachment class and decodes escaped alternative text", () => {
    const expectedAlt = 'Equipo & staff "Guzmán"';
    const result = verifyImageAlt('<img class="aligncenter wp-image-7 size-large" src="/wp-content/uploads/team.jpg" alt="Equipo &amp; staff &quot;Guzmán&quot;">', { ...target, expectedAlt });
    expect(result).toMatchObject({ status: "verified", matchedImages: 1, observedAlts: [expectedAlt] });
    expect(result.limitations.some(value => value.includes("ranking or performance"))).toBe(true);
    expect(verifyImageAlt('<img class="wp-image-70" alt="Tax accounting team">', target).status).toBe("inconclusive");
    expect(verifyImageAlt('<img class="wp-image-7-extra" alt="Tax accounting team">', target).status).toBe("inconclusive");
  });

  it("matches source URLs, bounded WordPress dimension variants and lazy srcsets without fetching", () => {
    for (const html of [
      '<img src="https://example.com/wp-content/uploads/team.jpg" alt="Tax accounting team">',
      '<img src="/wp-content/uploads/team-300x200.jpg" alt="Tax accounting team">',
      '<img src="data:image/gif;base64,AAAA" data-src="/wp-content/uploads/team.jpg" alt="Tax accounting team">',
      '<img srcset="/wp-content/uploads/team-300x200.jpg 300w, /wp-content/uploads/team-600x400.jpg 600w" alt="Tax accounting team">',
      '<img data-srcset="/wp-content/uploads/team-600x400.jpg 1x, /wp-content/uploads/team-1200x800.jpg 2x" alt="Tax accounting team">',
      '<img data-lazy-src="/wp-content/uploads/team.jpg" alt="Tax accounting team">',
    ]) expect(verifyImageAlt(Buffer.from(html), target)).toMatchObject({ status: "verified", matchedImages: 1, observedAlts: [target.expectedAlt] });
  });

  it("does not equate another origin, directory, extension, basename, query or arbitrary filename suffix", () => {
    for (const source of [
      "https://cdn.example.com/wp-content/uploads/team.jpg",
      "/other/team-300x200.jpg",
      "/wp-content/uploads/team-300x200.png",
      "/wp-content/uploads/other-team-300x200.jpg",
      "/wp-content/uploads/team-thumbnail.jpg",
      "/wp-content/uploads/team.jpg?attachment_id=70",
      "/wp-content/uploads/team-0x200.jpg",
      "/wp-content/uploads/team-999999x200.jpg",
    ]) expect(verifyImageAlt(`<img src="${source}" alt="Tax accounting team">`, target).status).toBe("inconclusive");
  });

  it("preserves exact source query semantics and HTML-escaped lazy attributes", () => {
    expect(verifyImageAlt('<img data-src="https://example.com/wp-content/uploads/team.jpg?size=full&amp;version=2" alt="Tax accounting team">', { ...target, sourceUrl: `${target.sourceUrl}?size=full&version=2` }).status).toBe("verified");
  });

  it("does not trust a source URL when an attachment class identifies a conflicting media ID", () => {
    for (const classes of ["wp-image-70", "wp-image-7 wp-image-8"]) {
      const result = verifyImageAlt(`<img class="${classes}" src="${target.sourceUrl}" alt="Tax accounting team">`, target);
      expect(result.status).toBe("inconclusive");
      expect(result.matchedImages).toBe(0);
      expect(result.limitations.some(value => value.includes("conflicting"))).toBe(true);
    }
  });

  it("requires source corroboration and never lets a matching class override contradictory concrete sources", () => {
    for (const attributes of [
      "",
      'src="/unrelated.jpg"',
      'src="data:image/gif;base64,AAAA"',
      'src="/unrelated.jpg" data-src="/wp-content/uploads/team.jpg"',
      'src="/wp-content/uploads/team.jpg" data-src="/unrelated.jpg"',
      'src="/wp-content/uploads/team.jpg" srcset="/unrelated.jpg 300w, /wp-content/uploads/team-600x400.jpg 600w"',
      'src="/wp-content/uploads/team.jpg" data-srcset="/unrelated.jpg 1x"',
    ]) {
      const result = verifyImageAlt(`<img class="wp-image-7" ${attributes} alt="Tax accounting team">`, target);
      expect(result).toMatchObject({ status: "inconclusive", matchedImages: 0, observedAlts: [] });
    }
    const lazy = verifyImageAlt('<img class="wp-image-7" src="data:image/gif;base64,AAAA" data-src="/wp-content/uploads/team.jpg" alt="Tax accounting team">', target);
    expect(lazy).toMatchObject({ status: "verified", matchedImages: 1, observedAlts: [target.expectedAlt] });
    expect(verifyImageAlt('<picture><source srcset="/unrelated.jpg 1x"><img class="wp-image-7" src="/wp-content/uploads/team.jpg" alt="Tax accounting team"></picture>', target).status).toBe("inconclusive");
    expect(verifyImageAlt('<picture><source srcset="/wp-content/uploads/team-300x200.jpg 1x"><img class="wp-image-7" src="/wp-content/uploads/team.jpg" alt="Tax accounting team"></picture>', target).status).toBe("verified");
  });

  it("reports stale caches, builder overrides and missing alternatives as mismatches", () => {
    expect(verifyImageAlt('<img class="wp-image-7" src="/wp-content/uploads/team.jpg" alt="Old cached alt">', target)).toMatchObject({ status: "mismatch", observedAlts: ["Old cached alt"] });
    expect(verifyImageAlt(`<img data-src="${target.sourceUrl}" alt="Elementor override">`, target)).toMatchObject({ status: "mismatch", observedAlts: ["Elementor override"] });
    const absent = verifyImageAlt('<img class="wp-image-7" src="/wp-content/uploads/team.jpg">', target);
    expect(absent).toMatchObject({ status: "mismatch", observedAlts: [null] });
    expect(absent.limitations.some(value => value.includes("Caches"))).toBe(true);
  });

  it("handles multiple matches without overlooking a conflicting public value", () => {
    const image = '<img class="wp-image-7" src="/wp-content/uploads/team.jpg" alt="Tax accounting team">';
    expect(verifyImageAlt(image.repeat(2), target)).toMatchObject({ status: "verified", matchedImages: 2, observedAlts: [target.expectedAlt, target.expectedAlt] });
    expect(verifyImageAlt(`${image}<img class="wp-image-7" src="/wp-content/uploads/team.jpg" alt="Different">`, target)).toMatchObject({ status: "mismatch", matchedImages: 2, observedAlts: [target.expectedAlt, "Different"] });
  });

  it("verifies an explicitly empty alternative without claiming the image is decorative", () => {
    expect(verifyImageAlt('<img class="wp-image-7" src="/wp-content/uploads/team.jpg" alt="">', { ...target, expectedAlt: "" })).toMatchObject({ status: "verified", observedAlts: [""] });
    expect(verifyImageAlt('<img class="wp-image-7" src="/wp-content/uploads/team.jpg">', { ...target, expectedAlt: "" })).toMatchObject({ status: "mismatch", observedAlts: [null] });
  });

  it("keeps absent images and JavaScript-inserted widgets inconclusive", () => {
    const result = verifyImageAlt('<script>document.write(\'<img class="wp-image-7" alt="Tax accounting team">\')</script><div data-widget-id="7"></div>', target);
    expect(result).toMatchObject({ status: "inconclusive", matchedImages: 0, observedAlts: [] });
    expect(result.limitations.some(value => value.includes("widget-specific"))).toBe(true);
  });

  it("rejects invalid targets and unsafe URLs without exposing input in diagnostics", () => {
    for (const sourceUrl of ["not-a-url", "javascript:execute()", "data:image/png,abc", "https://user:secret@example.com/team.jpg", "https://example.com:8443/team.jpg"]) {
      const result = verifyImageAlt('<img class="wp-image-7" alt="Tax accounting team">', { ...target, sourceUrl });
      expect(result.status).toBe("inconclusive");
      expect(JSON.stringify(result)).not.toContain("secret");
    }
    expect(verifyImageAlt("", { ...target, mediaId: 0 }).status).toBe("inconclusive");
    expect(verifyImageAlt("", { ...target, expectedAlt: "a".repeat(2001) }).status).toBe("inconclusive");
  });

  it("rejects excessive match counts, long alternatives and malformed or oversized source lists", () => {
    const repeated = verifyImageAlt('<img class="wp-image-7" src="/wp-content/uploads/team.jpg" alt="Tax accounting team">'.repeat(21), target);
    expect(repeated.status).toBe("inconclusive");
    expect(repeated.observedAlts).toHaveLength(20);
    expect(repeated.matchedImages).toBe(21);
    const long = verifyImageAlt(`<img class="wp-image-7" src="/wp-content/uploads/team.jpg" alt="${"a".repeat(2001)}">`, target);
    expect(long.status).toBe("inconclusive");
    expect(long.observedAlts[0]).toHaveLength(2000);
    const manySources = Array.from({ length: 21 }, () => `${target.sourceUrl} 1x`).join(",");
    expect(verifyImageAlt(`<img srcset="${manySources}" alt="Tax accounting team">`, target).status).toBe("inconclusive");
    expect(verifyImageAlt(`<img srcset="${target.sourceUrl} invalid" alt="Tax accounting team">`, target).status).toBe("inconclusive");
    expect(verifyImageAlt(`<img srcset="data:image/png,${target.sourceUrl}" alt="Tax accounting team">`, target).status).toBe("inconclusive");
    expect(verifyImageAlt("x".repeat(2 * 1024 * 1024 + 1), target).status).toBe("inconclusive");
  });
});
