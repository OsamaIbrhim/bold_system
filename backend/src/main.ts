import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { randomUUID } from 'crypto';
import { ApiExceptionFilter } from './common/api-error.filter';
import compression from 'compression';
import { apiJsonReplacer } from './common/json-serialization';
import { validateRuntimeEnvironment } from './config/environment';
import { configureDatabaseConnection } from './config/database-connection';

async function bootstrap() {
  // Bound and normalize the Prisma pool before PrismaClient reads DATABASE_URL.
  configureDatabaseConnection();
  // Validate every security-critical setting before Nest constructs providers or
  // opens a database connection. Configuration errors must fail the deployment.
  const environment = validateRuntimeEnvironment();
  const app = await NestFactory.create(AppModule);
  // Keep BigInt handling inside the HTTP adapter. Sync cursors are explicitly
  // strings, while this protects future database counters from causing a 500.
  app.getHttpAdapter().getInstance().set('json replacer', apiJsonReplacer);
  app.setGlobalPrefix('api/v1');
  app.use(compression({ threshold: 1024 }));
  app.use((req: any, res: any, next: () => void) => {
    req.requestStartedAt = process.hrtime.bigint();
    const supplied = String(req.headers['x-request-id'] || '');
    req.requestId = /^[a-zA-Z0-9._-]{8,80}$/.test(supplied) ? supplied : randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({ origin: environment.corsOrigins, credentials: true });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  const config = new DocumentBuilder()
    .setTitle('Bold POS API')
    .setDescription('Multi-branch POS + Inventory – EGP, ar-EG')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(environment.port, '0.0.0.0');
  console.log(`Bold API running on port ${environment.port}`);
}
bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown startup failure';
  console.error(`Bold API failed to start: ${message}`);
  process.exitCode = 1;
});
