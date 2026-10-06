"use client";
import { Suspense } from "react";
import MistakeDrill from "../../components/mistakes/MistakeDrill";

export default function MistakeDrillPage() {
  return (
    <Suspense fallback={null}>
      <MistakeDrill />
    </Suspense>
  );
}
