import { supabase } from "./supabase";

const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

function normalizeCode(code) {
  return String(code || "").toUpperCase().trim();
}

function generateCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

export async function createUser() {
  if (!supabase) return { code: null, error: "Supabase not configured" };

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateCode();
    const { data, error } = await supabase
      .from("users")
      .insert({ code })
      .select("code")
      .single();

    if (!error) return { code: data?.code || code, error: null };
    if (error.code === "23505") continue;
    return { code: null, error: error.message || "Create user failed" };
  }

  return { code: null, error: "Failed to generate unique code" };
}

export async function verifyCode(code) {
  if (!supabase) return { valid: false, error: "Supabase not configured" };

  const normalized = normalizeCode(code);
  if (!normalized || normalized.length !== CODE_LENGTH) {
    return { valid: false, error: "Invalid code" };
  }

  const { data, error } = await supabase
    .from("users")
    .select("code")
    .eq("code", normalized)
    .single();

  if (error || !data) return { valid: false, error: "Invalid code" };

  await supabase
    .from("users")
    .update({ last_login: new Date().toISOString() })
    .eq("code", normalized);

  return { valid: true, error: null };
}

