const $=id=>document.getElementById(id);
let currentUser=null, lastActivityId=0;

async function api(path, options={}) {
  const r=await fetch(path,{headers:{"content-type":"application/json",...(options.headers||{})},...options});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.error||"Something went wrong");
  return d;
}
function show(id,on=true){$(id).classList.toggle("hidden",!on)}
function msg(id,text){$(id).textContent=text}

document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");
  show("loginForm",b.dataset.tab==="login");show("signupForm",b.dataset.tab==="signup");
  msg("authMsg","");
});

$("loginForm").onsubmit=async e=>{
  e.preventDefault();msg("authMsg","Signing in…");
  try{await api("/api/login",{method:"POST",body:JSON.stringify({email:$("loginEmail").value,password:$("loginPassword").value})});await refresh();}
  catch(err){msg("authMsg",err.message)}
};
$("signupForm").onsubmit=async e=>{
  e.preventDefault();msg("authMsg","Creating account…");
  try{await api("/api/signup",{method:"POST",body:JSON.stringify({name:$("signupName").value,email:$("signupEmail").value,password:$("signupPassword").value})});await refresh();}
  catch(err){msg("authMsg",err.message)}
};
$("logout").onclick=async()=>{await api("/api/logout",{method:"POST"});location.reload()};

$("profileForm").onsubmit=async e=>{
  e.preventDefault();
  try{await api("/api/profile",{method:"POST",body:JSON.stringify({name:$("profileName").value,bio:$("profileBio").value})});msg("profileMsg","Profile updated.");await refresh();}
  catch(err){msg("profileMsg",err.message)}
};
$("messageForm").onsubmit=async e=>{
  e.preventDefault();
  try{await api("/api/message",{method:"POST",body:JSON.stringify({message:$("messageText").value})});$("messageText").value="";msg("messageMsg","Message sent.");}
  catch(err){msg("messageMsg",err.message)}
};
$("formForm").onsubmit=async e=>{
  e.preventDefault();
  try{await api("/api/form",{method:"POST",body:JSON.stringify({subject:$("formSubject").value,details:$("formDetails").value})});$("formForm").reset();msg("formMsg","Form submitted.");}
  catch(err){msg("formMsg",err.message)}
};

async function refresh(){
  const d=await api("/api/me");currentUser=d.user;
  show("auth",!currentUser);show("landing",!currentUser);show("dashboard",!!currentUser);show("logout",!!currentUser);
  if(!currentUser)return;
  $("userName").textContent=currentUser.name;$("roleBadge").textContent=currentUser.role;
  $("profileName").value=currentUser.name;$("profileBio").value=currentUser.bio||"";
  if(currentUser.role==="admin"){show("admin",true);loadAdmin();}else show("admin",false);
}
async function loadAdmin(){
  try{
    const [a,u]=await Promise.all([api("/api/admin/activity"),api("/api/admin/users")]);
    $("statUsers").textContent=u.users.length;$("statEvents").textContent=a.activities.length;
    $("activityRows").innerHTML=a.activities.map(x=>`<tr><td>${new Date(x.created_at).toLocaleString()}</td><td>${esc(x.name||"System")}<br><small>${esc(x.email||"")}</small></td><td><b>${esc(x.type)}</b></td><td>${esc(x.details||"")}</td></tr>`).join("");
    $("userRows").innerHTML=u.users.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${esc(x.role)}</td><td>${new Date(x.created_at).toLocaleString()}</td></tr>`).join("");
    const newest=a.activities[0]?.id||0;
    if(lastActivityId && newest>lastActivityId && Notification.permission==="granted"){
      const fresh=a.activities.filter(x=>x.id>lastActivityId).slice().reverse();
      fresh.forEach(x=>new Notification("Taufik Portal",{body:`${x.name||"Someone"}: ${x.type}`}));
    }
    lastActivityId=Math.max(lastActivityId,newest);
  }catch(e){}
}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
$("notifyBtn").onclick=async()=>{
  if(!("Notification"in window)){alert("Browser notifications are not supported here.");return}
  const p=await Notification.requestPermission();
  $("notifyBtn").textContent=p==="granted"?"Notifications enabled":"Notifications not enabled";
};
refresh().catch(()=>{});
setInterval(()=>{if(currentUser?.role==="admin")loadAdmin()},5000);
