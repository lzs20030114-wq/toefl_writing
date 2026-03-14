import { supabase } from "./supabase";

/**
 * Send email OTP verification code via Supabase Auth.
 */
export async function sendEmailOTP(email) {
  if (!supabase) return { error: "Supabase not configured" };

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });

  if (error) return { error: error.message };
  return { error: null };
}

/**
 * Verify email OTP, then link/create user record via server API.
 * Returns { userCode, tier, email, auth_method, isNewUser, error }
 */
export async function verifyEmailOTP(email, token) {
  if (!supabase) return { userCode: null, error: "Supabase not configured" };

  const { data: authData, error: authError } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (authError) return { userCode: null, error: authError.message };

  const authUid = authData.user?.id;
  if (!authUid) return { userCode: null, error: "验证失败" };

  // Call server API to create/find user record
  try {
    const res = await fetch("/api/auth/email-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, authUid }),
    });
    const body = await res.json();
    if (!res.ok) return { userCode: null, error: body?.error || "账户创建失败" };
    return {
      userCode: body.code,
      tier: body.tier || "free",
      email: body.email || email,
      auth_method: body.auth_method || "email",
      isNewUser: body.isNewUser || false,
      error: null,
    };
  } catch {
    return { userCode: null, error: "服务器请求失败" };
  }
}

/**
 * Bind email to an existing code user.
 * Prerequisites: user has verified OTP for the target email.
 */
export async function verifyBindEmail(userCode, email, token) {
  if (!supabase) return { error: "Supabase not configured" };

  // Verify OTP first
  const { data: authData, error: authError } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (authError) return { error: authError.message };

  const authUid = authData.user?.id;

  // Call server API to bind email
  try {
    const res = await fetch("/api/auth/bind-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userCode, email, authUid }),
    });
    const body = await res.json();
    if (!res.ok) return { error: body?.error || "绑定失败" };
    return { error: null };
  } catch {
    return { error: "服务器请求失败" };
  }
}

/**
 * Sign out from Supabase Auth.
 */
export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}
