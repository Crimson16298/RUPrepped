import { createPresageCompanionClient, type PresageCompanionEvent, type PresageCompanionStatus } from "@ruprepped/presage-companion-client";
import { useEffect, useRef, useState } from "react";
import type { PresageMeasurementSnapshot } from "../components/PresageMeasurements";
import { applyPresageEvent, createPresageLifecycleQueue, emptyPresageSnapshot, prunePresageSnapshot, snapshotForSession, type PresageStateSnapshot } from "./presageMeasurementState.mjs";
import { createPresageOwnerStopper, createPresageOwnerToken, registerPresagePageLifecycle, registerPresageVisibilityHeartbeat } from "./presageLifecycle.mjs";

interface UsePresageCompanionOptions {
  /** Only a real, active FastAPI session may be associated with the companion. */
  sessionId: string | null;
  consentGranted: boolean;
}

interface StoredSnapshot {
  sessionId: string | null;
  snapshot: PresageStateSnapshot;
}

const retryDelay = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  if (signal.aborted) { resolve(); return; }
  const timer = window.setTimeout(done, milliseconds);
  function done() {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", done);
    resolve();
  }
  signal.addEventListener("abort", done, { once: true });
});

function statusEvent(status: PresageCompanionStatus, sessionId: string): PresageCompanionEvent {
  return { schemaVersion: "1.0.0", emittedAt: new Date().toISOString(), type: "status", sessionId, status };
}

/**
 * Browser-side lifecycle for Person 3's loopback companion. Only fresh,
 * consented summary readings enter this state; camera frames never do.
 */
export function usePresageCompanion({ sessionId, consentGranted }: UsePresageCompanionOptions): PresageMeasurementSnapshot {
  const [stored, setStored] = useState<StoredSnapshot | null>(null);
  const lifecycleQueueRef = useRef(createPresageLifecycleQueue());

  const enabled = import.meta.env.VITE_PRESAGE_COMPANION_ENABLED === "true";
  const capabilityToken = import.meta.env.VITE_PRESAGE_COMPANION_TOKEN;
  const baseUrl = import.meta.env.VITE_PRESAGE_COMPANION_BASE_URL;
  const visibleSnapshot = snapshotForSession(stored, sessionId, consentGranted);

  useEffect(() => {
    if (!consentGranted || !sessionId) return;
    const timer = window.setInterval(() => {
      setStored((current) => current?.sessionId === sessionId
        ? { sessionId, snapshot: prunePresageSnapshot(current.snapshot) }
        : current);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [consentGranted, sessionId]);

  useEffect(() => {
    if (!consentGranted || !sessionId || !enabled || !capabilityToken) {
      if (sessionId) {
        const availability = consentGranted ? "unavailable" : "not-requested";
        setStored({ sessionId, snapshot: emptyPresageSnapshot(availability) });
      }
      return;
    }

    let active = true;
    const controller = new AbortController();
    let client: ReturnType<typeof createPresageCompanionClient> | null = null;
    const ownerToken = createPresageOwnerToken();
    let companionStarted = false;
    let ownerStopper: ReturnType<typeof createPresageOwnerStopper> | null = null;
    let retryCount = 0;
    let validationTimer: number | undefined;
    let heartbeatTimer: number | undefined;

    if (!ownerToken) {
      setStored({ sessionId, snapshot: emptyPresageSnapshot("unavailable") });
      return;
    }

    const stopCompanion = async () => {
      if (!ownerStopper) return false;
      if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      return ownerStopper.stop();
    };
    const sendHeartbeat = () => {
      if (!active || !companionStarted || !client) return;
      void client.heartbeat(sessionId, ownerToken).catch(() => {
        // The server lease is the bounded fallback if heartbeat transport is lost.
      });
    };

    const reportLifecycleFailure = (failure: { operation: string; errorClass: string }) => {
      // Deliberately log only the operation and a whitelisted error class, never request data.
      console.warn("Presage lifecycle request failed", failure);
    };

    const updateSnapshot = (event: PresageCompanionEvent) => {
      if (!active || event.sessionId !== sessionId) return;
      setStored((current) => {
        const base = current?.sessionId === sessionId
          ? current.snapshot
          : emptyPresageSnapshot("warming-up");
        return { sessionId, snapshot: applyPresageEvent(base, event, sessionId) };
      });
    };
    const setConnection = (connectionState: PresageStateSnapshot["connectionState"]) => {
      if (!active) return;
      setStored((current) => {
        const base = current?.sessionId === sessionId ? current.snapshot : emptyPresageSnapshot("warming-up");
        return { sessionId, snapshot: { ...base, connectionState } };
      });
    };

    const startAndSubscribe = lifecycleQueueRef.current.run(async () => {
      if (!active) return;
      client = createPresageCompanionClient({
        ...(baseUrl ? { baseUrl } : {}),
        capabilityToken,
      });
      ownerStopper = createPresageOwnerStopper(client, sessionId, ownerToken, reportLifecycleFailure);

      try {
        let started = false;
        for (let attempt = 0; attempt < 8 && active; attempt += 1) {
          setConnection(attempt === 0 ? "connecting" : "reconnecting");
          try {
            const result = await client.start(sessionId, ownerToken, { signal: controller.signal });
            if (result.accepted) {
              companionStarted = true;
              started = true;
              updateSnapshot(statusEvent(result.status === "session_active_elsewhere" ? "unavailable" : result.status, sessionId));
              heartbeatTimer = window.setInterval(sendHeartbeat, 4_000);
              break;
            }
            if (result.status !== "session_active_elsewhere") {
              updateSnapshot(statusEvent(result.status, sessionId));
              return;
            }
          } catch {
            // Loopback services may restart independently; retry without exposing request details.
          }
          await retryDelay(Math.min(400 * (attempt + 1), 2_000), controller.signal);
        }
        if (!started) {
          if (active) setStored({ sessionId, snapshot: emptyPresageSnapshot("unavailable") });
          return;
        }
        if (!active) return;
      } catch {
        if (active) setStored({ sessionId, snapshot: emptyPresageSnapshot("unavailable") });
      }
    });

    const subscribeToEvents = async () => {
      if (!client || !companionStarted) return;
      while (active && retryCount < 12) {
          try {
            setConnection(retryCount === 0 ? "connecting" : "reconnecting");
            await client.subscribe(sessionId, {
              signal: controller.signal,
              onConnected() { retryCount = 0; setConnection("connected"); },
              onEvent(event) {
                if (event && typeof event === "object" && "sessionId" in event && event.sessionId === sessionId) {
                  if (event.type === "status" && Number.isInteger(event.validationCode) && event.status !== "stopped") {
                    if (validationTimer !== undefined) window.clearTimeout(validationTimer);
                    validationTimer = window.setTimeout(() => {
                      validationTimer = undefined;
                      updateSnapshot(event as PresageCompanionEvent);
                    }, 450);
                    return;
                  }
                  if (event.type === "measurement" && validationTimer !== undefined) {
                    window.clearTimeout(validationTimer);
                    validationTimer = undefined;
                  }
                  updateSnapshot(event as PresageCompanionEvent);
                }
              },
            });
            if (!active || controller.signal.aborted) break;
            throw new Error("companion_stream_ended");
          } catch {
            if (!active || controller.signal.aborted) break;
            retryCount += 1;
            setConnection("reconnecting");
            try {
              const current = await client.status();
              if (current.status === "stopped" || current.status === "awaiting_consent") {
                const restarted = await client.start(sessionId, ownerToken, { signal: controller.signal });
                companionStarted ||= restarted.accepted;
                if (restarted.accepted) {
                  const status = restarted.status === "session_active_elsewhere" ? "unavailable" : restarted.status;
                  updateSnapshot(statusEvent(status, sessionId));
                }
              }
            } catch {
              // Retry the authenticated loopback connection without logging request details.
            }
            await retryDelay(Math.min(300 * 2 ** Math.min(retryCount, 4), 5_000), controller.signal);
          }
      }
      if (validationTimer !== undefined) window.clearTimeout(validationTimer);
      if (active && retryCount >= 12) {
        setStored({ sessionId, snapshot: emptyPresageSnapshot("unavailable") });
      }
    };
    void startAndSubscribe.then(() => subscribeToEvents());
    const removeVisibilityHeartbeat = registerPresageVisibilityHeartbeat(document, sendHeartbeat);

    const onTeardown = () => {
      active = false;
      controller.abort();
      if (validationTimer !== undefined) window.clearTimeout(validationTimer);
      if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
      void stopCompanion();
    };
    const removePageLifecycle = registerPresagePageLifecycle(window, onTeardown);

    return () => {
      removeVisibilityHeartbeat();
      removePageLifecycle();
      // Send the session-scoped stop immediately; queue a retry after any in-flight start
      // settles so StrictMode cleanup cannot race a later start request.
      void lifecycleQueueRef.current.run(async () => {
        await startAndSubscribe;
        await stopCompanion();
      });
    };
  }, [baseUrl, capabilityToken, consentGranted, enabled, sessionId]);

  return visibleSnapshot;
}
