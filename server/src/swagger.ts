import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('SEO Spy API')
    .setDescription('Local API. Use scope "demo" for simulated results, "homepage" for protected HTML checks, or "lighthouse" for HTML checks plus Google PageSpeed Insights lab measurements. Lighthouse supports mobile (default) and desktop strategy. Poll statusUrl; completed/partial/failed are terminal. Retrieve findings/evidence, recommendations, and the Lighthouse report. No Facebook, AI, or external writes.')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: false, defaultModelsExpandDepth: 1 },
    customSiteTitle: 'SEO Spy API docs',
  });
}
