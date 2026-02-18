export function buildHistoryEntries(hist) {
  const raw = Array.isArray(hist?.sessions) ? hist.sessions : [];
  const rawEntries = raw.map((session, sourceIndex) => ({
    session,
    sourceIndex: Number.isFinite(Number(session?.id)) ? Number(session.id) : sourceIndex,
  }));

  const seenMockIds = new Set();
  const deduped = [];
  for (let i = rawEntries.length - 1; i >= 0; i -= 1) {
    const entry = rawEntries[i];
    const mid = entry?.session?.type === "mock" ? entry?.session?.details?.mockSessionId : null;
    if (mid) {
      if (seenMockIds.has(mid)) continue;
      seenMockIds.add(mid);
    }
    deduped.push(entry);
  }
  return deduped.reverse();
}

export function buildHistoryStats(entries) {
  const sessions = entries.map((x) => x.session);
  const byType = {
    bs: sessions.filter((s) => s.type === "bs"),
    email: sessions.filter((s) => s.type === "email"),
    discussion: sessions.filter((s) => s.type === "discussion"),
    mock: sessions.filter((s) => s.type === "mock"),
  };
  const hasPendingMock = byType.mock.some(
    (m) => Array.isArray(m?.details?.tasks) && m.details.tasks.some((t) => !Number.isFinite(t?.score)),
  );

  return {
    sessions,
    byType,
    hasPendingMock,
  };
}

export function buildRecentEntries(entries, limit = 10) {
  return entries.slice(-limit).reverse();
}
