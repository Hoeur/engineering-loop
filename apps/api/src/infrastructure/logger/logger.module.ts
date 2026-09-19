import { Global, Module } from '@nestjs/common';
import { createLogger, type EngLoopLogger } from '@engloop/logger';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/config.service';
import { LOGGER } from './logger.tokens';

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: LOGGER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): EngLoopLogger =>
        createLogger({
          service: 'engloop-api',
          level: config.env.LOG_LEVEL,
          pretty: config.env.LOG_PRETTY,
        }),
    },
  ],
  exports: [LOGGER],
})
export class LoggerModule {}
