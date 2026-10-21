import { expect, test, type Page } from "@playwright/test";
import "dotenv/config";

const PASSWORD = process.env.DEMO_PASSWORD ?? "weddingflow-demo";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/);
}

/** Runs due background jobs through the protected scheduler endpoint (as a hosted cron would). */
async function runJobs(page: Page) {
  for (let i = 0; i < 3; i++) {
    const res = await page.request.post("/api/cron/tick", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(res.status()).toBe(200);
  }
}

test("enquiry → CRM → contact → approval → simulated send", async ({ page }) => {
  const name = `E2E Couple ${Date.now()}`;

  await test.step("client submits the public enquiry form", async () => {
    await page.goto("/enquire/aurora-films-demo");
    await page.fill("#contactName", name);
    await page.fill("#phone", `98${String(Date.now()).slice(-8)}`);
    await page.fill("#city", "Jaipur");
    await page.fill("#eventDate", "2027-11-12");
    await page.locator('input[name="serviceIds"]').first().check();
    await page.locator('input[name="consent"]').check();
    await page.waitForTimeout(3200); // the anti-spam token rejects instant submissions
    await page.click('button:has-text("Send enquiry")');
    await page.waitForURL(/thanks/);
    await expect(page.getByText("not a booking confirmation")).toBeVisible();
    await expect(page.getByText(/ENQ-[A-Z0-9]{6}/)).toBeVisible();
  });

  await test.step("the lead appears in the studio CRM with an acknowledgement draft", async () => {
    await runJobs(page);
    await signIn(page, "owner@aurora.demo");
    await page.goto(`/leads?q=${encodeURIComponent(name)}`);
    await page.getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
    await expect(page.getByText("Awaiting approval").first()).toBeVisible();
  });

  await test.step("staff logs a call and the status updates", async () => {
    await page.getByRole("button", { name: "Log contact" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Log contact" }).click();
    await expect(page.locator("h1").getByText("Contacted")).toBeVisible();
  });

  await test.step("approving a draft queues it; demo mode simulates the send", async () => {
    await page.getByRole("button", { name: /Approve/ }).first().click();
    await expect(page.getByText("Queued").first()).toBeVisible();
    await runJobs(page);
    await page.reload();
    await expect(page.getByText("Demo — not sent").first()).toBeVisible();
  });

  await test.step("a follow-up can be scheduled", async () => {
    await page.getByRole("button", { name: "Schedule follow-up" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Schedule" }).click();
    await expect(page.getByText(`Follow up with ${name}`).first()).toBeVisible();
  });
});

test("staff cannot export leads or reach platform admin", async ({ page }) => {
  await signIn(page, "staff@aurora.demo");
  expect((await page.request.get("/api/leads/export")).status()).toBe(403);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("studios only see their own leads", async ({ page }) => {
  // "Kavya Gowda" exists only in the Aurora sample studio.
  await signIn(page, "owner@lumiere.demo");
  await page.goto("/leads?scope=all&q=Kavya");
  await expect(page.getByText("No leads match these filters")).toBeVisible();
});
