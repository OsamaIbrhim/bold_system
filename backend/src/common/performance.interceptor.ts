import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize, tap } from 'rxjs/operators';

@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();
    // The early middleware timestamp includes JWT/role guards and their
    // database work; starting here would hide authorization pool contention.
    const started = request.requestStartedAt || process.hrtime.bigint();
    return next.handle().pipe(
      tap(() => {
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
        if (!response.headersSent) response.setHeader('server-timing', `app;dur=${elapsedMs.toFixed(1)}`);
      }),
      finalize(() => {
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
        const threshold = Number(process.env.SLOW_REQUEST_MS || 500);
        const line = `${request.method} ${request.originalUrl} ${response.statusCode} ${elapsedMs.toFixed(1)}ms [${request.requestId || '-'}]`;
        if (elapsedMs >= threshold) this.logger.warn(`SLOW ${line}`);
        else if (process.env.HTTP_TIMING_LOGS === 'true') this.logger.log(line);
      }),
    );
  }
}
