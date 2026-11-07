import type { AnyRouter } from "@tanstack/react-router";
import type { BoardInboxItem, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, type AtomRegistry } from "effect/reactivity";
import { InboxIcon } from "lucide-react";

import { getClientSettings, subscribeClientSettings } from "../../hooks/useSettings";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
} from "../../threadNotifications";
import { toastManager } from "../ui/toast";
import { INBOX_LABELS, boardInboxQuery, inboxKey } from "./boardInbox";

/** A burst bigger than this, such as a routine adding several to-dos, is announced once. */
const MAX_SEPARATE_ALERTS = 2;

/**
 * Announces each thing that newly waits on the person in the primary environment's companies,
 * with the same sounds, toasts, and desktop notifications threads use. App-lifetime.
 */
export function startBoardNotifications(
  registry: AtomRegistry.AtomRegistry,
  router: AnyRouter,
): () => void {
  let watching: EnvironmentId | null = null;
  let stopWatching = () => {};

  const open = (environmentId: EnvironmentId, item: BoardInboxItem | null) => {
    const environment =
      environmentId === registry.get(primaryEnvironmentIdAtom) ? {} : { environmentId };
    void router.navigate({
      to: "/board",
      search:
        item === null
          ? { ...environment, tab: "inbox" }
          : item.kind === "skill"
            ? { ...environment, tab: "inbox" }
            : item.taskId === null
              ? { ...environment, company: item.companyId, tab: "org" }
              : { ...environment, company: item.companyId, card: item.taskId, tab: "inbox" },
    });
  };

  const present = (environmentId: EnvironmentId, items: ReadonlyArray<BoardInboxItem>) => {
    const single = items.length === 1 ? items[0]! : null;
    const title =
      single === null ? `${items.length} things wait on you` : INBOX_LABELS[single.kind];
    const body =
      single === null
        ? items.map((item) => item.title).join(", ")
        : `${single.title} · ${single.companyName}`;
    const { notificationMode: mode, inAppNotificationsEnabled } = getClientSettings();
    if (hasNotificationSound(mode)) {
      void playNotificationSound("input", () =>
        hasNotificationSound(getClientSettings().notificationMode),
      );
    }
    const looking = document.visibilityState === "visible" && document.hasFocus();
    if (looking) {
      if (!inAppNotificationsEnabled) return;
      const toastId = toastManager.add({
        type: "info",
        title,
        description: body,
        data: {
          hideCopyButton: true,
          leadingIcon: <InboxIcon aria-hidden className="size-4 text-info-foreground" />,
        },
        actionProps: {
          children: single === null ? "Open inbox" : "Open",
          onClick: () => {
            toastManager.close(toastId);
            open(environmentId, single);
          },
        },
      });
      return;
    }
    if (
      !hasDesktopNotifications(mode) ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    )
      return;
    try {
      const notification = new Notification(title, {
        body,
        tag: single === null ? "board-inbox" : `board:${inboxKey(single)}`,
        silent: true,
      });
      notification.addEventListener("click", () => {
        notification.close();
        window.focus();
        void window.desktopBridge?.revealWindow().catch(() => undefined);
        open(environmentId, single);
      });
    } catch {
      // Some browsers expose Notification but reject desktop presentation.
    }
  };

  const watch = (environmentId: EnvironmentId) => {
    // Unset until the first inbox arrives: what already waited at startup is not news.
    let seen: ReadonlySet<string> | null = null;
    return registry.subscribe(
      boardInboxQuery(environmentId),
      (result) => {
        const inbox = AsyncResult.getOrElse(result, () => null)?.inbox;
        if (inbox === undefined) return;
        const keys = new Set(inbox.map(inboxKey));
        const fresh = seen === null ? [] : inbox.filter((item) => !seen!.has(inboxKey(item)));
        seen = keys;
        if (fresh.length === 0) return;
        if (fresh.length <= MAX_SEPARATE_ALERTS) {
          for (const item of fresh) present(environmentId, [item]);
        } else {
          present(environmentId, fresh);
        }
      },
      { immediate: true },
    );
  };

  const sync = () => {
    const { notificationMode, inAppNotificationsEnabled } = getClientSettings();
    const enabled = notificationMode !== "off" || inAppNotificationsEnabled;
    const next = enabled ? registry.get(primaryEnvironmentIdAtom) : null;
    if (next === watching) return;
    stopWatching();
    stopWatching = () => {};
    watching = next;
    if (next !== null) stopWatching = watch(next);
  };

  const unsubscribeSettings = subscribeClientSettings(sync);
  const unsubscribePrimary = registry.subscribe(primaryEnvironmentIdAtom, sync);
  sync();
  return () => {
    unsubscribeSettings();
    unsubscribePrimary();
    stopWatching();
  };
}
