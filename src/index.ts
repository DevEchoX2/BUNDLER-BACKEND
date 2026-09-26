import { createClient } from '@supabase/supabase-js';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  HELIUS_API_KEY: string;
  COINSNAP_SECRET: string;
  AI: any;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === '/api/webhooks/coinsnap' && request.method === 'POST') {
      try {
        const payload = await request.json() as any;
        if (payload.type === 'Settled' || payload.status === 'PAID') {
          await supabase
            .from('users')
            .update({ tier: 'pro' })
            .eq('email', payload.customer_email);
        }
        return new Response(JSON.stringify({ received: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Webhook Error' }), { status: 400, headers: corsHeaders });
      }
    }

    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(token || '');

    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    if (url.pathname === '/api/ai-chat' && request.method === 'POST') {
      const { prompt } = await request.json() as { prompt: string };
      const { data: profile } = await supabase.from('profiles').select('ai_prompts, tier').eq('id', user.id).single();
      
      if (profile?.tier === 'free' && profile?.ai_prompts >= 10) {
        return new Response(JSON.stringify({ error: 'Limit reached' }), { status: 403, headers: corsHeaders });
      }
      
      const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
        messages: [{ role: 'user', content: prompt }]
      });

      if (profile?.tier === 'free') {
        await supabase.from('profiles').update({ ai_prompts: profile.ai_prompts + 1 }).eq('id', user.id);
      }
      return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    if (url.pathname === '/api/solana-tracker' && request.method === 'GET') {
      const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
      const rpcRequest = await fetch(heliusUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'getHealth', params: [] })
      });
      const data = await rpcRequest.json();
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    return new Response(JSON.stringify({ error: 'Route not found' }), { 
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
};
