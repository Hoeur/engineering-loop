import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { withRequestContext } from '../request-context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const headerRequestId = req.header('x-request-id');
    const headerTraceId = req.header('x-trace-id');
    const requestId = headerRequestId ?? randomUUID();
    const traceId = headerTraceId ?? requestId;

    res.setHeader('x-request-id', requestId);
    res.setHeader('x-trace-id', traceId);

    withRequestContext({ traceId, requestId, actorType: 'USER' }, () => {
      next();
    });
  }
}
