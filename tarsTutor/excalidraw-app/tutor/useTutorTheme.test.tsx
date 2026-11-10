import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle, useTutorTheme } from "./useTutorTheme";

beforeEach(() => {
  window.localStorage.clear();
  delete window.document.documentElement.dataset.tarsTheme;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.document.documentElement.dataset.tarsTheme;
  window.localStorage.clear();
});
describe("shared tutor theme", () => {
  it("switches all mounted surfaces together and persists across remounts", () => {
    window.localStorage.setItem("tars-theme", "light");
    const hook = renderHook(() => useTutorTheme(window));
    const controls = render(<ThemeToggle view={window} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to dark mode" }),
    );
    expect(hook.result.current.theme).toBe("dark");
    expect(window.document.documentElement.dataset.tarsTheme).toBe("dark");
    expect(window.localStorage.getItem("tars-theme")).toBe("dark");
    controls.unmount();
    hook.unmount();
    const restored = renderHook(() => useTutorTheme(window));
    expect(restored.result.current.theme).toBe("dark");
    act(() => restored.result.current.setTheme("light"));
    expect(window.document.documentElement.dataset.tarsTheme).toBe("light");
  });
  it("continues to switch when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    const hook = renderHook(() => useTutorTheme(window));
    act(() => hook.result.current.setTheme("dark"));
    expect(hook.result.current.theme).toBe("dark");
    expect(window.document.documentElement.dataset.tarsTheme).toBe("dark");
  });
});
