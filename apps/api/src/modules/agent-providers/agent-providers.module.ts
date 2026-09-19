import { Module } from '@nestjs/common';
import { AgentProvidersController } from './agent-providers.controller';
import { AgentProvidersService } from './agent-providers.service';

@Module({
  controllers: [AgentProvidersController],
  providers: [AgentProvidersService],
  exports: [AgentProvidersService],
})
export class AgentProvidersModule {}
