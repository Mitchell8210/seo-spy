// Read-only preparation for one explicitly requested image-alt edit. No proposal or Apply.
import "reflect-metadata";
import process from "node:process";
import console from "node:console";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { load } from "cheerio";

process.env.LOG_LEVEL = "silent";
process.env.WORDPRESS_WRITES_ENABLED = "false";
process.env.AI_ENABLED = "false";
const { AppModule } = await import("../dist/app.module.js");
const { WordPressClient } = await import("../dist/integrations/wordpress/wordpress.client.js");
const { WebsiteCollector, WebsiteDns, WebsiteTransport } = await import("../dist/integrations/website/collector.js");
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  const config = app.get(ConfigService);
  const businessId = config.getOrThrow("WORDPRESS_BUSINESS_ID");
  const siteUrl = config.getOrThrow("WORDPRESS_SITE_URL");
  const connection = { businessId, siteUrl, username: config.getOrThrow("WORDPRESS_USERNAME"), applicationPassword: config.getOrThrow("WORDPRESS_APPLICATION_PASSWORD") };
  const collector = new WebsiteCollector(new WebsiteDns(), new WebsiteTransport());
  const page = await collector.collect(siteUrl);
  const $ = load(page.body);
  const images = $("img").toArray().slice(0, 30).map(img => ({ src: $(img).attr("src") ?? null, alt: $(img).attr("alt") ?? null, class: $(img).attr("class") ?? null }));
  const media = await app.get(WordPressClient).request(connection, "GET", "/wp-json/wp/v2/media?context=edit&per_page=10&_fields=id,parent,title,alt_text,source_url,modified_gmt");
  console.log(JSON.stringify({ businessId, pageUrl: page.finalUrl, images, media }, null, 2));
} catch {
  console.error("Read-only image inspection failed; no changes were requested.");
  process.exitCode = 1;
} finally { await app.close(); }
