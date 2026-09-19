import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response.interceptor';
import { AppConfigModule } from './infrastructure/config/config.module';
import { CryptoModule } from './infrastructure/crypto/crypto.module';
import { EventsModule } from './infrastructure/events/events.module';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { AgentProvidersModule } from './modules/agent-providers/agent-providers.module';
import { AgentRunsModule } from './modules/agent-runs/agent-runs.module';
import { AgentsModule } from './modules/agents/agents.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { InboxModule } from './modules/inbox/inbox.module';
import { ArtifactsModule } from './modules/artifacts/artifacts.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { CostModule } from './modules/cost/cost.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { EpicsModule } from './modules/epics/epics.module';
import { FeaturesModule } from './modules/features/features.module';
import { GitModule } from './modules/git/git.module';
import { GitHubModule } from './modules/github/github.module';
import { HealthModule } from './modules/health/health.module';
import { MemoryModule } from './modules/memory/memory.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RepositoriesModule } from './modules/repositories/repositories.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TestsModule } from './modules/tests/tests.module';
import { UsageModule } from './modules/usage/usage.module';
import { UsersModule } from './modules/users/users.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';

@Module({
  imports: [
    // Infrastructure (all @Global)
    AppConfigModule,
    LoggerModule,
    PrismaModule,
    CryptoModule,
    EventsModule,
    QueueModule,
    AuthModule,
    AuditModule,
    NotificationsModule,

    // Domain modules
    UsersModule,
    OrganizationsModule,
    ProjectsModule,
    RepositoriesModule,
    EpicsModule,
    FeaturesModule,
    TasksModule,
    AgentsModule,
    AgentProvidersModule,
    AgentRunsModule,
    WorkflowsModule,
    GitModule,
    GitHubModule,
    TestsModule,
    ReviewsModule,
    SchedulesModule,
    MemoryModule,
    ArtifactsModule,
    UsageModule,
    CostModule,
    ApprovalsModule,
    InboxModule,
    WebhooksModule,
    DashboardModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
