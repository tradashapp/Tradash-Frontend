"use client";

import { useEffect } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

interface Props {
  value: number;
  className?: string;
  prefix?: string;
}

// Smoothly counts to the target value instead of jumping. Used for live PnL so
// the number glides as the price moves.
export function PnLCounter({ value, className, prefix = "$" }: Props) {
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { stiffness: 90, damping: 20, mass: 0.4 });
  const text = useTransform(spring, (v) => {
    const sign = v >= 0 ? "+" : "−";
    return `${sign}${prefix}${Math.abs(v).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  });

  useEffect(() => {
    mv.set(value);
  }, [value, mv]);

  return <motion.span className={className}>{text}</motion.span>;
}
