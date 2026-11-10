import { useCallback, useEffect, useRef, useState } from "react";

import { readableError } from "./classroomMedia";
import { speechLanguage } from "./speechLanguage";
import type { ClassroomWindow } from "../../shared/classroom";

export const useClassroomAudio = (
  view: ClassroomWindow,
  speed: number,
  muted: boolean,
) => {
  const audio = useRef<HTMLAudioElement | null>(null);
  const mode = useRef<"lesson" | "reply" | null>(null);
  const track = useRef({ text: "", duration: 30 });
  const operation = useRef(0);
  const progressRef = useRef(0);
  const clockRef = useRef(0);
  const playingRef = useRef(false);
  const silentRef = useRef(false);
  const speedRef = useRef(speed);
  const cache = useRef(new Map<string, Promise<string>>());
  const urls = useRef(new Set<string>());
  const controllers = useRef(new Set<AbortController>());
  const alive = useRef(true);
  const [progress, updateProgress] = useState(0);
  const [replyProgress, setReplyProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [isReply, setIsReply] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [silent, updateSilent] = useState(false);

  const setProgress = useCallback((value: number) => {
    const normalized = Math.max(0, Math.min(1, value));
    progressRef.current = normalized;
    updateProgress(normalized);
    if (
      mode.current === "lesson" &&
      audio.current &&
      Number.isFinite(audio.current.duration)
    ) {
      audio.current.currentTime = audio.current.duration * normalized;
    }
  }, []);

  const pause = useCallback(() => {
    operation.current += 1;
    const node = audio.current;
    if (
      playingRef.current &&
      !silentRef.current &&
      mode.current === "lesson" &&
      node &&
      Number.isFinite(node.duration) &&
      node.duration > 0
    ) {
      progressRef.current = Math.min(1, node.currentTime / node.duration);
      updateProgress(progressRef.current);
    }
    audio.current?.pause();
    playingRef.current = false;
    setPlaying(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    const node = view.document.createElement("audio");
    node.preload = "auto";
    audio.current = node;
    node.onended = () => {
      if (mode.current === "lesson") {
        progressRef.current = 1;
        updateProgress(1);
      } else {
        setReplyProgress(1);
      }
      playingRef.current = false;
      setPlaying(false);
    };
    node.onerror = () => {
      if (!node.src || !alive.current) {
        return;
      }
      node.pause();
      playingRef.current = false;
      setPlaying(false);
      setLoading(false);
      setError(
        "Narration could not be played. Retry audio, or continue with silent playback.",
      );
    };
    const timer = view.setInterval(() => {
      const now = view.performance.now();
      if (playingRef.current) {
        if (silentRef.current && mode.current === "lesson") {
          const next = Math.min(
            1,
            progressRef.current +
              (((now - clockRef.current) / 1000) * speedRef.current) /
                Math.max(1, track.current.duration),
          );
          progressRef.current = next;
          updateProgress(next);
          if (next >= 1) {
            playingRef.current = false;
            setPlaying(false);
          }
        } else if (Number.isFinite(node.duration) && node.duration > 0) {
          const next = Math.max(
            0,
            Math.min(1, node.currentTime / node.duration),
          );
          if (mode.current === "lesson") {
            progressRef.current = next;
            updateProgress(next);
          } else {
            setReplyProgress(next);
          }
        }
      }
      clockRef.current = now;
    }, 80);
    return () => {
      alive.current = false;
      operation.current += 1;
      playingRef.current = false;
      node.pause();
      node.removeAttribute("src");
      node.onended = null;
      node.onerror = null;
      for (const controller of controllers.current) {
        controller.abort();
      }
      controllers.current.clear();
      for (const url of urls.current) {
        view.URL.revokeObjectURL(url);
      }
      urls.current.clear();
      cache.current.clear();
      view.clearInterval(timer);
    };
  }, [view]);

  useEffect(() => {
    speedRef.current = speed;
    if (audio.current) {
      audio.current.playbackRate = speed;
      audio.current.muted = muted;
    }
  }, [speed, muted]);

  const getAudio = useCallback(
    (text: string) => {
      const existing = cache.current.get(text);
      if (existing) {
        return existing;
      }
      const controller = new view.AbortController();
      controllers.current.add(controller);
      const timeout = view.setTimeout(() => controller.abort(), 100000);
      const result = (async () => {
        try {
          const response = await view.fetch("/api/tutor/speech/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, language: speechLanguage(text) }),
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(await readableError(response));
          }
          const blob = await response.blob();
          if (!alive.current) {
            throw new Error("Narration request was cancelled.");
          }
          const url = view.URL.createObjectURL(blob);
          urls.current.add(url);
          return url;
        } catch (failure) {
          cache.current.delete(text);
          throw failure;
        } finally {
          view.clearTimeout(timeout);
          controllers.current.delete(controller);
        }
      })();
      cache.current.set(text, result);
      return result;
    },
    [view],
  );

  const play = useCallback(
    async (
      text: string,
      duration: number,
      kind: "lesson" | "reply" = "lesson",
    ) => {
      pause();
      track.current = { text, duration };
      const ticket = ++operation.current;
      mode.current = kind;
      setIsReply(kind === "reply");
      setError("");
      if (kind === "reply") {
        setReplyProgress(0);
      }
      if (silentRef.current) {
        if (kind === "reply") {
          setReplyProgress(1);
          return;
        }
        clockRef.current = view.performance.now();
        playingRef.current = true;
        setPlaying(true);
        return;
      }
      setLoading(true);
      try {
        const url = await getAudio(text);
        const node = audio.current;
        if (!alive.current || ticket !== operation.current || !node) {
          return;
        }
        node.src = url;
        node.playbackRate = speedRef.current;
        const offset = kind === "lesson" ? progressRef.current : 0;
        await new Promise<void>((resolve, reject) => {
          const timer = view.setTimeout(
            () => reject(new Error("Audio loading timed out. Please retry.")),
            20000,
          );
          node.onloadedmetadata = () => {
            view.clearTimeout(timer);
            if (Number.isFinite(node.duration)) {
              node.currentTime = node.duration * offset;
            }
            resolve();
          };
          node.addEventListener(
            "error",
            () => {
              view.clearTimeout(timer);
              reject(new Error("The narration audio could not be decoded."));
            },
            { once: true },
          );
          node.load();
        });
        if (!alive.current || ticket !== operation.current) {
          return;
        }
        await node.play();
        if (!alive.current || ticket !== operation.current) {
          node.pause();
          return;
        }
        playingRef.current = true;
        setPlaying(true);
      } catch (failure) {
        if (alive.current && ticket === operation.current) {
          const message =
            failure instanceof Error
              ? failure.message
              : "Could not load narration.";
          setError(
            message.includes("play()") || message.includes("interact")
              ? "Press Play to enable audio in your browser."
              : message,
          );
          playingRef.current = false;
          setPlaying(false);
        }
      } finally {
        if (alive.current && ticket === operation.current) {
          setLoading(false);
        }
      }
    },
    [getAudio, pause, view],
  );

  const setSilent = useCallback(
    (value: boolean) => {
      pause();
      silentRef.current = value;
      updateSilent(value);
      setError("");
    },
    [pause],
  );

  const preload = useCallback(
    (text: string) => {
      if (!silentRef.current && text) {
        void getAudio(text).catch(() => {
          /* Playback displays any retry failure. */
        });
      }
    },
    [getAudio],
  );

  return {
    progress,
    replyProgress,
    playing,
    isReply,
    loading,
    error,
    silent,
    setSilent,
    pause,
    play,
    setProgress,
    preload,
  };
};
