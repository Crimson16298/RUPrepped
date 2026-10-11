import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("sidebar displays genuine readings and keeps transient quality guidance alongside them", async () => {
  const vite = await createServer({ configFile: "./vite.config.ts", server: { middlewareMode: true, hmr: false }, appType: "custom" });
  try {
    const { PresageMeasurements } = await vite.ssrLoadModule("/src/components/PresageMeasurements.tsx");
    const markup = renderToStaticMarkup(React.createElement(PresageMeasurements, {
      availability: "available",
      source: "presage-smartspectra",
      connectionState: "connected",
      measurements: [{ metric: "pulseRate", value: 71, confidence: 90, stable: true, measuredAt: new Date().toISOString() }],
      qualityWarning: { status: "quality_insufficient", validationCode: 7 },
    }));
    assert.match(markup, /Consented camera context/);
    assert.match(markup, /Pulse rate/);
    assert.match(markup, /upper chest is not visible/);
    assert.match(markup, /upper chest is visible/);
    assert.match(markup, /Authenticated camera event stream connected/);
  } finally {
    await vite.close();
  }
});

test("sidebar withholds stale values instead of rendering them", async () => {
  const vite = await createServer({ configFile: "./vite.config.ts", server: { middlewareMode: true, hmr: false }, appType: "custom" });
  try {
    const { PresageMeasurements } = await vite.ssrLoadModule("/src/components/PresageMeasurements.tsx");
    const markup = renderToStaticMarkup(React.createElement(PresageMeasurements, {
      availability: "available",
      measurements: [{ metric: "pulseRate", value: 71, measuredAt: "2020-01-01T00:00:00.000Z" }],
    }));
    assert.match(markup, /No current valid measurement/);
    assert.doesNotMatch(markup, /Pulse rate/);
  } finally {
    await vite.close();
  }
});
