import { MovementWindowBufferService } from "./movement-window-buffer.service";

function frame(i: number) {
  return { jointFrameId: `f${i}`, capturedAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`, angles: [{ jointName: "leftKnee", thetaRadians: 1.0 }] };
}

function buildBuffer() {
  const mlClient = { sendMovementWindow: jest.fn().mockResolvedValue({ movementPhaseEventId: "m1", validated: false }) };
  const events = { appendValidated: jest.fn().mockResolvedValue(undefined) };
  const gateway = { broadcast: jest.fn() };
  const buffer = new MovementWindowBufferService(mlClient as never, events as never, gateway as never);
  return { buffer, mlClient, events, gateway };
}

describe("MovementWindowBufferService", () => {
  it("does not call ml-service until the window reaches 16 frames", async () => {
    const { buffer, mlClient } = buildBuffer();
    for (let i = 0; i < 15; i++) {
      await buffer.addFrame("s1", "e1", frame(i));
    }
    expect(mlClient.sendMovementWindow).not.toHaveBeenCalled();
  });

  it("sends exactly 16 frames' worth of data once the window fills, then resets", async () => {
    const { buffer, mlClient, events, gateway } = buildBuffer();
    for (let i = 0; i < 16; i++) {
      await buffer.addFrame("s1", "e1", frame(i));
    }

    expect(mlClient.sendMovementWindow).toHaveBeenCalledTimes(1);
    const call = mlClient.sendMovementWindow.mock.calls[0][0];
    expect(call.sessionId).toBe("s1");
    expect(call.exerciseId).toBe("e1");
    expect(call.jointAngleSequence).toHaveLength(16);
    expect(call.sourceFrameIds).toHaveLength(16);
    expect(call.windowStartAt).toBe(frame(0).capturedAt);
    expect(call.windowEndAt).toBe(frame(15).capturedAt);

    expect(events.appendValidated).toHaveBeenCalledWith("s1", "movement-phase-event", { movementPhaseEventId: "m1", validated: false });
    expect(gateway.broadcast).toHaveBeenCalledWith("s1", "movement-phase-event", expect.objectContaining({ movementPhaseEventId: "m1" }));

    // Next frame starts a fresh window - no second call yet.
    await buffer.addFrame("s1", "e1", frame(16));
    expect(mlClient.sendMovementWindow).toHaveBeenCalledTimes(1);
  });

  it("swallows an ml-service failure and still resets the window, without throwing", async () => {
    const { buffer, mlClient, events } = buildBuffer();
    mlClient.sendMovementWindow.mockRejectedValueOnce(new Error("ml-service down"));

    await expect(
      (async () => {
        for (let i = 0; i < 16; i++) {
          await buffer.addFrame("s1", "e1", frame(i));
        }
      })()
    ).resolves.not.toThrow();

    expect(events.appendValidated).not.toHaveBeenCalled();
  });

  it("keeps separate buffers per session+exercise", async () => {
    const { buffer, mlClient } = buildBuffer();
    for (let i = 0; i < 15; i++) {
      await buffer.addFrame("s1", "e1", frame(i));
      await buffer.addFrame("s2", "e1", frame(i));
    }
    expect(mlClient.sendMovementWindow).not.toHaveBeenCalled();
  });
});
