import type { PresageMeasurement, PresageMeasurementAvailability, PresageMeasurementSnapshot } from "../components/PresageMeasurements";

export interface PresageStateSnapshot extends PresageMeasurementSnapshot {
  measurements: readonly PresageMeasurement[];
  connectionState: "connecting" | "connected" | "reconnecting" | "disconnected";
  qualityWarning?: { status: string; validationCode?: number };
}

export function createPresageLifecycleQueue(): { run<T>(operation: () => T | Promise<T>): Promise<T>; wait(): Promise<void> };
export function emptyPresageSnapshot(availability?: PresageMeasurementAvailability): PresageStateSnapshot;
export function prunePresageSnapshot(snapshot: PresageStateSnapshot, now?: number, maxAgeMs?: number): PresageStateSnapshot;
export function applyPresageEvent(previous: PresageStateSnapshot, event: unknown, sessionId: string, now?: number): PresageStateSnapshot;
export function snapshotForSession(stored: { sessionId: string | null; snapshot: PresageStateSnapshot } | null, sessionId: string | null, consentGranted: boolean): PresageStateSnapshot;
