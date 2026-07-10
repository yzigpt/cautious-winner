import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import {
  SUPABASE_ADMIN_EMAIL,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from "./supabase-config.js";

const placeholderValues = [
  "https://YOUR-PROJECT.supabase.co",
  "YOUR_SUPABASE_ANON_KEY",
  "admin@example.com",
];

const configError =
  "Настройте Supabase в файле supabase-config.js: укажите URL проекта, anon key и email администратора.";

function isPlaceholder(value) {
  return !value || placeholderValues.includes(value);
}

function normalizeProjectUrl(value) {
  try {
    const url = new URL(value);
    // Supabase client expects the project root, not the REST endpoint itself.
    url.pathname = url.pathname.replace(/\/rest\/v1\/?$/, "") || "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

const projectUrl = normalizeProjectUrl(SUPABASE_URL);

const configured =
  !isPlaceholder(SUPABASE_URL) &&
  !isPlaceholder(SUPABASE_ANON_KEY) &&
  !isPlaceholder(SUPABASE_ADMIN_EMAIL);

const supabase = configured
  ? createClient(projectUrl, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function isSupabaseConfigured() {
  return configured;
}

export function getSupabaseConfigError() {
  return configError;
}

export function getSupabase() {
  if (!supabase) {
    throw new Error(configError);
  }

  return supabase;
}

export { SUPABASE_ADMIN_EMAIL };
