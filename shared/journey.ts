// Deliberately small DTOs: never serialize operational booking/expense records.
export interface JourneyStop {
  id: string;
  sourceId?: number;
  day: string;
  title: string;
  start_time: string;
  end_time: string;
  location_name: string;
  lat: number | null;
  lng: number | null;
  notes: string;
  mode: "walk" | "drive" | "transit";
  done: boolean;
}
export interface JourneyDay {
  day: string;
  title: string;
  start_name: string;
  start_lat: number | null;
  start_lng: number | null;
  end_name: string;
  end_lat: number | null;
  end_lng: number | null;
}
export interface Journey {
  stops: JourneyStop[];
  days: JourneyDay[];
}
export interface PublicJourney {
  title: string;
  destination: string;
  updatedAt: string;
  days: Array<{
    label: string;
    title: string;
    notes: string[];
    stops: Array<{
      title: string;
      time: string;
      endTime: string;
      location: string;
      mode: string;
      duration: string;
    }>;
  }>;
}
export const textValue = (v: unknown, max = 500): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
export const coordinate = (v: unknown, limit: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit
    ? v
    : null;
export const validDay = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const time = (v: unknown) =>
  typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : "";
export function cleanJourney(value: any): Journey {
  if (
    !value ||
    !Array.isArray(value.stops) ||
    !Array.isArray(value.days) ||
    value.stops.length > 500 ||
    value.days.length > 366
  )
    throw new Error("invalid_plan");
  const ids = new Set<string>();
  const stops = value.stops.map((a: any): JourneyStop => {
    if (
      !validDay(a.day) ||
      !textValue(a.title, 200) ||
      !textValue(a.id, 100) ||
      ids.has(a.id)
    )
      throw new Error("invalid_plan");
    ids.add(a.id);
    return {
      id: textValue(a.id, 100),
      ...(Number.isSafeInteger(a.sourceId) && a.sourceId > 0
        ? { sourceId: a.sourceId }
        : {}),
      day: a.day,
      title: textValue(a.title, 200),
      start_time: time(a.start_time),
      end_time: time(a.end_time),
      location_name: textValue(a.location_name, 300),
      lat: coordinate(a.lat, 90),
      lng: coordinate(a.lng, 180),
      notes: textValue(a.notes, 2000),
      mode: a.mode === "drive" || a.mode === "transit" ? a.mode : "walk",
      done: !!a.done,
    };
  });
  const days = value.days.map((d: any): JourneyDay => {
    if (d.day !== "*" && !validDay(d.day)) throw new Error("invalid_plan");
    return {
      day: d.day,
      title: textValue(d.title, 200),
      start_name: textValue(d.start_name, 300),
      start_lat: coordinate(d.start_lat, 90),
      start_lng: coordinate(d.start_lng, 180),
      end_name: textValue(d.end_name, 300),
      end_lat: coordinate(d.end_lat, 90),
      end_lng: coordinate(d.end_lng, 180),
    };
  });
  return { stops, days };
}
export function copyGroupStops(
  personal: Journey,
  group: Journey,
  selected: number[],
): Journey {
  const stops = [...personal.stops];
  for (const a of group.stops.filter(
    (a) => a.sourceId && selected.includes(a.sourceId),
  )) {
    const i = stops.findIndex((s) => s.sourceId === a.sourceId);
    const copy = {
      ...a,
      id: i < 0 ? crypto.randomUUID() : stops[i].id,
      done: false,
    };
    if (i < 0) stops.push(copy);
    else stops[i] = copy;
  }
  return { ...personal, stops };
}
export function publicJourney(
  title: string,
  destination: string,
  plan: Journey,
  notes: any[],
  guide: boolean,
): PublicJourney {
  const dates = [
    ...new Set([
      ...plan.stops.map((a) => a.day),
      ...plan.days.filter((d) => d.day !== "*").map((d) => d.day),
      ...notes.filter((n) => validDay(n.day)).map((n) => n.day),
    ]),
  ].sort();
  const duration = (a: JourneyStop) => {
    if (!a.start_time || !a.end_time) return "";
    const mins = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
    const n = mins(a.end_time) - mins(a.start_time);
    return n >= 0 ? String(n) : "";
  };
  return {
    title: textValue(title, 200),
    destination: textValue(destination, 300),
    updatedAt: new Date().toISOString(),
    days: dates.map((day, i) => ({
      label: guide ? String(i + 1) : day,
      title: plan.days.find((d) => d.day === day)?.title ?? "",
      notes: notes
        .filter((n) => n.day === day || n.day === "*")
        .map((n) => textValue(n.content, 2000)),
      stops: plan.stops
        .filter((a) => a.day === day)
        .map((a) => ({
          title: a.title,
          time: a.start_time,
          endTime: a.end_time,
          location: a.location_name,
          mode: a.mode,
          duration: duration(a),
        })),
    })),
  };
}
// Republish only these fields, even when a client submits extra properties.
export function cleanPublicJourney(value: any): PublicJourney {
  if (
    !value ||
    !textValue(value.title, 200) ||
    !Array.isArray(value.days) ||
    value.days.length > 366
  )
    throw new Error("invalid_guide");
  let count = 0;
  return {
    title: textValue(value.title, 200),
    destination: textValue(value.destination, 300),
    updatedAt: new Date().toISOString(),
    days: value.days.map((d: any, i: number) => {
      if (
        !Array.isArray(d.stops) ||
        (count += d.stops.length) > 500 ||
        !Array.isArray(d.notes) ||
        d.notes.length > 100
      )
        throw new Error("invalid_guide");
      return {
        label: String(i + 1),
        title: textValue(d.title, 200),
        notes: d.notes.map((n: unknown) => textValue(n, 2000)),
        stops: d.stops.map((s: any) => ({
          title: textValue(s.title, 200),
          time: time(s.time),
          endTime: time(s.endTime),
          location: textValue(s.location, 300),
          mode: ["drive", "transit"].includes(s.mode) ? s.mode : "walk",
          duration: /^\d{1,4}$/.test(s.duration) ? String(s.duration) : "",
        })),
      };
    }),
  };
}
export function directionsUrl(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mode: string,
) {
  const travelmode =
    mode === "walk"
      ? "walking"
      : ["drive", "car", "taxi"].includes(mode)
        ? "driving"
        : "transit";
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", origin: `${from.lat},${from.lng}`, destination: `${to.lat},${to.lng}`, travelmode })}`;
}
