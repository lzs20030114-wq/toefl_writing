export function buildHistoryEntries(hist) {
  const raw = Array.isArray(hist?.sessions) ? hist.sessions : [];
  const rawEntries = raw.map((session, sourceIndex) => ({
    session,
    sourceIndex: Number.isFinite(Number(session?.id)) ? Number(session.id) : sourceIndex,
    _idx: sourceIndex,
  }));

  const latestMockById = new Map();
  rawEntries.forEach((entry) => {
    const mid = entry?.session?.type === "mock" ? entry?.session?.details?.mockSessionId : null;
    if (!mid) return;

    const curTs = Number(new Date(entry?.session?.date || 0));
    const curRank = Number.isFinite(curTs) && curTs > 0 ? curTs : entry._idx;
    const prev = latestMockById.get(mid);
    if (!prev) {
      latestMockById.set(mid, { entry, rank: curRank });
      return;
    }
    if (curRank >= prev.rank) {
      latestMockById.set(mid, { entry, rank: curRank });
    }
  });

  const deduped = rawEntries.filter((entry) => {
    const mid = entry?.session?.type === "mock" ? entry?.session?.details?.mockSessionId : null;
    if (!mid) return true;
    return latestMockById.get(mid)?.entry === entry;
  });

  return deduped.map(({ _idx, ...rest }) => rest);
}

function toTs(entry) {
  const n = Number(new Date(entry?.session?.date || 0));
  if (Number.isFinite(n) && n > 0) return n;
  return Number(entry?.sourceIndex || 0);
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
  const sorted = [...entries].sort((a, b) => toTs(b) - toTs(a));
  return sorted.slice(0, limit);
}
