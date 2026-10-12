import { tokyoRailRoute } from "./lib/tokyo-rail";
import { geoapifyTransit, googleTransitEmbed } from './lib/geoapify-transit';
import { normalizeTransitOptions } from './lib/transit-provider';
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import type { Env } from "./env.d";
import {
  getSessionUser,
  hashPassword,
  hashToken,
  randomToken,
  clearCookie,
  type SessionUser,
} from "./lib/auth";
import { ensureJourneySchema } from "./lib/journey-schema";
import {
  cleanJourney,
  cleanPublicJourney,
  copyGroupStops,
  coordinate,
  publicJourney,
  textValue,
  validDay,
  type Journey,
} from "../shared/journey";
import { daysBetween } from "../shared/days";

type Bindings = { Bindings: Env; Variables: { user: SessionUser } };
export const journey = new Hono<Bindings>();
const error = (c: any, code: string, status = 400) =>
  c.json({ error: code }, status);
const schemas = new WeakMap<D1Database, Promise<boolean>>();
journey.use("*", bodyLimit({ maxSize: 500000 }));
journey.use("*", async (c, next) => {
  let schemaReady = schemas.get(c.env.DB);
  if (!schemaReady) {
    schemaReady = ensureJourneySchema(c.env).catch((e) => {
      schemas.delete(c.env.DB);
      throw e;
    });
    schemas.set(c.env.DB, schemaReady);
  }
  if (!(await schemaReady)) schemas.delete(c.env.DB);
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  if (c.req.path.includes("/guest/"))
    c.header("X-Robots-Tag", "noindex, nofollow");
  return next();
});

/** Atomic bounded counter, shared across Worker isolates. */
export async function consumeLimit(
  env: Env,
  key: string,
  max: number,
  seconds: number,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const r = await env.DB.prepare(
    `INSERT INTO journey_limits(key,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END
    WHERE expires_at<=? OR count<? RETURNING count`,
  )
    .bind(key, now + seconds, now, now, now, max)
    .first();
  return !!r;
}
const cap = (v: string | undefined, fallback: number) =>
  Math.max(1, Math.min(fallback, Number(v) || fallback));

journey.get("/recovery/status", (c) =>
  c.json({
    available: !!(
      c.env.RESEND_API_KEY &&
      c.env.RESET_EMAIL_FROM &&
      c.env.APP_ORIGIN
    ),
  }),
);
journey.post("/recovery/request", async (c) => {
  if (!c.env.RESEND_API_KEY || !c.env.RESET_EMAIL_FROM || !c.env.APP_ORIGIN)
    return error(c, "recovery_unavailable", 503);
  const body = await c.req.json<any>();
  const email = textValue(body.email, 254).toLowerCase();
  if (!email.includes("@")) return error(c, "invalid_email");
  const ip = await hashToken(c.req.header("CF-Connecting-IP") ?? "local");
  const address = await hashToken(email);
  if (
    !(await consumeLimit(c.env, `reset-ip:${ip}`, 10, 3600)) ||
    !(await consumeLimit(c.env, `reset-email:${address}`, 3, 3600))
  )
    return error(c, "rate_limited", 429);
  const user = await c.env.DB.prepare(
    "SELECT id FROM users WHERE email=? AND disabled=0",
  )
    .bind(email)
    .first<any>();
  // Same response for an unknown email, exhausted delivery allowance, or a
  // provider rejection. The copy promises no delivery and offers a retry path.
  if (
    user &&
    (await consumeLimit(
      c.env,
      `mail:${new Date().toISOString().slice(0, 10)}`,
      cap(c.env.RESEND_DAILY_LIMIT, 90),
      86400,
    )) &&
    (await consumeLimit(
      c.env,
      `mail-month:${new Date().toISOString().slice(0, 7)}`,
      2800,
      32 * 86400,
    ))
  ) {
    const token = randomToken(),
      digest = await hashToken(token),
      now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      "INSERT INTO password_resets(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)",
    )
      .bind(digest, user.id, now + 1800, now)
      .run();
    const url = new URL("/reset-password", c.env.APP_ORIGIN);
    url.hash = token; // token stays out of HTTP logs and referrers
    try {
      const result = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: c.env.RESET_EMAIL_FROM,
          to: [email],
          subject:
            "Jelajah — reset your password / tetapkan semula kata laluan",
          text: `Reset your password within 30 minutes. Abaikan jika anda tidak meminta ini.\n\n${url}\n\nIf you did not request this, ignore this email.`,
        }),
      });
      if (!result.ok) throw new Error("delivery_failed");
    } catch {
      await c.env.DB.prepare("DELETE FROM password_resets WHERE token_hash=?")
        .bind(digest)
        .run();
      console.warn("Jelajah recovery delivery failed"); // never log addresses/tokens
    }
  }
  return c.json({ ok: true });
});
journey.post("/recovery/reset", async (c) => {
  const b = await c.req.json<any>();
  if (
    typeof b.password !== "string" ||
    b.password.length < 8 ||
    b.password.length > 256 ||
    !/^[a-f0-9]{64}$/.test(b.token)
  )
    return error(c, "invalid_reset");
  const ip = await hashToken(c.req.header("CF-Connecting-IP") ?? "local");
  if (!(await consumeLimit(c.env, `reset-consume:${ip}`, 20, 3600)))
    return error(c, "rate_limited", 429);
  const digest = await hashToken(b.token),
    claim = randomToken(),
    now = Math.floor(Date.now() / 1000);
  const { hash, salt } = await hashPassword(b.password);
  // One transaction: claim, conditional password write, revoke all credentials,
  // invalidate sibling reset links. A competing request cannot reuse the claim.
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE password_resets SET claimed=? WHERE token_hash=? AND claimed IS NULL AND expires_at>?
      AND EXISTS(SELECT 1 FROM users WHERE id=password_resets.user_id AND disabled=0)`,
    ).bind(claim, digest, now),
    c.env.DB.prepare(
      "UPDATE users SET password_hash=?,salt=?,must_change_password=0 WHERE id=(SELECT user_id FROM password_resets WHERE token_hash=? AND claimed=?)",
    ).bind(hash, salt, digest, claim),
    c.env.DB.prepare(
      "DELETE FROM sessions WHERE user_id=(SELECT user_id FROM password_resets WHERE token_hash=? AND claimed=?)",
    ).bind(digest, claim),
    c.env.DB.prepare(
      "UPDATE api_tokens SET revoked=1 WHERE user_id=(SELECT user_id FROM password_resets WHERE token_hash=? AND claimed=?)",
    ).bind(digest, claim),
    c.env.DB.prepare(
      "DELETE FROM password_resets WHERE user_id=(SELECT user_id FROM password_resets WHERE token_hash=? AND claimed=?)",
    ).bind(digest, claim),
  ]);
  if (!results[0].meta.changes) return error(c, "invalid_reset");
  c.header("Set-Cookie", clearCookie());
  return c.json({ ok: true });
});

export async function groupJourney(env: Env, tripId: number): Promise<Journey> {
  const [a, d, legs] = await Promise.all([
    env.DB.prepare(
      "SELECT * FROM activities WHERE trip_id=? ORDER BY day,sort,start_time,id",
    )
      .bind(tripId)
      .all<any>(),
    env.DB.prepare("SELECT * FROM day_settings WHERE trip_id=?")
      .bind(tripId)
      .all<any>(),
    env.DB.prepare("SELECT day,leg_key,mode FROM leg_overrides WHERE trip_id=?")
      .bind(tripId)
      .all<any>(),
  ]);
  const trip = await env.DB.prepare(
    "SELECT start_date,end_date FROM trips WHERE id=?",
  )
    .bind(tripId)
    .first<any>();
  const days = [...d.results];
  if (
    validDay(trip?.start_date) &&
    validDay(trip?.end_date) &&
    trip.start_date <= trip.end_date &&
    (Date.parse(trip.end_date) - Date.parse(trip.start_date)) / 86400000 < 366
  ) {
    for (const day of daysBetween(trip.start_date, trip.end_date))
      if (!days.some((d) => d.day === day)) days.push({ day });
  }
  const stops: any[] = a.results.map((a) => {
    const mode = legs.results.find(
      (l) => l.day === a.day && l.leg_key.startsWith(`act:${a.id}->`),
    )?.mode;
    return {
      ...a,
      id: `group-${a.id}`,
      sourceId: a.id,
      mode: ["car", "drive", "taxi"].includes(mode)
        ? "drive"
        : mode === "walk"
          ? "walk"
          : "transit",
    };
  });
  // Copy the schedule represented by bookings, never the booking/expense rows.
  // No payer, traveller, confirmation number, cost or document identifier leaves
  // this projection. Event IDs are re-keyed when making a personal copy.
  const bookings = await env.DB.prepare(
    `SELECT e.id,e.category,e.expense_date,e.end_date,e.location,e.vendor,e.lat,e.lng,d.parsed_json,d.booking_no
    FROM expenses e LEFT JOIN documents d ON d.id=e.document_id WHERE e.trip_id=? AND e.category IN ('flight','accommodation') AND COALESCE(json_extract(CASE WHEN json_valid(e.meta_json) THEN e.meta_json ELSE '{}' END, '$.source_document_removed'),0) = 0`,
  )
    .bind(tripId)
    .all<any>();
  const itineraryDocs = await env.DB.prepare(
    "SELECT booking_no,parsed_json FROM documents WHERE trip_id=? AND doc_type='itinerary' AND booking_no IS NOT NULL",
  )
    .bind(tripId)
    .all<any>();
  const parse = (value: string | null) => {
    try {
      return JSON.parse(value || "{}");
    } catch {
      return {};
    }
  };
  for (const b of bookings.results) {
    const parsed = parse(b.parsed_json);
    const add = (
      suffix: string,
      day: string,
      title: string,
      start_time: string,
      location_name: string,
      lat: number | null = null,
      lng: number | null = null,
      end_time = "",
    ) => {
      if (validDay(day))
        stops.push({
          id: `booking-${b.id}-${suffix}`,
          day,
          title,
          start_time,
          end_time,
          location_name,
          lat,
          lng,
          notes: "",
          mode: "transit",
          done: false,
        });
    };
    if (b.category === "flight") {
      const companion = itineraryDocs.results.find(
        (d) => d.booking_no === b.booking_no,
      );
      const enriched = companion
        ? parse(companion.parsed_json).legs
        : undefined;
      const legs =
        Array.isArray(enriched) && enriched.length
          ? enriched
          : Array.isArray(parsed.legs)
            ? parsed.legs
            : [];
      if (legs.length)
        legs.forEach((leg: any, i: number) =>
          add(
            `flight-${i}`,
            leg.date,
            `✈ ${textValue(leg.from, 100)} → ${textValue(leg.to, 100)} ${textValue(leg.flightNo, 30)}`,
            leg.depTime || "",
            leg.depPlace || "",
            null,
            null,
            leg.arrTime || "",
          ),
        );
      else
        add(
          "flight",
          b.expense_date,
          `✈ ${textValue(b.vendor, 100)}`,
          "",
          "",
          null,
          null,
        );
    } else {
      const place = textValue(b.location || parsed.location || b.vendor, 300);
      add(
        "checkin",
        b.expense_date,
        `↘ 🏨 ${place}`,
        parsed.checkInTime || "",
        place,
        b.lat,
        b.lng,
      );
      add(
        "checkout",
        b.end_date,
        `↗ 🏨 ${place}`,
        parsed.checkOutTime || "",
        place,
        b.lat,
        b.lng,
      );
    }
  }
  // Preserve manual activity order; position generated booking events by time.
  const ordered: any[] = [];
  for (const day of [...new Set(stops.map((s) => s.day))].sort()) {
    const manual = stops.filter((s) => s.day === day && s.sourceId),
      automatic = stops.filter((s) => s.day === day && !s.sourceId);
    let last = -1;
    const minutes = (s: string) =>
      /^\d{2}:\d{2}$/.test(s)
        ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3))
        : null;
    const rows = manual.map((s, i) => {
      const m = minutes(s.start_time);
      last = m ?? last + 0.001;
      return { s, time: last, order: i };
    });
    rows.push(
      ...automatic.map((s, i) => ({
        s,
        time: minutes(s.start_time) ?? 1441,
        order: manual.length + i,
      })),
    );
    rows.sort((x, y) => x.time - y.time || x.order - y.order);
    ordered.push(...rows.map((r) => r.s));
  }
  return cleanJourney({ stops: ordered, days });
}
async function selectedNotes(env: Env, tripId: number, ids: number[]) {
  const rows = await env.DB.prepare(
    "SELECT id,day,content FROM day_notes WHERE trip_id=? ORDER BY day,sort,id",
  )
    .bind(tripId)
    .all<any>();
  return rows.results.filter((n) => ids.includes(n.id));
}
journey.get("/guest/:token", async (c) => {
  const link = await c.env.DB.prepare(
    `SELECT l.*,t.name,t.destination FROM guest_links l JOIN trips t ON t.id=l.trip_id
    WHERE token_hash=? AND revoked=0 AND (expires_at IS NULL OR expires_at>?)`,
  )
    .bind(await hashToken(c.req.param("token")), Date.now())
    .first<any>();
  if (!link) return error(c, "not_found", 404);
  return c.json(
    publicJourney(
      link.name,
      link.destination,
      await groupJourney(c.env, link.trip_id),
      await selectedNotes(c.env, link.trip_id, JSON.parse(link.note_ids)),
      false,
    ),
  );
});
journey.get("/guides", async (c) => {
  const q = textValue(c.req.query("q"), 100),
    duration = Number(c.req.query("duration") || 0);
  const page = Math.max(0, Math.min(1000, Number(c.req.query("page")) || 0));
  const rows = await c.env.DB.prepare(
    `SELECT g.id,g.title,g.destination,g.duration,g.updated_at FROM journey_guides g JOIN trips t ON t.id=g.trip_id
    WHERE published IS NOT NULL AND taken_down=0 AND (instr(lower(g.title),lower(?))>0 OR instr(lower(g.destination),lower(?))>0)
    AND (?=0 OR g.duration<=?) ORDER BY g.updated_at DESC,g.id LIMIT 24 OFFSET ?`,
  )
    .bind(q, q, duration, duration, page * 24)
    .all();
  return c.json({ items: rows.results });
});
journey.get("/guides/:id", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT published FROM journey_guides g JOIN trips t ON t.id=g.trip_id WHERE g.id=? AND published IS NOT NULL AND taken_down=0",
  )
    .bind(c.req.param("id"))
    .first<any>();
  return row ? c.json(JSON.parse(row.published)) : error(c, "not_found", 404);
});

// All routes below require an authenticated session; public routes above expose
// only explicit projections, never the legacy /plan response.
journey.use("*", async (c, next) => {
  const user = await getSessionUser(c.env, getCookie(c, "sid"));
  if (!user) return error(c, "unauthorized", 401);
  c.set("user", user);
  if (c.req.method !== "GET") {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin)
      return error(c, "forbidden", 403);
    const length = Number(c.req.header("Content-Length") || 0);
    if (length > 500000) return error(c, "too_large", 413);
  }
  return next();
});

export async function journeyRole(
  env: Env,
  user: SessionUser,
  tripId: number,
): Promise<string | null> {
  const trip = await env.DB.prepare(
    "SELECT hidden_features FROM trips WHERE id=?",
  )
    .bind(tripId)
    .first<any>();
  if (!trip) return null;
  const membership = await env.DB.prepare(
    "SELECT role FROM trip_members WHERE trip_id=? AND participant_id=?",
  )
    .bind(tripId, user.participant_id)
    .first<any>();
  const role = user.role === "admin" ? "leader" : membership?.role;
  if (
    !role ||
    (role !== "leader" &&
      JSON.parse(trip.hidden_features || "[]").includes("plan"))
  )
    return null;
  return role;
}
async function personalAccess(c: any, id: number, write = false) {
  const plan = await c.env.DB.prepare(
    "SELECT i.*,u.name AS owner_name,u.disabled,u.participant_id FROM itineraries i JOIN users u ON u.id=i.owner_id WHERE i.id=?",
  )
    .bind(id)
    .first();
  if (
    !plan ||
    plan.disabled ||
    !(await journeyRole(c.env, c.get("user"), plan.trip_id))
  )
    return null;
  // The owner must still belong to the trip. Admin owners follow existing
  // platform-administration semantics; being an admin never grants others' plans.
  const owner = await c.env.DB.prepare("SELECT * FROM users WHERE id=?")
    .bind(plan.owner_id)
    .first();
  if (!(await journeyRole(c.env, owner, plan.trip_id))) return null;
  if (plan.owner_id === c.get("user").id) return plan;
  if (write) return null;
  return (await c.env.DB.prepare(
    "SELECT 1 FROM itinerary_viewers WHERE itinerary_id=? AND user_id=?",
  )
    .bind(id, c.get("user").id)
    .first())
    ? plan
    : null;
}
journey.get("/trips/:id/plans", async (c) => {
  const id = Number(c.req.param("id")),
    user = c.get("user");
  if (!(await journeyRole(c.env, user, id))) return error(c, "forbidden", 403);
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO itineraries(trip_id) VALUES (?)",
  )
    .bind(id)
    .run();
  const candidates = await c.env.DB.prepare(
    `SELECT i.id,i.owner_id,u.name AS owner_name FROM itineraries i JOIN users u ON u.id=i.owner_id
    WHERE i.trip_id=? AND (i.owner_id=? OR EXISTS(SELECT 1 FROM itinerary_viewers v WHERE v.itinerary_id=i.id AND v.user_id=?))`,
  )
    .bind(id, user.id, user.id)
    .all<any>();
  const plans = [];
  for (const p of candidates.results)
    if (await personalAccess(c, p.id)) plans.push(p);
  return c.json({ plans });
});
journey.get("/trips/:id/group", async (c) => {
  const id = Number(c.req.param("id"));
  if (!(await journeyRole(c.env, c.get("user"), id)))
    return error(c, "forbidden", 403);
  return c.json(await groupJourney(c.env, id));
});
journey.post("/trips/:id/clone", async (c) => {
  const id = Number(c.req.param("id"));
  if (!(await journeyRole(c.env, c.get("user"), id)))
    return error(c, "forbidden", 403);
  const group = await groupJourney(c.env, id);
  group.stops = group.stops.map((a) => ({
    ...a,
    id: crypto.randomUUID(),
    done: false,
  }));
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO itineraries(trip_id,owner_id,content) VALUES (?,?,?)",
  )
    .bind(id, c.get("user").id, JSON.stringify(group))
    .run();
  return c.json(
    await c.env.DB.prepare(
      "SELECT id FROM itineraries WHERE trip_id=? AND owner_id=?",
    )
      .bind(id, c.get("user").id)
      .first(),
  );
});
journey.get("/plans/:id", async (c) => {
  const p = await personalAccess(c, Number(c.req.param("id")));
  return p
    ? c.json({
        id: p.id,
        owner_id: p.owner_id,
        owner_name: p.owner_name,
        version: p.version,
        content: JSON.parse(p.content),
      })
    : error(c, "not_found", 404);
});
journey.put("/plans/:id", async (c) => {
  const p = await personalAccess(c, Number(c.req.param("id")), true);
  if (!p) return error(c, "not_found", 404);
  const b = await c.req.json<any>();
  let content: Journey;
  try {
    content = cleanJourney(b.content);
  } catch {
    return error(c, "invalid_plan");
  }
  const r = await c.env.DB.prepare(
    "UPDATE itineraries SET content=?,version=version+1,updated_at=datetime('now') WHERE id=? AND version=?",
  )
    .bind(JSON.stringify(content), p.id, Number(b.version))
    .run();
  return r.meta.changes
    ? c.json({ version: p.version + 1 })
    : error(c, "conflict", 409);
});
journey.post("/plans/:id/copy", async (c) => {
  const p = await personalAccess(c, Number(c.req.param("id")), true);
  if (!p) return error(c, "not_found", 404);
  const b = await c.req.json<any>();
  if (!Array.isArray(b.ids) || b.ids.length > 500)
    return error(c, "invalid_plan");
  const content = copyGroupStops(
    JSON.parse(p.content),
    await groupJourney(c.env, p.trip_id),
    b.ids,
  );
  const r = await c.env.DB.prepare(
    "UPDATE itineraries SET content=?,version=version+1,updated_at=datetime('now') WHERE id=? AND version=?",
  )
    .bind(JSON.stringify(cleanJourney(content)), p.id, Number(b.version))
    .run();
  return r.meta.changes ? c.json({ ok: true }) : error(c, "conflict", 409);
});
journey.get("/plans/:id/viewers", async (c) => {
  const p = await personalAccess(c, Number(c.req.param("id")), true);
  if (!p) return error(c, "not_found", 404);
  const rows = await c.env.DB.prepare(
    `SELECT u.id,u.name,EXISTS(SELECT 1 FROM itinerary_viewers v WHERE v.user_id=u.id AND v.itinerary_id=?) AS selected
    FROM users u JOIN trip_members m ON m.participant_id=u.participant_id WHERE m.trip_id=? AND u.disabled=0 AND u.id<>?`,
  )
    .bind(p.id, p.trip_id, c.get("user").id)
    .all();
  return c.json({ items: rows.results });
});
journey.put("/plans/:id/viewers", async (c) => {
  const p = await personalAccess(c, Number(c.req.param("id")), true);
  if (!p) return error(c, "not_found", 404);
  const b = await c.req.json<any>();
  if (!Array.isArray(b.ids) || b.ids.length > 200)
    return error(c, "invalid_viewers");
  const rows = await c.env.DB.prepare(
    "SELECT u.id FROM users u JOIN trip_members m ON m.participant_id=u.participant_id WHERE m.trip_id=? AND u.disabled=0",
  )
    .bind(p.trip_id)
    .all<any>();
  const ids = [...new Set<number>(b.ids)];
  if (ids.some((id) => !rows.results.some((u) => u.id === id)))
    return error(c, "invalid_viewers");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM itinerary_viewers WHERE itinerary_id=?").bind(
      p.id,
    ),
    ...ids.map((id) =>
      c.env.DB.prepare(
        "INSERT INTO itinerary_viewers(itinerary_id,user_id) VALUES (?,?)",
      ).bind(p.id, id),
    ),
  ]);
  return c.json({ ok: true });
});

journey.get("/trips/:id/notes", async (c) => {
  const id = Number(c.req.param("id"));
  if (!(await journeyRole(c.env, c.get("user"), id)))
    return error(c, "forbidden", 403);
  const [group, own] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id,day,content,done,is_check,'group' AS visibility FROM day_notes WHERE trip_id=? ORDER BY day,sort,id",
    )
      .bind(id)
      .all(),
    c.env.DB.prepare(
      "SELECT id,day,content,done,'private' AS visibility FROM private_notes WHERE trip_id=? AND user_id=? ORDER BY day,id",
    )
      .bind(id, c.get("user").id)
      .all(),
  ]);
  return c.json({ items: [...group.results, ...own.results] });
});
journey.post("/trips/:id/notes", async (c) => {
  const id = Number(c.req.param("id")),
    role = await journeyRole(c.env, c.get("user"), id),
    b = await c.req.json<any>();
  if (!role) return error(c, "forbidden", 403);
  if (
    !["private", "group"].includes(b.visibility) ||
    !textValue(b.content, 2000) ||
    !(b.day === "*" || validDay(b.day))
  )
    return error(c, "invalid_note");
  if (b.visibility === "group" && role === "viewer")
    return error(c, "forbidden", 403);
  const r =
    b.visibility === "private"
      ? await c.env.DB.prepare(
          "INSERT INTO private_notes(trip_id,user_id,day,content) VALUES (?,?,?,?)",
        )
          .bind(id, c.get("user").id, b.day, textValue(b.content, 2000))
          .run()
      : await c.env.DB.prepare(
          "INSERT INTO day_notes(trip_id,day,content,is_check) VALUES (?,?,?,?)",
        )
          .bind(id, b.day, textValue(b.content, 2000), b.is_check === true ? 1 : 0)
          .run();
  return c.json({ id: r.meta.last_row_id });
});
journey.patch("/trips/:id/notes/:visibility/:noteId", async (c) => {
  const trip = Number(c.req.param("id")),
    role = await journeyRole(c.env, c.get("user"), trip),
    own = c.req.param("visibility") === "private";
  if (!role || (!own && role === "viewer")) return error(c, "forbidden", 403);
  const b = await c.req.json<any>(),
    id = Number(c.req.param("noteId"));
  if (!textValue(b.content, 2000)) return error(c, "invalid_note");
  const r = own
    ? await c.env.DB.prepare(
        "UPDATE private_notes SET content=?,done=? WHERE id=? AND trip_id=? AND user_id=?",
      )
        .bind(
          textValue(b.content, 2000),
          b.done ? 1 : 0,
          id,
          trip,
          c.get("user").id,
        )
        .run()
    : await c.env.DB.prepare(
        "UPDATE day_notes SET content=?,done=? WHERE id=? AND trip_id=?",
      )
        .bind(textValue(b.content, 2000), b.done ? 1 : 0, id, trip)
        .run();
  return r.meta.changes ? c.json({ ok: true }) : error(c, "not_found", 404);
});
journey.delete("/trips/:id/notes/:visibility/:noteId", async (c) => {
  const trip = Number(c.req.param("id")),
    role = await journeyRole(c.env, c.get("user"), trip),
    own = c.req.param("visibility") === "private",
    id = Number(c.req.param("noteId"));
  if (!role || (!own && role === "viewer")) return error(c, "forbidden", 403);
  const r = own
    ? await c.env.DB.prepare(
        "DELETE FROM private_notes WHERE id=? AND trip_id=? AND user_id=?",
      )
        .bind(id, trip, c.get("user").id)
        .run()
    : await c.env.DB.prepare("DELETE FROM day_notes WHERE id=? AND trip_id=?")
        .bind(id, trip)
        .run();
  return r.meta.changes ? c.json({ ok: true }) : error(c, "not_found", 404);
});

journey.post('/trips/:id/transit-preview', async c => {
  if (!(await journeyRole(c.env, c.get('user'), Number(c.req.param('id'))))) return error(c, 'forbidden', 403);
  const b = await c.req.json<any>();
  if (!Array.isArray(b.points) || b.points.length !== 2 || b.points.some((p: any) => !Array.isArray(p) || p.length !== 2 || coordinate(p[0], 90) === null || coordinate(p[1], 180) === null)) return error(c, 'invalid_coordinates');
  c.header('Cache-Control', 'no-store');
  if (b.provider === 'google') return c.json({ embedUrl: c.env.GOOGLE_MAPS_EMBED_KEY ? googleTransitEmbed(c.env.GOOGLE_MAPS_EMBED_KEY, b.points) : null });
  if (b.provider !== 'geoapify') return error(c, 'invalid_provider');
  if (!c.env.GEOAPIFY_API_KEY) return c.json({ available: false, reason: 'setup' });
  if (!(await consumeLimit(c.env, `geo-user:${c.get('user').id}`, 6, 60))) return c.json({ available: false, reason: 'quota' });
  const key = await hashToken(JSON.stringify(['geo-approx-v1', b.points]));
  const cached = await c.env.DB.prepare('SELECT content FROM route_cache WHERE key=? AND expires_at>?').bind(key, Date.now()).first<any>();
  if (cached) return c.json(JSON.parse(cached.content));
  // Conservative request cap, not a credit guarantee: long routes cost more credits.
  if (!(await consumeLimit(c.env, 'geo-minute', 10, 60)) || !(await consumeLimit(c.env, `geo-day:${new Date().toISOString().slice(0,10)}`, cap(c.env.GEOAPIFY_DAILY_LIMIT, 100), 86400))) return c.json({ available: false, reason: 'quota' });
  try {
    const url = new URL('https://api.geoapify.com/v1/routing');
    url.search = new URLSearchParams({ waypoints: b.points.map((p: number[]) => p.join(',')).join('|'), mode: 'approximated_transit', format: 'geojson', units: 'metric', lang: 'en', apiKey: c.env.GEOAPIFY_API_KEY }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return c.json({ available: false, reason: response.status === 429 ? 'quota' : 'provider' });
    const result = { available: true, ...geoapifyTransit(await response.json()) };
    await c.env.DB.prepare('INSERT OR REPLACE INTO route_cache(key,content,expires_at) VALUES (?,?,?)').bind(key, JSON.stringify(result), Date.now() + 3600000).run();
    return c.json(result);
  } catch { return c.json({ available: false, reason: 'provider' }); }
});

journey.post('/trips/:id/transit-options', async c => {
  if (!(await journeyRole(c.env, c.get('user'), Number(c.req.param('id'))))) return error(c, 'forbidden', 403);
  const b = await c.req.json<any>();
  if (!Array.isArray(b.points) || b.points.length !== 2 || b.points.some((p: any) => !Array.isArray(p) || p.length !== 2 || coordinate(p[0], 90) === null || coordinate(p[1], 180) === null) ||
      typeof b.departure !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(b.departure) || !Number.isFinite(Date.parse(b.departure))) return error(c, 'invalid_request');
  if (!c.env.TRANSIT_PLAN_URL || !c.env.TRANSIT_CONTACT) return c.json({ available: false, reason: 'transit_setup' });
  if (!(await consumeLimit(c.env, `transit-user:${c.get('user').id}`, 6, 60))) return c.json({ available: false, reason: 'quota' });
  const key = await hashToken(JSON.stringify(['motis-v6', c.env.TRANSIT_PLAN_URL, b.points, b.departure]));
  const cached = await c.env.DB.prepare('SELECT content FROM route_cache WHERE key=? AND expires_at>?').bind(key, Date.now()).first<any>();
  if (cached) return c.json(JSON.parse(cached.content));
  if (!(await consumeLimit(c.env, 'transit-minute', 10, 60)) || !(await consumeLimit(c.env, `transit-day:${new Date().toISOString().slice(0,10)}`, cap(c.env.TRANSIT_DAILY_LIMIT, 100), 86400))) return c.json({ available: false, reason: 'quota' });
  try {
    const url = new URL(c.env.TRANSIT_PLAN_URL);
    if (url.protocol !== 'https:') return c.json({ available: false, reason: 'transit_setup' });
    url.search = new URLSearchParams({ fromPlace: b.points[0].join(','), toPlace: b.points[1].join(','), time: b.departure, numItineraries: '3', withFares: 'true', detailedLegs: 'true', detailedTransfers: 'true' }).toString();
    const response = await fetch(url, { headers: { 'User-Agent': `Jelajah/0.28 (${c.env.TRANSIT_CONTACT})` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return c.json({ available: false, reason: response.status === 429 ? 'quota' : 'provider' });
    const options = normalizeTransitOptions(await response.json());
    const result = { available: options.length > 0, reason: options.length ? undefined : 'transit_coverage', options, checkedAt: new Date().toISOString() };
    await c.env.DB.prepare('INSERT OR REPLACE INTO route_cache(key,content,expires_at) VALUES (?,?,?)').bind(key, JSON.stringify(result), Date.now() + 5 * 60000).run();
    return c.json(result);
  } catch { return c.json({ available: false, reason: 'provider' }); }
});

journey.post("/trips/:id/routes", async (c) => {
  const trip = Number(c.req.param("id"));
  if (!(await journeyRole(c.env, c.get("user"), trip)))
    return error(c, "forbidden", 403);
  const b = await c.req.json<any>();
  if (
    !Array.isArray(b.points) ||
    b.points.length !== 2 ||
    b.points.some(
      (p: any) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        coordinate(p[0], 90) === null ||
        coordinate(p[1], 180) === null,
    )
  )
    return error(c, "invalid_coordinates");
  if (["train", "metro", "transit", "intercity"].includes(b.mode)) {
    if (!(await consumeLimit(c.env, `rail-user:${c.get("user").id}`, 60, 60)))
      return c.json({ available: false, reason: "quota" });
    return c.json(tokyoRailRoute(b.points[0], b.points[1]));
  }
  if (!["walk", "drive", "taxi", "car"].includes(b.mode))
    return c.json({ available: false, reason: "unsupported" });
  const profile = b.mode === "walk" ? "foot-walking" : "driving-car";
  const key = await hashToken(JSON.stringify([profile, b.points])),
    now = Date.now();
  const cached = await c.env.DB.prepare(
    "SELECT content FROM route_cache WHERE key=? AND expires_at>?",
  )
    .bind(key, now)
    .first<any>();
  if (cached) return c.json(JSON.parse(cached.content));
  if (!c.env.ORS_API_KEY)
    return c.json({ available: false, reason: "unconfigured" });
  if (
    !(await consumeLimit(c.env, `routes-user:${c.get("user").id}`, 60, 60)) ||
    !(await consumeLimit(c.env, `routes-minute`, 35, 60)) ||
    !(await consumeLimit(
      c.env,
      `routes-day:${new Date().toISOString().slice(0, 10)}`,
      cap(c.env.ORS_DAILY_LIMIT, 1900),
      86400,
    ))
  )
    return c.json({ available: false, reason: "quota" });
  try {
    const response = await fetch(
      `https://api.openrouteservice.org/v2/directions/${profile}/geojson`,
      {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: c.env.ORS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: b.points.map(([lat, lng]: number[]) => [lng, lat]),
        }),
      },
    );
    if (!response.ok) return c.json({ available: false, reason:
      response.status === 401 || response.status === 403 ? "credentials" :
      response.status === 429 ? "quota" : "provider" });
    const data: any = await response.json(),
      f = data.features?.[0],
      summary = f?.properties?.summary;
    if (
      !Array.isArray(f?.geometry?.coordinates) ||
      !Number.isFinite(summary?.distance) ||
      !Number.isFinite(summary?.duration)
    )
      return c.json({ available: false, reason: "provider" });
    const points = f.geometry.coordinates.map(([lng, lat]: number[]) => [
      lat,
      lng,
    ]);
    if (
      points.some(
        ([lat, lng]: number[]) =>
          coordinate(lat, 90) === null || coordinate(lng, 180) === null,
      )
    )
      return c.json({ available: false, reason: "provider" });
    const result = {
      available: true,
      points,
      distance: summary.distance,
      duration: summary.duration,
      mode: b.mode,
    };
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM route_cache WHERE expires_at<?").bind(now),
      c.env.DB.prepare(
        "INSERT OR REPLACE INTO route_cache(key,content,expires_at) VALUES (?,?,?)",
      ).bind(key, JSON.stringify(result), now + 7 * 86400000),
    ]);
    return c.json(result);
  } catch {
    return c.json({ available: false, reason: "provider" });
  }
});

journey.get("/geocode", async (c) => {
  const q = textValue(c.req.query("q"), 200);
  if (!q) return c.json({ items: [] });
  if (!(await consumeLimit(c.env, `geo:${c.get("user").id}`, 30, 60)))
    return error(c, "rate_limited", 429);
  const url = new URL(c.env.GEOCODER_URL || "https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "5");
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return c.json({ items: [] });
    const data: any = await res.json();
    return c.json({
      items: (data.features ?? [])
        .slice(0, 5)
        .map((f: any) => ({
          name: textValue(
            [f.properties?.name, f.properties?.city, f.properties?.country]
              .filter(Boolean)
              .join(", "),
            300,
          ),
          lat: coordinate(f.geometry?.coordinates?.[1], 90),
          lng: coordinate(f.geometry?.coordinates?.[0], 180),
        }))
        .filter((p: any) => p.lat !== null && p.lng !== null),
    });
  } catch {
    return c.json({ items: [] });
  }
});

journey.use("/trips/:id/publishing/*", async (c, next) => {
  if (
    (await journeyRole(c.env, c.get("user"), Number(c.req.param("id")))) !==
    "leader"
  )
    return error(c, "forbidden", 403);
  return next();
});
journey.post("/trips/:id/publishing/preview", async (c) => {
  const id = Number(c.req.param("id")),
    b = await c.req.json<any>();
  const trip = await c.env.DB.prepare(
    "SELECT name,destination FROM trips WHERE id=?",
  )
    .bind(id)
    .first<any>();
  return c.json(
    publicJourney(
      trip.name,
      trip.destination,
      await groupJourney(c.env, id),
      await selectedNotes(c.env, id, Array.isArray(b.noteIds) ? b.noteIds : []),
      !!b.guide,
    ),
  );
});
journey.get("/trips/:id/publishing/links", async (c) =>
  c.json({
    items: (
      await c.env.DB.prepare(
        "SELECT id,expires_at,revoked,created_at FROM guest_links WHERE trip_id=? ORDER BY id DESC",
      )
        .bind(Number(c.req.param("id")))
        .all()
    ).results,
  }),
);
journey.post("/trips/:id/publishing/links", async (c) => {
  const id = Number(c.req.param("id")),
    b = await c.req.json<any>();
  const expiry = b.expiresAt ? Date.parse(b.expiresAt) : null;
  if (expiry !== null && (!Number.isFinite(expiry) || expiry <= Date.now()))
    return error(c, "invalid_expiry");
  const token = randomToken(),
    notes = await selectedNotes(
      c.env,
      id,
      Array.isArray(b.noteIds) ? b.noteIds : [],
    );
  await c.env.DB.prepare(
    "INSERT INTO guest_links(trip_id,token_hash,note_ids,expires_at,created_by) VALUES (?,?,?,?,?)",
  )
    .bind(
      id,
      await hashToken(token),
      JSON.stringify(notes.map((n) => n.id)),
      expiry,
      c.get("user").id,
    )
    .run();
  return c.json({ path: `/share/${token}` });
});
journey.delete("/trips/:id/publishing/links/:link", async (c) => {
  await c.env.DB.prepare(
    "UPDATE guest_links SET revoked=1 WHERE id=? AND trip_id=?",
  )
    .bind(Number(c.req.param("link")), Number(c.req.param("id")))
    .run();
  return c.json({ ok: true });
});
journey.get("/trips/:id/publishing/guides", async (c) =>
  c.json({
    items: (
      await c.env.DB.prepare(
        "SELECT id,draft,published IS NOT NULL AS live,taken_down FROM journey_guides WHERE trip_id=?",
      )
        .bind(Number(c.req.param("id")))
        .all()
    ).results,
  }),
);
journey.post("/trips/:id/publishing/guides", async (c) => {
  const trip = Number(c.req.param("id")),
    b = await c.req.json<any>();
  let draft;
  try {
    draft = cleanPublicJourney(b.draft);
  } catch {
    return error(c, "invalid_guide");
  }
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO journey_guides(id,trip_id,draft,title,destination,duration) VALUES (?,?,?,?,?,?)",
  )
    .bind(
      id,
      trip,
      JSON.stringify(draft),
      draft.title,
      draft.destination,
      draft.days.length,
    )
    .run();
  return c.json({ id });
});
journey.put("/trips/:id/publishing/guides/:guide", async (c) => {
  const trip = Number(c.req.param("id")),
    id = c.req.param("guide"),
    b = await c.req.json<any>();
  const old = await c.env.DB.prepare(
    "SELECT taken_down FROM journey_guides WHERE id=? AND trip_id=?",
  )
    .bind(id, trip)
    .first<any>();
  if (!old) return error(c, "not_found", 404);
  if (b.publish && old.taken_down) return error(c, "taken_down", 403);
  let draft;
  try {
    draft = cleanPublicJourney(b.draft);
  } catch {
    return error(c, "invalid_guide");
  }
  if (b.publish) {
    await c.env.DB.prepare(
      "UPDATE journey_guides SET draft=?,published=?,title=?,destination=?,duration=?,updated_at=datetime('now') WHERE id=? AND trip_id=?",
    )
      .bind(
        JSON.stringify(draft),
        JSON.stringify(draft),
        draft.title,
        draft.destination,
        draft.days.length,
        id,
        trip,
      )
      .run();
  } else
    await c.env.DB.prepare(
      "UPDATE journey_guides SET draft=? WHERE id=? AND trip_id=?",
    )
      .bind(JSON.stringify(draft), id, trip)
      .run();
  return c.json({ ok: true });
});
journey.delete("/trips/:id/publishing/guides/:guide", async (c) => {
  await c.env.DB.prepare(
    "UPDATE journey_guides SET published=NULL WHERE id=? AND trip_id=?",
  )
    .bind(c.req.param("guide"), Number(c.req.param("id")))
    .run();
  return c.json({ ok: true });
});
journey.get("/admin/guides", async (c) => {
  if (c.get("user").role !== "admin") return error(c, "forbidden", 403);
  return c.json({
    items: (
      await c.env.DB.prepare(
        "SELECT id,title,destination,taken_down FROM journey_guides WHERE published IS NOT NULL ORDER BY updated_at DESC LIMIT 100",
      ).all()
    ).results,
  });
});
journey.patch("/admin/guides/:id", async (c) => {
  if (c.get("user").role !== "admin") return error(c, "forbidden", 403);
  const b = await c.req.json<any>();
  await c.env.DB.prepare("UPDATE journey_guides SET taken_down=? WHERE id=?")
    .bind(b.takenDown ? 1 : 0, c.req.param("id"))
    .run();
  return c.json({ ok: true });
});
