import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export function configureSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle("SEO Spy API")
    .setDescription(
      'Local API. Website scopes: demo, homepage, lighthouse. Facebook supports local OAuth/report creation and saved analysis. WordPress supports immutable evidence, exact proposals and public media-alt verification. Muse defaults to labeled mocks and cached reads. Every real model request requires a separate AI administrator approval of an exact cost estimate and a durable SQLite reservation; development caps are $2 cumulative, $0.50 UTC-daily, ten calls, one active request, one per minute and 1500 output tokens. Demo limits require separate administrator authorization. WordPress changes have independent approval/write gates. No model call runs from a saved read or startup.',
    )
    .setVersion("0.2.0")
    .addBearerAuth({ type: "http", scheme: "bearer", description: "Private WORDPRESS_OPERATOR_KEY for local operator endpoints only; never send the WordPress application password here." })
    .build();
  SwaggerModule.setup(
    "api/docs",
    app,
    () => SwaggerModule.createDocument(app, config),
    {
      jsonDocumentUrl: "api/docs-json",
      swaggerOptions: {
        persistAuthorization: false,
        defaultModelsExpandDepth: 1,
      },
      customSiteTitle: "SEO Spy API docs",
    },
  );
}
