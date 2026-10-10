import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({error:"Method not allowed"},405);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply({error:"Server secrets are not configured"},500);
  const token = req.headers.get("Authorization"); if (!token) return reply({error:"Login required"},401);
  const caller = createClient(url, anon, { global:{headers:{Authorization:token}} });
  const {data:{user},error:authErr} = await caller.auth.getUser();
  if (authErr || !user) return reply({error:"Invalid session"},401);
  const admin = createClient(url, service, {auth:{autoRefreshToken:false,persistSession:false}});
  const {data:profile} = await admin.from("ham_profiles").select("role").eq("user_id",user.id).maybeSingle();
  if (profile?.role !== "manager") return reply({error:"Manager only"},403);
  let b:any; try { b=await req.json(); } catch { return reply({error:"Invalid JSON"},400); }
  const phone=String(b.phone||"").trim(), full_name=String(b.full_name||"").trim(), password=String(b.password||""), team_id=String(b.team_id||"");
  if (!phone || !full_name || password.length<8 || !team_id) return reply({error:"Phone, name, team and password (8+ characters) are required"},400);
  const {data:team,error:teamErr}=await admin.from("ham_teams").select("id").eq("id",team_id).maybeSingle();
  if (teamErr || !team) return reply({error:"Team not found"},400);
  const {data:created,error:createErr}=await admin.auth.admin.createUser({phone,password,phone_confirm:true,user_metadata:{full_name}});
  if (createErr || !created.user) return reply({error:createErr?.message||"Could not create account"},400);
  const {error:profileErr}=await admin.from("ham_profiles").insert({user_id:created.user.id,full_name,role:"coach",team_id,phone});
  if (profileErr) { await admin.auth.admin.deleteUser(created.user.id); return reply({error:profileErr.message},400); }
  const {error:teamUpdateErr}=await admin.from("ham_teams").update({coach_user_id:created.user.id}).eq("id",team_id);
  if (teamUpdateErr) return reply({error:"Account created but team assignment failed: "+teamUpdateErr.message},500);
  return reply({ok:true,user_id:created.user.id,full_name,phone,team_id});
});
