/** GeoJSON uses longitude first; Leaflet uses latitude first. Never invent geometry. */
export function geoapifyTransit(data: any) {
  const feature = data?.features?.[0];
  const geometry = feature?.geometry;
  const lines = geometry?.type === 'MultiLineString' ? geometry.coordinates
    : geometry?.type === 'LineString' ? [geometry.coordinates] : [];
  if (!Array.isArray(lines) || !lines.length || lines.length > 100) throw new Error('geometry');
  const segments = lines.map((line: any) => {
    if (!Array.isArray(line) || line.length < 2 || line.length > 30000) throw new Error('geometry');
    const points: [number, number][] = line.map((p: any) => {
      if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) throw new Error('geometry');
      return [p[1], p[0]];
    });
    return { points, mode: 'transit', label: 'Approximate transit route' };
  });
  const duration = feature.properties?.time;
  const distance = feature.properties?.distance;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(distance) || distance < 0) throw new Error('summary');
  return { segments, duration, distance, approximate: true };
}

export function googleTransitEmbed(key: string, points: number[][]) {
  const url = new URL('https://www.google.com/maps/embed/v1/directions');
  url.search = new URLSearchParams({ key, origin: points[0].join(','), destination: points[1].join(','), mode: 'transit', language: 'en' }).toString();
  return url.toString();
}
