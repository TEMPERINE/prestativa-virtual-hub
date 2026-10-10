import { createDesktopNotificationAdapter } from "./desktop-notification-adapter";
import { createWebNotificationAdapter } from "./web-notification-adapter";

export function createOfficeNotificationAdapter() {
  const desktop = typeof window !== "undefined" ? window.prestativaDesktop : undefined;
  return desktop?.isDesktop && desktop.notifications
    ? createDesktopNotificationAdapter(desktop.notifications)
    : createWebNotificationAdapter();
}
