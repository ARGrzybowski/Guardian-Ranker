// keepalive.js
import { createClient } from "@supabase/supabase-js";

// --- Supabase credentials ---
const SUPABASE_URL = "https://vmwdspxtlryiypqacmmx.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtd2RzcHh0bHJ5aXlwcWFjbW14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5NDE0ODIsImV4cCI6MjA3MDUxNzQ4Mn0.6iGGFoRCTtvV-EI7ZRER_EmjQfDnY2EY3OujcsS3soE";

// --- Create Supabase client ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function keepAlive() {
  try {
    // Query a harmless row just to keep DB alive
    const { data, error } = await supabase
      .from("leaderboard")
      .select("bungie_name")
      .limit(1);

    if (error) throw error;
    console.log("[KeepAlive] Success:", new Date().toISOString(), data);
  } catch (err) {
    console.error("[KeepAlive] Failed:", err.message);
  }
}

keepAlive();
