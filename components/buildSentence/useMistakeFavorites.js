"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSavedCode } from "../../lib/AuthContext";
import {
  addFavoriteCloud,
  loadFavoritesCloud,
  removeFavoriteCloud,
} from "../../lib/mistakeFavorites";

function pointerKey(sessionId, detailIndex) {
  if (sessionId == null || detailIndex == null) return null;
  return `${sessionId}|${detailIndex}`;
}

/**
 * Hook for the mistake-favorites feature on /mistake-notebook.
 *
 * Returns:
 *   favorites: full list (sorted newest first)
 *   isStarred(sessionId, detailIndex): O(1) lookup
 *   toggleStar(sessionId, detailIndex, snapshot, subject?): optimistic toggle
 *   loading, error, reload
 */
export function useMistakeFavorites() {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const userCodeRef = useRef(null);

  // Keep an O(1) lookup map keyed by "${session_id}|${detail_index}"
  const starredMap = useMemo(() => {
    const m = new Map();
    for (const f of favorites) {
      const key = pointerKey(f.session_id, f.detail_index);
      if (key) m.set(key, f);
    }
    return m;
  }, [favorites]);

  const reload = useCallback(async () => {
    const code = userCodeRef.current;
    if (!code) {
      setFavorites([]);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: err } = await loadFavoritesCloud(code);
    if (err) {
      setError(err);
      setLoading(false);
      return;
    }
    setFavorites(Array.isArray(data?.favorites) ? data.favorites : []);
    setLoading(false);
  }, []);

  // Mount: read saved code and fetch
  useEffect(() => {
    if (typeof window === "undefined") return;
    userCodeRef.current = (getSavedCode() || "").toUpperCase().trim() || null;
    reload();
  }, [reload]);

  const isStarred = useCallback(
    (sessionId, detailIndex) => {
      const key = pointerKey(sessionId, detailIndex);
      return key ? starredMap.has(key) : false;
    },
    [starredMap],
  );

  const toggleStar = useCallback(
    async (sessionId, detailIndex, snapshot, subject = "bs") => {
      const code = userCodeRef.current;
      if (!code) {
        setError("登录后可以收藏错题");
        return;
      }
      const key = pointerKey(sessionId, detailIndex);
      if (!key) {
        setError("无法定位错题（缺少 sessionId/detailIndex）");
        return;
      }

      const existing = starredMap.get(key);
      if (existing) {
        // Unstar — optimistic remove
        const prev = favorites;
        setFavorites((cur) => cur.filter((f) => f.id !== existing.id));
        const { error: err } = await removeFavoriteCloud(code, { id: existing.id });
        if (err) {
          // rollback
          setFavorites(prev);
          setError(err);
        }
        return;
      }

      // Star — optimistic add (placeholder id; replaced on response)
      const tempId = `tmp-${Date.now()}-${Math.random()}`;
      const optimistic = {
        id: tempId,
        subject,
        session_id: sessionId,
        detail_index: detailIndex,
        snapshot,
        note: null,
        created_at: new Date().toISOString(),
      };
      setFavorites((cur) => [optimistic, ...cur]);
      const { data, error: err } = await addFavoriteCloud(code, {
        subject,
        sessionId,
        detailIndex,
        snapshot,
      });
      if (err) {
        // rollback
        setFavorites((cur) => cur.filter((f) => f.id !== tempId));
        setError(err);
        return;
      }
      // Replace optimistic item with server-returned record
      const server = data?.favorite;
      if (server) {
        setFavorites((cur) => cur.map((f) => (f.id === tempId ? server : f)));
      }
    },
    [favorites, starredMap],
  );

  return {
    favorites,
    isStarred,
    toggleStar,
    loading,
    error,
    reload,
  };
}
