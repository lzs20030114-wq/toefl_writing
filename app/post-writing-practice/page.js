"use client";

import LoginGate from "../../components/LoginGate";
import { PostWritingPracticePage } from "../../components/writing/PostWritingPracticePage";
import { setCurrentUser } from "../../lib/sessionStore";

export default function PostWritingPracticeRoute() {
  return (
    <LoginGate>
      {({ userCode }) => {
        setCurrentUser(userCode);
        return <PostWritingPracticePage />;
      }}
    </LoginGate>
  );
}
