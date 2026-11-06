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

        <p id="login-error" class="login-error" role="alert" hidden></p>
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

 wireForm(document.querySelector('#login-form'), async data => {
   const errorBox = document.querySelector('#login-error');
   errorBox.hidden = true;
   try {
     const session = await api('/auth/login', { method: 'POST', body: Object.fromEntries(data), publicRequest: true, timeoutMs: 25000 });
     setSession(session);
     await onLogin();
   } catch (error) {
     errorBox.textContent = error.message;
     errorBox.hidden = false;
     throw error;
   }
 });
}
export async function logout(){try{await api('/auth/logout',{method:'POST'});setSession(null);location.reload();}catch(error){toast(error.message,true);}}
