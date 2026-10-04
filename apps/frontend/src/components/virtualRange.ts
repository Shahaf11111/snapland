/** Fixed-height rows with a small buffer above and below the viewport. */
export function getVisibleRange(count: number, scrollTop: number, height: number, rowHeight: number, overscan = 5) {
  const top = Math.min(Math.max(0, scrollTop), Math.max(0, count * rowHeight - height));
  return {
    start: Math.max(0, Math.floor(top / rowHeight) - overscan),
    end: Math.min(count, Math.ceil((top + height) / rowHeight) + overscan),
  };
}
