import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { randomUUID } from 'crypto';
import { ApiExceptionFilter } from './common/api-error.filter';
import * as compression from 'compression';
import { apiJsonReplacer } from './common/json-serialization';

async function bootstrap() {
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
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3001,http://localhost:5173,file://,null')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: allowedOrigins, credentials: false });
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

  await app.listen(process.env.PORT || 3000);
  console.log(`Bold API running on http://localhost:${process.env.PORT || 3000}`);
}
bootstrap();
