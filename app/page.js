"use client";

import { Suspense, useEffect } from "react";
import LoginGate from "../components/LoginGate";
import HomePageClient from "../components/home/HomePageClient";
import { setCurrentUser } from "../lib/sessionStore";

function PageInner({ userCode, userTier, userEmail, authMethod, isLoggedIn, showLoginModal, onLogout }) {
  useEffect(() => { setCurrentUser(userCode); }, [userCode]);
  return (
    <HomePageClient
      userCode={userCode}
      userTier={userTier}
      userEmail={userEmail}
      authMethod={authMethod}
      isLoggedIn={isLoggedIn}
      showLoginModal={showLoginModal}
      onLogout={onLogout}
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LoginGate>
        {(props) => <PageInner {...props} />}
      </LoginGate>
    </Suspense>
  );
}
