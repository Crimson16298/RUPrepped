import { createPresageCompanionClient, type PresageCompanionEvent, type PresageCompanionStatus } from "@ruprepped/presage-companion-client";
import { useEffect, useRef, useState } from "react";
import type { PresageMeasurement, PresageMeasurementSnapshot } from "../components/PresageMeasurements";

interface UsePresageCompanionOptions {
  /** Only a real, active FastAPI session may be associated with the companion. */
  sessionId: string | null;
  consentGranted: boolean;
}

const unavailableSnapshot: PresageMeasurementSnapshot = { availability: "unavailable" };
const notRequestedSnapshot: PresageMeasurementSnapshot = { availability: "not-requested" };

function snapshotForStatus(status: PresageCompanionStatus, measurements: readonly PresageMeasurement[] = []): PresageMeasurementSnapshot {
  if (status === "awaiting_consent") return notRequestedSnapshot;
  if (status === "starting" || status === "warming_up") return { availability: "warming-up" };
  if (status === "measuring" && measurements.length > 0) {
    return { availability: "available", measurements, source: "presage-smartspectra" };
  }
  return unavailableSnapshot;
}

function acceptedMeasurements(event: PresageCompanionEvent): PresageMeasurement[] | null {
  if (event.type !== "measurement" || event.quality.validationCode !== 0 || !event.quality.stable || event.quality.confidence < 70) {
    return null;
  }

  const measurements: PresageMeasurement[] = [];
  for (const metric of event.metrics) {
    if (!Number.isFinite(metric.value) || metric.confidence < 70 || !metric.stable || !Number.isFinite(Date.parse(metric.measuredAt))) continue;
    measurements.push({
      metric: metric.metric,
      value: metric.value,
      confidence: metric.confidence,
      stable: metric.stable,
      measuredAt: metric.measuredAt,
    });
  }

  return measurements.length > 0 ? measurements : null;
}

/**
 * Browser-side lifecycle for Person 3's loopback companion. The companion owns
 * camera access; this hook receives only consented, summary-only SSE events.
 */
export function usePresageCompanion({ sessionId, consentGranted }: UsePresageCompanionOptions): PresageMeasurementSnapshot {
  const [snapshot, setSnapshot] = useState<PresageMeasurementSnapshot>(
    consentGranted ? unavailableSnapshot : notRequestedSnapshot,
  );
  const stopQueueRef = useRef<Promise<void>>(Promise.resolve());

  const enabled = import.meta.env.VITE_PRESAGE_COMPANION_ENABLED === "true";
  const capabilityToken = import.meta.env.VITE_PRESAGE_COMPANION_TOKEN;
  const baseUrl = import.meta.env.VITE_PRESAGE_COMPANION_BASE_URL;

  useEffect(() => {
    if (!consentGranted) {
      setSnapshot(notRequestedSnapshot);
      return;
    }
    if (!sessionId || !enabled || !capabilityToken) {
      setSnapshot(unavailableSnapshot);
      return;
    }

    let active = true;
    const controller = new AbortController();
    const previousStop = stopQueueRef.current;
    let client: ReturnType<typeof createPresageCompanionClient> | null = null;
    let companionStarted = false;

    const startAndSubscribe = (async () => {
      await previousStop;
      if (!active) return false;

      try {
        client = createPresageCompanionClient({
          ...(baseUrl ? { baseUrl } : {}),
          capabilityToken,
        });
        const started = await client.start(sessionId);
        companionStarted = started.accepted;
        if (!active) return started.accepted;
        setSnapshot(snapshotForStatus(started.status === "session_active_elsewhere" ? "unavailable" : started.status));
        if (!started.accepted) return false;

        await client.subscribe(sessionId, {
          signal: controller.signal,
          onEvent(event) {
            if (!active || event.sessionId !== sessionId) return;
            if (event.type === "measurement") {
              const measurements = acceptedMeasurements(event);
              setSnapshot(measurements
                ? { availability: "available", measurements, source: "presage-smartspectra" }
                : unavailableSnapshot);
              return;
            }
            setSnapshot((current) => snapshotForStatus(event.status, current.measurements));
          },
        });

        if (active) {
          await client.stop(sessionId).catch(() => undefined);
          setSnapshot(unavailableSnapshot);
        }
        return true;
      } catch {
        if (active) {
          if (companionStarted && client) await client.stop(sessionId).catch(() => undefined);
          setSnapshot(unavailableSnapshot);
        }
        return false;
      }
    })();

    return () => {
      active = false;
      controller.abort();
      setSnapshot(unavailableSnapshot);
      const stop = (async () => {
        await startAndSubscribe;
        if (companionStarted && client) await client.stop(sessionId).catch(() => undefined);
      })();
      stopQueueRef.current = stop;
    };
  }, [baseUrl, capabilityToken, consentGranted, enabled, sessionId]);

  return snapshot;
}
