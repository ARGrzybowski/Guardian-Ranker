import { createEdgeHandler } from '../../../worker/edge.mjs';

Deno.serve(createEdgeHandler({
  url: Deno.env.get('SUPABASE_URL')!,
  key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  apiKey: Deno.env.get('BUNGIE_API_KEY') || undefined
}));
