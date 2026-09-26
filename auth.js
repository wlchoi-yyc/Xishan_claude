// Shared Teaching games authorization: authorizedUsers/<lower-case email> exists.
const gate=document.getElementById('authGate'),message=document.getElementById('authMessage'),login=document.getElementById('googleLoginButton'),signout=document.getElementById('authLogout'),experience=document.getElementById('experience');
let authorized=false,loaded=false,version=0,unsubscribe=null;
function lock(text){authorized=false;experience.hidden=true;gate.hidden=false;gate.style.display='grid';document.body.classList.add('auth-locked');message.textContent=text;window.dispatchEvent(new Event('teaching-auth-lock'));}
function showError(error){const code=error?.code||'';message.textContent=code==='auth/popup-closed-by-user'?'登入已取消，請再試一次。':code==='auth/popup-blocked'?'請允許此網站開啟 Google 登入視窗後再試。':code==='auth/unauthorized-domain'?'此網址尚未完成登入設定，請稍後再試。':'未能確認使用權限，請重新登入再試。';}
async function boot(){
 if(!window.firebase)throw new Error('Firebase SDK unavailable');
 const response=await fetch('/__/firebase/init.json',{cache:'no-store'});if(!response.ok)throw new Error('Configuration unavailable');
 const config=await response.json();if(config.projectId!=='mulan-journey')throw new Error('Unexpected Firebase project');
 firebase.initializeApp(config);const auth=firebase.auth(),db=firebase.firestore();auth.useDeviceLanguage();
 const provider=new firebase.auth.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
 login.disabled=false;
 login.addEventListener('click',async()=>{login.disabled=true;message.textContent='正在登入……';try{await auth.signInWithPopup(provider)}catch(error){showError(error)}finally{if(!authorized)login.disabled=false}});
 signout.addEventListener('click',async()=>{lock('正在登出……');try{await auth.signOut()}catch{message.textContent='登出未完成，請再試。'}});
 auth.onAuthStateChanged(async user=>{
  const check=++version;if(unsubscribe){unsubscribe();unsubscribe=null}lock(user?'正在檢查使用權限……':'請使用獲授權的 Google 帳號登入');login.disabled=!!user;
  if(!user){login.disabled=false;return}
  const uid=user.uid,email=(user.email||'').trim().toLowerCase();
  const current=()=>check===version&&auth.currentUser?.uid===uid;
  try{
   if(!email)throw new Error('Missing email');
   const ref=db.collection('authorizedUsers').doc(email);
   // Server-only initial check prevents a cached, revoked grant unlocking the page.
   const permission=await ref.get({source:'server'});if(!current())return;
   if(!permission.exists){lock('此 Google 帳號未獲授權。請改用獲授權的帳號登入。');login.disabled=false;return}
   authorized=true;gate.hidden=true;gate.style.display='none';experience.hidden=false;document.body.classList.remove('auth-locked');
   if(!loaded){loaded=true;try{await import('./js/main.js')}catch(error){loaded=false;throw error}}
   if(!current())return;
   unsubscribe=ref.onSnapshot({includeMetadataChanges:true},snapshot=>{
    if(!current()||snapshot.metadata.fromCache)return;
    if(!snapshot.exists){lock('此帳號的使用權限已取消。');login.disabled=false}
   },()=>{if(current()){lock('未能確認使用權限，請重新登入。');login.disabled=false}});
  }catch(error){if(!current())return;lock('未能確認使用權限，請重新登入再試。');showError(error);login.disabled=false}
 });
}
boot().catch(()=>{lock('登入服務未能載入，請重新整理網頁。');login.disabled=true});
