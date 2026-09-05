const COOKIE = "tk_session";
const SESSION_DAYS = 7;

function json(data, status=200, extra={}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"content-type":"application/json; charset=utf-8", ...extra}
  });
}

function nowISO() { return new Date().toISOString(); }

function bytesToB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
}

function b64ToBytes(s) {
  s = s.replaceAll("-","+").replaceAll("_","/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bytesToB64(new Uint8Array(buf));
}

async function passwordHash(password) {
  const salt = crypto.randomUUID();
  const digest = await sha256(`${salt}:${password}`);
  return `${salt}$${digest}`;
}

async function passwordVerify(password, stored) {
  const [salt, digest] = stored.split("$");
  if (!salt || !digest) return false;
  return (await sha256(`${salt}:${password}`)) === digest;
}

function cookieToken(headers) {
  const raw = headers.get("cookie") || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function sessionCookie(token, maxAge=SESSION_DAYS*86400) {
  return `${COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

async function createSession(env, userId) {
  const token = bytesToB64(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const expires = new Date(Date.now()+SESSION_DAYS*86400*1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
    .bind(tokenHash, userId, expires).run();
  return token;
}

async function getUser(request, env) {
  const token = cookieToken(request.headers);
  if (!token) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT u.id,u.name,u.email,u.role,u.bio
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?
  `).bind(hash, nowISO()).first();
  return row || null;
}

async function activity(env, userId, type, details="") {
  await env.DB.prepare("INSERT INTO activities(user_id,type,details) VALUES(?,?,?)")
    .bind(userId || null, type, details).run();
}

async function ensureAdmin(env) {
  const email = env.ADMIN_EMAIL;
  const password = env.ADMIN_PASSWORD;
  if (!email || !password) return;
  const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email.toLowerCase()).first();
  if (!exists) {
    const hash = await passwordHash(password);
    const r = await env.DB.prepare(
      "INSERT INTO users(name,email,password_hash,role,bio) VALUES(?,?,?,?,?)"
    ).bind("Taufik Admin", email.toLowerCase(), hash, "admin", "Site administrator").run();
    await activity(env, r.meta.last_row_id, "admin_created", "Initial administrator account created");
  }
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function clean(s, max=2000) {
  return String(s ?? "").trim().slice(0,max);
}

async function api(request, env, url) {
  await ensureAdmin(env);
  const path = url.pathname;
  const method = request.method;
  let user = await getUser(request, env);

  if (method === "GET" && path === "/api/me") {
    return json({user});
  }

  if (method === "POST" && path === "/api/signup") {
    const b = await request.json().catch(()=>({}));
    const name = clean(b.name, 80), email = clean(b.email, 160).toLowerCase(), password = String(b.password||"");
    if (!name || !validateEmail(email) || password.length < 8) {
      return json({error:"Name, valid email and password of at least 8 characters are required."},400);
    }
    const existing = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
    if (existing) return json({error:"An account with this email already exists."},409);
    const hash = await passwordHash(password);
    const r = await env.DB.prepare(
      "INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'user')"
    ).bind(name,email,hash).run();
    const token = await createSession(env, r.meta.last_row_id);
    await activity(env, r.meta.last_row_id, "signup", "New account created");
    return json({ok:true},200,{"Set-Cookie":sessionCookie(token)});
  }

  if (method === "POST" && path === "/api/login") {
    const b = await request.json().catch(()=>({}));
    const email = clean(b.email,160).toLowerCase(), password = String(b.password||"");
    const row = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
    if (!row || !(await passwordVerify(password,row.password_hash))) {
      return json({error:"Invalid email or password."},401);
    }
    const token = await createSession(env,row.id);
    await activity(env,row.id,"login","Successful login");
    return json({ok:true},200,{"Set-Cookie":sessionCookie(token)});
  }

  if (method === "POST" && path === "/api/logout") {
    const token = cookieToken(request.headers);
    if (token) {
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
    }
    if (user) await activity(env,user.id,"logout","User logged out");
    return json({ok:true},200,{"Set-Cookie":sessionCookie("",0)});
  }

  if (!user) return json({error:"Login required."},401);

  if (method === "POST" && path === "/api/profile") {
    const b = await request.json().catch(()=>({}));
    const name = clean(b.name,80), bio = clean(b.bio,500);
    if (!name) return json({error:"Name is required."},400);
    await env.DB.prepare("UPDATE users SET name=?,bio=?,updated_at=? WHERE id=?")
      .bind(name,bio,nowISO(),user.id).run();
    await activity(env,user.id,"profile_change","Profile name/bio updated");
    return json({ok:true});
  }

  if (method === "POST" && path === "/api/message") {
    const b = await request.json().catch(()=>({}));
    const message = clean(b.message,2000);
    if (!message) return json({error:"Message cannot be empty."},400);
    await env.DB.prepare("INSERT INTO messages(user_id,message) VALUES(?,?)").bind(user.id,message).run();
    await activity(env,user.id,"message","New message submitted");
    return json({ok:true});
  }

  if (method === "POST" && path === "/api/form") {
    const b = await request.json().catch(()=>({}));
    const subject = clean(b.subject,160), details = clean(b.details,3000);
    if (!subject || !details) return json({error:"Subject and details are required."},400);
    await env.DB.prepare("INSERT INTO form_submissions(user_id,subject,details) VALUES(?,?,?)")
      .bind(user.id,subject,details).run();
    await activity(env,user.id,"form_submit",`Form submitted: ${subject}`);
    return json({ok:true});
  }

  if (user.role === "admin" && method === "GET" && path === "/api/admin/activity") {
    const rows = await env.DB.prepare(`
      SELECT a.id,a.type,a.details,a.created_at,u.name,u.email
      FROM activities a LEFT JOIN users u ON u.id=a.user_id
      ORDER BY a.id DESC LIMIT 100
    `).all();
    return json({activities:rows.results});
  }

  if (user.role === "admin" && method === "GET" && path === "/api/admin/users") {
    const rows = await env.DB.prepare(`
      SELECT id,name,email,role,bio,created_at,updated_at
      FROM users ORDER BY id DESC LIMIT 200
    `).all();
    return json({users:rows.results});
  }

  return json({error:"Not found"},404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request,env,url);
    return env.ASSETS.fetch(request);
  }
};
