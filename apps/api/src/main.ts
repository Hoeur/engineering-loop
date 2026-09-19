import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { getEnv } from '@engloop/config';
import { createLogger } from '@engloop/logger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const env = getEnv();
  const logger = createLogger({
    service: 'engloop-api',
    level: env.LOG_LEVEL,
    pretty: env.LOG_PRETTY,
  });

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
    // Structured pino logging replaces Nest's default console logger.
    logger: ['error', 'warn'],
  });

  app.setGlobalPrefix(env.API_GLOBAL_PREFIX);
  app.enableCors({
    origin: env.API_CORS_ORIGINS,
    credentials: true,
    exposedHeaders: ['x-request-id', 'x-trace-id'],
  });
  app.enableShutdownHooks();

  if (env.SWAGGER_ENABLED) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('EngLoop API')
        .setDescription(
          'Multi-agent engineering orchestration control plane. Every response uses the ' +
            '`{ success, data, meta }` / `{ success, error, meta }` envelope.',
        )
        .setVersion('0.1.0')
        .addBearerAuth()
        .addTag('tasks', 'Engineering tasks and the state machine')
        .addTag('workflows', 'Workflow definitions and runs')
        .addTag('agents', 'Agent configuration and role assignment')
        .addTag('github', 'GitHub App installation, discovery and repository import')
        .build(),
    );
    SwaggerModule.setup(`${env.API_GLOBAL_PREFIX}/docs`, app, document, {
      jsonDocumentUrl: `${env.API_GLOBAL_PREFIX}/docs-json`,
    });
  }

  await app.listen(env.API_PORT, env.API_HOST);

  logger.info(
    {
      port: env.API_PORT,
      host: env.API_HOST,
      prefix: env.API_GLOBAL_PREFIX,
      swagger: env.SWAGGER_ENABLED ? `/${env.API_GLOBAL_PREFIX}/docs` : 'disabled',
      // Logged because a browser reports a rejected origin only as an opaque
      // "Failed to fetch" — seeing the allowed list at boot saves the guesswork.
      corsOrigins: env.API_CORS_ORIGINS,
      agentProvider: env.AGENT_DEFAULT_PROVIDER,
    },
    'api.started',
  );
}

void bootstrap().catch((error: unknown) => {
  console.error('Failed to start EngLoop API', error);
  process.exit(1);
});
