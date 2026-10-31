import { requestIdFor, sessionOf } from '../auth/guard';
import {
  listNotifications as listForUser,
  markAllNotificationsRead,
  markNotificationRead,
  parseNotificationQuery,
} from '../core/events/notifications';
import type { Writer } from '../core/db/writer';

export function listNotifications(writer: Writer, request: Request) {
  const user = sessionOf(request);
  return listForUser(writer, user.id, parseNotificationQuery(new URL(request.url)));
}

export function readNotification(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  return markNotificationRead(writer, user.id, requestIdFor(request), id);
}

export function readAllNotifications(writer: Writer, request: Request) {
  const user = sessionOf(request);
  return markAllNotificationsRead(writer, user.id, requestIdFor(request));
}
