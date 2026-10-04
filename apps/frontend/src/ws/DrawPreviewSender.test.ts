import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LngLat } from "@snapland/shared";
import { DrawPreviewSender } from "./DrawPreviewSender.js";

const points = (lng: number): LngLat[] => [[lng, 32.08]];
const progress = (lng: number) => ({ type: "draw:progress", payload: { points: points(lng) } });

describe("DrawPreviewSender", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  it("sends immediately, then coalesces rapid changes into one latest update per 100ms", () => {
    const send = vi.fn(() => true);
    const sender = new DrawPreviewSender(send);
    sender.update(points(34));
    expect(send).toHaveBeenCalledWith(progress(34));
    for (let index = 1; index <= 9; index++) {
      vi.advanceTimersByTime(10);
      sender.update(points(34 + index / 100));
    }
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(progress(34.09));
    vi.advanceTimersByTime(500);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keeps sustained regular preview traffic to ten sends in a second", () => {
    const send = vi.fn(() => true);
    const sender = new DrawPreviewSender(send);
    for (let index = 0; index < 100; index++) {
      sender.update(points(34 + index / 100));
      if (index < 99) vi.advanceTimersByTime(10);
    }
    expect(send).toHaveBeenCalledTimes(10);
    sender.reset();
  });

  it("sends the final position immediately and removes the older trailing update", () => {
    const send = vi.fn(() => true);
    const sender = new DrawPreviewSender(send);
    sender.update(points(34));
    vi.advanceTimersByTime(20);
    sender.update(points(35));
    vi.advanceTimersByTime(20);
    sender.update(points(36), true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(progress(36));
    vi.runAllTimers();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("cancels scheduled previews without allowing them to revive a completed draft", () => {
    const send = vi.fn(() => true);
    const sender = new DrawPreviewSender(send);
    sender.update(points(34));
    sender.update(points(35));
    sender.cancel();
    expect(send).toHaveBeenLastCalledWith({ type: "draw:cancel", payload: {} });
    vi.runAllTimers();
    expect(send).toHaveBeenCalledTimes(2);
    sender.update(points(36));
    expect(send).toHaveBeenLastCalledWith(progress(36));
  });

  it("retains only the latest offline preview and flushes it when the transport is ready", () => {
    const send = vi.fn(() => false);
    const sender = new DrawPreviewSender(send);
    for (let index = 0; index < 100; index++) sender.update(points(34 + index / 100));
    send.mockReturnValue(true);
    send.mockClear();
    sender.flush();
    sender.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(progress(34.99));
  });

  it("replaces offline previews with cancellation so reconnect cannot replay the draft", () => {
    const send = vi.fn(() => false);
    const sender = new DrawPreviewSender(send);
    sender.update(points(34));
    sender.update(points(35), true);
    sender.cancel();
    send.mockReturnValue(true);
    send.mockClear();
    sender.flush();
    vi.runAllTimers();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: "draw:cancel", payload: {} });
  });

  it("retains a trailing update when the connection drops before its scheduled send", () => {
    const send = vi.fn(() => true);
    const sender = new DrawPreviewSender(send);
    sender.update(points(34));
    sender.update(points(35));
    send.mockReturnValue(false);
    vi.advanceTimersByTime(100);
    send.mockClear();
    send.mockReturnValue(true);
    sender.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(progress(35));
  });

  it("clears timers and offline state on session change or unmount", () => {
    const send = vi.fn(() => true);
    const sender = new DrawPreviewSender(send);
    sender.update(points(34));
    sender.update(points(35));
    sender.reset();
    vi.runAllTimers();
    expect(send).toHaveBeenCalledTimes(1);
    send.mockReturnValue(false);
    sender.update(points(36));
    sender.reset();
    send.mockClear();
    send.mockReturnValue(true);
    sender.flush();
    expect(send).not.toHaveBeenCalled();
    sender.update(points(37));
    expect(send).toHaveBeenCalledWith(progress(37));
  });
});
