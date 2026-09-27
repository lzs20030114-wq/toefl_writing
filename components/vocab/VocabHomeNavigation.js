"use client";

import { createContext, useContext } from "react";

const VocabHomeNavigation = createContext(null);

export function VocabHomeNavigationProvider({ navigate, children }) {
  return <VocabHomeNavigation.Provider value={navigate}>{children}</VocabHomeNavigation.Provider>;
}

export function useVocabHomeNavigation() {
  return useContext(VocabHomeNavigation);
}
