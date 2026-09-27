// Canvas odometer: draws a formatted number whose digits ROLL to new values
// instead of swapping. The chart's price pill is pinned in place, so this roll
// is the only thing that moves on it — the canvas twin of components/ui/Odometer.
//
// Slots are indexed from the RIGHT, so the cents stay the cents when the string
// grows a digit ("$99.98" → "$100.02"). Non-digit slots ($ , . + −) are drawn
// static. Digits roll up when the value rises and down when it falls, like a
// mechanical counter, rather than taking the numerically shortest path.

interface DigitSlot {
  /** Eased position; floor(cur) mod 10 is the digit showing, the fraction is the roll. */
  cur: number;
  /** Where `cur` is heading. Unbounded — wraps are just +10 / −10 of travel. */
  target: number;
}

/** Fraction of the remaining roll covered per frame (~250ms to settle). */
const ROLL_EASE = 0.22;

const mod10 = (n: number) => ((n % 10) + 10) % 10;

export class CanvasOdometer {
  private text = "";
  private value: number | null = null;
  /** Digit state per slot, indexed from the right; null = non-digit slot. */
  private slots: (DigitSlot | null)[] = [];

  /** Current string, for sizing the pill around it. */
  get label(): string {
    return this.text;
  }

  /** Point the odometer at a new value. Cheap to call every frame. */
  set(text: string, value: number) {
    if (text === this.text) return;
    const dir =
      this.value == null || value === this.value
        ? 0
        : value > this.value
          ? 1
          : -1;
    this.value = value;
    this.text = text;

    const next: (DigitSlot | null)[] = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[text.length - 1 - i]!;
      const d = ch.charCodeAt(0) - 48;
      if (d < 0 || d > 9) {
        next.push(null);
        continue;
      }
      const prev = this.slots[i];
      if (!prev) {
        // New slot (first value, or the string just grew): no roll to show.
        next.push({ cur: d, target: d });
        continue;
      }
      const at = mod10(prev.target);
      if (at !== d) {
        const up = mod10(d - at);
        const down = mod10(at - d);
        // Direction follows the value; with no direction, take the short way.
        const step = dir > 0 ? up : dir < 0 ? -down : up <= down ? up : -down;
        prev.target += step;
      }
      next.push(prev);
    }
    this.slots = next;
  }

  /** Forget everything, so the next value snaps in without rolling. */
  reset() {
    this.text = "";
    this.value = null;
    this.slots = [];
  }

  /**
   * Advance the roll one frame and draw the string right-aligned at `xRight`,
   * vertically centered on `y`. The caller sets font + fillStyle and clips to
   * the pill, so digits rolling in and out are cut at its edge. `cellH` is the
   * vertical travel of one digit step.
   */
  draw(ctx: CanvasRenderingContext2D, xRight: number, y: number, cellH: number) {
    const cw = ctx.measureText("0").width;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < this.slots.length; i++) {
      const cx = xRight - (i + 0.5) * cw;
      const slot = this.slots[i];
      if (!slot) {
        ctx.fillText(this.text[this.text.length - 1 - i]!, cx, y);
        continue;
      }
      const diff = slot.target - slot.cur;
      if (Math.abs(diff) < 0.002) {
        // Settled: fold the travel back into 0..9 so it never grows unbounded.
        slot.target = slot.cur = mod10(slot.target);
      } else {
        slot.cur += diff * ROLL_EASE;
      }
      const base = Math.floor(slot.cur);
      const frac = slot.cur - base;
      ctx.fillText(String(mod10(base)), cx, y - frac * cellH);
      if (frac > 0.001) {
        ctx.fillText(String(mod10(base + 1)), cx, y + (1 - frac) * cellH);
      }
    }
  }

  /** Width the current string occupies in the ctx's current (monospace) font. */
  width(ctx: CanvasRenderingContext2D): number {
    return ctx.measureText("0").width * this.text.length;
  }
}
