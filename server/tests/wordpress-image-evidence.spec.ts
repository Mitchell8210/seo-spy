import { matchMediaImages, observeImages } from "../src/integrations/wordpress/image-evidence.js";

const pageUrl = "https://example.com/services/bookkeeping/";
const original = "https://example.com/wp-content/uploads/letter.png";
// Registered sizes need not share a basename with the original. Metadata, not
// a filename-shape guess, establishes which bytes WordPress associates with ID 7.
const variant = "https://example.com/wp-content/uploads/registered-letter-crop.webp";
const catalog = [{ mediaId: 7, sourceUrls: [original, variant] }];
const match = (html: string) => matchMediaImages(observeImages(html), pageUrl, catalog, 7);

describe("bounded image observations for exact WordPress evidence", () => {
  it("preserves decoded alternatives, explicit attachment identity and lazy sources", () => {
    const [image] = observeImages('<img class="alignnone wp-image-7 size-large" src="data:image/png;base64,AAAA" data-src="/wp-content/uploads/registered-letter-crop.webp" data-srcset="/wp-content/uploads/letter.png 2x" alt="Asesoría &amp; atención">');
    expect(image).toMatchObject({
      src: "data:image/png;base64,AAAA", alt: "Asesoría & atención", attachmentIds: [7],
      attributes: { src: "data:image/png;base64,AAAA", "data-src": "/wp-content/uploads/registered-letter-crop.webp", "data-srcset": "/wp-content/uploads/letter.png 2x" },
      pictureSources: [],
    });
  });

  it("keeps missing and intentionally empty alternatives distinct", () => {
    const images = observeImages('<img class="wp-image-7" src="/a"><img class="wp-image-8" src="/b" alt="">');
    expect(images.map(image => image.alt)).toEqual([null, ""]);
  });

  it("records picture replacement sources with their exact attributes", () => {
    const [image] = observeImages('<picture><source type="image/webp" media="(min-width: 600px)" srcset="/wp-content/uploads/registered-letter-crop.webp 1x"><img class="wp-image-7" src="/wp-content/uploads/letter.png" alt="Carta"></picture>');
    expect(image.pictureSources).toEqual(expect.arrayContaining([expect.objectContaining({ type: "image/webp", media: "(min-width: 600px)", srcset: "/wp-content/uploads/registered-letter-crop.webp 1x" })]));
  });

  it("does not invent an attachment identity from a filename or unrelated widget identifier", () => {
    const images = observeImages('<img id="7" data-widget-id="7" src="/wp-content/uploads/wp-image-7.png"><img class="wp-image-70-extra" src="/letter.png">');
    expect(images.every(image => image.attachmentIds.length === 0)).toBe(true);
  });
});

describe("authoritative WordPress registered-size matching", () => {
  it.each([
    `<img class="wp-image-7" src="${original}" alt="Carta">`,
    `<img class="wp-image-7" src="${variant}" alt="Carta">`,
    '<img class="wp-image-7" src="/wp-content/uploads/registered-letter-crop.webp" alt="Carta">',
    '<img class="wp-image-7" src="../../wp-content/uploads/letter.png" alt="Carta">',
    '<img class="wp-image-7" src="data:image/png;base64,AAAA" data-src="/wp-content/uploads/registered-letter-crop.webp" alt="Carta">',
    '<img class="wp-image-7" data-lazy-src="/wp-content/uploads/letter.png" alt="Carta">',
    '<img class="wp-image-7" data-original="/wp-content/uploads/letter.png" alt="Carta">',
    '<img class="wp-image-7" srcset="/wp-content/uploads/registered-letter-crop.webp 300w, /wp-content/uploads/letter.png 1254w" alt="Carta">',
    '<img class="wp-image-7" data-srcset="/wp-content/uploads/registered-letter-crop.webp 1x, /wp-content/uploads/letter.png 2x" alt="Carta">',
    '<img class="wp-image-7" data-lazy-srcset="/wp-content/uploads/registered-letter-crop.webp 1x" alt="Carta">',
    '<picture><source srcset="/wp-content/uploads/registered-letter-crop.webp 1x"><img class="wp-image-7" src="/wp-content/uploads/letter.png" alt="Carta"></picture>',
  ])("matches exact registered URLs and attachment ID in %s", html => {
    const result = match(html);
    expect(result.status).toBe("matched");
    expect(result.matches).toHaveLength(1);
    expect(result.renderedUrls.length).toBeGreaterThan(0);
    expect(result.renderedUrls.every(url => catalog[0].sourceUrls.includes(url))).toBe(true);
  });

  it("retains the authoritative rendered variant, not a guessed original", () => {
    const result = match(`<img class="wp-image-7" src="${variant}" alt="">`);
    expect(result.renderedUrls).toEqual([variant]);
    expect(result.matches[0].alt).toBe("");
  });

  it("does not classify an empty or missing alt as a defect during identity matching", () => {
    expect(match(`<img class="wp-image-7" src="${original}" alt="">`).status).toBe("matched");
    const missing = match(`<img class="wp-image-7" src="${original}">`);
    expect(missing.status).toBe("matched");
    expect(missing.matches[0].alt).toBeNull();
  });

  it("allows duplicate size URLs belonging to the same media record", () => {
    const result = matchMediaImages(observeImages(`<img class="wp-image-7" src="${variant}" alt="">`), pageUrl,
      [{ mediaId: 7, sourceUrls: [original, variant, variant] }], 7);
    expect(result.status).toBe("matched");
    expect(result.renderedUrls).toEqual([variant]);
  });

  it("rejects a URL claimed by two different authoritative media IDs as ambiguous", () => {
    const result = matchMediaImages(observeImages(`<img class="wp-image-7" src="${variant}" alt="">`), pageUrl,
      [...catalog, { mediaId: 8, sourceUrls: [variant] }], 7);
    expect(result.status).toBe("ambiguous");
  });

  it.each([
    '<img class="wp-image-7" src="/wp-content/uploads/letter-300x300.png" alt="">',
    '<img class="wp-image-7" src="/wp-content/uploads/letter.png.unrelated" alt="">',
    '<img class="wp-image-7" src="/other/letter.png" alt="">',
    '<img class="wp-image-7" src="https://unrelated.example/wp-content/uploads/letter.png" alt="">',
    '<img class="wp-image-7" src="/wp-content/uploads/letter.png?new-version=1" alt="">',
    '<img class="wp-image-7" src="/wp-content/uploads/LETTER.png" alt="">',
  ])("does not accept filename resemblance, prefixes, another origin or changed query in %s", html => {
    expect(match(html).status).not.toBe("matched");
  });

  it("preserves exact query identity and decodes HTML-escaped source attributes", () => {
    const url = `${original}?version=2&size=full`;
    const result = matchMediaImages(observeImages(`<img class="wp-image-7" data-src="${original}?version=2&amp;size=full" alt="">`), pageUrl,
      [{ mediaId: 7, sourceUrls: [url] }], 7);
    expect(result.status).toBe("matched");
    expect(result.renderedUrls).toEqual([url]);
  });

  it.each([
    `<img src="${original}" alt="">`,
    `<img class="wp-image-8" src="${original}" alt="">`,
    `<img class="wp-image-7 wp-image-8" src="${original}" alt="">`,
    '<img class="wp-image-7" alt="">',
    '<img class="wp-image-7" src="data:image/png;base64,AAAA" alt="">',
  ])("requires both unambiguous attachment identity and an authoritative concrete source in %s", html => {
    expect(match(html).status).not.toBe("matched");
  });

  it.each([
    `<img class="wp-image-7" src="${original}" data-src="/unrelated.png" alt="">`,
    `<img class="wp-image-7" src="/unrelated.png" data-src="${original}" alt="">`,
    `<img class="wp-image-7" src="${original}" srcset="/unrelated.png 300w, ${variant} 600w" alt="">`,
    `<picture><source srcset="/unrelated.png 1x"><img class="wp-image-7" src="${original}" alt=""></picture>`,
  ])("rejects contradictory advertised sources rather than choosing a convenient match in %s", html => {
    expect(match(html).status).not.toBe("matched");
  });

  it.each([
    ["malformed descriptor", `<img class="wp-image-7" src="${original}" srcset="${variant} invalid" alt="">`],
    ["unsafe source", `<img class="wp-image-7" src="${original}" data-src="javascript:alert(1)" alt="">`],
    ["excessive candidates", `<img class="wp-image-7" src="${original}" srcset="${Array.from({ length: 21 }, () => `${variant} 1x`).join(",")}" alt="">`],
    ["oversized source list", `<img class="wp-image-7" src="${original}" data-srcset="${"x".repeat(8193)}" alt="">`],
  ])("fails closed on %s", (_label, html) => {
    expect(match(html).status).not.toBe("matched");
  });

  it("keeps each repeated placement so enrollment can reject conflicting observed alternatives", () => {
    const result = match(`<img class="wp-image-7" src="${original}" alt=""><img class="wp-image-7" src="${variant}" alt="Different value">`);
    expect(result.status).toBe("matched");
    expect(result.matches.map(image => image.alt)).toEqual(["", "Different value"]);
  });

  it("ignores a separate unrelated image rather than assigning it to the selected media", () => {
    const result = match(`<img class="wp-image-8" src="/unrelated.png" alt="Other"><img class="wp-image-7" src="${variant}" alt="">`);
    expect(result.status).toBe("matched");
    expect(result.matches).toHaveLength(1);
    expect(result.renderedUrls).toEqual([variant]);
  });

  it("returns absent when the requested authoritative media record is unavailable", () => {
    const result = matchMediaImages(observeImages(`<img class="wp-image-7" src="${original}" alt="">`), pageUrl, [], 7);
    expect(result.status).not.toBe("matched");
  });
});
