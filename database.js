const SUPABASE_URL = 'https://vmwdspxtlryiypqacmmx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtd2RzcHh0bHJ5aXlwcWFjbW14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5NDE0ODIsImV4cCI6MjA3MDUxNzQ4Mn0.6iGGFoRCTtvV-EI7ZRER_EmjQfDnY2EY3OujcsS3soE'; 

let client;
export function getDatabase() {
  if (!globalThis.supabase) throw new Error('Leaderboard database is unavailable.');
  return client ??= globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}
