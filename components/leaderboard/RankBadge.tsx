"use client";

/**
 * Medal badges for the podium's top three, and the matching numerals used in the
 * ranked table.
 *
 * The badge is one inline SVG per rank rather than three image files: it has to
 * sit on a translucent glass cube and recolour per metal, and a PNG would carry
 * its own background and fringe against the blur behind it. Inline also means
 * the gradients below are the single source of truth for "what gold looks like"
 * — the table numerals reuse the very same stops, so a 1st-place cube and a
 * "1" in the list are unmistakably the same material.
 *
 * Shape, from the top down: a pair of wings spreading left and right from a wide
 * crossbar, tapering as they go out; below them a short neck; then the round
 * medallion carrying the numeral. The wings are what make it read as an award
 * rather than a coin, and the wide top is what lets it sit over the narrow stem
 * without looking top-heavy.
 */

export type Metal = "gold" | "silver" | "bronze";

/**
 * Each metal as four stops: the two highlights that catch the light, the body
 * tone, and the shadow the underside falls into. Real metal is not one colour
 * with a lighter tint — it is a bright specular band against a much darker
 * body, which is why the light/dark spread here is deliberately wide.
 */
const METALS: Record<
  Metal,
  { light: string; mid: string; body: string; dark: string; glow: string }
> = {
  gold: {
    light: "#FFF6D0",
    mid: "#FFD75E",
    body: "#E8A317",
    dark: "#8A5A06",
    glow: "rgba(255, 199, 64, 0.55)",
  },
  silver: {
    light: "#FFFFFF",
    mid: "#E2E8F0",
    body: "#A8B2C1",
    dark: "#5A6474",
    glow: "rgba(226, 232, 240, 0.45)",
  },
  bronze: {
    light: "#FFD9B0",
    mid: "#E09B5F",
    body: "#B96F32",
    dark: "#6B3A12",
    glow: "rgba(224, 155, 95, 0.45)",
  },
};

export const RANK_METAL: Record<1 | 2 | 3, Metal> = {
  1: "gold",
  2: "silver",
  3: "bronze",
};

/** Unique gradient ids per instance — two badges on one page must not collide. */
let seq = 0;

interface BadgeProps {
  rank: 1 | 2 | 3;
  /** Rendered width in px; the badge keeps its aspect ratio. */
  size?: number;
  className?: string;
}

export function RankBadge({ rank, size = 46, className = "" }: BadgeProps) {
  const metal = METALS[RANK_METAL[rank]];
  // useId would be the idiomatic choice, but this component also renders inside
  // a `.map` where React may reuse ids across re-orders; a module counter is
  // stable for the life of the element either way.
  const id = `badge-${rank}-${++seq}`;
  const face = `${id}-face`;
  const wing = `${id}-wing`;
  const rim = `${id}-rim`;

  return (
    <svg
      viewBox="0 0 64 58"
      width={size}
      height={(size * 58) / 64}
      fill="none"
      className={className}
      aria-hidden
      style={{ filter: `drop-shadow(0 2px 6px ${metal.glow})` }}
    >
      <defs>
        {/* Wings: lit from the upper left, falling into shadow at the tips. */}
        <linearGradient id={wing} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={metal.light} />
          <stop offset="45%" stopColor={metal.mid} />
          <stop offset="100%" stopColor={metal.dark} />
        </linearGradient>
        {/* Medallion face — a diagonal sweep so the disc reads as domed. */}
        <linearGradient id={face} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor={metal.light} />
          <stop offset="38%" stopColor={metal.mid} />
          <stop offset="72%" stopColor={metal.body} />
          <stop offset="100%" stopColor={metal.dark} />
        </linearGradient>
        {/* Outer rim, darker than the face so the disc has an edge. */}
        <linearGradient id={rim} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor={metal.mid} />
          <stop offset="100%" stopColor={metal.dark} />
        </linearGradient>
      </defs>

      {/* Wings. Drawn as one mirrored pair sweeping out and slightly up from
          the crossbar, with three feather notches cut into each trailing edge
          so the silhouette reads as plumage at small sizes. */}
      <g fill={`url(#${wing})`}>
        <path d="M31 13 L10 9 Q3 8.5 1.5 12.5 Q6 13.5 8 15.5 Q3.5 15.5 2.5 18.5 Q8 19.5 10.5 21.5 Q6.5 22 6 24.5 Q15 25.5 22 22.5 Q28 20 31 16.5 Z" />
        <path d="M33 13 L54 9 Q61 8.5 62.5 12.5 Q58 13.5 56 15.5 Q60.5 15.5 61.5 18.5 Q56 19.5 53.5 21.5 Q57.5 22 58 24.5 Q49 25.5 42 22.5 Q36 20 33 16.5 Z" />
      </g>

      {/* Crossbar joining the wings over the neck. */}
      <rect x="25" y="10" width="14" height="7" rx="3" fill={`url(#${rim})`} />

      {/* Neck — the short stem the medallion hangs from. */}
      <path d="M28 16 L36 16 L34.5 25 L29.5 25 Z" fill={`url(#${rim})`} />

      {/* Medallion. */}
      <circle cx="32" cy="39" r="17" fill={`url(#${rim})`} />
      <circle cx="32" cy="39" r="14" fill={`url(#${face})`} />
      {/* Inner bevel ring, and a specular arc across the upper left of the
          dome — the two together are what stop the disc looking flat. */}
      <circle
        cx="32"
        cy="39"
        r="11"
        fill="none"
        stroke={metal.dark}
        strokeOpacity="0.35"
        strokeWidth="1"
      />
      <path
        d="M23 33 Q28 28 36 29"
        stroke="#fff"
        strokeOpacity="0.6"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* The numeral, struck into the medallion. The dark copy offset a hair
          below the light one is what gives the digit its engraved edge. */}
      <text
        x="32"
        y="45.5"
        textAnchor="middle"
        fontSize="17"
        fontWeight="900"
        fill={metal.dark}
        fillOpacity="0.55"
        style={{ fontFamily: "var(--font-sans), system-ui, sans-serif" }}
      >
        {rank}
      </text>
      <text
        x="32"
        y="44.8"
        textAnchor="middle"
        fontSize="17"
        fontWeight="900"
        fill="#fff"
        fillOpacity="0.95"
        style={{ fontFamily: "var(--font-sans), system-ui, sans-serif" }}
      >
        {rank}
      </text>
    </svg>
  );
}

/**
 * The rank numeral for a table row, struck in the same metal as its badge.
 *
 * Text gradients need `background-clip: text`, so this is a span rather than an
 * SVG — it has to sit on the row's baseline and inherit the tabular figures the
 * column depends on for alignment.
 */
export function RankNumeral({ rank }: { rank: 1 | 2 | 3 }) {
  const metal = METALS[RANK_METAL[rank]];
  return (
    <span
      className="tabular font-black"
      style={{
        backgroundImage: `linear-gradient(150deg, ${metal.light} 0%, ${metal.mid} 38%, ${metal.body} 70%, ${metal.dark} 100%)`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        // A soft bloom in the metal's own colour: the gradient alone reads as
        // grey against a dark row, since the darkest stop is most of the glyph.
        filter: `drop-shadow(0 0 5px ${metal.glow})`,
      }}
    >
      {rank}
    </span>
  );
}
