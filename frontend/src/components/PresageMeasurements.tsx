import { CameraOff, CircleAlert, LoaderCircle, ShieldCheck } from "lucide-react";

export type PresageMeasurementAvailability =
  | "not-requested"
  | "permission-denied"
  | "unavailable"
  | "warming-up"
  | "available";

/**
 * The only metric names and units currently emitted by Person 3's Presage
 * proof of concept. RMSSD deliberately has no unit because the installed SDK
 * declaration does not define one.
 */
export type PresageMetric = "breathingRate" | "pulseRate" | "hrvRmssd";
export type PresageMeasurementSource = "presage-smartspectra";

export interface PresageMeasurement {
  metric: PresageMetric;
  value: number;
  /** ISO-8601 observation time supplied by the approved integration. */
  measuredAt: string;
  confidence?: number;
  stable?: boolean;
}

/**
 * Normalized, summary-only input for a future approved Presage transport.
 * The transport must never contain camera frames or change interview scoring.
 */
export interface PresageMeasurementSnapshot {
  availability: PresageMeasurementAvailability;
  measurements?: readonly PresageMeasurement[];
  source?: PresageMeasurementSource;
}

export interface PresageMeasurementsProps extends PresageMeasurementSnapshot {
  /** Values older than this are withheld instead of displayed as current. */
  staleAfterMs?: number;
  className?: string;
}

const metricMetadata: Record<PresageMetric, { label: string; unit?: string }> = {
  breathingRate: { label: "Breathing rate", unit: "breaths/min" },
  pulseRate: { label: "Pulse rate", unit: "bpm" },
  hrvRmssd: { label: "HRV (RMSSD)" },
};

const statusCopy: Record<Exclude<PresageMeasurementAvailability, "available">, { title: string; detail: string }> = {
  "not-requested": {
    title: "Camera context not requested",
    detail: "Camera measurements are optional. Your text interview can continue without them.",
  },
  "permission-denied": {
    title: "Camera access was not granted",
    detail: "No measurements are collected. You can continue with the text interview.",
  },
  unavailable: {
    title: "Camera measurements unavailable",
    detail: "No valid camera measurement is available for this session.",
  },
  "warming-up": {
    title: "Camera signal warming up",
    detail: "Measurements appear only after the approved integration provides a valid reading.",
  },
};

function isCurrentMeasurement(measurement: PresageMeasurement, staleAfterMs: number): boolean {
  const timestamp = Date.parse(measurement.measuredAt);
  return Number.isFinite(measurement.value)
    && Number.isFinite(timestamp)
    && timestamp <= Date.now()
    && Date.now() - timestamp <= staleAfterMs;
}

function formatValue(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

/**
 * Presentation-only boundary for consented Presage readings. It does not
 * request camera access, infer a mental state, or influence interview scoring.
 */
export function PresageMeasurements({
  availability,
  measurements = [],
  source,
  staleAfterMs = 30_000,
  className,
}: PresageMeasurementsProps) {
  const safeStaleAfterMs = Number.isFinite(staleAfterMs) && staleAfterMs >= 0 ? staleAfterMs : 30_000;
  const currentMeasurements = availability === "available"
    ? measurements.filter((measurement) => isCurrentMeasurement(measurement, safeStaleAfterMs))
    : [];
  const stateClass = `presage-measurements--${availability}`;

  if (availability !== "available") {
    const copy = statusCopy[availability];
    const Icon = availability === "warming-up" ? LoaderCircle : availability === "permission-denied" ? CircleAlert : CameraOff;
    return (
      <section className={`presage-measurements ${stateClass} ${className ?? ""}`.trim()} aria-label="Camera measurement status">
        <Icon aria-hidden="true" size={17} className={availability === "warming-up" ? "presage-measurements__spinner" : undefined} />
        <div>
          <strong>{copy.title}</strong>
          <p>{copy.detail}</p>
        </div>
      </section>
    );
  }

  if (!currentMeasurements.length) {
    return (
      <section className={`presage-measurements ${stateClass} ${className ?? ""}`.trim()} aria-label="Camera measurement status">
        <CameraOff aria-hidden="true" size={17} />
        <div>
          <strong>No current valid measurement</strong>
          <p>Readings that are missing, invalid, or stale are not displayed.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`presage-measurements ${stateClass} ${className ?? ""}`.trim()} aria-label="Consented Presage measurements">
      <div className="presage-measurements__heading">
        <ShieldCheck aria-hidden="true" size={17} />
        <div>
          <strong>Consented camera context</strong>
          <p>Sensor readings only. They do not represent a diagnosis or change Gemini feedback.</p>
        </div>
      </div>
      <dl className="presage-measurements__values">
        {currentMeasurements.map((measurement) => {
          const metadata = metricMetadata[measurement.metric];
          return (
            <div key={`${measurement.metric}-${measurement.measuredAt}`}>
              <dt>{metadata.label}</dt>
              <dd>
                {formatValue(measurement.value)}{metadata.unit ? ` ${metadata.unit}` : ""}
              </dd>
            </div>
          );
        })}
      </dl>
      {source === "presage-smartspectra" && <small className="presage-measurements__source">Source: Presage SmartSpectra</small>}
    </section>
  );
}
