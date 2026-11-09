/** Scroll position for a fixed-height viewport that follows new output until the user scrolls up. */
export class Scroller {
  top = 0;
  follow = true;
  private max = 0;

  /** Record content and viewport sizes; returns the first visible line. */
  layout(total: number, height: number): number {
    this.max = Math.max(0, total - height);
    this.top = this.follow ? this.max : Math.min(this.top, this.max);
    return this.top;
  }

  /** Negative scrolls up. Reaching the bottom turns following back on. */
  scrollBy(lines: number): void {
    this.top = Math.max(0, Math.min(this.max, this.top + lines));
    this.follow = this.top === this.max;
  }

  toEnd(): void {
    this.top = this.max;
    this.follow = true;
  }
}
