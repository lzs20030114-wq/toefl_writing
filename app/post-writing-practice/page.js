"use client";

import { useEffect } from "react";
import LoginGate from "../../components/LoginGate";
import { PostWritingPracticePage } from "../../components/writing/PostWritingPracticePage";
import { setCurrentUser } from "../../lib/sessionStore";

function RouteInner({ userCode }) {
  useEffect(() => { setCurrentUser(userCode); }, [userCode]);
  return <PostWritingPracticePage />;
}

export default function PostWritingPracticeRoute() {
  return (
    <LoginGate>
      {({ userCode }) => <RouteInner userCode={userCode} />}
    </LoginGate>
  );
}
