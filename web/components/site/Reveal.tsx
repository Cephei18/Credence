"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

/** Scroll-in reveal — subtle fade + lift. Keeps the journey feeling alive
 *  without distracting motion. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** A numbered narrative section with generous breathing room. */
export function Section({
  id,
  index,
  eyebrow,
  title,
  lede,
  children,
}: {
  id: string;
  index: string;
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section id={id} className="mx-auto max-w-narrative scroll-mt-24 px-6 py-20 sm:py-28">
      <Reveal>
        <div className="flex items-center gap-3">
          <span className="mono text-xs text-faint">{index}</span>
          <span className="h-px w-8 bg-[var(--border-strong)]" />
          <span className="eyebrow">{eyebrow}</span>
        </div>
        <h2 className="mt-5 text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          {title}
        </h2>
        {lede && <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">{lede}</p>}
      </Reveal>
      {children && <div className="mt-10">{children}</div>}
    </section>
  );
}
