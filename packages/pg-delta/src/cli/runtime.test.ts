import { afterEach, describe, expect, test } from "bun:test";
import {
  getEnv,
  getRuntimeStdio,
  isInteractiveTerminal,
  setExitCode,
  shouldStyleStderr,
} from "./runtime.ts";

const originalProcess = globalThis.process;

afterEach(() => {
  Object.defineProperty(globalThis, "process", {
    value: originalProcess,
    writable: true,
    configurable: true,
  });
});

describe("cli runtime", () => {
  test("reads env values through the runtime boundary", () => {
    Object.defineProperty(globalThis, "process", {
      value: {
        ...originalProcess,
        env: { TEST_RUNTIME_ENV: "ok" },
      },
      writable: true,
      configurable: true,
    });

    expect(getEnv("TEST_RUNTIME_ENV")).toBe("ok");
  });

  test("sets exit code through the runtime boundary", () => {
    const fakeProcess = {
      ...originalProcess,
      exitCode: 0,
    };
    Object.defineProperty(globalThis, "process", {
      value: fakeProcess,
      writable: true,
      configurable: true,
    });

    setExitCode(7);

    expect(fakeProcess.exitCode).toBe(7);
  });

  test("derives interactive and styling capabilities from stdio", () => {
    const fakeProcess = {
      ...originalProcess,
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      stderr: { isTTY: true },
    };
    Object.defineProperty(globalThis, "process", {
      value: fakeProcess,
      writable: true,
      configurable: true,
    });

    const stdio = getRuntimeStdio();

    expect(stdio.stdin.isTTY).toBe(true);
    expect(isInteractiveTerminal()).toBe(true);
    expect(shouldStyleStderr()).toBe(true);
  });
});
