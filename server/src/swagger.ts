import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('SEO Spy API')
    .setDescription('Local API. Use scope "demo" for simulated results or "homepage" for a real HTML audit of the registered business website. Poll statusUrl, then retrieve findings/evidence and recommendations. No Facebook, AI, or external changes.')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: false, defaultModelsExpandDepth: 1 },
    customSiteTitle: 'SEO Spy API docs',
  });
}
