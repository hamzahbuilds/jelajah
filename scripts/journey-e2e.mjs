// Run after the legacy regression suite on an isolated local Wrangler database.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.JELAJAH_TEST_URL || "http://127.0.0.1:8788";
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  serviceWorkers: "block",
});
const page = await context.newPage();
page.setDefaultTimeout(25000);
await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
mkdirSync("e2e-shots/journey", { recursive: true });
const call = async (path, method = "GET", data) => {
  const r = await page.request.fetch(`${base}/api${path}`, { method, data });
  assert.equal(r.status(), 200, `${method} ${path}: ${await r.text()}`);
  return r.json();
};
try {
  await page.goto(`${base}/login`);
  await page.fill("input[type=email]", "admin@jelajah.local");
  await page.fill(
    "input[type=password]",
    process.env.JELAJAH_TEST_PASSWORD || "kata-laluan-baru-99",
  );
  await page.click(".login-card button");
  await page.waitForURL(`${base}/`);
  const trip = await call("/trips", "POST", {
    name: "A little Tokyo adventure",
    destination: "Tokyo, Japan",
    start_date: "2026-11-29",
    end_date: "2026-12-01",
    emoji: "🌸",
  });
  const places = [
    ["Morning in the gardens", "Shinjuku Gyoen", 35.6852, 139.71],
    ["Coffee and a quiet lane", "Yanaka Ginza", 35.7278, 139.7653],
    ["Sunset by the river", "Sumida Park", 35.7149, 139.8031],
  ];
  for (let day = 0; day < 3; day++) {
    const date = ["2026-11-29", "2026-11-30", "2026-12-01"][day];
    await call(`/trips/${trip.id}/daysettings`, "PUT", {
      day: date,
      title: [
        "Slow mornings, bright city",
        "Old streets & new favourites",
        "One more little adventure",
      ][day],
      start_name: "Our starting point",
      start_lat: 35.68,
      start_lng: 139.7,
    });
    for (let k = 0; k < 3; k++)
      await call(`/trips/${trip.id}/activities`, "POST", {
        title: places[k][0],
        day: date,
        start_time: `${10 + k * 2}:00`,
        end_time: `${11 + k * 2}:00`,
        location_name: places[k][1],
        lat: places[k][2],
        lng: places[k][3],
        notes: "Internal organiser notes",
        participant_ids: [],
      });
  }
  await call(`/journey/trips/${trip.id}/notes`, "POST", {
    day: "*",
    visibility: "private",
    content: "PRIVATE: birthday surprise",
  });
  const note = await call(`/journey/trips/${trip.id}/notes`, "POST", {
    day: "2026-11-29",
    visibility: "group",
    content: "Bring comfortable shoes and leave room for a little detour.",
  });
  await page.goto(`${base}/trips/${trip.id}/plan`);
  await page.waitForSelector(".daypills");
  await page.screenshot({
    path: "e2e-shots/journey/group-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "My plan", exact: true }).click();
  await page
    .getByRole("button", { name: "Create my plan", exact: true })
    .click();
  await page.waitForSelector(".personal-plan");
  const first = page.locator(".journal-stop").first();
  await first.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Title", { exact: true })
    .fill("My very own morning");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.waitForSelector(".modalwrap", { state: "detached" });
  assert(
    (await page.locator(".journal-stop").first().innerText()).includes(
      "My very own morning",
    ),
  );
  const group = await call(`/journey/trips/${trip.id}/group`);
  assert(!JSON.stringify(group).includes("My very own morning"));
  await page.screenshot({
    path: "e2e-shots/journey/personal-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Copy group activities", exact: true })
    .click();
  await page.getByText("Replaces your copy", { exact: true }).first().waitFor();
  await page
    .getByRole("button", { name: "Cancel", exact: true })
    .first()
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.querySelector(".main").getBoundingClientRect().x === 0,
  );
  await page.screenshot({
    path: "e2e-shots/journey/personal-mobile.png",
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 2,
  );
  assert(!overflow, "Mobile page overflows horizontally");
  await page.getByRole("button", { name: "Map", exact: true }).click();
  assert(await page.locator(".journal-map").isVisible());
  await page.screenshot({
    path: "e2e-shots/journey/map-mobile.png",
    fullPage: true,
  });
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page.screenshot({
    path: "e2e-shots/journey/personal-dark.png",
    fullPage: true,
  });
  await page.evaluate(() =>
    document.documentElement.removeAttribute("data-theme"),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Share & publish", exact: true })
    .click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForSelector(".public-schedule");
  assert(
    !(await page.locator(".public-schedule").innerText()).includes("PRIVATE"),
  );
  await page
    .getByRole("button", { name: "Create guest link", exact: true })
    .click();
  await page.getByLabel("Guest link", { exact: true }).waitFor();
  const link = await page
    .getByLabel("Guest link", { exact: true })
    .inputValue();
  const guestPage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: "block",
  });
  guestPage.setDefaultTimeout(25000);
  await guestPage.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) =>
    r.abort(),
  );
  await guestPage.goto(link);
  await guestPage.waitForSelector(".public-schedule");
  const publicText = await guestPage.locator("body").innerText();
  assert(!publicText.includes("PRIVATE"));
  assert(!publicText.includes("Internal organiser notes"));
  await guestPage.screenshot({
    path: "e2e-shots/journey/guest-desktop.png",
    fullPage: true,
  });
  // Force a multi-page table to exercise repeating headers and row wrapping.
  const extra = [];
  for (let k = 0; k < 24; k++)
    extra.push(
      (
        await call(`/trips/${trip.id}/activities`, "POST", {
          title: `Optional neighbourhood walk ${k + 1}`,
          day: "2026-12-01",
          start_time: "15:00",
          end_time: "16:00",
          location_name:
            "A long place name for checking that the printed table wraps cleanly",
          participant_ids: [],
        })
      ).id,
    );
  await guestPage.reload();
  await guestPage
    .getByText("Optional neighbourhood walk 24", { exact: true })
    .waitFor();
  await guestPage.pdf({
    path: "e2e-shots/journey/itinerary.pdf",
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });
  await guestPage.emulateMedia({ media: "print" });
  await guestPage.screenshot({
    path: "e2e-shots/journey/print-preview.png",
    fullPage: true,
  });
  await guestPage.emulateMedia({ media: "screen" });
  await call(`/trips/${trip.id}/activities/delete`, "POST", { ids: extra });
  await page.getByRole("button", { name: "Public guide", exact: true }).click();
  await page
    .getByRole("button", { name: "Create guide draft", exact: true })
    .click();
  await page.waitForSelector(".guide-editor");
  await page
    .locator(".guide-editor")
    .getByLabel("Title", { exact: true })
    .fill("Three slow days in Tokyo");
  await page
    .locator(".guide-editor")
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Publish reviewed guide", exact: true })
    .click();
  await page
    .getByRole("link", { name: "View published guide", exact: true })
    .waitFor();
  const guidePath = await page
    .getByRole("link", { name: "View published guide", exact: true })
    .getAttribute("href");
  await guestPage.goto(`${base}${guidePath}`);
  await guestPage.waitForSelector(".public-schedule");
  assert(
    !(await guestPage.locator(".public-schedule").innerText()).includes(
      "2026-11-29",
    ),
  );
  await guestPage.getByRole("button", { name: "Bahasa Malaysia" }).click();
  await guestPage.getByText("Panduan awam", { exact: true }).waitFor();
  await guestPage.screenshot({
    path: "e2e-shots/journey/guide-bm.png",
    fullPage: true,
  });
  await guestPage.goto(`${base}/discover`);
  await guestPage.waitForSelector(".guide-card");
  await guestPage.screenshot({
    path: "e2e-shots/journey/discover.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Guest link", exact: true }).click();
  await page
    .getByRole("button", { name: "Revoke", exact: true })
    .first()
    .click();
  await page.getByText("Revoked", { exact: true }).waitFor();
  await guestPage.goto(link);
  await guestPage.getByRole("alert").waitFor();
  await guestPage.goto(`${base}/forgot-password`);
  await guestPage
    .getByText(
      "Email recovery is not configured. Please contact your organiser.",
    )
    .waitFor();
  await guestPage.screenshot({
    path: "e2e-shots/journey/recovery.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  writeFileSync(
    "e2e-shots/journey/result.json",
    JSON.stringify(
      {
        tripId: trip.id,
        guidePath,
        checks:
          "personal editing, independent copy, guest preview/revoke, guide publishing/discovery, BM, dark mode, mobile overflow, recovery, print",
        errors,
      },
      null,
      2,
    ),
  );
  await guestPage.close();
  console.log("JOURNEY E2E PASSED");
} finally {
  await browser.close();
}
