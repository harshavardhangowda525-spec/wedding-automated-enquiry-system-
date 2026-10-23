import { expect, test } from "@playwright/test";
import "dotenv/config";

test("client completes the enquiry chat and gets the automatic WhatsApp confirmation", async ({ page }) => {
  const name = "Kavitha Raman";
  await page.goto("/enquire/aurora-films-demo");
  await page.getByRole("link", { name: /Start chat/ }).click();
  await page.waitForURL(/\/chat$/);

  const reply = async (text: string) => {
    await page.getByLabel("Your reply").fill(text);
    await page.getByRole("button", { name: "Send" }).click();
  };
  await reply(name);
  await expect(page.getByText(/best phone/)).toBeVisible();
  await reply(`98${String(Date.now()).slice(-8)}`);
  await page.getByRole("button", { name: "Wedding", exact: true }).click();
  await page.getByLabel("Event date").fill("2027-12-20");
  await page.getByRole("button", { name: "Use this date" }).click();
  await reply("Udaipur");
  await page.getByRole("group", { name: "Services" }).getByRole("button").first().click();
  await page.getByRole("button", { name: /^Done/ }).click();
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByLabel("Assistant is typing")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "I agree" }).click();
  await expect(page.getByText("Here's what I have")).toBeVisible();
  await page.waitForTimeout(3200); // the anti-spam token rejects submissions faster than a person could type
  await page.getByRole("button", { name: "Send enquiry" }).click();

  await page.waitForURL(/thanks/);
  await expect(page.getByText("not a booking confirmation")).toBeVisible();
  await expect(page.getByText(/confirmation to your WhatsApp/)).toBeVisible();
});
