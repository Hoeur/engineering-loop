import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Inject, Injectable } from '@nestjs/common';
import type { DomainEvent, DomainEventName, DomainEventOf, ExecutionContext } from '@engloop/types';
import type { EngLoopLogger } from '@engloop/logger';
import { LOGGER } from '../logger/logger.tokens';
import { getRequestContext } from '../../common/request-context';

type Handler = (event: DomainEvent) => void | Promise<void>;

/**
 * Typed in-process event bus (spec section 19).
 *
 * Deliberately in-process for the MVP: it decouples modules without adding a
 * broker. The publish signature already carries everything a durable transport
 * would need, so swapping in Redis streams or NATS is a one-file change.
 */
@Injectable()
export class EventBus {
  private readonly emitter = new EventEmitter({ captureRejections: true });

  constructor(@Inject(LOGGER) private readonly logger: EngLoopLogger) {
    this.emitter.setMaxListeners(100);
    this.emitter.on('error', (error: unknown) => {
      this.logger.error({ error: String(error) }, 'event.handler.failed');
    });
  }

  publish<TName extends DomainEventName>(
    name: TName,
    payload: DomainEventOf<TName>['payload'],
    context?: Partial<ExecutionContext>,
  ): DomainEventOf<TName> {
    const event = {
      id: randomUUID(),
      name,
      occurredAt: new Date().toISOString(),
      context: { ...getRequestContext(), ...context },
      payload,
    } as DomainEventOf<TName>;

    this.logger.withContext(event.context).debug({ event: name }, 'event.published');
    this.emitter.emit(name, event);
    this.emitter.emit('*', event);
    return event;
  }

  on<TName extends DomainEventName>(
    name: TName,
    handler: (event: DomainEventOf<TName>) => void | Promise<void>,
  ): () => void {
    this.emitter.on(name, handler as Handler);
    return () => this.emitter.off(name, handler as Handler);
  }

  onAny(handler: Handler): () => void {
    this.emitter.on('*', handler);
    return () => this.emitter.off('*', handler);
  }
}
