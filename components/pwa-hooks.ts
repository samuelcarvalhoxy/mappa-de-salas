"use client";

import { useCallback, useEffect, useRef, useState } from "react";

async function postApi(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

export function useInstallPrompt() {
  const [prompt, setPrompt] = useState<
    (Event & { prompt?: () => Promise<void> }) | null
  >(null);
  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setPrompt(event as Event & { prompt: () => Promise<void> });
    };
    window.addEventListener("beforeinstallprompt", handler);
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => null);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  return {
    available: Boolean(prompt),
    install: async () => {
      await prompt?.prompt?.();
      setPrompt(null);
    },
  };
}

function urlBase64ToUint8Array(value: string) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = window.atob(padded);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export function usePushNotifications(
  publicKey: string,
  onError: (message: string) => void,
) {
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported",
  );
  const [status, setStatus] = useState<
    "idle" | "syncing" | "active" | "error"
  >("idle");
  const syncing = useRef(false);
  const syncSubscription = useCallback(
    async (sendTest = false, silent = false, forceNew = false) => {
      if (syncing.current) return false;
      syncing.current = true;
      setStatus("syncing");
      try {
        if (!publicKey)
          throw new Error("A chave pública de notificações não está disponível.");
        if (!("serviceWorker" in navigator) || !("PushManager" in window))
          throw new Error("Este navegador não oferece notificações push.");
        await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",
        });
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        const expectedKey = urlBase64ToUint8Array(publicKey);
        if (subscription && !forceNew) {
          const currentKey = subscription.options.applicationServerKey;
          const currentBytes = currentKey ? new Uint8Array(currentKey) : null;
          const sameKey =
            currentBytes?.length === expectedKey.length &&
            currentBytes.every((value, index) => value === expectedKey[index]);
          if (!sameKey) {
            await subscription.unsubscribe();
            subscription = null;
          }
        }
        if (subscription && forceNew) {
          await subscription.unsubscribe();
          subscription = null;
        }
        subscription =
          subscription ||
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: expectedKey,
          }));
        await postApi("/api/push", {
          action: "subscribe",
          subscription: subscription.toJSON(),
        });
        setStatus("active");
        if (sendTest) await postApi("/api/push", { action: "test" });
        return true;
      } catch (error) {
        setStatus("error");
        if (!silent)
          onError(
            error instanceof Error
              ? error.message
              : "Não foi possível ativar notificações.",
          );
        return false;
      } finally {
        syncing.current = false;
      }
    },
    [onError, publicKey],
  );

  useEffect(() => {
    if (permission !== "granted" || !publicKey) return;
    const timer = window.setTimeout(() => {
      void syncSubscription(false, true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [permission, publicKey, syncSubscription]);

  const enable = async () => {
    try {
      if (
        !("Notification" in window) ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      )
        throw new Error("Este navegador não oferece notificações push.");
      const next = await Notification.requestPermission();
      setPermission(next);
      if (next !== "granted")
        throw new Error("A permissão de notificações não foi concedida.");
      return await syncSubscription(true, false, status === "error");
    } catch (error) {
      setStatus("error");
      onError(
        error instanceof Error
          ? error.message
          : "Não foi possível ativar notificações.",
      );
      return false;
    }
  };

  const test = async () => {
    const synchronized = await syncSubscription(false);
    if (!synchronized) return false;
    try {
      await postApi("/api/push", { action: "test" });
      return true;
    } catch (error) {
      const repaired = await syncSubscription(true, false, true);
      if (repaired) return true;
      setStatus("error");
      onError(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar a notificação de teste.",
      );
      return false;
    }
  };

  return { permission, status, enable, test };
}

