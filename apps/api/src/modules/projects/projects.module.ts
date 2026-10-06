import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectPhasesController } from './project-phases.controller';
import { ProjectPhasesService } from './project-phases.service';
import { ProjectContractController } from './project-contract.controller';
import { ProjectContractService } from './project-contract.service';
import { ProjectPhaseDependenciesService } from './project-phase-dependencies.service';

@Module({
  imports: [TasksModule],
  controllers: [ProjectsController, ProjectPhasesController, ProjectContractController],
  providers: [
    ProjectsService,
    ProjectPhasesService,
    ProjectContractService,
    ProjectPhaseDependenciesService,
  ],
  exports: [ProjectsService],
})
export class ProjectsModule {}
