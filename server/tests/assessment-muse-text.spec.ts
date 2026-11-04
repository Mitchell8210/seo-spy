import { isCompleteBusinessText, safeBusinessExcerpt } from "../src/integrations/assessment-ai/assessment-muse-text.js";

const fallback = "Review the cited evidence before choosing a change.";

describe("complete, privacy-minimized business assessment excerpts", () => {
  it("keeps essential complete sentences instead of truncating a recommendation mid-word", () => {
    const first = "Inspect the main visible image and its loading timeline.";
    const second = "Confirm the actual cause before changing loading priority or server configuration.";
    expect(safeBusinessExcerpt(`${first} ${second}`, 95, fallback)).toBe(first);
    expect(safeBusinessExcerpt(`${first} ${second}`, 200, fallback)).toBe(`${first} ${second}`);
  });
  it("does not publish a trailing fragment even when the input is under the bound", () => {
    expect(safeBusinessExcerpt("Inspect the image. Re-run Lighthouse with the s", 150, fallback)).toBe("Inspect the image.");
    expect(safeBusinessExcerpt("Re-run Lighthouse with the s", 150, fallback)).toBe(fallback);
  });
  it("uses the complete fallback when no whole first sentence fits", () => {
    const long = "Inspect the " + "important visible resource ".repeat(40) + "before choosing a fix.";
    expect(safeBusinessExcerpt(long, 100, fallback)).toBe(fallback);
  });
  it("does not mistake a decimal measurement for the end of a sentence", () => {
    const first = "The main content appeared after 11.6 seconds in this mobile lab run.";
    expect(safeBusinessExcerpt(`${first} Inspect the loading timeline.`, first.length, fallback)).toBe(first);
    expect(safeBusinessExcerpt(first, 55, fallback)).toBe(fallback);
    expect(safeBusinessExcerpt("The delay was 450 ms. Review the resource.", 100, fallback)).toBe("The delay was 450 ms. Review the resource.");
  });
  it("does not stop at an unfinished common abbreviation", () => {
    expect(safeBusinessExcerpt("Dr. Example should review the image in context.", 100, fallback)).toBe("Dr. Example should review the image in context.");
    expect(safeBusinessExcerpt("Check the resource, e.g. the main visible image, before changing it.", 130, fallback)).toBe("Check the resource, e.g. the main visible image, before changing it.");
  });
  it("keeps Spanish, Unicode and emoji intact at the bound", () => {
    const first = "Revise la imagen principal 🐈 y su carga; después, confirme la causa.";
    const result = safeBusinessExcerpt(`${first} Evite cambios sin evidencia.`, first.length, fallback);
    expect(result).toBe(first);
    expect(result).not.toMatch(/\uFFFD/);
    expect(isCompleteBusinessText(result)).toBe(true);
  });
  it("supports complete quoted sentences and bracketed clarifications", () => {
    for (const input of ["Review the item (“main image”).", 'Review the “main image.”', 'Review "the image."', "Confirm the result (same device).", "¿Está completa la evidencia? ¡Revísela antes de cambiarla!"])
      expect(safeBusinessExcerpt(input, 150, fallback)).toBe(input);
  });
  it("keeps punctuation inside a sentence and does not convert a semicolon or ellipsis into a completed recommendation", () => {
    expect(safeBusinessExcerpt("Inspect the image; then confirm its purpose.", 150, fallback)).toBe("Inspect the image; then confirm its purpose.");
    expect(safeBusinessExcerpt("Wait… then inspect the saved evidence.", 150, fallback)).toBe("Wait… then inspect the saved evidence.");
    for (const input of ["Inspect the image;", "Inspect the image…", "Inspect the image..."])
      expect(safeBusinessExcerpt(input, 150, fallback)).toBe(fallback);
  });
  it("redacts links, email, phone numbers and inline credentials before sentence selection", () => {
    const input = "Review https://example.com/private?token=PRIVATE_URL. Contact person@example.com or +1 (702) 555-1212. api_key=PRIVATE_API; authorization: Bearer PRIVATE_AUTH; password: PRIVATE_PASSWORD. Inspect the image.";
    const result = safeBusinessExcerpt(input, 500, fallback);
    for (const secret of ["example.com", "person@", "702", "PRIVATE_URL", "PRIVATE_API", "PRIVATE_AUTH", "PRIVATE_PASSWORD"]) expect(result).not.toContain(secret);
    expect(result).toContain("[link omitted].");
    expect(result).toContain("[contact omitted]");
    expect(result).toContain("[secret omitted]");
    expect(isCompleteBusinessText(result)).toBe(true);
  });
  it("redacts quoted credentials, HTML/control characters and private-key blocks", () => {
    const result = safeBusinessExcerpt('<b>Review</b> the image. "api_key":"PRIVATE_QUOTED".\u0000 -----BEGIN PRIVATE KEY-----\nPRIVATE_KEY_BYTES\n-----END PRIVATE KEY-----', 500, fallback);
    expect(result).toContain("Review the image.");
    expect(result).not.toMatch(/PRIVATE_QUOTED|PRIVATE_KEY_BYTES|<b>/);
    expect(result).not.toContain(String.fromCharCode(0));
    expect(isCompleteBusinessText(result)).toBe(true);
  });
  it("redacts quoted authorization values and whitespace-separated credentials", () => {
    const result = safeBusinessExcerpt('Authorization: Bearer "QUOTED_AUTH". bearer "QUOTED_BEARER". api key WHITESPACE_KEY. Review the image.', 500, fallback);
    expect(result).not.toMatch(/QUOTED_AUTH|QUOTED_BEARER|WHITESPACE_KEY/);
    expect(result).toContain("Review the image.");
    expect(isCompleteBusinessText(result)).toBe(true);
  });
  it("redacts script/style bodies rather than preserving embedded instructions", () => {
    expect(safeBusinessExcerpt("<script>SECRET_SCRIPT();</script><style>SECRET_STYLE</style>Review the image.", 150, fallback)).toBe("Review the image.");
  });
  it("measures the limit after redaction without cutting the replacement marker", () => {
    const input = "Inspect https://example.com/" + "private-path".repeat(80) + ".";
    expect(safeBusinessExcerpt(input, 100, fallback)).toBe("Inspect [link omitted].");
  });
  it.each([null, undefined, 1, {}, "", "   ", "x".repeat(65537), "Broken surrogate \ud83d."])("returns the trusted fallback for incompatible input %#", value => {
    expect(safeBusinessExcerpt(value, 100, fallback)).toBe(fallback);
  });
  it("rejects an invalid or overlong fallback instead of inventing a shorter fact", () => {
    expect(() => safeBusinessExcerpt("Complete.", 10, fallback)).toThrow(RangeError);
    expect(() => safeBusinessExcerpt("Complete.", 100, "An unfinished fallback")).toThrow(RangeError);
    expect(() => safeBusinessExcerpt("Complete.", 0, fallback)).toThrow(RangeError);
  });
  it.each(["", "Incomplete text", "Review [the image.", "Review the image).", 'Review "the image.', "Review the image…", "Review the image...", "Dr.", "Invalid\u0000 text.", "Broken surrogate \ud83d."])("identifies visibly incomplete or malformed output: %j", text => {
    expect(isCompleteBusinessText(text)).toBe(false);
  });
});
