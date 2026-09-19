import type { NotificationChannel, NotificationType, Severity } from '@engloop/types';

export interface NotificationPayload {
  organizationId: string;
  userId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  severity: Severity;
  payload: Record<string, unknown>;
}

/**
 * Channel abstraction (spec section 32). The MVP ships only the in-app channel;
 * email/Slack implement this interface when they land.
 */
export interface NotificationProvider {
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
  deliver(notification: NotificationPayload): Promise<void>;
}

export const NOTIFICATION_PROVIDERS = Symbol('NOTIFICATION_PROVIDERS');
