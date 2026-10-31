import { Module } from "@nestjs/common";
import { WebsiteCollector, WebsiteDns, WebsiteTransport } from "./collector.js";

// Audit and action verification share the same bounded collector capacity.
@Module({ providers: [WebsiteCollector, WebsiteDns, WebsiteTransport], exports: [WebsiteCollector, WebsiteDns, WebsiteTransport] })
export class WebsiteCollectionModule {}
