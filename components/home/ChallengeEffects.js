"use client";

import { useEffect, useRef } from "react";
import { CHALLENGE_TOKENS as CH } from "./theme";

export function ParticleField() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resize();
    window.addEventListener("resize", resize);

    const particles = Array.from({ length: 60 }, () => ({
      x: Math.random() * (canvas.width || 800),
      y: Math.random() * (canvas.height || 600),
      r: Math.random() * 2 + 0.5,
      vy: -(Math.random() * 0.5 + 0.15),
      vx: (Math.random() - 0.5) * 0.3,
      a: Math.random() * 0.45 + 0.1,
    }));

    let raf = 0;
    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const particle of particles) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        if (particle.y < -10) {
          particle.y = canvas.height + 10;
          particle.x = Math.random() * canvas.width;
        }
        if (particle.x < -10) particle.x = canvas.width + 10;
        if (particle.x > canvas.width + 10) particle.x = -10;

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,50,50,${particle.a})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(loop);
    };

    loop();
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={ref} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }} />;
}

export function ChallengeEffects({ isChallenge, crtFlash }) {
  if (!isChallenge) {
    return crtFlash ? <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 9999, pointerEvents: "none", animation: "ch-crtFlash .4s ease-out forwards" }} /> : null;
  }

  return (
    <>
      <ParticleField />
      <div style={{ position: "fixed", inset: 0, background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.7) 100%)", pointerEvents: "none", zIndex: 1, animation: "ch-vignette 6s ease-in-out infinite" }} />
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,transparent,${CH.accent},transparent)`, zIndex: 2, pointerEvents: "none", animation: "ch-glowPulse 3s ease-in-out infinite" }} />
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,transparent,${CH.accent},transparent)`, zIndex: 2, pointerEvents: "none", animation: "ch-glowPulse 3s ease-in-out infinite" }} />
      <div style={{ position: "fixed", top: 0, left: 0, bottom: 0, width: 2, background: `linear-gradient(180deg,transparent,${CH.accent},transparent)`, zIndex: 2, pointerEvents: "none", animation: "ch-glowPulse 3s ease-in-out infinite" }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 2, background: `linear-gradient(180deg,transparent,${CH.accent},transparent)`, zIndex: 2, pointerEvents: "none", animation: "ch-glowPulse 3s ease-in-out infinite" }} />
      {crtFlash ? <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 9999, pointerEvents: "none", animation: "ch-crtFlash .4s ease-out forwards" }} /> : null}
    </>
  );
}
