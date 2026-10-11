import { useEffect, useState } from "react";
export interface RouteLeg {
  key: string;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  chosen: string;
}
export interface RouteResult {
  available: boolean;
  reason?: string;
  points?: [number, number][];
  distance?: number;
  duration?: number;
  mode?: string;
  segments?: { points: [number, number][]; mode: string; label?: string; color?: string }[];
  connections?: { from: [number, number]; to: [number, number]; label: string }[];
  railSeconds?: number;
  railDistance?: number;
  source?: string;
  stations?: string[];
  lines?: string[];
  walkingUnavailable?: boolean;
}
const memory = new Map<string, RouteResult>();
export function useJourneyRoutes(tripId: number, legs: RouteLeg[]) {
  const signature = JSON.stringify(
    legs.map((l) => [
      l.key,
      l.from.lat,
      l.from.lng,
      l.to.lat,
      l.to.lng,
      l.chosen,
    ]),
  );
  const [state, setState] = useState<{
    signature: string;
    results: Record<string, RouteResult>;
  }>({ signature: "", results: {} });
  useEffect(() => {
    const controller = new AbortController();
    const results: Record<string, RouteResult> = {};
    setState({ signature, results: {} });
    // Sequential requests avoid a large itinerary exhausting the minute quota.
    (async () => {
      for (const leg of legs) {
        if (controller.signal.aborted) return;
        const body = {
          points: [
            [leg.from.lat, leg.from.lng],
            [leg.to.lat, leg.to.lng],
          ],
          mode: leg.chosen,
        };
        const key = JSON.stringify(body);
        let result = memory.get(key);
        if (!result) {
          try {
            const r = await fetch(`/api/journey/trips/${tripId}/routes`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal: controller.signal,
            });
            result = r.ok ? await r.json() : { available: false };
            if (result?.available && result.connections) {
              let seconds = result.railSeconds ?? 0, metres = result.railDistance ?? 0;
              for (const c of result.connections) {
                if (controller.signal.aborted) return;
                if (Math.abs(c.from[0]-c.to[0])+Math.abs(c.from[1]-c.to[1]) < 0.00001) continue;
                try {
                  const walkResponse = await fetch(`/api/journey/trips/${tripId}/routes`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ points: [c.from,c.to], mode: 'walk' }), signal: controller.signal,
                  });
                  const walk: RouteResult = walkResponse.ok ? await walkResponse.json() : { available: false };
                  if (walk.available && walk.points) {
                    result.segments!.push({ points: walk.points, mode: 'walk', label: c.label });
                    seconds += walk.duration ?? 0; metres += walk.distance ?? 0;
                  } else { result.walkingUnavailable = true; }
                } catch { result.walkingUnavailable = true; }
              }
              if (!result.walkingUnavailable) { result.duration = seconds; result.distance = metres; }
            }
            if (result?.available) {
              if (memory.size > 200) memory.clear();
              memory.set(key, result);
            }
          } catch {
            result = { available: false };
          }
        }
        if (!controller.signal.aborted) {
          results[leg.key] = result!;
          setState({ signature, results: { ...results } });
        }
      }
    })();
    return () => controller.abort();
  }, [tripId, signature]);
  return state.signature === signature ? state.results : {};
}

export function routeFailureMessage(result: RouteResult, labels: {
  routeSetup: string; routeAuth: string; routeQuota: string; unavailable: string; transitCoverage: string;
}) {
  if (result.reason === 'transit_coverage') return labels.transitCoverage;
  if (result.reason === 'unconfigured') return labels.routeSetup;
  if (result.reason === 'credentials') return labels.routeAuth;
  if (result.reason === 'quota') return labels.routeQuota;
  return labels.unavailable;
}

export function routeSegments(result: RouteResult | undefined, mode: string) {
  if (!result?.available) return [];
  return result.segments ?? (result.points ? [{ points: result.points, mode }] : []);
}
