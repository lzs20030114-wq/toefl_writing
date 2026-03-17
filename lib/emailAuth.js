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
 * Returns { userCode, tier, email, auth_method, has_password, isNewUser, error }
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
      has_password: body.has_password || false,
      isNewUser: body.isNewUser || false,
      error: null,
    };
  } catch {
    return { userCode: null, error: "服务器请求失败" };
  }
}

/**
 * Sign in with email + password via Supabase Auth, then sync user record.
 * Returns { userCode, tier, email, auth_method, has_password, error }
 */
export async function signInWithPassword(email, password) {
  if (!supabase) return { userCode: null, error: "Supabase not configured" };

  const { data, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError) return { userCode: null, error: authError.message };

  const authUid = data.user?.id;
  if (!authUid) return { userCode: null, error: "登录失败" };

  // Reuse email-login route to sync user record
  try {
    const res = await fetch("/api/auth/email-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, authUid }),
    });
    const body = await res.json();
    if (!res.ok) return { userCode: null, error: body?.error || "账户同步失败" };

    // Self-healing: password login succeeded but flag is false
    if (!body.has_password) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          await fetch("/api/auth/set-password-flag", {
            method: "POST",
            headers: { "Authorization": "Bearer " + session.access_token },
          });
        }
      } catch { /* non-critical */ }
      body.has_password = true;
    }

    return {
      userCode: body.code,
      tier: body.tier || "free",
      email: body.email || email,
      auth_method: body.auth_method || "email",
      has_password: body.has_password || false,
      error: null,
    };
  } catch {
    return { userCode: null, error: "服务器请求失败" };
  }
}

/**
 * Set or update password for the currently authenticated Supabase user.
 * Returns { error }
 */
export async function setPassword(password) {
  if (!supabase) return { error: "Supabase not configured" };

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) return { error: updateError.message };

  // Get current session token for authenticated server call
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { error: "无法获取会话信息" };

  // Set has_password flag on server using verified token
  try {
    const res = await fetch("/api/auth/set-password-flag", {
      method: "POST",
      headers: { "Authorization": "Bearer " + session.access_token },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body?.error || "设置密码标记失败" };
    }
  } catch {
    return { error: "服务器请求失败" };
  }

  return { error: null };
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
