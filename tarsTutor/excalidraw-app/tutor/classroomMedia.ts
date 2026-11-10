/** Audio/board clocks share a normalized timeline, including after seeks. */
export const revealProgress = (
  progress: number,
  revealAt: number,
  nextRevealAt = 1,
) =>
  Math.max(
    0,
    Math.min(
      1,
      (progress - revealAt) /
        Math.max(0.025, Math.min(0.13, nextRevealAt - revealAt)),
    ),
  );

export const wrapBoardText = (text: string, maxCharacters: number): string[] =>
  text.split("\n").flatMap((paragraph) => {
    if (!paragraph) {
      return [""];
    }
    const lines: string[] = [];
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line && `${line} ${word}`.length > maxCharacters) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
    return lines;
  });

/** Downmix and resample browser recordings to Gnani's mono 16 kHz PCM WAV. */
export const encodeWav = (
  channels: Float32Array[],
  sourceRate: number,
  targetRate = 16000,
): ArrayBuffer => {
  const sourceLength = channels[0]?.length || 0;
  const length = Math.floor((sourceLength * targetRate) / sourceRate);
  const buffer = new ArrayBuffer(44 + length * 2);
  const data = new DataView(buffer);
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      data.setUint8(offset + i, value.charCodeAt(i));
    }
  };
  ascii(0, "RIFF");
  data.setUint32(4, 36 + length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, targetRate, true);
  data.setUint32(28, targetRate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  ascii(36, "data");
  data.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const start = Math.floor((i * sourceRate) / targetRate);
    const end = Math.max(
      start + 1,
      Math.min(sourceLength, Math.floor(((i + 1) * sourceRate) / targetRate)),
    );
    let sample = 0;
    for (const channel of channels) {
      for (let j = start; j < end; j++) {
        sample += channel[j] || 0;
      }
    }
    sample = Math.max(
      -1,
      Math.min(1, sample / Math.max(1, (end - start) * channels.length)),
    );
    data.setInt16(
      44 + i * 2,
      sample < 0 ? sample * 32768 : sample * 32767,
      true,
    );
  }
  return buffer;
};

export const readableError = async (response: Response) => {
  const payload = await response.json().catch(() => null);
  return typeof payload?.detail === "string"
    ? payload.detail
    : response.status === 429
    ? "The tutor is busy. Please try again in a moment."
    : "The request could not be completed. Please try again.";
};
