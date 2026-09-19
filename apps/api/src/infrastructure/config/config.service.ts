import { Injectable } from '@nestjs/common';
import { getEnv, type Env } from '@engloop/config';

@Injectable()
export class AppConfigService {
  readonly env: Env;

  constructor() {
    this.env = getEnv();
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }

  get redisConnection(): { host: string; port: number; password?: string } {
    return {
      host: this.env.REDIS_HOST,
      port: this.env.REDIS_PORT,
      ...(this.env.REDIS_PASSWORD ? { password: this.env.REDIS_PASSWORD } : {}),
    };
  }
}
