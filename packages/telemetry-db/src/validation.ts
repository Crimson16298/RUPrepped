import type { Json } from './types.js';
export class TelemetryValidationError extends Error { constructor(message: string) { super(message); this.name = 'TelemetryValidationError'; } }
export function required(value: unknown, name: string): asserts value { if (typeof value !== 'string' || !value.trim()) throw new TelemetryValidationError(`${name} is required.`); }
export function timestamp(value: string, name: string): void { required(value, name); if (!Number.isFinite(Date.parse(value))) throw new TelemetryValidationError(`${name} must be an ISO timestamp.`); }
export function finite(value: number, name: string, min?: number, max?: number): void { if (!Number.isFinite(value) || (min !== undefined && value < min) || (max !== undefined && value > max)) throw new TelemetryValidationError(`${name} is out of range.`); }
export function json(value: Json, name: string): void { try { if (JSON.stringify(value) === undefined) throw new Error('undefined'); } catch { throw new TelemetryValidationError(`${name} must be serializable JSON.`); } }
