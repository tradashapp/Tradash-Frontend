"use client";

import { motion } from "framer-motion";
import { formatUsd } from "@/lib/format";
import { Avatar } from "./Avatar";
import { RankBadge } from "./RankBadge";
import type { LeaderboardEntry, LeaderboardMetric } from "@/types";

interface Props {
  /** Ranks 1-3, in rank order. Shorter arrays render the slots that exist. */
  top: LeaderboardEntry[];
  metric: LeaderboardMetric;
  onSelect: (entry: LeaderboardEntry) => void;
}

/**
 * The top three, as a podium.
 *
 * Layout: 2nd — 1st — 3rd, with 1st both taller and lifted, so the eye lands on
 * the winner before it reads the ranks. The staggered heights are what make the
 * arrangement read diagonally; the runners-up also sit lower on the baseline
 * (translate-y) so the three tops form a shallow V rather than a flat row.
 *
 * The avatar overlaps the top edge of each plinth rather than sitting inside it,
 * which is what keeps a short box from looking cramped.
 *
 * Each plinth is a 3D glass cube — see `Plinth` for how the three faces are
 * assembled. All three share one light source (up and to the left) and one
 * vanishing direction (back and to the right), which is what stops the row from
 * reading as three unrelated boxes.
 */
export function Podium({ top, metric, onSelect }: Props) {
  // Index by rank rather than by array position — a board with two traders on
  // it must still put the winner in the middle, not on the left.
  const byRank = new Map(top.map((e) => [e.rank, e]));
  const order: { rank: 1 | 2 | 3 }[] = [{ rank: 2 }, { rank: 1 }, { rank: 3 }];

  return (
    <div className="mb-5 flex items-end justify-center gap-2 px-1 pt-10">
      {order.map(({ rank }, i) => {
        const entry = byRank.get(rank);
        return (
          <Plinth
            key={rank}
            rank={rank}
            entry={entry}
            metric={metric}
            // Stagger the reveal from the winner outwards.
            delay={rank === 1 ? 0 : 0.08 + i * 0.02}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}

/**
 * Per-rank presentation. 1st is taller, lifted, and wears the brightest glow.
 *
 * `tint` values are the rgb triples the cube's faces are built from — every
 * face derives its colour from this one number at a different alpha, so a rank
 * is re-skinned by editing a single line. Each rank is tinted with its own metal
 * so the cube and the badge standing on it read as one object.
 */
const RANKS = {
  1: {
    height: 104,
    lift: "-translate-y-3",
    // Metal tints, matching the badge each plinth carries: gold, silver, bronze.
    // The cube and its badge are the same material seen at different alphas.
    tint: "255, 199, 64",
    /** Only the winner throws a coloured bloom onto the surface beneath. */
    glow: "0 18px 40px -12px rgba(255, 199, 64, 0.4)",
    ringColor: "#FFD75E",
    badge: 52,
    avatar: "h-16 w-16",
  },
  2: {
    height: 78,
    lift: "translate-y-0",
    tint: "226, 232, 240",
    glow: "0 14px 30px -14px rgba(0, 0, 0, 0.7)",
    ringColor: "rgba(226, 232, 240, 0.55)",
    badge: 42,
    avatar: "h-12 w-12",
  },
  3: {
    height: 64,
    lift: "translate-y-1",
    tint: "224, 155, 95",
    glow: "0 14px 30px -14px rgba(0, 0, 0, 0.7)",
    ringColor: "rgba(224, 155, 95, 0.5)",
    badge: 42,
    avatar: "h-12 w-12",
  },
} as const;

/**
 * Depth of the cube in px — how far the top face recedes and how wide the side
 * face is. One value for all three ranks: they sit on the same baseline in the
 * same room, so they must share a vanishing direction. Tuned against the
 * ~130px-wide column a `flex-1` plinth gets inside the 28rem sheet; much more
 * and the top face starts crowding out the avatar above it.
 */
const DEPTH = 14;

function Plinth({
  rank,
  entry,
  metric,
  delay,
  onSelect,
}: {
  rank: 1 | 2 | 3;
  /** Absent when fewer than three traders have ranked — the slot renders empty. */
  entry: LeaderboardEntry | undefined;
  metric: LeaderboardMetric;
  delay: number;
  onSelect: (entry: LeaderboardEntry) => void;
}) {
  const style = RANKS[rank];
  const value = entry
    ? metric === "pnl"
      ? `${entry.pnl >= 0 ? "+" : "−"}${formatUsd(Math.abs(entry.pnl))}`
      : `${entry.roi >= 0 ? "+" : "−"}${Math.abs(entry.roi * 100).toFixed(1)}%`
    : "—";
  const up = (entry?.[metric] ?? 0) >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={`flex flex-1 flex-col items-center ${style.lift}`}
    >
      {/* Avatar + handle, straddling the top edge of the plinth. */}
      {/* The metal ring lives on a wrapper, not on Avatar: Avatar owns its own
          `style` (it paints a generated tint for users with no photo), so the
          ring colour cannot be passed down as an inline custom property. */}
      <span
        className="rounded-full"
        style={{ boxShadow: `0 0 0 ${rank === 1 ? 2 : 1}px ${style.ringColor}` }}
      >
        <Avatar
          src={entry?.avatarUrl}
          name={entry?.username}
          className={style.avatar}
        />
      </span>
      <span className="mt-1.5 max-w-full truncate px-1 text-[11px] font-medium text-text">
        {entry ? `@${entry.username}` : "—"}
      </span>
      <span
        className={`tabular text-[11px] font-semibold ${
          !entry ? "text-text-muted" : up ? "text-up" : "text-down"
        }`}
      >
        {value}
      </span>

      {/* The cube. Three faces sharing one light source (upper left) and one
          vanishing direction (back and to the right):

            top    — brightest, it faces the light,
            side   — the right cheek, mid-tone, giving the solid its weight,
            front  — the glass face carrying the rank label.

          The receding faces are cut with `clip-path` rather than skewed. A
          skewX/skewY pair cannot produce the two parallelograms this needs —
          the sheared box detaches from the front face's corners at anything but
          a trivial angle — whereas naming all four corners places the shared
          edges exactly. It also leaves the label unforeshortened: a 3D
          transform on a parent would tilt the type away from the reader with
          the solid, which is worse than a flat plinth.

          Every corner is expressed against DEPTH, so the three ranks recede in
          parallel despite their different heights. */}
      <button
        type="button"
        disabled={!entry}
        onClick={() => entry && onSelect(entry)}
        aria-label={entry ? `View @${entry.username}` : undefined}
        className={`relative mt-2 w-full transition-transform duration-200 disabled:cursor-default ${
          entry ? "active:scale-[0.97]" : "opacity-40"
        }`}
        // Room for the top face, which stands above the front face's box.
        style={{ height: style.height + DEPTH }}
      >
        {/* Top face. */}
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            clipPath: `polygon(0 ${DEPTH}px, ${DEPTH}px 0, 100% 0, calc(100% - ${DEPTH}px) ${DEPTH}px)`,
            background: `linear-gradient(115deg, rgba(${style.tint}, 0.42), rgba(${style.tint}, 0.2))`,
          }}
        />

        {/* Right side face. Fades out towards the base on the same ramp as the
            front face, so the cube stays open at the bottom on both visible
            sides — otherwise the receding cheek would still close the corner. */}
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            clipPath: `polygon(calc(100% - ${DEPTH}px) ${DEPTH}px, 100% 0, 100% calc(100% - ${DEPTH}px), calc(100% - ${DEPTH}px) 100%)`,
            background: `linear-gradient(to bottom, rgba(${style.tint}, 0.2) 0%, rgba(${style.tint}, 0.07) 45%, rgba(${style.tint}, 0) 100%)`,
          }}
        />

        {/* Front face — the glass itself, and the only face carrying content.

            BOTTOMLESS: there is no bottom border, and the tint fades to fully
            transparent at the base, so the cube dissolves into the sheet rather
            than sitting in a closed box. The side borders are masked to fade out
            over the same distance — a hard 1px edge running all the way down
            would redraw the bottom corners the fade is meant to remove. */}
        <span
          className="absolute bottom-0 left-0 flex items-start justify-center overflow-hidden pt-3"
          style={{
            top: DEPTH,
            right: DEPTH,
            background: `linear-gradient(to bottom, rgba(${style.tint}, 0.2) 0%, rgba(${style.tint}, 0.08) 45%, rgba(${style.tint}, 0) 100%)`,
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            borderTop: `1px solid rgba(${style.tint}, 0.45)`,
            boxShadow: style.glow,
          }}
        >
          {/* Side edges, faded out towards the open base. Drawn as an inset
              shadow on a masked overlay so only the left and right rules show. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              boxShadow: `inset 1px 0 0 rgba(${style.tint}, 0.22), inset -1px 0 0 rgba(${style.tint}, 0.22)`,
              maskImage:
                "linear-gradient(to bottom, #000 0%, #000 45%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, #000 0%, #000 45%, transparent 100%)",
            }}
          />
          {/* Specular sweep across the upper left — this is what sells the face
              as glass rather than flat tinted plastic. Faded at the base too, so
              it doesn't reintroduce a visible bottom edge. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, rgba(255, 255, 255, 0.22) 0%, rgba(255, 255, 255, 0.06) 28%, transparent 52%)",
              maskImage:
                "linear-gradient(to bottom, #000 0%, #000 50%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, #000 0%, #000 50%, transparent 100%)",
            }}
          />
          {/* The medal, struck into the face of the cube. */}
          <RankBadge rank={rank} size={style.badge} className="relative" />
        </span>
      </button>

    </motion.div>
  );
}
