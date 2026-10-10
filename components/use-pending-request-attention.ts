"use client";

import { useEffect, useState, type RefObject } from "react";
import { DUTY_REMINDER_INTERVAL_MS, type PendingDutySnapshot } from "@/lib/pending-request-attention";

export function usePendingRequestAttention({ snapshot, rootRef, buttonRef, rippleRef }: {
  snapshot: PendingDutySnapshot | null;
  rootRef: RefObject<HTMLDivElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  rippleRef: RefObject<HTMLDivElement | null>;
}) {
  const count = snapshot?.requests.length || 0;
  const userId = snapshot?.userId || "";
  const requestKey = snapshot?.requests.map((request) => request.id).sort().join(",") || "";
  const [reminderVisible, setReminderVisible] = useState(false);

  useEffect(() => {
    if (!count) return;
    let frame = 0;
    const locate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const source = buttonRef.current?.getBoundingClientRect();
        const layer = rippleRef.current;
        if (!source || !layer) return;
        layer.style.setProperty("--request-source-x", `${source.left + source.width / 2}px`);
        layer.style.setProperty("--request-source-y", `${source.top + source.height / 2}px`);
        layer.style.setProperty("--request-wave-scale", `${Math.ceil(Math.hypot(window.innerWidth,window.innerHeight) / 16)}`);
      });
    };
    const observer = new ResizeObserver(locate);
    if (buttonRef.current) observer.observe(buttonRef.current);
    if (rootRef.current) observer.observe(rootRef.current);
    window.addEventListener("resize", locate);
    window.addEventListener("scroll", locate, { passive: true, capture: true });
    locate();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize",locate); window.removeEventListener("scroll",locate,true); };
  }, [count, buttonRef, rippleRef, rootRef]);

  useEffect(() => {
    if (!count) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const originalTitle = document.title;
    let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const createdIcon = !favicon;
    if (!favicon) { favicon = document.createElement("link"); favicon.rel = "icon"; document.head.append(favicon); }
    const originalIcon = favicon.getAttribute("href");
    let yellow = true;
    const markTab = () => {
      const color = yellow || motion.matches ? "#ffe000" : "#26e67b";
      document.title = motion.matches || yellow ? `🟡 ${count} pedido(s) aguardando você | Mappa` : `🟢 Analisar solicitações (${count}) | Mappa`;
      favicon.href = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${color}"/><path d="M16 7v12m0 4v2" stroke="#142015" stroke-width="4" stroke-linecap="round"/></svg>`)}`;
      yellow = !yellow;
    };
    markTab();
    const titleTimer = window.setInterval(markTab, 2600);
    let hideTimer = 0;
    let shake: Animation | undefined;
    const remind = (notifyBrowser: boolean) => {
      setReminderVisible(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setReminderVisible(false), 8000);
      const editing = document.activeElement?.matches("input,textarea,select,[contenteditable='true']");
      const dialog = document.querySelector("[role='dialog'],[role='alertdialog'],dialog[open]");
      if (!motion.matches && !editing && !dialog && document.visibilityState === "visible") {
        shake?.cancel();
        shake = rootRef.current?.animate?.([
          { transform: "translate(0,0)" }, { transform: "translate(-2px,1px)" },
          { transform: "translate(2px,-1px)" }, { transform: "translate(-2px,-1px)" },
          { transform: "translate(2px,1px)" }, { transform: "translate(0,0)" },
        ], { duration: 600, iterations: 1 });
      }
      if (notifyBrowser && "Notification" in window && Notification.permission === "granted" && "serviceWorker" in navigator) {
        // Coordinate browser reminders across tabs. This does not contact the server.
        const key = `mappa-duty-reminder-${userId}`;
        try {
          const previous = Number(localStorage.getItem(key)) || 0;
          if (Date.now() - previous < DUTY_REMINDER_INTERVAL_MS - 5000) return;
          localStorage.setItem(key,String(Date.now()));
        } catch { /* The in-app reminder still works without storage. */ }
        void navigator.serviceWorker.getRegistration().then((registration) => registration?.showNotification("Solicitações aguardando sua resposta", {
          body: `${count} pedido(s) sob sua responsabilidade ainda aguardam análise.`, icon: "/icon.svg",
          tag: `responsibility-reminder-${userId}`, data: { url: "/?tab=requests" },
        })).catch(() => { /* Browser denial never suppresses in-app reminders. */ });
      }
    };
    const first = window.setTimeout(() => remind(false), 0);
    const reminderTimer = window.setInterval(() => remind(true), DUTY_REMINDER_INTERVAL_MS);
    return () => {
      window.clearTimeout(first); window.clearTimeout(hideTimer);
      window.clearInterval(titleTimer); window.clearInterval(reminderTimer); shake?.cancel();
      document.title = originalTitle;
      if (createdIcon) favicon.remove();
      else if (originalIcon === null) favicon.removeAttribute("href");
      else favicon.setAttribute("href",originalIcon);
    };
  }, [count, requestKey, userId, rootRef]);
  return count > 0 && reminderVisible;
}
