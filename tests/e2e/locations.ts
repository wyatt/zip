import { expect, type Page } from "@playwright/test";

export async function saveOperatorLocations(
  page: Page,
  locations = [
    { name: "Home", lat: "42.35596", lon: "-71.07029" },
    { name: "Base One", lat: "42.36796", lon: "-71.08029" },
  ],
) {
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account settings" })).toBeVisible();
  for (const location of locations) {
    await page.getByRole("button", { name: "Add location", exact: true }).click();
    const row = page.locator(".location-row").last();
    await row.getByLabel("Name", { exact: true }).fill(location.name);
    await row.getByLabel("Latitude", { exact: true }).fill(location.lat);
    await row.getByLabel("Longitude", { exact: true }).fill(location.lon);
  }
  await page.getByRole("button", { name: "Save locations", exact: true }).click();
  await expect(page.getByText("Locations saved")).toBeVisible();
}
