import { Module } from '@nestjs/common';
import { GitController } from './git.controller';
import { GitApiService } from './git.service';

@Module({
  controllers: [GitController],
  providers: [GitApiService],
  exports: [GitApiService],
})
export class GitModule {}
