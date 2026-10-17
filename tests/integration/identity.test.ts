import { beforeAll, describe, expect, it } from "vitest";
import type { DataStore } from "@/server/store/types";
import { DEMO, staffFor } from "../support/fixtures";
import { storeCases } from "../support/stores";
import { acceptInvitation, inviteStaff, login, updateMembership } from "@/server/services/identity";
import { resolveActor } from "@/server/auth/session";
import { DEMO_PASSWORD } from "@/server/store/demo-constants";
import { resetRateLimits } from "@/server/http/rate-limit";

describe.each(storeCases)("identity & access [$name]", ({ make }) => {
  let store: DataStore;
  beforeAll(async () => {
    store = await make();
    resetRateLimits();
  });

  it("logs in with the right password only, with the same error for unknown users", async () => {
    const ok = await login(store, { email: DEMO.users.cashier, password: DEMO_PASSWORD }, "test-ip-1");
    expect((await resolveActor(store, ok.token))?.kind).toBe("staff");
    await expect(login(store, { email: DEMO.users.cashier, password: "wrong" }, "test-ip-1")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      message: "Email or password is incorrect",
    });
    await expect(login(store, { email: "nobody@example.com", password: "wrong" }, "test-ip-1")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      message: "Email or password is incorrect",
    });
  });

  it("rate-limits repeated failed logins", async () => {
    const attempts = Array.from({ length: 9 }, () => login(store, { email: DEMO.users.kitchen, password: "nope" }, "test-ip-rl").catch((e) => e.code));
    const codes = await Promise.all(attempts);
    expect(codes).toContain("RATE_LIMITED");
  });

  it("invitations are single-use and never reset an existing password", async () => {
    const owner = await staffFor(store, DEMO.users.owner);
    const email = `cook-${Date.now()}@spiceroute.demo`;
    const { inviteUrl } = await inviteStaff(store, owner, { email, role: "KITCHEN", branchIds: [DEMO.mainBranchId] });
    const token = inviteUrl.split("/invite/")[1];
    const accepted = await acceptInvitation(store, token, { name: "New Cook", password: "NewCook12345" }, "inv-1");
    expect(accepted.home).toBe("/kitchen");
    await expect(acceptInvitation(store, token, { name: "Again", password: "Another12345" }, "inv-2")).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await login(store, { email, password: "NewCook12345" }, "inv-3")).user.email).toBe(email);
  });

  it("managers can only invite junior roles into their own branches", async () => {
    const manager = await staffFor(store, DEMO.users.manager);
    await expect(inviteStaff(store, manager, { email: "x1@spiceroute.demo", role: "OWNER", branchIds: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(inviteStaff(store, manager, { email: "x2@spiceroute.demo", role: "KITCHEN", branchIds: [DEMO.lakeBranchId] })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      inviteStaff(store, await staffFor(store, DEMO.users.cashier), { email: "x3@spiceroute.demo", role: "KITCHEN", branchIds: [DEMO.mainBranchId] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("disabling access ends sessions immediately", async () => {
    const owner = await staffFor(store, DEMO.users.owner);
    const email = `temp-${Date.now()}@spiceroute.demo`;
    const { inviteUrl } = await inviteStaff(store, owner, { email, role: "CASHIER", branchIds: [DEMO.mainBranchId] });
    const s = await acceptInvitation(store, inviteUrl.split("/invite/")[1], { name: "Temp", password: "TempUser12345" }, "inv-9");
    expect(await resolveActor(store, s.token)).not.toBeNull();
    const user = await store.getUserByEmail(email);
    const m = (await store.listMemberships(DEMO.tenantId)).find((x) => x.userId === user!.id)!;
    await updateMembership(store, owner, m.id, { status: "DISABLED" });
    expect(await resolveActor(store, s.token)).toBeNull();
  });

  it("an expired session is rejected", async () => {
    const user = (await store.getUserByEmail(DEMO.users.cashier))!;
    const token = `expired-${Date.now()}-token`;
    const { sha256 } = await import("@/server/crypto");
    await store.createSession({
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      lastSeenAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    expect(await resolveActor(store, token)).toBeNull();
  });
});
