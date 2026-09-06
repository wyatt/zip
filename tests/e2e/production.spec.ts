import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { saveOperatorLocations } from "./locations";

async function signUp(page: Page, route: string, email: string, password: string, name: string) {
  await page.goto(route);
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: false }).click();
  await page.getByLabel("Your name", { exact: true }).fill(name);
  await page.getByRole("radio", { name: route === "/operator" || route === "/fleet" ? /Operator/ : /Customer/ }).check();
  await page.getByRole("button", { name: "Open workspace", exact: true }).click();
  await expect(page.getByRole("link", { name: "Sign out", exact: true })).toBeVisible();
}
async function pickInspectionArea(page: Page) {
  const map = page.getByTestId("flight-map");
  await expect(map).toBeVisible();
  const box = await map.boundingBox();
  if (!box) throw new Error("Flight map is not visible.");
  await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await map.click({ position: { x: Math.min(box.width - 8, box.width / 2 + 90), y: Math.min(box.height - 8, box.height / 2 + 90) } });
}

async function stopAgent(agent: ChildProcess | undefined) {
  if (!agent || agent.exitCode !== null || agent.signalCode !== null) return;
  agent.kill("SIGTERM");
  await Promise.race([once(agent, "exit"), new Promise(resolve => setTimeout(resolve, 10000))]);
  if (agent.exitCode === null && agent.signalCode === null) agent.kill("SIGKILL"); // Only the isolated simulator spawned by this test.
}

test("private customer request → self-registered operator → provisioned local agent → measured flight completion", async ({ browser }, testInfo) => {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error("This test provisions local test accounts and must use a loopback Convex deployment.");
  const customerContext = await browser.newContext(), operatorContext = await browser.newContext();
  const customer = await customerContext.newPage(), operator = await operatorContext.newPage();
  const errors: string[] = [];
  for (const page of [customer, operator]) page.on("pageerror", error => errors.push(error.message));
  const suffix = Date.now(), operatorEmail = `operator-${suffix}@iris.test`, password = `Iris-test-${suffix}-secure`;
  let agent: ChildProcess | undefined;
  let agentLogs = "";
  try {
    await signUp(operator, "/operator", operatorEmail, password, "Test Operator");
    await expect(operator.getByLabel("Invitation code")).toHaveCount(0);
    await saveOperatorLocations(operator);
    await operator.getByRole("link", { name: "Fleet", exact: true }).click();
    await operator.getByRole("button", { name: "Add aircraft", exact: true }).click();
    await operator.getByLabel("Environment", { exact: true }).selectOption("simulated");
    await operator.getByRole("button", { name: "Register aircraft", exact: true }).click();
    await expect(operator.locator("pre.secret-value")).toBeVisible();
    const agentToken = (await operator.locator("pre.secret-value").innerText()).replace("IRIS_AGENT_TOKEN=", "").trim();
    agent = spawn(process.execPath, ["--import", "tsx", "agent/index.ts"], { env: { ...process.env, IRIS_AGENT_TOKEN: agentToken }, stdio: ["ignore", "pipe", "pipe"] });
    agent.stdout?.on("data", data => { agentLogs += String(data); });
    agent.stderr?.on("data", data => { agentLogs += String(data); });
    await expect.poll(() => agentLogs, { timeout: 20000 }).toContain("Telemetry: 20 Hz");
    await signUp(customer, "/request", `customer-${suffix}@iris.test`, password, "Test Customer");
    await customer.getByRole("button", { name: "Inspection", exact: true }).click();
    await customer.getByLabel("Title", { exact: true }).fill(`Stability check ${suffix}`);
    await customer.getByLabel("Hover (s)", { exact: true }).fill("5");
    await pickInspectionArea(customer);
    await customer.getByRole("button", { name: "Submit request", exact: false }).click();
    await expect(customer.getByRole("heading", { name: "Finding a qualified operator" })).toBeVisible();
    await operator.getByRole("link", { name: "Dashboard", exact: true }).click();
    await operator.getByRole("button").filter({ hasText: `Stability check ${suffix}` }).click();
    await operator.locator("input[name=mode][value=autonomous]").check();
    await operator.getByRole("button", { name: /Accept job/, exact: false }).click();
    const start = operator.getByRole("button", { name: "Start flight", exact: false });
    await expect(start).toBeEnabled({ timeout: 20000 });
    await operator.screenshot({ path: testInfo.outputPath("operator-ready.png"), fullPage: true });
    await start.click();
    await expect(operator.getByTestId("control-owner")).toHaveText("Flight agent", { timeout: 10000 });
    await expect.poll(async () => Number((await operator.getByTestId("altitude").innerText()).replace("m", ""))).toBeGreaterThan(1);
    await operator.screenshot({ path: testInfo.outputPath("operator-flight.png"), fullPage: true });
    await expect(operator.getByRole("heading", { name: "Completed", exact: true })).toBeVisible({ timeout: 30000 });
    await expect(customer.getByRole("heading", { name: "Completed", exact: true })).toBeVisible();
    await expect(operator.getByText("Flight completed. The requested task result remains unverified.")).toBeVisible();
    await operator.getByText("Flight activity", { exact: false }).click();
    const events = await operator.locator(".events li").allTextContents();
    expect(events.findIndex(e => e.includes("Land and disarm verified"))).toBeLessThan(events.findIndex(e => e.includes("Flight completed")));
    await Promise.all([customer.reload(), operator.reload()]);
    await expect(customer.getByRole("heading", { name: "Completed", exact: true })).toBeVisible();
    await expect(operator.getByRole("heading", { name: "Completed", exact: true })).toBeVisible();
    await operator.screenshot({ path: testInfo.outputPath("operator-completed.png"), fullPage: true });
    // Reuse this aircraft across operations; control generations must remain monotonic.
    async function requestAnother(title: string, manual: boolean) {
      await customer.getByRole("button", { name: "Back to requests", exact: true }).click();
      await customer.getByRole("button", { name: "Inspection", exact: true }).click();
      await customer.getByLabel("Title", { exact: true }).fill(title);
      await customer.getByLabel("Hover (s)", { exact: true }).fill("5");
      await pickInspectionArea(customer);
      await customer.getByRole("button", { name: "Submit request", exact: false }).click();
      await operator.getByRole("button").filter({ hasText: title }).click();
      await operator.locator(`input[name=mode][value=${manual ? "manual" : "autonomous"}]`).check();
      await operator.getByRole("button", { name: /Accept job/, exact: false }).click();
      await expect(operator.getByRole("button", { name: "Start flight", exact: false })).toBeEnabled({ timeout: 15000 });
      await operator.getByRole("button", { name: "Start flight", exact: false }).click();
    }
    await requestAnother(`Takeover check ${suffix}`, false);
    await expect.poll(async () => Number((await operator.getByTestId("altitude").innerText()).replace("m", ""))).toBeGreaterThan(2.7);
    await operator.getByRole("button", { name: "Take Control", exact: true }).click();
    await expect(operator.getByRole("dialog", { name: "Take Control" })).toBeVisible();
    await expect(operator.getByRole("dialog")).toContainText("hover in place");
    await operator.getByRole("dialog").getByRole("button", { name: "Take Control", exact: true }).click();
    await expect(operator.getByTestId("control-owner")).toHaveText("Operator computer");
    await operator.getByRole("button", { name: "Connect computer controls", exact: true }).click();
    await expect(operator.getByText("Computer controls connected", { exact: true })).toBeVisible();
    const north = operator.getByRole("button", { name: "North", exact: true });
    await north.hover(); await operator.mouse.down(); await operator.waitForTimeout(600); await operator.mouse.up();
    await operator.screenshot({ path: testInfo.outputPath("operator-computer-takeover.png"), fullPage: true });
    await expect(operator.locator(".production-steps li.completed").filter({ hasText: "Hold at task location" })).toBeVisible({ timeout: 15000 });
    await operator.getByRole("button", { name: "Manual land", exact: true }).click();
    await expect(operator.getByRole("heading", { name: "Completed", exact: true })).toBeVisible({ timeout: 15000 });
    await requestAnother(`Manual check ${suffix}`, true);
    await expect(operator.getByTestId("control-owner")).toHaveText("Operator computer");
    await expect(operator.getByTestId("altitude")).toHaveText("0.0m");
    await operator.getByRole("button", { name: "Connect computer controls", exact: true }).click();
    await expect(operator.getByText("Computer controls connected", { exact: true })).toBeVisible();
    await operator.getByRole("button", { name: "Manual takeoff", exact: true }).click();
    await expect(operator.locator(".production-steps li.completed").filter({ hasText: "Hold at task location" })).toBeVisible({ timeout: 20000 });
    await operator.getByRole("button", { name: "Manual land", exact: true }).click();
    await expect(operator.getByRole("heading", { name: "Completed", exact: true })).toBeVisible({ timeout: 15000 });
    await requestAnother(`Reconnect check ${suffix}`, false);
    await expect.poll(async () => Number((await operator.getByTestId("altitude").innerText()).replace("m", ""))).toBeGreaterThan(1);
    const oldAgent = agent!;
    oldAgent.kill("SIGKILL"); await once(oldAgent, "exit");
    await expect(operator.getByTestId("telemetry-status")).toHaveText("Telemetry stale", { timeout: 5000 });
    await expect(operator.getByRole("heading", { name: "Attention required", exact: true })).toBeVisible({ timeout: 15000 });
    agent = spawn(process.execPath, ["--import", "tsx", "agent/index.ts"], { env: { ...process.env, IRIS_AGENT_TOKEN: agentToken }, stdio: ["ignore", "pipe", "pipe"] });
    agent.stdout?.on("data", data => { agentLogs += String(data); }); agent.stderr?.on("data", data => { agentLogs += String(data); });
    await expect(operator.getByTestId("telemetry-status")).toHaveText("Live telemetry", { timeout: 15000 });
    await expect(operator.getByRole("heading", { name: "Attention required", exact: true })).toBeVisible();
    await expect(operator.getByTestId("altitude")).toHaveText("0.0m");
    await expect(operator.getByRole("button", { name: "Start flight", exact: false })).toBeDisabled();
    await operator.getByLabel("Close without completing the job").fill("Verified grounded after simulator agent restart.");
    await operator.getByRole("button", { name: "Confirm grounded & close operation" }).click();
    await expect(operator.getByRole("heading", { name: "Cancelled", exact: true })).toBeVisible();
    await customer.setViewportSize({ width: 390, height: 844 });
    await customer.screenshot({ path: testInfo.outputPath("customer-mobile.png"), fullPage: true });
    expect(await customer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await stopAgent(agent);
    await testInfo.attach("agent-log", { body: agentLogs, contentType: "text/plain" });
    await customerContext.close(); await operatorContext.close();
  }
});
