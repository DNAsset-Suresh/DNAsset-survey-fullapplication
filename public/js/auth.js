import { api,setSession } from './api.js';
import { icon,toast,wireForm } from './ui.js';
export function loginScreen(onLogin){
 document.querySelector('#app').innerHTML=`
  <div class="login-page">
    <section class="login-story">
      <a class="brand" href="#dashboard">
        <img src="/favicon.svg" alt="">
        <span>DNAssets<small>PROPERTY INTELLIGENCE</small></span>
      </a>
      <div>
        <span class="eyebrow">CLARITY AT EVERY STEP</span>
        <h1>Good decisions<br>start with<br>complete records.</h1>
        <p>Your property documents, verification, and progress. Together in one secure workspace.</p>
      </div>
      <small>Survey Number Verification & Document Tracking System</small>
    </section>
    <section class="login-panel">
      <form id="login-form">
        <span class="eyebrow">YOUR DNAssets WORKSPACE</span>
        <h2>Welcome back.</h2>
        <p>Sign in to keep your property records moving.</p>
        <p class="small">Your username is recorded from your signed-in account.</p>
        <label>Email ID
          <input type="text" id="login_email" name="email" autocomplete="username" required placeholder="reviewer@dnassets.com">
        </label>
        <label>Password
          <div class="password-input-group">
            <input type="password" id="login_password" name="password" autocomplete="current-password" required placeholder="Enter your password">
            <button type="button" class="password-toggle-btn" data-toggle-pw="login_password" title="Show or hide password">${icon('eye')}</button>
          </div>
        </label>
        <button class="button primary full" type="submit">Sign in ${icon('arrow')}</button>

        <div class="login-quick-accounts" style="margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border, #e2e8f0);">
          <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted, #64748b); font-weight: 600; display: block; margin-bottom: 8px;">Quick Sign-in Credentials:</span>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <button type="button" class="button small-button" data-fill-login="admin@dnassets.com" data-fill-pass="admin123" style="text-align: left; justify-content: space-between; font-size: 12px; padding: 6px 10px;">
              <span><strong>Admin:</strong> admin@dnassets.com</span>
              <code style="background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 4px;">admin123</code>
            </button>
            <button type="button" class="button small-button" data-fill-login="reviewer@dnassets.com" data-fill-pass="reviewer123" style="text-align: left; justify-content: space-between; font-size: 12px; padding: 6px 10px;">
              <span><strong>Reviewer:</strong> reviewer@dnassets.com</span>
              <code style="background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 4px;">reviewer123</code>
            </button>
            <button type="button" class="button small-button" data-fill-login="dna.callus@gmail.com" data-fill-pass="dna.suresh123" style="text-align: left; justify-content: space-between; font-size: 12px; padding: 6px 10px;">
              <span><strong>DN Assets:</strong> dna.callus@gmail.com</span>
              <code style="background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 4px;">dna.suresh123</code>
            </button>
          </div>
        </div>
      </form>
    </section>
  </div>`;

 const toggleBtn = document.querySelector('[data-toggle-pw]');
 if (toggleBtn) {
   toggleBtn.onclick = () => {
     const target = document.querySelector('#' + toggleBtn.dataset.togglePw);
     if (target) target.type = target.type === 'password' ? 'text' : 'password';
   };
 }

 document.querySelectorAll('[data-fill-login]').forEach(btn => {
   btn.onclick = () => {
     const emailInput = document.querySelector('#login_email');
     const passInput = document.querySelector('#login_password');
     if (emailInput) emailInput.value = btn.dataset.fillLogin;
     if (passInput) passInput.value = btn.dataset.fillPass;
   };
 });

 wireForm(document.querySelector('#login-form'),async data=>{const session=await api('/auth/login',{method:'POST',body:Object.fromEntries(data),publicRequest:true});setSession(session);await onLogin();});
}
export async function logout(){try{await api('/auth/logout',{method:'POST'});setSession(null);location.reload();}catch(error){toast(error.message,true);}}
