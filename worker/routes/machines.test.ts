import { describe, expect, it } from "vitest";

describe("Machine Status API — 3.8.1", () => {
  it("GET /machines harus mengembalikan 10 mesin dengan konfigurasi yang benar", async () => {
    const response = await fetch(
      "http://localhost/machines",
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body.ok).toBe(true);
    expect(Array.isArray(body.machines)).toBe(true);
    expect(body.machines).toHaveLength(10);

    const washers = body.machines.filter(
      (machine: {
        machineId: string;
        type: string;
      }) => machine.type === "WASHER",
    );

    const dryers = body.machines.filter(
      (machine: {
        machineId: string;
        type: string;
      }) => machine.type === "DRYER",
    );

    expect(washers).toHaveLength(5);
    expect(dryers).toHaveLength(5);

    expect(
      washers.map(
        (machine: { machineId: string }) =>
          machine.machineId,
      ),
    ).toEqual([
      "W1",
      "W2",
      "W3",
      "W4",
      "W5",
    ]);

    expect(
      dryers.map(
        (machine: { machineId: string }) =>
          machine.machineId,
      ),
    ).toEqual([
      "D1",
      "D2",
      "D3",
      "D4",
      "D5",
    ]);

    for (const machine of washers) {
      expect(machine.durationMinutes).toBe(32);
    }

    for (const machine of dryers) {
      expect(machine.durationMinutes).toBe(50);
    }
  });
});
