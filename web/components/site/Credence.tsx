"use client";

import { useEffect, useState } from "react";
import { Nav } from "./Nav";
import { Hero } from "./Hero";
import { Experiment } from "./Experiment";
import { Behavior } from "./Behavior";
import { Verification } from "./Verification";
import { Credentials } from "./Credentials";
import { Authority } from "./Authority";
import { LaunchYourAgent } from "./LaunchYourAgent";
import { Architecture } from "./Architecture";
import { loadNarrative, type Narrative } from "@/lib/narrative";

export default function Credence() {
  const [n, setN] = useState<Narrative | null>(null);

  const refresh = () => loadNarrative().then(setN);
  useEffect(() => {
    refresh();
  }, []);

  if (!n) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-faint">Loading Credence…</div>
    );
  }

  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Experiment />
        <Behavior alpha={n.alpha} beta={n.beta} />
        <Verification narrative={n} onComplete={refresh} />
        <Credentials alpha={n.alpha} beta={n.beta} />
        <Authority alpha={n.alpha} beta={n.beta} />
        <LaunchYourAgent cfg={n.demo} />
        <Architecture narrative={n} />
      </main>
    </>
  );
}
