import { resolveSequence, type ResolvedSubBlock } from "./battery-steps";
import { buildSidecar } from "./sidecar";
import { cadenceAt, framesPerPhase, phaseAt, tagFrames, totalSeconds, windowsFor } from "./sub-blocks";

/** The protocol this slice was built for: 10 s relaxed, 6 s habitual, 6 s standardised. */
const BLOCKS: ResolvedSubBlock[] = [
  { phase: "relaxed", durationSeconds: 10, instruction: "Stand as you normally would." },
  {
    phase: "habitual",
    durationSeconds: 6,
    instruction: "Stand still.",
    preparation: "March in place for five steps, then stop where you land.",
  },
  { phase: "standardized", durationSeconds: 6, instruction: "Put your heels on the marks." },
];

const W = windowsFor(BLOCKS);

describe("windowsFor", () => {
  it("lays the blocks end to end with no gap or overlap", () => {
    expect(W.map((w) => [w.startSeconds, w.endSeconds])).toEqual([
      [0, 10],
      [10, 16],
      [16, 22],
    ]);
    expect(totalSeconds(BLOCKS)).toBe(22);
  });

  it("keeps each block's own instruction and preparation", () => {
    expect(W[1]!.preparation).toMatch(/March in place/);
    expect(W[0]!.preparation).toBeNull();
    expect(W[2]!.instruction).toMatch(/heels on the marks/);
  });
});

describe("phaseAt", () => {
  it.each([
    [0, "relaxed"],
    [5, "relaxed"],
    [9.999, "relaxed"],
    [10, "habitual"],
    [15.9, "habitual"],
    [16, "standardized"],
    [21.999, "standardized"],
  ])("maps %ss to %s", (t, phase) => {
    expect(phaseAt(W, t as number)?.phase).toBe(phase);
  });

  it("treats a boundary as the START of the new phase, not the end of the old", () => {
    // Half-open [start, end). Arbitrary, but it has to be decided somewhere, or
    // both phases claim the frame and the counts stop adding up.
    expect(phaseAt(W, 10)?.phase).toBe("habitual");
    expect(phaseAt(W, 16)?.phase).toBe("standardized");
  });

  it("returns null past the end rather than clamping to the last phase", () => {
    // A frame captured after the hold is over was taken while the person was no
    // longer holding anything. Attributing it to `standardized` would be a
    // measurement of the wrong thing, not a missing one.
    expect(phaseAt(W, 22)).toBeNull();
    expect(phaseAt(W, 30)).toBeNull();
  });

  it("returns null before the start and for a non-finite time", () => {
    expect(phaseAt(W, -0.1)).toBeNull();
    expect(phaseAt(W, Number.NaN)).toBeNull();
    expect(phaseAt(W, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("cadenceAt", () => {
  it("reports what is left in the phase and in the whole step", () => {
    const state = cadenceAt(W, 12);
    expect(state.current?.phase).toBe("habitual");
    expect(state.remainingInPhase).toBeCloseTo(4);
    expect(state.remainingTotal).toBeCloseTo(10);
    expect(state.phaseProgress).toBeCloseTo(2 / 6);
    expect(state.next?.phase).toBe("standardized");
  });

  it("has no next phase on the last block", () => {
    expect(cadenceAt(W, 18).next).toBeNull();
  });

  it("fires justChanged exactly once per boundary", () => {
    // So a spoken prompt or a haptic cue happens once, not on every frame of
    // the new phase.
    let previous: number | null = null;
    const fired: string[] = [];
    for (let t = 0; t < 22; t += 0.1) {
      const state = cadenceAt(W, t, previous);
      if (state.justChanged && state.current) {
        fired.push(state.current.phase);
        previous = state.current.index;
      }
    }
    expect(fired).toEqual(["relaxed", "habitual", "standardized"]);
  });

  it("reports the step as finished past the end", () => {
    const state = cadenceAt(W, 25, 2);
    expect(state.current).toBeNull();
    expect(state.remainingTotal).toBe(0);
    expect(state.phaseProgress).toBe(1);
    expect(state.justChanged).toBe(false);
  });

  it("is derived from one elapsed value, so tag and countdown cannot disagree", () => {
    // The whole reason this is pure: a second independent timer would drift
    // against the recorder's clock, and a frame could be tagged with a phase
    // whose prompt had not changed yet.
    for (const t of [0, 9.99, 10, 15.99, 16, 21.99]) {
      const state = cadenceAt(W, t);
      expect(state.current?.phase).toBe(phaseAt(W, t)?.phase);
    }
  });
});

describe("tagFrames", () => {
  it("tags every frame with the phase it fell in", () => {
    expect(tagFrames(W, [0, 4, 10, 15, 16, 21])).toEqual([
      "relaxed",
      "relaxed",
      "habitual",
      "habitual",
      "standardized",
      "standardized",
    ]);
  });

  it("leaves a frame outside every window untagged rather than guessing", () => {
    expect(tagFrames(W, [-1, 22, 100])).toEqual([undefined, undefined, undefined]);
  });

  it("counts frames per phase from real timestamps, not declared durations", () => {
    // 30 fps over the whole 22 s. A split by declared duration would be a guess
    // that drifts with every dropped frame; this counts what was captured.
    const times = Array.from({ length: 660 }, (_, i) => i / 30);
    const counts = framesPerPhase(W, times);
    expect(counts.relaxed).toBe(300); // 10 s
    expect(counts.habitual).toBe(180); // 6 s
    expect(counts.standardized).toBe(180); // 6 s
    expect(counts.relaxed! + counts.habitual! + counts.standardized!).toBe(times.length);
  });

  it("a dropped run of frames shrinks that phase's count and no other", () => {
    // The property that makes capture-time tagging worth it: the analysis sees
    // which phase lost coverage instead of inferring boundaries that have moved.
    const times = Array.from({ length: 660 }, (_, i) => i / 30).filter(
      (t) => !(t >= 11 && t < 13) // two seconds lost inside `habitual`
    );
    const counts = framesPerPhase(W, times);
    expect(counts.relaxed).toBe(300);
    expect(counts.habitual).toBe(120); // 6 s - 2 s
    expect(counts.standardized).toBe(180);
  });
});

describe("resolveSequence with a synthetic multi-block battery", () => {
  const battery = {
    version: "test-multiblock",
    status: "draft",
    steps: [
      {
        stepId: "static.anterior",
        module: "static",
        title: "Facing the camera",
        instruction: "Face the camera.",
        view: "anterior",
        kind: "hold",
        durationSeconds: 22,
        minFps: 24,
        modes: ["clinic"],
        metricKeys: ["static.shoulder_line_tilt"],
        subBlocks: BLOCKS,
      },
      {
        stepId: "static.posterior",
        module: "static",
        title: "Back to the camera",
        instruction: "Turn around.",
        view: "posterior",
        kind: "hold",
        durationSeconds: 5,
        minFps: 24,
        modes: ["clinic"],
        metricKeys: [],
      },
    ],
  };

  it("takes each step's own duration instead of one global", () => {
    // The drift this slice fixes: the battery said 15/5/5/5 and the app recorded
    // 30 s for every step from `CLIP_SECONDS`.
    const { steps, source } = resolveSequence(battery);
    expect(source).toBe("battery");
    expect(steps.map((s) => s.durationSeconds)).toEqual([22, 5]);
  });

  it("keeps the battery's own order", () => {
    // The sequence a clinician authored is part of the protocol; re-sorting by
    // view or id here would silently reorder their assessment.
    expect(resolveSequence(battery).steps.map((s) => s.stepId)).toEqual([
      "static.anterior",
      "static.posterior",
    ]);
  });

  it("resolves sub-blocks only on the step that declares them", () => {
    const steps = resolveSequence(battery).steps;
    const multi = steps[0]!;
    const single = steps[1]!;
    expect(multi.subBlocks?.map((b) => b.phase)).toEqual(["relaxed", "habitual", "standardized"]);
    expect(single.subBlocks).toBeUndefined();
  });

  it("the resolved sub-blocks sum to the step's declared duration", () => {
    const multi = resolveSequence(battery).steps[0]!;
    expect(totalSeconds(multi.subBlocks!)).toBe(multi.durationSeconds);
  });

  it("filters by mode so a clinic-only step cannot reach a patient run", () => {
    expect(resolveSequence(battery, { mode: "patient" }).source).toBe("fallback");
  });

  it("reports the fallback rather than looking like a real battery", () => {
    // A silent fallback is how the original drift survived: it has to be
    // distinguishable from the clinic's protocol.
    const result = resolveSequence(null);
    expect(result.source).toBe("fallback");
    expect(result.reason).toMatch(/could not be read/);
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("drops a half-understood sub-block list entirely", () => {
    // Worse than none: the cadence would run phases the clinician never
    // authored while the frames carried their names.
    const bad = {
      steps: [
        {
          ...battery.steps[0],
          subBlocks: [{ phase: "relaxed", durationSeconds: 10, instruction: "x" }, { phase: "nonsense" }],
        },
      ],
    };
    expect(resolveSequence(bad).steps[0]!.subBlocks).toBeUndefined();
  });

  it("ignores a single sub-block, which is not a multi-phase hold", () => {
    const one = {
      steps: [{ ...battery.steps[0], subBlocks: [BLOCKS[0]] }],
    };
    expect(resolveSequence(one).steps[0]!.subBlocks).toBeUndefined();
  });

  it("defaults the risk flags to false, never to required", () => {
    // An absent flag must not be read as "a spotter is required", which would
    // block an ordinary static step. The server refuses the clip independently,
    // so the app being wrong here cannot get an unspotted capture recorded.
    const step = resolveSequence(battery).steps[0]!;
    expect(step.requiresSpotter).toBe(false);
    expect(step.eyesClosed).toBe(false);
    expect(step.stance).toBe("bilateral");
  });

  it("carries the risk flags through when the battery sets them", () => {
    const balance = {
      steps: [
        {
          ...battery.steps[0],
          stepId: "balance.single_left",
          requiresSpotter: true,
          eyesClosed: true,
          stance: "single_left",
          subBlocks: undefined,
          durationSeconds: 10,
        },
      ],
    };
    const [step] = resolveSequence(balance).steps;
    expect(step).toMatchObject({ requiresSpotter: true, eyesClosed: true, stance: "single_left" });
  });

  it("falls back per step when a duration is missing, and says so by value", () => {
    const noDuration = { steps: [{ ...battery.steps[1], durationSeconds: undefined }] };
    expect(resolveSequence(noDuration).steps[0]!.durationSeconds).toBe(30);
  });
});

describe("subPhase through buildSidecar into the uploaded sidecar", () => {
  // `GravitySample` names the vector `g`, not `gravity`.
  const gravitySamples = Array.from({ length: 240 }, (_, i) => ({
    t: i / 10,
    g: [0, 1, 0] as [number, number, number],
  }));

  function build(frameTimes: number[], withPhases: boolean) {
    return buildSidecar({
      clipId: "c-1",
      sessionId: "s-1",
      stepId: "static.anterior",
      view: "anterior",
      recordedAt: new Date().toISOString(),
      fps: 30,
      width: 1080,
      height: 1440,
      frameTimes,
      subPhases: withPhases ? tagFrames(W, frameTimes) : undefined,
      gravitySamples,
      device: { model: "iPad16,2", lens: "back_wide", appVersion: "1.0.0" },
    });
  }

  const times = Array.from({ length: 660 }, (_, i) => i / 30);

  it("tags each frame with the phase it was captured in", () => {
    const sidecar = build(times, true);
    expect(sidecar.frames[0]!.subPhase).toBe("relaxed");
    expect(sidecar.frames[299]!.subPhase).toBe("relaxed"); // t = 9.967
    expect(sidecar.frames[300]!.subPhase).toBe("habitual"); // t = 10.0
    expect(sidecar.frames[479]!.subPhase).toBe("habitual"); // t = 15.967
    expect(sidecar.frames[480]!.subPhase).toBe("standardized"); // t = 16.0
    expect(sidecar.frames[659]!.subPhase).toBe("standardized");
  });

  it("gives the analysis deterministic boundaries with no heuristic splitting", () => {
    // The point of tagging at capture time: every frame carries its own phase,
    // so the counts are a fact about the recording rather than a reconstruction.
    const sidecar = build(times, true);
    const counts = sidecar.frames.reduce<Record<string, number>>((acc, f) => {
      if (f.subPhase) acc[f.subPhase] = (acc[f.subPhase] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ relaxed: 300, habitual: 180, standardized: 180 });
    expect(sidecar.frames.every((f) => f.subPhase !== undefined)).toBe(true);
  });

  it("OMITS subPhase entirely for a single-phase hold", () => {
    // Absent, not null: the schema has no null for this field, and an ordinary
    // static hold has no sub-phase to name.
    const sidecar = build(times, false);
    expect(sidecar.frames.every((f) => !("subPhase" in f))).toBe(true);
  });

  it("omits the tag on a frame that fell outside every window", () => {
    // Rather than attributing it to the nearest phase. A frame captured after
    // the hold ended was taken while the person was no longer holding anything.
    const overrun = [...times, 22.5, 23.0];
    const sidecar = build(overrun, true);
    expect(sidecar.frames[659]!.subPhase).toBe("standardized");
    expect("subPhase" in sidecar.frames[660]!).toBe(false);
    expect("subPhase" in sidecar.frames[661]!).toBe(false);
  });
});
