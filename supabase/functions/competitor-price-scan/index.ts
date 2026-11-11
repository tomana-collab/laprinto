
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
const url = Deno.env.get("SUPABASE_URL")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(url, service);
const cors = {"access-control-allow-origin":"*","access-control-allow-headers":"authorization, apikey, content-type, x-cron-secret","content-type":"application/json; charset=utf-8"};
const respond = (obj:unknown,status=200)=>new Response(JSON.stringify(obj),{status,headers:cors});
function normalizePrice(raw:unknown):number|null{
 if(typeof raw==="number"){return Number.isFinite(raw)&&raw>0&&raw<100000?Math.round(raw*100)/100:null;}
 if(typeof raw!=="string")return null;
 let s=raw.trim().replace(/[^\d.,]/g,"");
 if(!s)return null;
 if(s.includes(",")&&s.includes("."))s=s.lastIndexOf(".")>s.lastIndexOf(",")?s.replaceAll(",",""):s.replaceAll(".","").replace(",",".");
 else if(s.includes(",")&&/,\d{1,2}$/.test(s))s=s.replace(",",".");
 else if(s.includes(",")&&/,\d{3}$/.test(s))s=s.replaceAll(",","");
 else if(s.includes(".")&&/\.\d{3}$/.test(s))s=s.replaceAll(".","");
 const v=Number(s);return Number.isFinite(v)&&v>0&&v<100000?Math.round(v*100)/100:null;
}
function jsonLdObjects(node:unknown):Record<string,unknown>[]{
 if(Array.isArray(node))return node.flatMap(jsonLdObjects);
 if(node&&typeof node==="object"){
  const v=node as Record<string,unknown>;
  return [v,...(v["@graph"]?jsonLdObjects(v["@graph"]):[])];
 }
 return [];
}
function priceFromHtml(html:string, expectedSku:string|null):{price:number;sku_verified:boolean;method:string}|null{
 const found:{price:number;sku_verified:boolean;method:string}[]=[];
 const ld=/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
 let m:RegExpExecArray|null;
 while((m=ld.exec(html))!==null){
  try{
   const data=JSON.parse(m[1]);
   for(const obj of jsonLdObjects(data)){
    const typ=String(obj["@type"]||"").toLowerCase();
    if(!typ.includes("product"))continue;
    const sku=String(obj.sku||obj.mpn||"").trim().toUpperCase();
    if(expectedSku&&sku&&sku!==expectedSku.toUpperCase())continue;
    const offers=Array.isArray(obj.offers)?obj.offers:[obj.offers];
    for(const offer of offers)if(offer&&typeof offer==="object"){
      const offerObj=offer as Record<string,unknown>;
      const currency=String(offerObj.priceCurrency||"ILS").toUpperCase();
      if(currency!=="ILS"&&currency!=="NIS")continue;
      const p=normalizePrice(offerObj.price??(offerObj.priceSpecification as Record<string,unknown>|undefined)?.price??offerObj.lowPrice);
      if(p!==null)found.push({price:p,sku_verified:!!expectedSku&&sku===expectedSku.toUpperCase(),method:"json_ld_product"});
    }
   }
  }catch{}
 }
 if(found.length){found.sort((a,b)=>Number(b.sku_verified)-Number(a.sku_verified));return found[0];}
 const meta=/<meta\b[^>]*>/gi;
 while((m=meta.exec(html))!==null){
   const tag=m[0]; const attr=(key:string)=>{const a=tag.match(new RegExp("\\b"+key+"\\s*=\\s*([\"'])(.*?)\\1","i"));return a?a[2]:null};
   const prop=String(attr("property")||attr("itemprop")||attr("name")||"").toLowerCase();
   if(!["product:price:amount","og:price:amount","price"].includes(prop))continue;
   const amount=normalizePrice(attr("content"));
   if(amount!==null)return {price:amount,sku_verified:false,method:"product_price_meta"};
 }
 return null;
}
function validateLink(productUrl:string,domain:string):URL|null{
 try{
  const u=new URL(productUrl);
  const host=u.hostname.toLowerCase();
  const base=domain.toLowerCase().replace(/^www\./,"");
  if(host==="localhost"||host.includes(":")||/^[\d.]+$/.test(host)||!host.includes("."))return null; // בלי כתובות IP/פנימיות
  if(u.protocol!=="https:" || u.port || (host!==base&&host!=="www."+base))return null;
  if(!u.pathname||u.pathname==="/")return null;
  if(/(?:^|\/)(?:wp-admin|wp-json|admin|api|login)(?:\/|$)/i.test(u.pathname))return null;
  return u;
 }catch{return null;}
}

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
// הגבלת קצב לפי דומיין: לפחות 2 שניות בין שתי בקשות לאותה חנות
const lastHit=new Map<string,number>();
async function throttle(host:string){
 const wait=(lastHit.get(host)||0)+2000-Date.now();
 if(wait>0)await sleep(wait);
 lastHit.set(host,Date.now());
}
// Timeout לכל בקשה; ניסיון חוזר עם backoff רק בשגיאת רשת/timeout/5xx. חסימה (403/429) לא עוקפים ולא מנסים שוב.
async function fetchWithRetry(href:string,host:string):Promise<Response>{
 let lastErr:unknown=null;
 for(let attempt=0;attempt<3;attempt++){
  if(attempt>0)await sleep(1500*attempt*attempt);
  await throttle(host);
  const ctl=new AbortController();
  const timer=setTimeout(()=>ctl.abort(),11000);
  try{
   const r=await fetch(href,{redirect:"manual",signal:ctl.signal,headers:{"accept":"text/html,application/xhtml+xml","user-agent":"Mozilla/5.0 (compatible; LaprintoPriceCheck/1.0)"}});
   if(r.status>=500&&attempt<2){await r.body?.cancel();lastErr=new Error("HTTP "+r.status);continue;}
   return r;
  }catch(e){lastErr=e;}
  finally{clearTimeout(timer);}
 }
 throw lastErr instanceof Error?lastErr:new Error(String(lastErr));
}
async function runOne(row:any,productRemoved=false){
 const offerId=String(row.offer_id);
 let status="error",price:number|null=null,http_status:number|null=null,detail="";
 const saveResult=async()=>{
  const {error}=await admin.from("competitor_scan_attempts").insert({offer_id:offerId,result:status,http_status,parsed_price:price,details:detail.slice(0,800)});
  if(error)throw new Error("scan_attempt_insert: "+error.message);
 };
 try{
  if(productRemoved){status="not_available";detail="Laprinto product removed from store; competitor price history kept";await saveResult();return {offer_id:offerId,result:status};}
  const safe=validateLink(String(row.competitor_url),String(row.store_domain));
  if(!safe){status="invalid_page";detail="URL does not match approved store host";await saveResult();return {offer_id:offerId,result:status};}
  // הפניה (301/302...) מותרת רק לכתובת באותה חנות מאושרת (למשל www או שינוי סיומת), עד 3 קפיצות.
  // הפניה לדומיין אחר או לעמוד כניסה נחשבת חסימה ולא נעקפת.
  let target=safe;
  let response=await fetchWithRetry(target.href,target.hostname);
  for(let hop=0;hop<3&&[301,302,303,307,308].includes(response.status);hop++){
   const loc=response.headers.get("location");
   let next:URL|null=null;
   try{next=loc?validateLink(new URL(loc,target.href).href,String(row.store_domain)):null;}catch{next=null;}
   if(!next)break;
   await response.body?.cancel();
   target=next;
   response=await fetchWithRetry(target.href,target.hostname);
  }
  http_status=response.status;
  if([301,302,303,307,308,401,403,429].includes(response.status)){status="blocked";detail="Redirect or access denied (not bypassed)";await response.body?.cancel();await saveResult();return {offer_id:offerId,result:status,http_status};}
  if(response.status===404||response.status===410){status="not_available";detail="HTTP "+response.status;await response.body?.cancel();await saveResult();return {offer_id:offerId,result:status,http_status};}
  if(!response.ok){status="http_error";detail="HTTP "+response.status;await response.body?.cancel();await saveResult();return {offer_id:offerId,result:status,http_status};}
  const contentType=response.headers.get("content-type")||"";
  if(!contentType.includes("text/html")){status="invalid_page";detail="Not an HTML document";await response.body?.cancel();await saveResult();return {offer_id:offerId,result:status};}
  const declaredSize=Number(response.headers.get("content-length")||"0");
  if(declaredSize>4000000){status="invalid_page";detail="HTML too large";await response.body?.cancel();await saveResult();return {offer_id:offerId,result:status};}
  const reader=response.body?.getReader();
  if(!reader)throw new Error("Empty response body");
  const chunks:Uint8Array[]=[];let length=0;
  while(true){
   const r=await reader.read();if(r.done)break;
   length+=r.value.length;if(length>4000000){await reader.cancel();throw new Error("HTML too large");}
   chunks.push(r.value);
  }
  const buf=new Uint8Array(length);let pos=0;for(const chunk of chunks){buf.set(chunk,pos);pos+=chunk.length;}
  const html=new TextDecoder().decode(buf);
  if(/(?:<h1[^>]*>\s*(?:404|not found)|product not found|page not found)/i.test(html.slice(0,12000))){status="not_available";detail="Page appears unavailable";await saveResult();return {offer_id:offerId,result:status};}
  const extracted=priceFromHtml(html,row.competitor_sku);
  if(!extracted){status="no_price";detail="No reliable ILS JSON-LD or product-price meta";await saveResult();return {offer_id:offerId,result:status};}
  price=extracted.price;
  // רק מחיר תקין נשמר כבדיקת מחיר; בכשל המחיר התקין האחרון נשאר כמות שהוא
  const {error}=await admin.from("competitor_price_checks").insert({offer_id:offerId,price,availability:"unknown",collection_method:"direct_product_page",source_url:safe.href,source_crawl_hint:"automated approved-offer scan",note:"Price from "+extracted.method+"; no shipping included; "+(extracted.sku_verified?"SKU corroborated":"SKU not exposed; user-approved match")});
  if(error)throw new Error(error.message);
  status="success";detail=extracted.method;
  await saveResult();return {offer_id:offerId,result:status,price};
 }catch(err){
  status="error";detail=String(err instanceof Error?err.message:err);
  try{await saveResult();}catch{}
  return {offer_id:offerId,result:status,detail:detail.slice(0,150)};
 }
}

// עבודה שממשיכה אחרי שהתשובה נשלחה (סביבת Supabase Edge)
function background(p:Promise<unknown>){
 const safe=p.catch(e=>console.error("background",e));
 // @ts-ignore EdgeRuntime קיים בסביבת Supabase
 if(typeof EdgeRuntime!=="undefined"&&EdgeRuntime.waitUntil)EdgeRuntime.waitUntil(safe);
}
const BATCH=15;
const LOCK_MS=4*60*1000;

// בודק מוצרים שהוסרו מהחנות (נשמרים בלי מחיקה) כדי לא לסרוק עבורם
async function removedProducts(rows:any[]):Promise<Set<string>>{
 const ids=[...new Set(rows.map(r=>r.product_id))];
 if(!ids.length)return new Set();
 const {data}=await admin.from("products").select("id").in("id",ids).not("wc_removed_at","is",null);
 return new Set((data||[]).map((p:any)=>p.id));
}

function chainNext(){
 // ממשיכים לקבוצה הבאה מיד (בנוסף ל-cron שרץ כל 2 דקות ככיסוי)
 background((async()=>{await sleep(1500);await admin.rpc("cron_continue_scan");})());
}

async function startRun(trigger:string){
 // ריצה תקועה (מעל שעתיים) מסומנת ככישלון כדי לא לחסום ריצות חדשות
 await admin.from("job_runs").update({status:"failed",finished_at:new Date().toISOString(),locked_until:null,errors:[{error:"נתקעה ולא הסתיימה תוך שעתיים"}]}).eq("job_type","price_scan").eq("status","running").lt("started_at",new Date(Date.now()-2*3600*1000).toISOString());
 const {count}=await admin.from("v_competitor_price_targets").select("offer_id",{count:"exact",head:true});
 const {data,error}=await admin.from("job_runs").insert({job_type:"price_scan",trigger,status:"running",records_total:count||0,cursor:"",meta:{batch:BATCH}}).select("id").single();
 if(error){
  if(error.code==="23505")return {already_running:true};
  throw new Error(error.message);
 }
 return {run_id:data.id,total:count||0};
}

async function continueRun(){
 const {data:run}=await admin.from("job_runs").select("*").eq("job_type","price_scan").eq("status","running").order("started_at",{ascending:false}).limit(1).maybeSingle();
 if(!run)return {idle:true};
 // נעילה אטומית לקבוצה אחת בכל פעם — מונעת סריקה כפולה
 const nowIso=new Date().toISOString();
 const {data:locked}=await admin.from("job_runs").update({locked_until:new Date(Date.now()+LOCK_MS).toISOString()}).eq("id",run.id).or(`locked_until.is.null,locked_until.lt.${nowIso}`).select("id");
 if(!locked?.length)return {locked:true};
 try{
  const {data:rows,error}=await admin.from("v_competitor_price_targets").select("*").order("offer_id").gt("offer_id",run.cursor||"00000000-0000-0000-0000-000000000000").limit(BATCH);
  if(error)throw new Error(error.message);
  const removed=await removedProducts(rows||[]);
  let ok=0,bad=0;const errs:any[]=Array.isArray(run.errors)?[...run.errors]:[];
  for(const row of rows||[]){
   const r:any=await runOne(row,removed.has(row.product_id));
   if(r.result==="success")ok++;else{bad++;if(errs.length<50)errs.push({offer_id:r.offer_id,result:r.result,detail:r.detail||null});}
  }
  const done=(rows?.length||0)<BATCH;
  const total=(run.success_count||0)+ok,fail=(run.failure_count||0)+bad;
  await admin.from("job_runs").update({
   cursor:rows?.length?rows[rows.length-1].offer_id:run.cursor,
   success_count:total,failure_count:fail,errors:errs,locked_until:null,
   ...(done?{status:fail===0?"success":total===0?"failed":"partial",finished_at:new Date().toISOString()}:{}),
  }).eq("id",run.id);
  if(!done)chainNext();
  return {run_id:run.id,processed:rows?.length||0,done};
 }catch(e){
  await admin.from("job_runs").update({locked_until:null,errors:[...(Array.isArray(run.errors)?run.errors:[]),{error:String(e instanceof Error?e.message:e).slice(0,300)}]}).eq("id",run.id);
  throw e;
 }
}

// אימות דו-שלבי: למשתמש עם גורם אימות מאומת, טוקן של שלב ראשון בלבד (aal1) לא מספיק
function mfaSatisfied(user: any, bearer: string): boolean {
  const hasMfa = (user?.factors || []).some((f: any) => f.status === 'verified')
  if (!hasMfa) return true
  try {
    const payload = JSON.parse(atob(bearer.replace(/^Bearer\s+/i, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.aal === 'aal2'
  } catch { return false }
}

// מי קורא: סוד פנימי של ה-cron (נבדק מול Vault), או אדמין מחובר
async function authenticate(req:Request):Promise<"cron"|"admin"|null>{
 const cron=req.headers.get("x-cron-secret");
 if(cron){
  const {data}=await admin.rpc("verify_cron_secret",{p:cron});
  return data===true?"cron":null;
 }
 const bearer=req.headers.get("authorization")||"";
 if(!bearer.startsWith("Bearer "))return null;
 const client=createClient(url,anon,{global:{headers:{Authorization:bearer}}});
 const {data:{user},error:userError}=await client.auth.getUser();
 if(userError||!user?.email)return null;
 if(!mfaSatisfied(user,bearer))return null;
 const {data:members,error:memErr}=await admin.from("team_members").select("id").ilike("email",user.email).eq("role","אדמין").limit(1);
 return !memErr&&members?.length?"admin":null;
}

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return respond({error:"Method not allowed"},405);
 const who=await authenticate(req);
 if(!who)return respond({error:"Unauthorized"},401);
 const body=await req.json().catch(()=>({}));
 try{
  // סריקת הצעה בודדת (כפתור "סרוק מוצר זה")
  if(body?.offer_id){
   if(typeof body.offer_id!=="string"||!/^[0-9a-f-]{36}$/i.test(body.offer_id))return respond({error:"Invalid offer id"},400);
   const {data,error}=await admin.from("v_competitor_price_targets").select("*").eq("offer_id",body.offer_id);
   if(error)return respond({error:error.message},500);
   const removed=await removedProducts(data||[]);
   const results=[];for(const row of data||[])results.push(await runOne(row,removed.has(row.product_id)));
   return respond({scanned:results.length,results,next_after:null});
  }
  // התחלת ריצה מלאה בתור ("סרוק עכשיו" / 08:00)
  if(body?.start){
   const r=await startRun(who==="cron"?"cron":"manual");
   if("already_running" in r)return respond({ok:false,already_running:true},409);
   // ה-cron לא מחכה לתשובה: הקבוצה רצה ברקע. מהפורטל מחזירים את תוצאת הקבוצה הראשונה
   if(who==="cron"){background(continueRun());return respond({ok:true,...r,background:true},202);}
   const c=await continueRun();
   return respond({ok:true,...r,first_batch:c});
  }
  // המשך תור קיים (cron כל 2 דקות / שרשור עצמי)
  if(body?.continue){
   if(who==="cron"){background(continueRun());return respond({ok:true,background:true},202);}
   return respond({ok:true,...(await continueRun())});
  }
  // תאימות לאחור: קריאה ישנה עם limit/after, בלי תיעוד ריצה
  const limit=Math.min(20,Math.max(1,Number(body?.limit)||10));
  const after=String(body?.after||"");
  let query=admin.from("v_competitor_price_targets").select("*").order("offer_id").limit(limit);
  if(after)query=query.gt("offer_id",after);
  const {data,error}=await query;
  if(error)return respond({error:error.message},500);
  const removed=await removedProducts(data||[]);
  const results=[];for(const row of data||[])results.push(await runOne(row,removed.has(row.product_id)));
  return respond({scanned:results.length,results,next_after:data?.length===limit?data[data.length-1].offer_id:null});
 }catch(e){
  return respond({error:String(e instanceof Error?e.message:e).slice(0,300)},500);
 }
});
