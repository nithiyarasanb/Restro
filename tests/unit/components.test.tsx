// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ColumnChart } from "@/components/ui/column-chart";
import { cart, cartCount, cartEstimate } from "@/features/cart/cart-store";
import { OrderStatusBadge } from "@/components/ui/badge";

describe("ColumnChart", () => {
  const data = [
    { key: "a", label: "11a", value: 2, display: "2 orders" },
    { key: "b", label: "12p", value: 7, display: "7 orders" },
  ];

  it("labels the peak, exposes each column to keyboard users and offers a table view", async () => {
    render(<ColumnChart title="Orders by hour" valueLabel="Orders" data={data} />);
    expect(screen.getByRole("group", { name: /Orders by hour\. Peak 12p: 7 orders/ })).toBeInTheDocument();
    const columns = screen.getAllByLabelText(/orders$/);
    expect(columns.map((c) => c.getAttribute("aria-label"))).toEqual(["11a: 2 orders", "12p: 7 orders"]);
    await userEvent.tab();
    expect(screen.getByRole("tooltip")).toHaveTextContent("11a · 2 orders");
    const table = screen.getByRole("table", { hidden: true });
    expect(within(table).getAllByRole("row", { hidden: true })).toHaveLength(3);
  });
});

describe("cart store", () => {
  beforeEach(() => {
    localStorage.clear();
    cart.setContext({ kind: "table", qrRef: "t_x", tableLabel: "Table 1", restaurantName: "R", branchName: "B", currency: "INR" });
    cart.clear();
  });

  const line = {
    menuItemId: "i1",
    name: "Tikka",
    variantId: null,
    variantName: null,
    modifierOptionIds: ["m1", "m2"],
    modifierLabels: [],
    quantity: 1,
    notes: null,
    unitEstimateMinor: 26000,
  };

  it("merges identical lines (modifier order irrelevant) and keeps different notes apart", () => {
    act(() => {
      cart.add(line);
      cart.add({ ...line, modifierOptionIds: ["m2", "m1"] });
      cart.add({ ...line, notes: "no onion" });
    });
    const s = cart.get();
    expect(s.lines).toHaveLength(2);
    expect(cartCount(s)).toBe(3);
    expect(cartEstimate(s)).toBe(78000);
  });

  it("starts a fresh cart when the table changes", () => {
    cart.add(line);
    expect(cart.setContext({ kind: "table", qrRef: "t_other", tableLabel: "Table 2", restaurantName: "R", branchName: "B", currency: "INR" })).toBe(true);
    expect(cart.get().lines).toHaveLength(0);
  });

  it("caps quantity at 50 and removes a line at zero", () => {
    cart.add({ ...line, quantity: 49 });
    const key = cart.get().lines[0].key;
    cart.setQuantity(key, 80);
    expect(cart.get().lines[0].quantity).toBe(50);
    cart.setQuantity(key, 0);
    expect(cart.get().lines).toHaveLength(0);
  });
});

describe("status badges", () => {
  it("render readable labels, not raw enum values", () => {
    render(<OrderStatusBadge status="PENDING_PAYMENT" />);
    expect(screen.getByText("Awaiting payment")).toBeInTheDocument();
  });
});
