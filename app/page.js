"use client";

import LoginGate from "../components/LoginGate";
import HomePageClient from "../components/home/HomePageClient";
import { setCurrentUser } from "../lib/sessionStore";

export default function Page() {
  return (
    <LoginGate>
      {({ userCode, userTier, userEmail, authMethod, onLogout }) => {
        setCurrentUser(userCode);
        return (
          <HomePageClient
            userCode={userCode}
            userTier={userTier}
            userEmail={userEmail}
            authMethod={authMethod}
            onLogout={onLogout}
          />
        );
      }}
    </LoginGate>
  );
}
