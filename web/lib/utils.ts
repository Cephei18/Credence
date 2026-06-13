import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function short(addr?: string) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export const LEVEL_COLORS = ["#9aa0aa", "#22d3ee", "#7c5cff", "#34d399"];
