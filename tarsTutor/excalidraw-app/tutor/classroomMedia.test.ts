import { describe, expect, it } from "vitest";

import { encodeWav, revealProgress, wrapBoardText } from "./classroomMedia";

describe("classroom timeline", () => {
  it("reveals from the media clock and rewinds correctly after a seek", () => {
    expect(revealProgress(0.1, 0.2)).toBe(0);
    expect(revealProgress(0.25, 0.2, 0.3)).toBeCloseTo(0.5);
    expect(revealProgress(0.7, 0.2)).toBe(1);
    expect(revealProgress(0.1, 0.2)).toBe(0);
    expect(revealProgress(1, 0.9, 0.9)).toBe(1);
  });

  it("wraps sentences while retaining paragraph boundaries", () => {
    expect(wrapBoardText("Learn with examples\n\nThen practice", 12)).toEqual([
      "Learn with",
      "examples",
      "",
      "Then",
      "practice",
    ]);
  });
});

describe("Gnani recording format", () => {
  it("writes an actual mono PCM WAV, downmixing and resampling stereo", () => {
    const wave = encodeWav(
      [new Float32Array(48000).fill(1), new Float32Array(48000).fill(0)],
      48000,
    );
    const data = new DataView(wave);
    expect(new TextDecoder().decode(wave.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wave.slice(8, 12))).toBe("WAVE");
    expect(data.getUint32(24, true)).toBe(16000);
    expect(data.getUint16(22, true)).toBe(1);
    expect(data.getUint16(34, true)).toBe(16);
    expect(data.getUint32(40, true)).toBe(32000);
    expect(data.getInt16(44, true)).toBe(16383);
    expect(wave.byteLength).toBe(32044);
  });

  it("clips samples safely instead of wrapping", () => {
    const data = new DataView(encodeWav([new Float32Array([-2, 2])], 16000));
    expect(data.getInt16(44, true)).toBe(-32768);
    expect(data.getInt16(46, true)).toBe(32767);
  });
});
